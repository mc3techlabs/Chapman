-- Chapman Reporting Portal — Supabase schema
create extension if not exists pgcrypto;

create table if not exists public.chapter_types (
  code text primary key,
  label text not null unique
);

create table if not exists public.chapter_statuses (
  code text primary key,
  label text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.app_roles (
  code text primary key,
  label text not null unique,
  sort_order integer not null default 0
);

create table if not exists public.report_terms (
  code text primary key,
  label text not null unique,
  sort_order integer not null default 0
);

create table if not exists public.system_contacts (
  id uuid primary key default gen_random_uuid(),
  contact_key text not null unique,
  full_name text not null,
  email text not null,
  role_label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique,
  role_code text not null references public.app_roles(code),
  district text,
  region text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  chapter_key text not null unique,
  chapter_name text not null,
  chapter_type_code text not null references public.chapter_types(code),
  university text,
  district text not null,
  region text not null,
  status_code text not null references public.chapter_statuses(code),
  is_dechartered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_chapters_district on public.chapters(district);
create index if not exists idx_chapters_region on public.chapters(region);
create index if not exists idx_chapters_status on public.chapters(status_code);
create index if not exists idx_chapters_type on public.chapters(chapter_type_code);

create table if not exists public.chapter_user_links (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chapter_id, profile_id)
);
create unique index if not exists uq_chapter_user_primary on public.chapter_user_links(chapter_id) where is_primary = true and is_active = true;

create table if not exists public.reviewer_assignments (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null unique references public.chapters(id) on delete cascade,
  district_director_profile_id uuid references public.profiles(id),
  regional_vice_president_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reporting_windows (
  id uuid primary key default gen_random_uuid(),
  window_code text not null unique,
  term_code text not null references public.report_terms(code),
  reporting_year integer,
  opens_on date,
  closes_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rubric_versions (
  id uuid primary key default gen_random_uuid(),
  version_code text not null unique,
  version_name text not null,
  chapter_type_code text not null references public.chapter_types(code),
  reporting_year integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rubric_sections (
  id uuid primary key default gen_random_uuid(),
  rubric_version_id uuid not null references public.rubric_versions(id) on delete cascade,
  section_code text not null,
  section_name text not null,
  display_order integer not null default 0,
  active boolean not null default true,
  unique(rubric_version_id, section_code)
);

create table if not exists public.rubric_subsections (
  id uuid primary key default gen_random_uuid(),
  rubric_section_id uuid not null references public.rubric_sections(id) on delete cascade,
  subsection_code text not null,
  subsection_name text not null,
  display_order integer not null default 0,
  active boolean not null default true,
  unique(rubric_section_id, subsection_code)
);

create table if not exists public.rubric_items (
  id uuid primary key default gen_random_uuid(),
  rubric_version_id uuid not null references public.rubric_versions(id) on delete cascade,
  rubric_section_id uuid not null references public.rubric_sections(id) on delete cascade,
  rubric_subsection_id uuid not null references public.rubric_subsections(id) on delete cascade,
  criterion_code text not null,
  criterion_text text not null,
  item_type text not null check (item_type in ('activity','metric')),
  is_required boolean not null default false,
  default_point_value integer not null default 1,
  display_order integer not null default 0,
  active boolean not null default true,
  unique(rubric_version_id, criterion_code)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  rubric_version_id uuid not null references public.rubric_versions(id),
  term_code text not null references public.report_terms(code),
  reporting_year integer not null,
  workflow_status text not null default 'draft' check (workflow_status in ('draft','submitted','returned','pending_executive','finalized')),
  district_review_status text not null default 'pending' check (district_review_status in ('pending','approved','returned')),
  regional_review_status text not null default 'pending' check (regional_review_status in ('pending','approved','returned')),
  executive_review_status text not null default 'pending' check (executive_review_status in ('pending','approved','returned')),
  submitted_by_profile_id uuid references public.profiles(id),
  submitted_at timestamptz,
  final_score integer not null default 0,
  max_score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(chapter_id, term_code, reporting_year)
);
create index if not exists idx_submissions_status on public.submissions(workflow_status);
create index if not exists idx_submissions_term_year on public.submissions(term_code, reporting_year);

create table if not exists public.submission_item_responses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  rubric_item_id uuid not null references public.rubric_items(id),
  answer_yes boolean not null,
  awarded_points integer not null default 0,
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(submission_id, rubric_item_id)
);

create table if not exists public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reviewer_profile_id uuid not null references public.profiles(id),
  reviewer_role_code text not null references public.app_roles(code),
  action text not null check (action in ('approved','returned','reopened')),
  action_comment text,
  action_at timestamptz not null default now()
);
create index if not exists idx_approval_actions_submission on public.approval_actions(submission_id);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.handle_new_profile()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'role_code', 'chapter')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_profile();

create or replace trigger set_updated_at_system_contacts before update on public.system_contacts for each row execute procedure public.set_updated_at();
create or replace trigger set_updated_at_profiles before update on public.profiles for each row execute procedure public.set_updated_at();
create or replace trigger set_updated_at_chapters before update on public.chapters for each row execute procedure public.set_updated_at();
create or replace trigger set_updated_at_chapter_user_links before update on public.chapter_user_links for each row execute procedure public.set_updated_at();
create or replace trigger set_updated_at_reviewer_assignments before update on public.reviewer_assignments for each row execute procedure public.set_updated_at();
create or replace trigger set_updated_at_reporting_windows before update on public.reporting_windows for each row execute procedure public.set_updated_at();
create or replace trigger set_updated_at_rubric_versions before update on public.rubric_versions for each row execute procedure public.set_updated_at();
create or replace trigger set_updated_at_submissions before update on public.submissions for each row execute procedure public.set_updated_at();
create or replace trigger set_updated_at_submission_item_responses before update on public.submission_item_responses for each row execute procedure public.set_updated_at();
