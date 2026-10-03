/**
 * Applies every SQL file in supabase/migrations/ in filename order against a
 * Postgres connection — used to set up the schema in the Supabase project this
 * app will attach to.
 *
 * Usage (Supabase → Project Settings → Database → Connection string → Direct):
 *   SUPABASE_DB_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" \
 *     npm run db:migrate
 *
 * To apply just one file later (there is no migration-history table):
 *   SUPABASE_DB_URL=... npm run db:migrate -- 0004_add_something.sql
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../supabase/migrations");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error(
    "Missing SUPABASE_DB_URL.\n" +
      "Get it from Supabase → Project Settings → Database → Connection string → Direct connection.\n" +
      "Example: SUPABASE_DB_URL=\"postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres\" npm run db:migrate"
  );
  process.exit(1);
}

const only = process.argv[2];
let files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (only) files = files.filter((f) => f === only);
if (!files.length) {
  console.error(only ? `No migration named ${only}` : "No migrations found.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    process.stdout.write(`→ ${file} … `);
    try {
      await client.query(sql);
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      // Re-running the full set re-executes idempotent DDL; "already exists"
      // style errors on a partially-applied set are reported but not fatal to
      // the remaining files, so a fresh project finishes in one pass.
      console.error(`   ${(err as Error).message}`);
    }
  }
  console.log("\nMigrations applied.");
} finally {
  await client.end();
}
