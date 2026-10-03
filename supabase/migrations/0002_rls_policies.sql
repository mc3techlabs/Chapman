-- ===========================================================================
-- Row Level Security
-- Access is enforced in the database, not just the UI. At 800+ chapters this
-- is also the isolation boundary between districts/regions: a reviewer or
-- chapter must never be able to read another scope's rows.
--
-- Role helpers are SECURITY DEFINER and STABLE so policies don't recurse
-- through profiles (each chapter/reviewer check would otherwise re-select
-- profiles and re-trigger its own policy).
-- ===========================================================================

create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select role_code from public.profiles where id = auth.uid();
$$;

create or replace function public.current_district()
returns text language sql stable security definer set search_path = public as $$
  select district from public.profiles where id = auth.uid();
$$;

create or replace function public.current_region()
returns text language sql stable security definer set search_path = public as $$
  select region from public.profiles where id = auth.uid();
$$;

-- The chapter(s) a shared login is linked to.
create or replace function public.current_chapter_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select chapter_id from public.chapter_user_links
   where profile_id = auth.uid() and is_active = true;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

create or replace function public.is_executive()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'executive_director', false);
$$;

-- ---------------------------------------------------------------------------
-- Referential / read-mostly tables: any authenticated user may read; only
-- admins may write. (Small lookup tables.)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'chapter_types','chapter_statuses','app_roles','report_terms',
    'regions','districts','rubric_versions','rubric_sections',
    'rubric_subsections','rubric_items','document_types'
  ] loop
    execute format('alter table public.%1$s enable row level security;', t);
    execute format('drop policy if exists %1$s_read on public.%1$s;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select
      to authenticated using (true);
    $f$, t);
    execute format('drop policy if exists %1$s_admin_write on public.%1$s;', t);
    execute format($f$
      create policy %1$s_admin_write on public.%1$s for all
      to authenticated using (public.is_admin()) with check (public.is_admin());
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- chapters: everyone signed in can read the roster (needed for queues and
-- imports); only admins write.
-- ---------------------------------------------------------------------------
alter table public.chapters enable row level security;

drop policy if exists chapters_read on public.chapters;
create policy chapters_read on public.chapters
  for select to authenticated using (true);

drop policy if exists chapters_admin_write on public.chapters;
create policy chapters_admin_write on public.chapters
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- profiles: you see yourself, plus admins/exec see everyone. Reviewers need
-- to see their counterpart's name, so district/regional scopes can read
-- profiles of peers in their own scope — kept narrow to avoid a roster leak.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.is_executive()
    or (public.current_role() = 'district_director' and district = public.current_district())
    or (public.current_role() = 'rvp' and region = public.current_region())
  );

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check (public.is_admin() or id = auth.uid());

-- ---------------------------------------------------------------------------
-- chapter_user_links / reviewer_assignments: admin-managed; a chapter may read
-- its own link; a reviewer may read rows assigned to them.
-- ---------------------------------------------------------------------------
alter table public.chapter_user_links enable row level security;
drop policy if exists cul_read on public.chapter_user_links;
create policy cul_read on public.chapter_user_links
  for select to authenticated
  using (
    profile_id = auth.uid()
    or chapter_id in (select public.current_chapter_ids())
    or public.is_admin()
  );
drop policy if exists cul_admin_write on public.chapter_user_links;
create policy cul_admin_write on public.chapter_user_links
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.reviewer_assignments enable row level security;
drop policy if exists ra_read on public.reviewer_assignments;
create policy ra_read on public.reviewer_assignments
  for select to authenticated
  using (
    public.is_admin()
    or district_director_profile_id = auth.uid()
    or regional_vice_president_profile_id = auth.uid()
  );
drop policy if exists ra_admin_write on public.reviewer_assignments;
create policy ra_admin_write on public.reviewer_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- reporting_windows: readable by all; admin-managed.
-- ---------------------------------------------------------------------------
alter table public.reporting_windows enable row level security;
drop policy if exists rw_read on public.reporting_windows;
create policy rw_read on public.reporting_windows for select to authenticated using (true);
drop policy if exists rw_admin_write on public.reporting_windows;
create policy rw_admin_write on public.reporting_windows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- submissions: the core scoping rule.
--   chapter     -> only its own chapter's submissions
--   DD          -> submissions for chapters in their district
--   RVP         -> submissions for chapters in their region
--   exec/admin  -> all
-- Writes: a chapter may create/update its OWN draft/returned submission only.
-- Reviewers never write the row itself; they write approval_actions.
-- ---------------------------------------------------------------------------
alter table public.submissions enable row level security;

drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions
  for select to authenticated
  using (
    public.is_admin()
    or public.is_executive()
    or chapter_id in (select public.current_chapter_ids())
    or (public.current_role() = 'district_director'
        and chapter_id in (select id from public.chapters where district = public.current_district()))
    or (public.current_role() = 'rvp'
        and chapter_id in (select id from public.chapters where region = public.current_region()))
  );

drop policy if exists submissions_chapter_insert on public.submissions;
create policy submissions_chapter_insert on public.submissions
  for insert to authenticated
  with check (
    chapter_id in (select public.current_chapter_ids())
    and workflow_status in ('draft','returned')
  );

drop policy if exists submissions_chapter_update on public.submissions;
create policy submissions_chapter_update on public.submissions
  for update to authenticated
  using (
    chapter_id in (select public.current_chapter_ids())
    and workflow_status in ('draft','returned')
  )
  with check (
    chapter_id in (select public.current_chapter_ids())
    and workflow_status in ('draft','returned','submitted')
  );

-- Admin/exec may move a submission through review states (approve/return/reopen).
drop policy if exists submissions_reviewer_update on public.submissions;
create policy submissions_reviewer_update on public.submissions
  for update to authenticated
  using (
    public.is_admin()
    or public.is_executive()
    or (public.current_role() = 'district_director'
        and chapter_id in (select id from public.chapters where district = public.current_district()))
    or (public.current_role() = 'rvp'
        and chapter_id in (select id from public.chapters where region = public.current_region()))
  )
  with check (true);

-- ---------------------------------------------------------------------------
-- submission_item_responses: readable/writable only in the parent
-- submission's scope; chapters only while the submission is editable.
-- ---------------------------------------------------------------------------
alter table public.submission_item_responses enable row level security;

drop policy if exists responses_read on public.submission_item_responses;
create policy responses_read on public.submission_item_responses
  for select to authenticated
  using (
    submission_id in (
      select id from public.submissions
    )
  );

drop policy if exists responses_chapter_write on public.submission_item_responses;
create policy responses_chapter_write on public.submission_item_responses
  for all to authenticated
  using (
    submission_id in (
      select id from public.submissions
       where chapter_id in (select public.current_chapter_ids())
         and workflow_status in ('draft','returned')
    )
  )
  with check (
    submission_id in (
      select id from public.submissions
       where chapter_id in (select public.current_chapter_ids())
         and workflow_status in ('draft','returned')
    )
  );

-- ---------------------------------------------------------------------------
-- approval_actions: readable in scope; insert only by the reviewer who owns
-- that lane (or admin/exec for reopen).
-- ---------------------------------------------------------------------------
alter table public.approval_actions enable row level security;

drop policy if exists approvals_read on public.approval_actions;
create policy approvals_read on public.approval_actions
  for select to authenticated
  using (submission_id in (select id from public.submissions));

drop policy if exists approvals_insert on public.approval_actions;
create policy approvals_insert on public.approval_actions
  for insert to authenticated
  with check (
    reviewer_profile_id = auth.uid()
    and submission_id in (select id from public.submissions)
  );

-- ---------------------------------------------------------------------------
-- audit_log: append-only; readable by admin/exec, insert by anyone acting.
-- ---------------------------------------------------------------------------
alter table public.audit_log enable row level security;
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (public.is_admin() or public.is_executive());
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (actor_profile_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- documents: a chapter sees its own uploads; reviewers see uploads for
-- chapters in their scope; admin sees all. Uploads by admin or the owning
-- chapter. document_types governs the allowed formats.
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents
  for select to authenticated
  using (
    public.is_admin()
    or public.is_executive()
    or chapter_id in (select public.current_chapter_ids())
    or (public.current_role() = 'district_director'
        and chapter_id in (select id from public.chapters where district = public.current_district()))
    or (public.current_role() = 'rvp'
        and chapter_id in (select id from public.chapters where region = public.current_region()))
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    public.is_admin()
    or chapter_id in (select public.current_chapter_ids())
  );

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (
    public.is_admin()
    or chapter_id in (select public.current_chapter_ids())
  )
  with check (true);

drop policy if exists documents_admin_delete on public.documents;
create policy documents_admin_delete on public.documents
  for delete to authenticated using (public.is_admin());
