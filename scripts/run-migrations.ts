/**
 * Applies .sql files in supabase/migrations, in filename order, to a
 * Supabase Postgres database via a direct connection (not the pooler —
 * DDL and multi-statement files need a plain session).
 *
 *   SUPABASE_DB_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" \
 *   npm run db:migrate
 *
 * Get the direct connection string from Project Settings -> Database ->
 * Connection string -> Direct connection.
 *
 * These files aren't tracked for idempotency (no migration-history table) —
 * running the full set twice will fail on `create policy` statements that
 * don't guard against already existing. Pass a filename to apply just one
 * (e.g. a later fix-up migration on a database that already has the rest):
 *
 *   npm run db:migrate -- 0005_drop_rubric_items_code_unique.sql
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("Set SUPABASE_DB_URL before running this script.");
  process.exit(1);
}

async function main() {
  const only = process.argv[2];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !only || f === only)
    .sort();

  if (only && files.length === 0) {
    console.error(`No migration file named ${only} in ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`Applying ${file}...`);
      await client.query(sql);
    }
    console.log("All migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
