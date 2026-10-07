-- Lets a chapter see who their District Director and RVP are, for the
-- chapter dashboard. Neither grant existed before: ra_read (0002) only
-- covers admin/admin_readonly and the reviewer rows themselves, and
-- profiles_self_read only lets a chapter read its own profile - a chapter
-- had no way to read reviewer_assignments at all, or the profile of
-- whichever DD/RVP it names.
--
-- Both additions are narrow and read-only: a chapter can only see the
-- single reviewer_assignments row for a chapter_id in its own
-- current_chapter_ids(), and only the profiles of the specific two people
-- that row actually names - not the district/region roster the way
-- district_director/rvp's own profiles_self_read grant works. No write
-- policy on either table is touched.

drop policy if exists ra_read on public.reviewer_assignments;
create policy ra_read on public.reviewer_assignments
  for select to authenticated
  using (
    public.is_admin()
    or public.is_admin_readonly()
    or district_director_profile_id = auth.uid()
    or regional_vice_president_profile_id = auth.uid()
    or chapter_id in (select public.current_chapter_ids())
  );

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
    or id in (
      select ra.district_director_profile_id from public.reviewer_assignments ra
      where ra.chapter_id in (select public.current_chapter_ids())
      union
      select ra.regional_vice_president_profile_id from public.reviewer_assignments ra
      where ra.chapter_id in (select public.current_chapter_ids())
    )
  );
