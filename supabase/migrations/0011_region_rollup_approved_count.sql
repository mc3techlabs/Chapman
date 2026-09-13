-- Mirrors 0010 for the Regional Vice President review screen: adds
-- regional_approved_count to v_region_rollup, since started_count/
-- completion_rate_pct are workflow-status based and don't capture "how
-- many has this RVP actually approved." Appended as the last column so
-- this stays a plain CREATE OR REPLACE (same columns, same order, one
-- addition) rather than a drop/recreate.
create or replace view public.v_region_rollup
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
  round(case when sum(s.max_score) > 0 then (sum(s.final_score)::numeric / sum(s.max_score)::numeric) * 100 else 0 end, 2) as pct_score,
  count(distinct s.chapter_id) filter (where s.regional_review_status = 'approved') as regional_approved_count
from scoped_chapters sc
cross join public.v_reporting_terms t
left join public.submissions s
  on s.chapter_id = sc.id and s.term_code = t.term_code and s.reporting_year = t.reporting_year
group by sc.region, t.term_code, t.reporting_year;
