/**
 * Generates supabase/bootstrap.sql — a single, self-contained, idempotent script
 * that you paste into the Supabase SQL Editor with the anon/service key (no DB
 * password, no network access from the sandbox needed).
 *
 * Phase 0 (security-architecture-plan.md §4.1, §5) requires exactly one
 * source of truth for the schema: supabase/migrations/0001...NNNN. This
 * generator's only job is to mechanically reproduce that schema plus seed
 * data for a one-paste SQL Editor workflow — it must never define, redefine,
 * or override any function, trigger, or policy beyond exactly what the
 * numbered migrations already say. (An earlier version of this script did
 * exactly that via an "authFix" block that silently replaced the migrations'
 * own on_auth_user_created trigger with a different, metadata-trusting one —
 * that was the root cause of defect 9 in the security plan, and the same
 * logic was also what made supabase/fix-auth-profiles.sql dangerous. Both
 * are gone. If the schema needs new behavior, it belongs in a new numbered
 * migration, reviewed like any other, not in this generator.)
 *
 * The script:
 *   1. Concatenates supabase/migrations/0001...0007 verbatim, in order. They
 *      are already written with `if not exists` / `create or replace` /
 *      `drop ... if exists`, so running this on a project that already has
 *      *some* of the schema only creates what is missing — it never drops
 *      or overwrites your data.
 *   2. Seeds all lookup data, geography, the two rubric versions with 300
 *      items, the 879-chapter roster, and the 7 document types — all
 *      idempotent.
 *
 * This generator does not converge an older, pre-0001 scaffold (a prior
 * prototype lineage, not this repo's migration history) to the current
 * schema — if such a project exists, run `npm run db:migrate` against it
 * directly and use `npm run drift-check` (see scripts/drift-check.ts) to
 * confirm the result matches, rather than relying on a generator silently
 * patching unknown gaps.
 *
 * Run: npm run gen:bootstrap
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const SEED = resolve(ROOT, "supabase/seed");
const MIG = resolve(ROOT, "supabase/migrations");
const OUT = resolve(ROOT, "supabase/bootstrap.sql");

/* ------------------------------- CSV parser ------------------------------ */
function readCsv(name) {
  const text = readFileSync(resolve(SEED, name), "utf8");
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/* ------------------------------- SQL literals ---------------------------- */
// Always a quoted literal (empty string -> ''). For non-nullable text columns.
const L = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";
// Nullable text: empty -> null.
const LN = (s) => (s === undefined || s === null || s === "" ? "null" : L(s));
const B = (v) => (v === "true" || v === "1" ? "true" : "false");
const I = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? String(Math.trunc(n)) : String(d); };

// Build "( <cell>, <cell> ),\n  ..." from rows given an array of mapper fns,
// one per output column.
function valRows(rows, mappers) {
  return rows
    .map((r) => "(" + mappers.map((m) => m(r)).join(", ") + ")")
    .join(",\n  ");
}

/* ------------------------------- 1. schema ------------------------------- */
// Every *.sql file in supabase/migrations/, in filename order - the same
// list scripts/apply-migrations.ts applies. A hardcoded list here was
// exactly the kind of silent drift Phase 0 exists to eliminate: it would
// have needed a manual, easy-to-forget edit on every new migration,
// otherwise bootstrap.sql would quietly fall behind what db:migrate
// actually installs.
const schema = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(MIG, f), "utf8"))
  .join("\n\n");

/* ------------------------------- 2. seed --------------------------------- */
const lookups = () => {
  const ct = readCsv("chapter_types.csv");
  const cs = readCsv("chapter_statuses.csv");
  const ar = readCsv("app_roles.csv");
  const rt = readCsv("report_terms.csv");
  const rg = readCsv("regions.csv");
  const di = readCsv("districts.csv");

  return `-- ------------------------------ lookups ----------------------------------
insert into public.chapter_types (code, label) values
  ${valRows(ct, [(r) => L(r.code), (r) => L(r.label)])}
on conflict (code) do update set label = excluded.label;

insert into public.chapter_statuses (code, label, sort_order, is_active) values
  ${valRows(cs, [(r) => L(r.code), (r) => L(r.label), (r) => I(r.sort_order), (r) => B(r.is_active)])}
on conflict (code) do update set
  label = excluded.label, sort_order = excluded.sort_order, is_active = excluded.is_active;

insert into public.app_roles (code, label, sort_order) values
  ${valRows(ar, [(r) => L(r.code), (r) => L(r.label), (r) => I(r.sort_order)])}
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into public.report_terms (code, label, sort_order) values
  ${valRows(rt, [(r) => L(r.code), (r) => L(r.label), (r) => I(r.sort_order)])}
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

-- ------------------------------ geography --------------------------------
insert into public.regions (code, name, sort_order) values
  ${valRows(rg, [(r) => L(r.code), (r) => L(r.name), (r) => I(r.sort_order)])}
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.districts (code, name, region_code) values
  ${valRows(di, [(r) => L(r.code), (r) => L(r.name), (r) => L(r.region_code)])}
on conflict (code) do update set name = excluded.name, region_code = excluded.region_code;
`;
};

const rubric = () => {
  const vers = readCsv("rubric_versions.csv");
  const secs = readCsv("rubric_sections.csv");
  const subs = readCsv("rubric_subsections.csv");
  const items = readCsv("rubric_items.csv");

  return `-- ------------------------------ rubric -----------------------------------
insert into public.rubric_versions (version_code, version_name, chapter_type_code, reporting_year, is_active) values
  ${valRows(vers, [
    (r) => L(r.version_code),
    (r) => L(r.version_name),
    (r) => L(r.chapter_type_code),
    (r) => (r.reporting_year ? I(r.reporting_year) : "null"),
    (r) => B(r.is_active),
  ])}
on conflict (version_code) do update set
  version_name = excluded.version_name,
  chapter_type_code = excluded.chapter_type_code,
  is_active = excluded.is_active;

insert into public.rubric_sections (rubric_version_id, section_code, section_name, display_order, active)
select rv.id, v.section_code, v.section_name, v.display_order, v.active
from (values
  ${valRows(secs, [
    (r) => L(r.rubric_version_code),
    (r) => L(r.section_code),
    (r) => L(r.section_name),
    (r) => I(r.display_order),
    (r) => B(r.active),
  ])}
) as v(rubric_version_code, section_code, section_name, display_order, active)
join public.rubric_versions rv on rv.version_code = v.rubric_version_code
on conflict (rubric_version_id, section_code) do update set
  section_name = excluded.section_name, display_order = excluded.display_order, active = excluded.active;

insert into public.rubric_subsections (rubric_section_id, subsection_code, subsection_name, display_order, active)
select rs.id, v.subsection_code, v.subsection_name, v.display_order, v.active
from (values
  ${valRows(subs, [
    (r) => L(r.rubric_version_code),
    (r) => L(r.section_code),
    (r) => L(r.subsection_code),
    (r) => L(r.subsection_name),
    (r) => I(r.display_order),
    (r) => B(r.active),
  ])}
) as v(rubric_version_code, section_code, subsection_code, subsection_name, display_order, active)
join public.rubric_versions rv on rv.version_code = v.rubric_version_code
join public.rubric_sections rs on rs.rubric_version_id = rv.id and rs.section_code = v.section_code
on conflict (rubric_section_id, subsection_code) do update set
  subsection_name = excluded.subsection_name, display_order = excluded.display_order, active = excluded.active;

-- Rubric items: criterion_code repeats within a version (it is a label, not a
-- key), so this is guarded to insert a version''s items only once. Re-running
-- the script leaves existing items untouched.
insert into public.rubric_items (
  rubric_version_id, rubric_section_id, rubric_subsection_id,
  criterion_code, criterion_text, item_type, is_required,
  default_point_value, mandatory_penalty, display_order, active
)
select rv.id, rs.id, rsub.id,
       v.criterion_code, v.criterion_text, v.item_type, v.is_required,
       v.default_point_value, 0, v.display_order, v.active
from (values
  ${valRows(items, [
    (r) => L(r.rubric_version_code),
    (r) => L(r.section_code),
    (r) => L(r.subsection_code),
    (r) => L(r.criterion_code),
    (r) => L(r.criterion_text),
    (r) => L(r.item_type === "metric" ? "metric" : "activity"),
    (r) => B(r.is_required),
    (r) => I(r.default_point_value, 1),
    (r) => I(r.display_order),
    (r) => B(r.active),
  ])}
) as v(rubric_version_code, section_code, subsection_code, criterion_code, criterion_text,
       item_type, is_required, default_point_value, display_order, active)
join public.rubric_versions rv on rv.version_code = v.rubric_version_code
join public.rubric_sections rs on rs.rubric_version_id = rv.id and rs.section_code = v.section_code
join public.rubric_subsections rsub on rsub.rubric_section_id = rs.id and rsub.subsection_code = v.subsection_code
where not exists (
  select 1 from public.rubric_items ri where ri.rubric_version_id = rv.id
);
`;
};

const chapters = () => {
  const all = readCsv("chapters.csv");
  const rows = all.filter((r) => r.district && r.region);
  return `-- ------------------------------ chapters (${rows.length}) -------------------------------
insert into public.chapters (
  chapter_key, chapter_name, chapter_type_code, university,
  district, region, status_code, is_dechartered
) values
  ${valRows(rows, [
    (r) => L(r.chapter_key),
    (r) => L(r.chapter_name),
    (r) => L(r.chapter_type_code),
    (r) => LN(r.university),
    (r) => L(r.district),
    (r) => L(r.region),
    (r) => L(r.status_code),
    (r) => B(r.is_dechartered),
  ])}
on conflict (chapter_key) do update set
  chapter_name = excluded.chapter_name,
  chapter_type_code = excluded.chapter_type_code,
  university = excluded.university,
  district = excluded.district,
  region = excluded.region,
  status_code = excluded.status_code,
  is_dechartered = excluded.is_dechartered;
`;
};

const documents = () => {
  const dt = readCsv("document_types.csv");
  const arr = (s) => {
    const parts = (s || "").split(",").map((x) => x.trim()).filter(Boolean);
    return parts.length ? "array[" + parts.map(L).join(", ") + "]" : "array[]::text[]";
  };
  return `-- --------------------- document framework (tax + special event) ---------
insert into public.document_types (
  code, label, category, description, allowed_extensions,
  max_size_mb, applies_to_types, is_active, display_order
) values
  ${valRows(dt, [
    (r) => L(r.code),
    (r) => L(r.label),
    (r) => L(r.category),
    (r) => LN(r.description),
    (r) => arr(r.allowed_extensions),
    (r) => I(r.max_size_mb, 25),
    (r) => arr(r.applies_to_types),
    (r) => B(r.is_active),
    (r) => I(r.display_order),
  ])}
on conflict (code) do update set
  label = excluded.label,
  category = excluded.category,
  description = excluded.description,
  allowed_extensions = excluded.allowed_extensions,
  max_size_mb = excluded.max_size_mb,
  applies_to_types = excluded.applies_to_types,
  is_active = excluded.is_active,
  display_order = excluded.display_order;
`;
};

const windows = () => {
  const year = new Date().getFullYear();
  return `-- --------------------- reporting window (default) ------------------------
-- Opens a Fall window for ${year} and marks it active ONLY if no active window
-- already exists, so re-running never disturbs a window you opened yourself.
insert into public.reporting_windows
  (window_code, term_code, reporting_year, opens_on, closes_on, is_active)
select
  'fall-${year}', 'fall', ${year}, '${year}-08-01', '${year}-11-30',
  not exists (select 1 from public.reporting_windows where is_active = true)
on conflict (window_code) do nothing;
`;
};

const header = `-- ===========================================================================
-- Chapman Reporting Portal — bootstrap.sql
--
-- ONE-SHOT, IDEMPOTENT setup for the attached Supabase project. Paste this whole
-- file into the Supabase dashboard -> SQL Editor -> New query -> Run.
--
-- It is safe to run more than once, and safe to run on a project that already
-- contains part of the schema: it creates only what is missing, upserts seed
-- rows, and NEVER drops or overwrites your data. This file is a mechanical
-- concatenation of supabase/migrations/0001...0007 plus seed data - it never
-- defines anything the migrations don't already define. See
-- docs/security-architecture-plan.md §4.1.
--
-- Generated by scripts/gen-bootstrap.mjs — do not hand-edit; regenerate instead.
-- Generated at: ${new Date().toISOString()}
-- ===========================================================================

`;

const footer = `
-- ===========================================================================
-- DONE. Expected result of the verification query above:
--   chapters = 879, rubric_items = 300, document_types = 7, regions = 6,
--   districts = 38, rubric_versions = 2.
-- ===========================================================================

select 'chapters' as entity, count(*) from public.chapters
union all select 'rubric_items', count(*) from public.rubric_items
union all select 'rubric_versions', count(*) from public.rubric_versions
union all select 'document_types', count(*) from public.document_types
union all select 'regions', count(*) from public.regions
union all select 'districts', count(*) from public.districts
order by entity;
`;

const sql =
  header +
  schema +
  "\n\n" +
  "-- ============================ SEED DATA ==================================\n\n" +
  lookups() +
  "\n" +
  rubric() +
  "\n" +
  chapters() +
  "\n" +
  windows() +
  "\n" +
  documents() +
  footer;

writeFileSync(OUT, sql, "utf8");

const lines = sql.split("\n").length;
console.log(`wrote ${OUT}`);
console.log(`  ${(sql.length / 1024).toFixed(1)} KB, ${lines} lines`);
