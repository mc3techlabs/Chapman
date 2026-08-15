-- Chapman Reporting Portal — reporting views
--
-- All views here are security_invoker = on: without it, a view executes
-- with its owner's privileges for RLS purposes (the owner is `postgres` in
-- Supabase, which bypasses RLS), so any authenticated role — including a
-- chapter's shared login — could otherwise read every district's/region's
-- data straight off the view, ignoring the chapters/submissions RLS scoping
-- in 0002_rls_policies.sql. With it on, the view re-evaluates as the
-- querying role, so district directors/RVPs/chapters only ever see their
-- own scope, and admin/exec (who already bypass RLS on the base tables)
-- see everything, same as before. See 0008 for the equivalent ALTER on an
-- already-migrated database.
create or replace view public.v_submission_rollup
  with (security_invoker = on) as
select
  c.id as chapter_id,
  c.chapter_key,
  c.chapter_name,
  c.chapter_type_code,
  c.district,
  c.region,
  c.status_code,
  s.id as submission_id,
  s.term_code,
  s.reporting_year,
  s.workflow_status,
  s.district_review_status,
  s.regional_review_status,
  s.executive_review_status,
  s.final_score,
  s.max_score,
  case when s.max_score > 0 then round((s.final_score::numeric / s.max_score::numeric) * 100, 2) else 0 end as pct_score
from public.submissions s
join public.chapters c on c.id = s.chapter_id;

-- district/region/national rollups are built LEFT JOIN from the active
-- chapter roster (cross joined against every term/year that's ever been
-- reported or opened), not INNER JOIN from submissions — a chapter that
-- hasn't started its report yet still has to count in the denominator, or
-- completion_rate_pct would be meaningless (3 finalized out of 3 that have
-- even been touched reads as "100%" when 57 others haven't started).
create or replace view public.v_reporting_terms
  with (security_invoker = on) as
select term_code, reporting_year from public.submissions where reporting_year is not null
union
select term_code, reporting_year from public.reporting_windows where reporting_year is not null;

-- CREATE OR REPLACE VIEW can't rename/restructure columns, only the older
-- definitions of these had different columns (submission_count, no
-- completion_rate_pct, etc.) — drop first so the new shape can apply.
drop view if exists public.v_district_rollup;
drop view if exists public.v_region_rollup;
drop view if exists public.v_national_rollup;

create view public.v_district_rollup
  with (security_invoker = on) as
with scoped_chapters as (
  select id, district, region from public.chapters where status_code = 'Active'
)
select
  sc.district,
  sc.region,
  t.term_code,
  t.reporting_year,
  count(distinct sc.id) as total_chapters,
  count(distinct s.chapter_id) as started_count,
  count(distinct s.chapter_id) filter (where s.workflow_status in ('submitted','pending_executive','finalized')) as submitted_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'returned') as returned_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'finalized') as finalized_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'pending_executive') as pending_executive_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'draft') as draft_count,
  round(
    100.0 * count(distinct s.chapter_id) filter (where s.workflow_status in ('submitted','pending_executive','finalized'))
      / nullif(count(distinct sc.id), 0),
    2
  ) as completion_rate_pct,
  coalesce(sum(s.final_score), 0) as total_points,
  coalesce(sum(s.max_score), 0) as total_possible_points,
  round(case when sum(s.max_score) > 0 then (sum(s.final_score)::numeric / sum(s.max_score)::numeric) * 100 else 0 end, 2) as pct_score
from scoped_chapters sc
cross join public.v_reporting_terms t
left join public.submissions s
  on s.chapter_id = sc.id and s.term_code = t.term_code and s.reporting_year = t.reporting_year
group by sc.district, sc.region, t.term_code, t.reporting_year;

create view public.v_region_rollup
  with (security_invoker = on) as
with scoped_chapters as (
  select id, region from public.chapters where status_code = 'Active'
)
select
  sc.region,
  t.term_code,
  t.reporting_year,
  count(distinct sc.id) as total_chapters,
  count(distinct s.chapter_id) as started_count,
  count(distinct s.chapter_id) filter (where s.workflow_status in ('submitted','pending_executive','finalized')) as submitted_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'returned') as returned_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'finalized') as finalized_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'pending_executive') as pending_executive_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'draft') as draft_count,
  round(
    100.0 * count(distinct s.chapter_id) filter (where s.workflow_status in ('submitted','pending_executive','finalized'))
      / nullif(count(distinct sc.id), 0),
    2
  ) as completion_rate_pct,
  coalesce(sum(s.final_score), 0) as total_points,
  coalesce(sum(s.max_score), 0) as total_possible_points,
  round(case when sum(s.max_score) > 0 then (sum(s.final_score)::numeric / sum(s.max_score)::numeric) * 100 else 0 end, 2) as pct_score
from scoped_chapters sc
cross join public.v_reporting_terms t
left join public.submissions s
  on s.chapter_id = sc.id and s.term_code = t.term_code and s.reporting_year = t.reporting_year
group by sc.region, t.term_code, t.reporting_year;

create view public.v_national_rollup
  with (security_invoker = on) as
with scoped_chapters as (
  select id from public.chapters where status_code = 'Active'
)
select
  t.term_code,
  t.reporting_year,
  count(distinct sc.id) as total_chapters,
  count(distinct s.chapter_id) as started_count,
  count(distinct s.chapter_id) filter (where s.workflow_status in ('submitted','pending_executive','finalized')) as submitted_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'returned') as returned_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'finalized') as finalized_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'pending_executive') as pending_executive_count,
  count(distinct s.chapter_id) filter (where s.workflow_status = 'draft') as draft_count,
  round(
    100.0 * count(distinct s.chapter_id) filter (where s.workflow_status in ('submitted','pending_executive','finalized'))
      / nullif(count(distinct sc.id), 0),
    2
  ) as completion_rate_pct,
  coalesce(sum(s.final_score), 0) as total_points,
  coalesce(sum(s.max_score), 0) as total_possible_points,
  round(case when sum(s.max_score) > 0 then (sum(s.final_score)::numeric / sum(s.max_score)::numeric) * 100 else 0 end, 2) as pct_score
from scoped_chapters sc
cross join public.v_reporting_terms t
left join public.submissions s
  on s.chapter_id = sc.id and s.term_code = t.term_code and s.reporting_year = t.reporting_year
group by t.term_code, t.reporting_year;
