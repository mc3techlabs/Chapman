/**
 * Read-only drift check (docs/security-architecture-plan.md §5 Phase 0).
 *
 * Proves - rather than assumes - that a target Supabase project's actual
 * installed functions, triggers, and RLS policies match what
 * supabase/migrations/*.sql defines. This is the tool that would have caught
 * defect 9 (bootstrap.sql's old "authFix" block silently installing a
 * different on_auth_user_created trigger than the migrations define) before
 * it ever reached a real project, instead of needing a manual code review
 * to notice the divergence.
 *
 * This script NEVER issues anything other than SELECT statements against
 * either database. It does not create, alter, or drop anything, and it does
 * not require or accept a service-role/superuser credential beyond whatever
 * read access the catalog introspection itself needs (pg_proc, pg_trigger,
 * pg_policies, pg_class are all readable by the connecting role's normal
 * catalog visibility).
 *
 * How it works: rather than parsing CREATE FUNCTION/POLICY text out of the
 * migration files (fragile - Postgres's own renderer reformats a function
 * body in ways a naive text diff would false-positive on), it compares two
 * LIVE databases using the identical introspection queries on both sides:
 *
 *   EXPECTED_DB_URL - a database supabase/migrations/*.sql has just been
 *                     applied to (a scratch/reference database - e.g. the
 *                     disposable local database used to verify this phase,
 *                     or a fresh Supabase branch/project built for this
 *                     purpose). This defines "what should be there."
 *   TARGET_DB_URL   - the project being audited (e.g. staging or
 *                     production). This defines "what's actually there."
 *
 * Usage:
 *   EXPECTED_DB_URL="postgresql://...scratch-db..." \
 *   TARGET_DB_URL="postgresql://...project-to-audit..." \
 *     npx tsx scripts/drift-check.ts
 *
 * Exit code is 0 only if every compared object matches exactly; 1 otherwise
 * (including if either connection fails), so this is safe to use as a CI
 * gate once there's somewhere to run it against repeatedly.
 */
import pg from "pg";

const expectedUrl = process.env.EXPECTED_DB_URL;
const targetUrl = process.env.TARGET_DB_URL;

if (!expectedUrl || !targetUrl) {
  console.error(
    "Missing EXPECTED_DB_URL and/or TARGET_DB_URL.\n" +
      "EXPECTED_DB_URL: a database supabase/migrations/*.sql has just been applied to.\n" +
      "TARGET_DB_URL: the project to audit against it."
  );
  process.exit(1);
}
if (expectedUrl === targetUrl) {
  console.error("EXPECTED_DB_URL and TARGET_DB_URL are identical - comparing a database against itself proves nothing.");
  process.exit(1);
}

interface FunctionRow {
  proname: string;
  identity_args: string;
  def: string;
}
interface TriggerRow {
  table_name: string;
  tgname: string;
  def: string;
}
interface PolicyRow {
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
}
interface RlsRow {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
}
interface GrantRow {
  table_name: string;
  grantee: string;
  privilege_type: string;
}

async function fetchAll(url: string) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const functions = (
      await client.query<FunctionRow>(`
        select p.proname,
               pg_get_function_identity_arguments(p.oid) as identity_args,
               pg_get_functiondef(p.oid) as def
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          -- Exclude anything owned by an extension (e.g. pgcrypto's digest/
          -- gen_salt/hmac/pgp_*): those aren't defined by our migrations at
          -- all, so comparing them is noise, not drift.
          and not exists (
            select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
          )
        order by p.proname, identity_args;
      `)
    ).rows;

    const triggers = (
      await client.query<TriggerRow>(`
        select t.tgrelid::regclass::text as table_name, t.tgname, pg_get_triggerdef(t.oid) as def
        from pg_trigger t
        where not t.tgisinternal
        order by table_name, t.tgname;
      `)
    ).rows;

    const policies = (
      await client.query<PolicyRow>(`
        select tablename, policyname, permissive, roles::text[] as roles, cmd, qual, with_check
        from pg_policies
        where schemaname = 'public'
        order by tablename, policyname;
      `)
    ).rows;

    const rls = (
      await client.query<RlsRow>(`
        select relname, relrowsecurity, relforcerowsecurity
        from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'
        order by relname;
      `)
    ).rows;

    const grants = (
      await client.query<GrantRow>(`
        select table_name, grantee, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
        order by table_name, grantee, privilege_type;
      `)
    ).rows;

    return { functions, triggers, policies, rls, grants };
  } finally {
    await client.end();
  }
}

function normalize(sql: string): string {
  // pg_get_functiondef/triggerdef already normalize formatting consistently
  // for a given Postgres version, so this just collapses incidental
  // whitespace differences rather than attempting any semantic parsing.
  return sql.replace(/\s+/g, " ").trim();
}

function byKey<T>(rows: T[], keyFn: (r: T) => string): Map<string, T> {
  return new Map(rows.map((r) => [keyFn(r), r]));
}

let driftFound = false;

function reportSection<T>(
  title: string,
  expectedRows: T[],
  targetRows: T[],
  keyFn: (r: T) => string,
  renderFn: (r: T) => string,
  informational = false
) {
  const expected = byKey(expectedRows, keyFn);
  const target = byKey(targetRows, keyFn);
  const allKeys = new Set([...expected.keys(), ...target.keys()]);
  const lines: string[] = [];

  for (const key of [...allKeys].sort()) {
    const e = expected.get(key);
    const t = target.get(key);
    if (e && !t) {
      lines.push(`  MISSING IN TARGET: ${key}`);
      if (!informational) driftFound = true;
    } else if (!e && t) {
      lines.push(`  EXTRA IN TARGET (not defined by any migration): ${key}`);
      if (!informational) driftFound = true;
    } else if (e && t) {
      const a = normalize(renderFn(e));
      const b = normalize(renderFn(t));
      if (a !== b) {
        lines.push(`  DRIFT: ${key}`);
        lines.push(`    expected: ${a}`);
        lines.push(`    target:   ${b}`);
        if (!informational) driftFound = true;
      }
    }
  }

  console.log(`\n${title} (${allKeys.size} compared)${informational ? " [informational only]" : ""}`);
  if (lines.length === 0) {
    console.log("  no differences");
  } else {
    for (const l of lines) console.log(l);
  }
}

const [expected, target] = await Promise.all([fetchAll(expectedUrl), fetchAll(targetUrl)]);

reportSection(
  "Functions (public schema)",
  expected.functions,
  target.functions,
  (r) => `${r.proname}(${r.identity_args})`,
  (r) => r.def
);

reportSection(
  "Triggers",
  expected.triggers,
  target.triggers,
  (r) => `${r.table_name}.${r.tgname}`,
  (r) => r.def
);

reportSection(
  "RLS policies",
  expected.policies,
  target.policies,
  (r) => `${r.tablename}.${r.policyname}`,
  (r) => `${r.permissive} ${r.cmd} roles=${r.roles.join(",")} using=${r.qual ?? ""} check=${r.with_check ?? ""}`
);

reportSection(
  "RLS enabled/forced per table",
  expected.rls,
  target.rls,
  (r) => r.relname,
  (r) => `enabled=${r.relrowsecurity} forced=${r.relforcerowsecurity}`
);

// Grants aren't managed by any migration here (RLS is the actual boundary),
// so these are reported for a human to eyeball, not held to a strict match.
reportSection(
  "Table grants to anon/authenticated/service_role",
  expected.grants,
  target.grants,
  (r) => `${r.table_name}.${r.grantee}.${r.privilege_type}`,
  (r) => `${r.table_name}.${r.grantee}.${r.privilege_type}`,
  true
);

console.log(driftFound ? "\nDRIFT DETECTED - target does not match the expected (migrated) state." : "\nNo drift detected.");
process.exit(driftFound ? 1 : 0);
