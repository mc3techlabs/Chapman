-- Found in review: plain Postgres views execute with the view owner's
-- privileges for RLS purposes (owner is `postgres` in Supabase, which has
-- BYPASSRLS). Without security_invoker, any authenticated role — including
-- a chapter's shared login — can read these reporting views directly via
-- the PostgREST API and get every district's/region's/national numbers,
-- not just their own scope, regardless of the chapters/submissions RLS
-- policies in 0002_rls_policies.sql. security_invoker (Postgres 15+) makes
-- the view re-evaluate as the querying role instead, so the underlying
-- table policies (chapters_read_chapter_own, submissions_read_for_scope,
-- etc.) actually apply.
alter view public.v_submission_rollup set (security_invoker = on);
alter view public.v_reporting_terms set (security_invoker = on);
alter view public.v_district_rollup set (security_invoker = on);
alter view public.v_region_rollup set (security_invoker = on);
alter view public.v_national_rollup set (security_invoker = on);
