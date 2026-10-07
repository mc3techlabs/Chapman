-- Splits "admin" into two access levels: admin (full read/write, unchanged)
-- and admin_readonly (sees everything an admin sees, can write nothing).
-- admin_readonly is a NEW role, additive to the existing schema - every
-- write policy already scoped to is_admin() is left exactly as-is, so a
-- read-only admin falls through to "not authorized" on any write attempt
-- without touching a single write-side policy or trigger (0004's
-- prevent_profile_self_escalation / enforce_submission_transition already
-- only bypass for is_admin()/is_executive()/service_role, so they already
-- treat admin_readonly like any other non-privileged actor).

insert into public.app_roles (code, label, sort_order) values
  ('admin_readonly', 'Admin (Read-only)', 6)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

update public.app_roles set label = 'Admin (Full access)' where code = 'admin';

create or replace function public.is_admin_readonly()
returns boolean language sql stable security definer set search_path = public as $is_admin_readonly$
  select coalesce(public.current_role() = 'admin_readonly', false);
$is_admin_readonly$;

-- ---------------------------------------------------------------------
-- Extend every READ policy that already grants is_admin() visibility to
-- also grant admin_readonly the same visibility. Every WRITE policy
-- (profiles_self_update, profiles_admin_insert, cul_admin_write,
-- ra_admin_write, rw_admin_write, chapters_admin_write, the lookup-table
-- _admin_write policies, submissions_reviewer_update, documents_insert/
-- update/delete) is untouched - admin_readonly only ever appears in a
-- USING clause here, never a WITH CHECK, and never on a write-only policy.
-- ---------------------------------------------------------------------

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.is_admin_readonly()
    or public.is_executive()
    or (public.current_role() = 'district_director' and district = public.current_district())
    or (public.current_role() = 'rvp' and region = public.current_region())
  );

drop policy if exists cul_read on public.chapter_user_links;
create policy cul_read on public.chapter_user_links
  for select to authenticated
  using (
    profile_id = auth.uid()
    or chapter_id in (select public.current_chapter_ids())
    or public.is_admin()
    or public.is_admin_readonly()
  );

drop policy if exists ra_read on public.reviewer_assignments;
create policy ra_read on public.reviewer_assignments
  for select to authenticated
  using (
    public.is_admin()
    or public.is_admin_readonly()
    or district_director_profile_id = auth.uid()
    or regional_vice_president_profile_id = auth.uid()
  );

drop policy if exists submissions_read on public.submissions;
create policy submissions_read on public.submissions
  for select to authenticated
  using (
    public.is_admin()
    or public.is_admin_readonly()
    or public.is_executive()
    or chapter_id in (select public.current_chapter_ids())
    or (public.current_role() = 'district_director'
        and chapter_id in (select id from public.chapters where district = public.current_district()))
    or (public.current_role() = 'rvp'
        and chapter_id in (select id from public.chapters where region = public.current_region()))
  );

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (public.is_admin() or public.is_admin_readonly() or public.is_executive());

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents
  for select to authenticated
  using (
    public.is_admin()
    or public.is_admin_readonly()
    or public.is_executive()
    or chapter_id in (select public.current_chapter_ids())
    or (public.current_role() = 'district_director'
        and chapter_id in (select id from public.chapters where district = public.current_district()))
    or (public.current_role() = 'rvp'
        and chapter_id in (select id from public.chapters where region = public.current_region()))
  );
