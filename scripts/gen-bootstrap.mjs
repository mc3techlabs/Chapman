/**
 * Generates supabase/bootstrap.sql — a single, self-contained, idempotent script
 * that you paste into the Supabase SQL Editor with the anon/service key (no DB
 * password, no network access from the sandbox needed).
 *
 * The script:
 *   1. Applies the seven migrations (0001 schema, 0002 RLS, 0003 views, 0004 RLS
 *      write hardening, 0005 admin access levels, 0006 chapter reviewer
 *      visibility, 0007 chapter withdraw submission). They are
 *      already written with `if not exists` / `create or replace` / `drop ... if exists`,
 *      so running this on a project that already has *some* of the schema only
 *      creates what is missing — it never drops or overwrites your data.
 *   2. Converges two known gaps that an older scaffold can have:
 *        - rubric_items.mandatory_penalty          (integer, default 0)
 *        - submission_item_responses.answer_code   (''yes''|''no''|''na'')
 *   3. Seeds all lookup data, geography, the two rubric versions with 300 items,
 *      the 879-chapter roster, and the 7 document types — all idempotent.
 *
 * Run: npm run gen:bootstrap
 */
import { readFileSync, writeFileSync } from "node:fs";
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
const schema = [
  readFileSync(resolve(MIG, "0001_schema.sql"), "utf8"),
  readFileSync(resolve(MIG, "0002_rls_policies.sql"), "utf8"),
  readFileSync(resolve(MIG, "0003_reporting_views.sql"), "utf8"),
  readFileSync(resolve(MIG, "0004_rls_write_hardening.sql"), "utf8"),
  readFileSync(resolve(MIG, "0005_admin_access_levels.sql"), "utf8"),
  readFileSync(resolve(MIG, "0006_chapter_reviewer_visibility.sql"), "utf8"),
  readFileSync(resolve(MIG, "0007_chapter_withdraw_submission.sql"), "utf8"),
].join("\n\n");

const gapFix = `-- ===========================================================================
-- CONVERGENCE: bring an older scaffold up to the current app schema.
-- Safe to run repeatedly; only adds what is missing, never drops or overwrites.
-- ===========================================================================

-- ternary scoring column for the "mandatory item" rule (ships with default 0,
-- so a future -1 rollout needs no migration)
alter table public.rubric_items
  add column if not exists mandatory_penalty integer not null default 0;

-- ternary answer column (yes | no | na)
alter table public.submission_item_responses
  add column if not exists answer_code text;

do $$
begin
  -- if a legacy boolean column exists, fold it into answer_code
  if exists (select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = 'submission_item_responses'
               and column_name = 'answer_yes') then
    execute $sql$
      update public.submission_item_responses
         set answer_code = case when answer_yes then 'yes' else 'no' end
       where answer_code is null
    $sql$;
  end if;
  update public.submission_item_responses set answer_code = 'no' where answer_code is null;
end $$;

alter table public.submission_item_responses alter column answer_code set not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.submission_item_responses'::regclass
                   and conname = 'submission_item_responses_answer_code_check') then
    alter table public.submission_item_responses
      add constraint submission_item_responses_answer_code_check
      check (answer_code in ('yes','no','na'));
  end if;
end $$;

-- ===========================================================================
-- UNIQUE-KEY GUARDS
-- The app upserts on these keys. On a project that already had an older
-- scaffold, the matching constraint may exist under a different name (or not
-- at all). A uniquely-named unique index enforces the same rule and lets the
-- upsert "on conflict (<cols>)" clauses work either way. No-op when present.
-- ===========================================================================
create unique index if not exists uq_chapters_chapter_key          on public.chapters(chapter_key);
create unique index if not exists uq_submissions_chapter_term_year  on public.submissions(chapter_id, term_code, reporting_year);
create unique index if not exists uq_responses_submission_item      on public.submission_item_responses(submission_id, rubric_item_id);
create unique index if not exists uq_chapter_user_links             on public.chapter_user_links(chapter_id, profile_id);
create unique index if not exists uq_rubric_versions_code           on public.rubric_versions(version_code);
create unique index if not exists uq_rubric_sections                on public.rubric_sections(rubric_version_id, section_code);
create unique index if not exists uq_rubric_subsections             on public.rubric_subsections(rubric_section_id, subsection_code);
create unique index if not exists uq_reporting_windows_code         on public.reporting_windows(window_code);
`;

/* --------------------------- auth <-> profile bridge --------------------- */
const authFix = `-- ===========================================================================
-- AUTH -> PROFILE BRIDGE
-- The app needs a public.profiles row for every signed-in user. Two guards:
--   1. The trigger fires on INSERT *and* UPDATE, so (re-)saving a user's
--      metadata in the dashboard repairs/updates their profile.
--   2. ensure_profile() lets a user self-heal a missing row at sign-in (the app
--      calls it automatically). Needed for accounts created before this schema.
-- Unknown role_code values degrade to 'chapter' instead of erroring on the FK.
-- ===========================================================================

create or replace function public.handle_new_profile()
returns trigger as $$
declare v_role text;
begin
  v_role := coalesce(
    (select code from public.app_roles where code = new.raw_user_meta_data ->> 'role_code'),
    'chapter'
  );
  insert into public.profiles (id, full_name, email, role_code, district, region)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    v_role,
    new.raw_user_meta_data ->> 'district',
    new.raw_user_meta_data ->> 'region'
  )
  on conflict (id) do update set
    full_name  = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    email      = coalesce(excluded.email, public.profiles.email),
    role_code  = case when new.raw_user_meta_data ->> 'role_code' is not null
                      then v_role else public.profiles.role_code end,
    district   = coalesce(excluded.district, public.profiles.district),
    region     = coalesce(excluded.region, public.profiles.region),
    updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_profile();

-- Self-heal: create the caller's profile if missing (no-op otherwise).
create or replace function public.ensure_profile()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_user auth.users;
  v_role text;
begin
  if v_uid is null then return; end if;
  if exists (select 1 from public.profiles where id = v_uid) then return; end if;
  select * into v_user from auth.users where id = v_uid;
  if not found then return; end if;
  v_role := coalesce(
    (select code from public.app_roles where code = v_user.raw_user_meta_data ->> 'role_code'),
    'chapter'
  );
  insert into public.profiles (id, full_name, email, role_code, district, region)
  values (
    v_uid,
    coalesce(v_user.raw_user_meta_data ->> 'full_name', ''),
    v_user.email,
    v_role,
    v_user.raw_user_meta_data ->> 'district',
    v_user.raw_user_meta_data ->> 'region'
  )
  on conflict (id) do nothing;
end $$;

grant execute on function public.ensure_profile() to authenticated;

-- Backfill profiles for existing auth users (an account created before this
-- schema was applied has no row). Idempotent.
insert into public.profiles (id, full_name, email, role_code, district, region)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  u.email,
  coalesce(
    (select code from public.app_roles ar where ar.code = u.raw_user_meta_data ->> 'role_code'),
    'chapter'
  ),
  u.raw_user_meta_data ->> 'district',
  u.raw_user_meta_data ->> 'region'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Keep existing profiles in sync with their metadata (metadata wins; a value
-- with no metadata counterpart is preserved).
update public.profiles p
   set role_code  = coalesce(
                      (select code from public.app_roles ar where ar.code = u.raw_user_meta_data ->> 'role_code'),
                      p.role_code),
       full_name  = coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), p.full_name),
       district   = coalesce(u.raw_user_meta_data ->> 'district', p.district),
       region     = coalesce(u.raw_user_meta_data ->> 'region', p.region),
       updated_at = now()
  from auth.users u
 where u.id = p.id;
`;

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
-- contains part of the schema: it creates only what is missing, alters the two
-- known gaps, upserts seed rows, and NEVER drops or overwrites your data.
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
  gapFix +
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
  "\n\n" +
  // Runs AFTER the seed: the backfill inserts into profiles, whose role_code FK
  // requires app_roles to be populated first.
  authFix +
  footer;

writeFileSync(OUT, sql, "utf8");

// Standalone auth/profile repair, for a project that was already bootstrapped
// (e.g. one passwordless user exists but no profile row). Same body as authFix.
const fixSql =
  "-- fix-auth-profiles.sql\n" +
  "-- Run this if you can sign in with an existing Supabase user but the app\n" +
  "-- bounces you straight back to /login (no matching public.profiles row).\n" +
  "-- Safe and idempotent — paste into Supabase -> SQL Editor -> New query -> Run.\n\n" +
  authFix +
  "\n\n-- Result: your user should appear below with the expected role_code.\n" +
  "select id, email, full_name, role_code, district, region, is_active\n" +
  "from public.profiles order by created_at;\n";
writeFileSync(resolve(ROOT, "supabase/fix-auth-profiles.sql"), fixSql, "utf8");

const lines = sql.split("\n").length;
console.log(`wrote ${OUT}`);
console.log(`  ${(sql.length / 1024).toFixed(1)} KB, ${lines} lines`);
