-- ===========================================================================
-- Reporting views for the district / regional / national rollups.
--
-- All views are security_invoker = on so they run with the *querying* role's
-- privileges: a district director querying a rollup only aggregates rows RLS
-- already lets them see. Without this, the view would evaluate as its owner
-- and leak every scope.
--
-- The rollups are built LEFT JOIN from the active chapter roster (cross
-- joined against every term/year that has ever been reported or opened), NOT
-- inner-joined from submissions — a chapter that hasn't started still has to
-- count in the denominator, or completion % is meaningless (3 finalized out
-- of the only 3 touched would read as 100% while 800 sit at zero).
-- ===========================================================================

-- Distinct term/year pairs for dashboard filters.
create or replace view public.v_reporting_terms
  with (security_invoker = on) as
select term_code, reporting_year from public.submissions where reporting_year is not null
union
select term_code, reporting_year from public.reporting_windows where reporting_year is not null;

-- Per-submission rollup row (one chapter / term / year).
create or replace view public.v_submission_rollup
  with (security_invoker = on) as
select
  c.id            as chapter_id,
  c.chapter_key,
  c.chapter_name,
  c.chapter_type_code,
  c.district,
  c.region,
  c.status_code,
  s.id            as submission_id,
  s.term_code,
  s.reporting_year,
  s.workflow_status,
  s.district_review_status,
  s.regional_review_status,
  s.executive_review_status,
  s.final_score,
  s.max_score,
  case when s.max_score > 0
       then round((s.final_score::numeric / s.max_score::numeric) * 100, 2)
       else 0 end as pct_score
from public.submissions s
join public.chapters c on c.id = s.chapter_id;

-- Active-chapter roster x every reported/opened term — the denominator spine.
create or replace view public.v_roster_spine
  with (security_invoker = on) as
select
  c.id as chapter_id, c.chapter_key, c.chapter_name, c.chapter_type_code,
  c.district, c.region,
  p.term_code, p.reporting_year
from public.chapters c
cross join (
  select term_code, reporting_year from public.v_reporting_terms where reporting_year is not null
) p
where c.status_code = 'Active';

drop view if exists public.v_district_rollup;
create view public.v_district_rollup
  with (security_invoker = on) as
select
  sp.district,
  sp.term_code,
  sp.reporting_year,
  count(*)                                              as chapters_total,
  count(s.id)                                           as chapters_started,
  count(*) filter (where s.workflow_status = 'finalized') as chapters_finalized,
  count(*) filter (where s.district_review_status = 'approved') as district_approved,
  coalesce(sum(s.final_score), 0)                       as points_earned,
  coalesce(sum(s.max_score), 0)                         as points_possible,
  case when coalesce(sum(s.max_score), 0) > 0
       then round((sum(s.final_score)::numeric / sum(s.max_score)::numeric) * 100, 2)
       else 0 end                                       as avg_score_pct,
  case when count(*) > 0
       then round((count(s.id)::numeric / count(*)::numeric) * 100, 2)
       else 0 end                                       as completion_rate_pct
from public.v_roster_spine sp
left join public.submissions s
  on s.chapter_id = sp.chapter_id
 and s.term_code = sp.term_code
 and s.reporting_year = sp.reporting_year
group by sp.district, sp.term_code, sp.reporting_year;

drop view if exists public.v_region_rollup;
create view public.v_region_rollup
  with (security_invoker = on) as
select
  sp.region,
  sp.term_code,
  sp.reporting_year,
  count(*)                                              as chapters_total,
  count(s.id)                                           as chapters_started,
  count(*) filter (where s.workflow_status = 'finalized') as chapters_finalized,
  count(*) filter (where s.regional_review_status = 'approved') as region_approved,
  count(distinct sp.district)                           as districts_total,
  coalesce(sum(s.final_score), 0)                       as points_earned,
  coalesce(sum(s.max_score), 0)                         as points_possible,
  case when coalesce(sum(s.max_score), 0) > 0
       then round((sum(s.final_score)::numeric / sum(s.max_score)::numeric) * 100, 2)
       else 0 end                                       as avg_score_pct,
  case when count(*) > 0
       then round((count(s.id)::numeric / count(*)::numeric) * 100, 2)
       else 0 end                                       as completion_rate_pct
from public.v_roster_spine sp
left join public.submissions s
  on s.chapter_id = sp.chapter_id
 and s.term_code = sp.term_code
 and s.reporting_year = sp.reporting_year
group by sp.region, sp.term_code, sp.reporting_year;

drop view if exists public.v_national_rollup;
create view public.v_national_rollup
  with (security_invoker = on) as
select
  sp.term_code,
  sp.reporting_year,
  count(*)                                              as chapters_total,
  count(s.id)                                           as chapters_started,
  count(*) filter (where s.workflow_status = 'finalized') as chapters_finalized,
  count(*) filter (where s.workflow_status = 'pending_executive') as pending_executive,
  count(distinct sp.region)                             as regions_total,
  count(distinct sp.district)                           as districts_total,
  coalesce(sum(s.final_score), 0)                       as points_earned,
  coalesce(sum(s.max_score), 0)                         as points_possible,
  case when coalesce(sum(s.max_score), 0) > 0
       then round((sum(s.final_score)::numeric / sum(s.max_score)::numeric) * 100, 2)
       else 0 end                                       as avg_score_pct,
  case when count(*) > 0
       then round((count(s.id)::numeric / count(*)::numeric) * 100, 2)
       else 0 end                                       as completion_rate_pct
from public.v_roster_spine sp
left join public.submissions s
  on s.chapter_id = sp.chapter_id
 and s.term_code = sp.term_code
 and s.reporting_year = sp.reporting_year
group by sp.term_code, sp.reporting_year;
