-- ===========================================================================
-- Chapman Reporting Portal — core schema
-- Designed for national scale: 800+ chapters, ~300 rubric items per cycle,
-- two terms per year. Every hot path is indexed; rollups are precomputed in
-- views; nothing in the app does an unbounded scan.
--
-- Scoring model (confirmed direction):
--   yes -> 1 point
--   no  -> 0 points
--   na  -> baseline points (counts as satisfied for non-applicable items)
-- Future: a designated mandatory item can carry a penalty (e.g. -1) when
-- missed. `mandatory_penalty` is present now (default 0) so that rule ships
-- later with NO schema migration.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Lookup tables
-- ---------------------------------------------------------------------------
create table if not exists public.chapter_types (
  code  text primary key,
  label text not null unique
);

create table if not exists public.chapter_statuses (
  code       text primary key,
  label      text not null unique,
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

create table if not exists public.app_roles (
  code       text primary key,
  label      text not null unique,
  sort_order integer not null default 0
);

create table if not exists public.report_terms (
  code       text primary key,
  label      text not null unique,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Geography (denormalised onto chapters for read speed; kept as lookups so
-- admin can rename a district/region without touching 800 chapter rows)
-- ---------------------------------------------------------------------------
create table if not exists public.regions (
  code text primary key,
  name text not null unique,
  sort_order integer not null default 0
);

create table if not exists public.districts (
  code       text primary key,
  name       text not null,
  region_code text not null references public.regions(code),
  unique(name, region_code)
);

-- ---------------------------------------------------------------------------
-- Chapters (the master roster — ~879 rows today, growth-ready)
-- ---------------------------------------------------------------------------
create table if not exists public.chapters (
  id                uuid primary key default gen_random_uuid(),
  chapter_key       text not null unique,
  chapter_name      text not null,
  chapter_type_code text not null references public.chapter_types(code),
  university        text,
  district          text not null,
  region            text not null,
  status_code       text not null references public.chapter_statuses(code),
  is_dechartered    boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_chapters_district on public.chapters(district);
create index if not exists idx_chapters_region   on public.chapters(region);
create index if not exists idx_chapters_status   on public.chapters(status_code);
create index if not exists idx_chapters_type     on public.chapters(chapter_type_code);
-- Roster search/sort across 800+ rows (name, key, university).
create index if not exists idx_chapters_name_trgm on public.chapters (lower(chapter_name) text_pattern_ops);

-- ---------------------------------------------------------------------------
-- People. `profiles.id` mirrors `auth.users.id` (Supabase Auth).
-- A chapter has ONE shared login (role_code = 'chapter') linked via
-- chapter_user_links; reviewers are named individuals.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text unique,
  role_code  text not null references public.app_roles(code),
  district   text,
  region     text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_profiles_role on public.profiles(role_code);

create table if not exists public.chapter_user_links (
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default true,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chapter_id, profile_id)
);
create unique index if not exists uq_chapter_user_primary
  on public.chapter_user_links(chapter_id) where is_primary = true and is_active = true;
create index if not exists idx_chapter_user_profile on public.chapter_user_links(profile_id);

-- Who reviews which chapter. One row per chapter (800+ rows); both reviewers
-- are assigned up front so review can run in parallel.
create table if not exists public.reviewer_assignments (
  id                             uuid primary key default gen_random_uuid(),
  chapter_id                     uuid not null unique references public.chapters(id) on delete cascade,
  district_director_profile_id   uuid references public.profiles(id),
  regional_vice_president_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reviewer_assign_dd  on public.reviewer_assignments(district_director_profile_id);
create index if not exists idx_reviewer_assign_rvp on public.reviewer_assignments(regional_vice_president_profile_id);

-- ---------------------------------------------------------------------------
-- Reporting windows (Fall / Spring cycles)
-- ---------------------------------------------------------------------------
create table if not exists public.reporting_windows (
  id             uuid primary key default gen_random_uuid(),
  window_code    text not null unique,
  term_code      text not null references public.report_terms(code),
  reporting_year integer,
  opens_on       date,
  closes_on      date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_windows_active on public.reporting_windows(is_active, created_at desc);

-- ---------------------------------------------------------------------------
-- Rubric (versioned by chapter type + fraternal year). Separate College and
-- Alumni versions; ~156 / ~144 items respectively.
-- ---------------------------------------------------------------------------
create table if not exists public.rubric_versions (
  id                uuid primary key default gen_random_uuid(),
  version_code      text not null unique,
  version_name      text not null,
  chapter_type_code text not null references public.chapter_types(code),
  reporting_year    integer,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.rubric_sections (
  id                uuid primary key default gen_random_uuid(),
  rubric_version_id uuid not null references public.rubric_versions(id) on delete cascade,
  section_code      text not null,
  section_name      text not null,
  display_order     integer not null default 0,
  active            boolean not null default true,
  unique(rubric_version_id, section_code)
);
create index if not exists idx_sections_version on public.rubric_sections(rubric_version_id, display_order);

create table if not exists public.rubric_subsections (
  id                uuid primary key default gen_random_uuid(),
  rubric_section_id uuid not null references public.rubric_sections(id) on delete cascade,
  subsection_code   text not null,
  subsection_name   text not null,
  display_order     integer not null default 0,
  active            boolean not null default true,
  unique(rubric_section_id, subsection_code)
);
create index if not exists idx_subsections_section on public.rubric_subsections(rubric_section_id, display_order);

create table if not exists public.rubric_items (
  id                  uuid primary key default gen_random_uuid(),
  rubric_version_id   uuid not null references public.rubric_versions(id) on delete cascade,
  rubric_section_id   uuid not null references public.rubric_sections(id) on delete cascade,
  rubric_subsection_id uuid not null references public.rubric_subsections(id) on delete cascade,
  criterion_code      text not null,
  criterion_text      text not null,
  item_type           text not null check (item_type in ('activity','metric')),
  -- is_required: the item is mandatory. mandatory_penalty is applied when a
  -- required item is answered "no" (default 0 = plain 0 points; a future
  -- rollout sets it to -1 to dock the chapter). Present now so the rule ships
  -- with no migration.
  is_required         boolean not null default false,
  default_point_value integer not null default 1,
  mandatory_penalty   integer not null default 0,
  display_order       integer not null default 0,
  active              boolean not null default true
);
create index if not exists idx_items_version   on public.rubric_items(rubric_version_id, display_order);
create index if not exists idx_items_section   on public.rubric_items(rubric_section_id);
create index if not exists idx_items_subsection on public.rubric_items(rubric_subsection_id);

-- ---------------------------------------------------------------------------
-- Submissions (one per chapter / term / year) and responses.
-- The three review lanes are tracked independently so district + regional can
-- progress in parallel; executive is gated in code on both being approved.
-- ---------------------------------------------------------------------------
create table if not exists public.submissions (
  id                     uuid primary key default gen_random_uuid(),
  chapter_id             uuid not null references public.chapters(id) on delete cascade,
  rubric_version_id      uuid not null references public.rubric_versions(id),
  term_code              text not null references public.report_terms(code),
  reporting_year         integer not null,
  workflow_status        text not null default 'draft'
      check (workflow_status in ('draft','submitted','returned','pending_executive','finalized')),
  district_review_status text not null default 'pending'
      check (district_review_status in ('pending','approved','returned')),
  regional_review_status text not null default 'pending'
      check (regional_review_status in ('pending','approved','returned')),
  executive_review_status text not null default 'pending'
      check (executive_review_status in ('pending','approved','returned')),
  submitted_by_profile_id uuid references public.profiles(id),
  submitted_at           timestamptz,
  final_score            integer not null default 0,
  max_score              integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique(chapter_id, term_code, reporting_year)
);
create index if not exists idx_submissions_status   on public.submissions(workflow_status);
create index if not exists idx_submissions_term_year on public.submissions(term_code, reporting_year);
create index if not exists idx_submissions_chapter  on public.submissions(chapter_id);
-- Dashboards filter by term+year+workflow constantly; this composite keeps the
-- review queues index-only at 800-chapter scale.
create index if not exists idx_submissions_queue
  on public.submissions(term_code, reporting_year, workflow_status, district_review_status, regional_review_status);

create table if not exists public.submission_item_responses (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.submissions(id) on delete cascade,
  rubric_item_id  uuid not null references public.rubric_items(id),
  -- Ternary answer. 'na' = not applicable (baseline points).
  answer_code     text not null check (answer_code in ('yes','no','na')),
  awarded_points  integer not null default 0,
  response_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(submission_id, rubric_item_id)
);
create index if not exists idx_responses_submission on public.submission_item_responses(submission_id);

create table if not exists public.approval_actions (
  id                 uuid primary key default gen_random_uuid(),
  submission_id      uuid not null references public.submissions(id) on delete cascade,
  reviewer_profile_id uuid not null references public.profiles(id),
  reviewer_role_code text not null references public.app_roles(code),
  action             text not null check (action in ('approved','returned','reopened')),
  action_comment     text,
  action_at          timestamptz not null default now()
);
create index if not exists idx_approval_actions_submission on public.approval_actions(submission_id);

create table if not exists public.audit_log (
  id                uuid primary key default gen_random_uuid(),
  actor_profile_id  uuid references public.profiles(id) on delete set null,
  entity_type       text not null,
  entity_id         uuid,
  action            text not null,
  metadata_json     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists idx_audit_entity on public.audit_log(entity_type, entity_id);
create index if not exists idx_audit_created on public.audit_log(created_at desc);

-- ---------------------------------------------------------------------------
-- Document framework (admin uploads)
-- Two categories ship now: tax documents and special event checklists.
-- The `document_types` table is data-driven, so the exact format/fields can be
-- re-specified later by editing rows (and adding requirements) — not code.
-- ---------------------------------------------------------------------------
create table if not exists public.document_types (
  code              text primary key,
  label             text not null,
  category          text not null check (category in ('tax','special_event','other')),
  description       text,
  allowed_extensions text[] not null default array['pdf','csv','xlsx','xls','png','jpg','jpeg'],
  max_size_mb       integer not null default 25,
  -- Which chapter types this document applies to (empty = all).
  applies_to_types  text[] not null default array[]::text[],
  is_active         boolean not null default true,
  display_order     integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.documents (
  id                 uuid primary key default gen_random_uuid(),
  chapter_id         uuid references public.chapters(id) on delete cascade,
  submission_id      uuid references public.submissions(id) on delete set null,
  document_type_code text not null references public.document_types(code),
  storage_path       text not null,
  file_name          text not null,
  content_type       text,
  size_bytes         bigint,
  term_code          text references public.report_terms(code),
  reporting_year     integer,
  status             text not null default 'uploaded'
      check (status in ('uploaded','under_review','accepted','rejected')),
  notes              text,
  uploaded_by_profile_id uuid references public.profiles(id),
  reviewed_by_profile_id uuid references public.profiles(id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_documents_chapter on public.documents(chapter_id, document_type_code);
create index if not exists idx_documents_type    on public.documents(document_type_code, status);
create index if not exists idx_documents_term    on public.documents(term_code, reporting_year);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'chapters','profiles','chapter_user_links','reviewer_assignments',
    'reporting_windows','rubric_versions','submissions',
    'submission_item_responses','documents','document_types'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at_%1$s on public.%1$s;
       create trigger set_updated_at_%1$s before update on public.%1$s
       for each row execute procedure public.set_updated_at();', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Auto-create a profile whenever an auth user is created. Role comes from the
-- user's raw metadata (defaults to the shared 'chapter' role).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_profile()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role_code, district, region)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role_code', 'chapter'),
    new.raw_user_meta_data ->> 'district',
    new.raw_user_meta_data ->> 'region'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_profile();
