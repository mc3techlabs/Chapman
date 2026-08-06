-- Chapman Reporting Portal — reporting views
create or replace view public.v_submission_rollup as
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

create or replace view public.v_district_rollup as
select
  district,
  region,
  term_code,
  reporting_year,
  count(*) as submission_count,
  sum(final_score) as total_points,
  sum(max_score) as total_possible_points,
  round(case when sum(max_score) > 0 then (sum(final_score)::numeric / sum(max_score)::numeric) * 100 else 0 end, 2) as pct_score
from public.v_submission_rollup
group by district, region, term_code, reporting_year;

create or replace view public.v_region_rollup as
select
  region,
  term_code,
  reporting_year,
  count(*) as submission_count,
  sum(final_score) as total_points,
  sum(max_score) as total_possible_points,
  round(case when sum(max_score) > 0 then (sum(final_score)::numeric / sum(max_score)::numeric) * 100 else 0 end, 2) as pct_score
from public.v_submission_rollup
group by region, term_code, reporting_year;

create or replace view public.v_national_rollup as
select
  term_code,
  reporting_year,
  count(*) as submission_count,
  sum(final_score) as total_points,
  sum(max_score) as total_possible_points,
  round(case when sum(max_score) > 0 then (sum(final_score)::numeric / sum(max_score)::numeric) * 100 else 0 end, 2) as pct_score
from public.v_submission_rollup
group by term_code, reporting_year;
