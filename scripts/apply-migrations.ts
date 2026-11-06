/**
 * Applies every SQL file in supabase/migrations/ in filename order against a
 * Postgres connection — used to set up the schema in the Supabase project this
 * app will attach to.
 *
 * Phase 0 hardening (docs/security-architecture-plan.md §5): this runner used
 * to log a per-file error and keep going, then unconditionally print
 * "Migrations applied." at the end regardless of how many files had actually
 * failed - an operator had no reliable signal anything was wrong. It now:
 *
 *   - takes a Postgres advisory lock for the run, so two concurrent applies
 *     against the same database can't interleave;
 *   - tracks every applied migration by name + a SHA-256 checksum of its
 *     content in supabase_migrations.schema_migrations, and refuses to
 *     proceed if an already-applied file's content has changed since
 *     (rather than silently re-running or silently ignoring it);
 *   - runs each migration in its own transaction, rolled back on any error;
 *   - supports --dry-run, which runs every pending migration inside a
 *     transaction that is always rolled back, reporting what WOULD happen
 *     without changing the database or recording anything as applied;
 *   - stops immediately on the first failure, never applies a later file
 *     once an earlier one has failed, and exits non-zero - there is no
 *     longer any code path that prints a success message after a failure.
 *
 * Usage (Supabase → Project Settings → Database → Connection string → Direct):
 *   SUPABASE_DB_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" \
 *     npm run db:migrate
 *
 * To apply just one file later:
 *   SUPABASE_DB_URL=... npm run db:migrate -- 0008_add_something.sql
 *
 * To see what would happen without changing anything:
 *   SUPABASE_DB_URL=... npm run db:migrate -- --dry-run
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../supabase/migrations");

// A fixed, arbitrary 64-bit key identifying "a Chapman migration run" to
// Postgres's advisory lock namespace. Any two processes calling
// pg_try_advisory_lock with this same key contend for the same lock,
// regardless of which database/session they're on otherwise.
const ADVISORY_LOCK_KEY = 847_201_993_001n;

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error(
    "Missing SUPABASE_DB_URL.\n" +
      "Get it from Supabase → Project Settings → Database → Connection string → Direct connection.\n" +
      "Example: SUPABASE_DB_URL=\"postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres\" npm run db:migrate"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.find((a) => !a.startsWith("--"));

let files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (only) files = files.filter((f) => f === only);
if (!files.length) {
  console.error(only ? `No migration named ${only}` : "No migrations found.");
  process.exit(1);
}

function checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function ensureTrackingTable(client: pg.Client): Promise<void> {
  await client.query(`create schema if not exists supabase_migrations;`);
  await client.query(`
    create table if not exists supabase_migrations.schema_migrations (
      version    text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    );
  `);
}

async function loadAppliedMap(client: pg.Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ version: string; checksum: string }>(
    `select version, checksum from supabase_migrations.schema_migrations;`
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

let lockHeld = false;
let failed = false;

try {
  await client.connect();

  const { rows: lockRows } = await client.query<{ ok: boolean }>(
    `select pg_try_advisory_lock($1::bigint) as ok;`,
    [ADVISORY_LOCK_KEY.toString()]
  );
  lockHeld = lockRows[0]?.ok === true;
  if (!lockHeld) {
    console.error(
      "Could not acquire the migration advisory lock - another migration run appears to be in " +
        "progress against this database. Refusing to proceed to avoid two applies interleaving."
    );
    process.exit(1);
  }

  await ensureTrackingTable(client);
  const applied = await loadAppliedMap(client);

  // Dry run needs every pending file's effects visible to the files after it
  // (0003 references tables 0001 creates, etc.), so it runs the whole pending
  // batch inside ONE outer transaction - via per-file SAVEPOINTs, not one
  // begin/rollback per file - and only ever rolls that single transaction
  // back at the very end. A real apply still commits each file individually,
  // so an earlier file's success survives a later file's failure.
  if (dryRun) await client.query("begin");

  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    const sum = checksum(sql);
    const priorSum = applied.get(file);

    if (priorSum !== undefined) {
      if (priorSum === sum) {
        console.log(`→ ${file} … already applied (checksum matches), skipping`);
        continue;
      }
      console.error(
        `→ ${file} … FAILED\n` +
          `   This migration is recorded as already applied, but its content has changed ` +
          `since (checksum ${priorSum.slice(0, 12)}… recorded vs ${sum.slice(0, 12)}… on disk). ` +
          `Refusing to re-run or silently ignore a modified already-applied file. ` +
          `If this change is intentional, give it a new migration number instead of editing ` +
          `an applied one.`
      );
      failed = true;
      break;
    }

    process.stdout.write(`→ ${file} … `);
    try {
      if (dryRun) {
        await client.query("savepoint file_sp");
        await client.query(sql);
        console.log("ok (dry run)");
      } else {
        await client.query("begin");
        await client.query(sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, checksum) values ($1, $2);`,
          [file, sum]
        );
        await client.query("commit");
        console.log("ok");
      }
    } catch (err) {
      await client.query(dryRun ? "rollback to savepoint file_sp" : "rollback").catch(() => undefined);
      console.log("FAILED");
      console.error(`   ${(err as Error).message}`);
      failed = true;
      break;
    }
  }

  if (dryRun) await client.query("rollback");
} finally {
  if (lockHeld) {
    await client.query(`select pg_advisory_unlock($1::bigint);`, [ADVISORY_LOCK_KEY.toString()]).catch(() => undefined);
  }
  await client.end();
}

if (failed) {
  console.error("\nMigration run FAILED - stopped before applying any later file. Nothing after the failed file ran.");
  process.exit(1);
}

console.log(dryRun ? "\nDry run complete - no changes were committed." : "\nMigrations applied.");
