-- Chapman Reporting Portal — RLS policies
alter table public.profiles enable row level security;
alter table public.chapters enable row level security;
alter table public.chapter_user_links enable row level security;
alter table public.reviewer_assignments enable row level security;
alter table public.reporting_windows enable row level security;
alter table public.rubric_versions enable row level security;
alter table public.rubric_sections enable row level security;
alter table public.rubric_subsections enable row level security;
alter table public.rubric_items enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_item_responses enable row level security;
alter table public.approval_actions enable row level security;
alter table public.audit_log enable row level security;
alter table public.chapter_types enable row level security;
alter table public.chapter_statuses enable row level security;
alter table public.app_roles enable row level security;
alter table public.report_terms enable row level security;
alter table public.system_contacts enable row level security;

create or replace function public.current_role_code()
returns text language sql stable as $$
  select role_code from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(public.current_role_code() = 'admin', false)
$$;

create or replace function public.is_exec()
returns boolean language sql stable as $$
  select coalesce(public.current_role_code() = 'executive_director', false)
$$;

create or replace function public.current_user_district()
returns text language sql stable as $$
  select district from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_region()
returns text language sql stable as $$
  select region from public.profiles where id = auth.uid()
$$;

create policy profiles_self_select on public.profiles for select using (id = auth.uid() or public.is_admin() or public.is_exec());
create policy profiles_self_update on public.profiles for update using (id = auth.uid() or public.is_admin());

create policy lookup_read_all_types on public.chapter_types for select using (true);
create policy lookup_read_all_statuses on public.chapter_statuses for select using (true);
create policy lookup_read_all_roles on public.app_roles for select using (true);
create policy lookup_read_all_terms on public.report_terms for select using (true);
create policy system_contacts_read_authenticated on public.system_contacts for select using (auth.role() = 'authenticated');

create policy chapters_read_chapter_own on public.chapters for select using (
  public.is_admin() or public.is_exec() or
  exists (
    select 1 from public.chapter_user_links cul
    where cul.chapter_id = chapters.id and cul.profile_id = auth.uid() and cul.is_active = true
  ) or district = public.current_user_district() or region = public.current_user_region()
);
create policy chapters_admin_write on public.chapters for all using (public.is_admin()) with check (public.is_admin());

create policy cul_read_own_or_admin on public.chapter_user_links for select using (
  public.is_admin() or public.is_exec() or profile_id = auth.uid()
);
create policy cul_admin_write on public.chapter_user_links for all using (public.is_admin()) with check (public.is_admin());

create policy assignments_read_for_scope on public.reviewer_assignments for select using (
  public.is_admin() or public.is_exec() or
  district_director_profile_id = auth.uid() or regional_vice_president_profile_id = auth.uid() or
  exists (select 1 from public.chapter_user_links cul where cul.chapter_id = reviewer_assignments.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true)
);
create policy assignments_admin_write on public.reviewer_assignments for all using (public.is_admin()) with check (public.is_admin());

create policy windows_read_authenticated on public.reporting_windows for select using (auth.role() = 'authenticated');
create policy windows_admin_write on public.reporting_windows for all using (public.is_admin()) with check (public.is_admin());

create policy rubric_versions_read_authenticated on public.rubric_versions for select using (auth.role() = 'authenticated');
create policy rubric_sections_read_authenticated on public.rubric_sections for select using (auth.role() = 'authenticated');
create policy rubric_subsections_read_authenticated on public.rubric_subsections for select using (auth.role() = 'authenticated');
create policy rubric_items_read_authenticated on public.rubric_items for select using (auth.role() = 'authenticated');
create policy rubric_admin_write_versions on public.rubric_versions for all using (public.is_admin()) with check (public.is_admin());
create policy rubric_admin_write_sections on public.rubric_sections for all using (public.is_admin()) with check (public.is_admin());
create policy rubric_admin_write_subsections on public.rubric_subsections for all using (public.is_admin()) with check (public.is_admin());
create policy rubric_admin_write_items on public.rubric_items for all using (public.is_admin()) with check (public.is_admin());

create policy submissions_read_for_scope on public.submissions for select using (
  public.is_admin() or public.is_exec() or
  exists (select 1 from public.chapter_user_links cul where cul.chapter_id = submissions.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true) or
  exists (select 1 from public.chapters c where c.id = submissions.chapter_id and c.district = public.current_user_district()) or
  exists (select 1 from public.chapters c where c.id = submissions.chapter_id and c.region = public.current_user_region())
);

create policy submissions_insert_chapter on public.submissions for insert with check (
  exists (select 1 from public.chapter_user_links cul where cul.chapter_id = submissions.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true)
  or public.is_admin()
);

create policy submissions_update_scope on public.submissions for update using (
  public.is_admin() or public.is_exec() or
  exists (select 1 from public.chapter_user_links cul where cul.chapter_id = submissions.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true) or
  exists (select 1 from public.chapters c where c.id = submissions.chapter_id and c.district = public.current_user_district()) or
  exists (select 1 from public.chapters c where c.id = submissions.chapter_id and c.region = public.current_user_region())
) with check (
  public.is_admin() or public.is_exec() or
  exists (select 1 from public.chapter_user_links cul where cul.chapter_id = submissions.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true) or
  exists (select 1 from public.chapters c where c.id = submissions.chapter_id and c.district = public.current_user_district()) or
  exists (select 1 from public.chapters c where c.id = submissions.chapter_id and c.region = public.current_user_region())
);

create policy responses_read_for_scope on public.submission_item_responses for select using (
  public.is_admin() or public.is_exec() or
  exists (
    select 1 from public.submissions s
    left join public.chapter_user_links cul on cul.chapter_id = s.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    left join public.chapters c on c.id = s.chapter_id
    where s.id = submission_item_responses.submission_id
      and (cul.id is not null or c.district = public.current_user_district() or c.region = public.current_user_region())
  )
);
create policy responses_write_for_scope on public.submission_item_responses for all using (
  public.is_admin() or
  exists (
    select 1 from public.submissions s
    join public.chapter_user_links cul on cul.chapter_id = s.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    where s.id = submission_item_responses.submission_id
  )
) with check (
  public.is_admin() or
  exists (
    select 1 from public.submissions s
    join public.chapter_user_links cul on cul.chapter_id = s.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    where s.id = submission_item_responses.submission_id
  )
);

create policy approvals_read_for_scope on public.approval_actions for select using (
  public.is_admin() or public.is_exec() or
  reviewer_profile_id = auth.uid() or
  exists (
    select 1 from public.submissions s
    left join public.chapter_user_links cul on cul.chapter_id = s.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    left join public.chapters c on c.id = s.chapter_id
    where s.id = approval_actions.submission_id
      and (cul.id is not null or c.district = public.current_user_district() or c.region = public.current_user_region())
  )
);
create policy approvals_insert_scope on public.approval_actions for insert with check (
  public.is_admin() or reviewer_profile_id = auth.uid()
);

create policy audit_admin_only on public.audit_log for select using (public.is_admin() or public.is_exec());
create policy audit_insert_authenticated on public.audit_log for insert with check (auth.role() = 'authenticated');
