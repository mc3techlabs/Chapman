-- ===========================================================================
-- Phase 2: workflow consistency (docs/security-architecture-plan.md).
-- Closes defect 4 (the parallel-approval race, not the draft-approval gap -
-- that half already shipped in 0008).
--
-- Root cause: src/lib/store/supabase.ts's approve() read the submission in
-- one request, computed whether both lanes were now approved from that
-- snapshot, then wrote a patch in a SEPARATE request. If a District
-- Director and an RVP approve within the same window (the architecture
-- explicitly runs these lanes in parallel), each one's read can see the
-- OTHER lane still pending - because the other hasn't committed yet - so
-- neither individual write includes the workflow_status transition. Both
-- lanes end up approved, but workflow_status is stuck at 'submitted'
-- forever, invisible to the executive queue.
--
-- Fix: two new RPC functions do the read-decide-write as ONE atomic SQL
-- UPDATE (a `CASE WHEN <other lane>` expression evaluated against the
-- row's current value under Postgres's own row lock, not a value read in
-- a prior, separate request) plus the approval_actions insert, in a single
-- transaction. PostgREST's REST API has no way to express "set this
-- column based on another column's current value" in one call - that's
-- the actual reason this needed a stored function, not just app-code
-- discipline. SECURITY INVOKER (the PL/pgSQL default): these run with the
-- CALLING user's privileges, so RLS and the existing
-- enforce_submission_transition / enforce_approval_action_integrity
-- triggers from 0008 still apply exactly as before - nothing here bypasses
-- authorization, it only makes the decide-and-write step atomic. The
-- actor's role is read server-side via current_role(), never trusted from
-- a client-supplied parameter.
-- ===========================================================================

create or replace function public.record_review_approval(p_submission_id uuid, p_comment text default null)
returns public.submissions
language plpgsql
security invoker
set search_path = public
as $record_approval$
declare
  actor_role text := public.current_role();
  actor_id uuid := auth.uid();
  v_sub public.submissions;
begin
  if actor_role = 'district_director' then
    update public.submissions
       set district_review_status = 'approved',
           workflow_status = case when regional_review_status = 'approved'
                                   then 'pending_executive' else workflow_status end
     where id = p_submission_id
    returning * into v_sub;
  elsif actor_role = 'rvp' then
    update public.submissions
       set regional_review_status = 'approved',
           workflow_status = case when district_review_status = 'approved'
                                   then 'pending_executive' else workflow_status end
     where id = p_submission_id
    returning * into v_sub;
  elsif actor_role = 'executive_director' then
    update public.submissions
       set executive_review_status = 'approved',
           workflow_status = 'finalized'
     where id = p_submission_id
    returning * into v_sub;
  else
    raise exception 'Only a district director, RVP, or executive director can record an approval.';
  end if;

  if v_sub.id is null then
    raise exception 'Update was rejected, or the submission is no longer in a state this action allows.';
  end if;

  insert into public.approval_actions (submission_id, reviewer_profile_id, reviewer_role_code, action, action_comment)
  values (p_submission_id, actor_id, actor_role, 'approved', p_comment);

  return v_sub;
end;
$record_approval$;

grant execute on function public.record_review_approval(uuid, text) to authenticated;

create or replace function public.record_review_return(p_submission_id uuid, p_comment text)
returns public.submissions
language plpgsql
security invoker
set search_path = public
as $record_return$
declare
  actor_role text := public.current_role();
  actor_id uuid := auth.uid();
  v_sub public.submissions;
begin
  if actor_role = 'district_director' then
    update public.submissions
       set district_review_status = 'returned', workflow_status = 'returned'
     where id = p_submission_id
    returning * into v_sub;
  elsif actor_role = 'rvp' then
    update public.submissions
       set regional_review_status = 'returned', workflow_status = 'returned'
     where id = p_submission_id
    returning * into v_sub;
  else
    raise exception 'Only a district director or RVP can return a submission.';
  end if;

  if v_sub.id is null then
    raise exception 'Update was rejected, or the submission is no longer in a state this action allows.';
  end if;

  insert into public.approval_actions (submission_id, reviewer_profile_id, reviewer_role_code, action, action_comment)
  values (p_submission_id, actor_id, actor_role, 'returned', p_comment);

  return v_sub;
end;
$record_return$;

grant execute on function public.record_review_return(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- One-time reconciliation: repair any submission already stranded by the
-- race above (both lanes approved, workflow_status never advanced past
-- 'submitted'). Idempotent - a no-op on a database that never hit the
-- race, or one already reconciled. Runs as this migration's own session,
-- which carries no request.jwt.claim.* GUCs, so it explicitly presents as
-- service_role for this one statement to pass enforce_submission_transition
-- (which would otherwise reject it: an anonymous actor_role matches none
-- of that trigger's branches and falls through to its final "not
-- authorized" exception) - the same mechanism a real service-role
-- PostgREST request uses, not a bypass invented for this migration.
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.submissions
     set workflow_status = 'pending_executive'
   where workflow_status = 'submitted'
     and district_review_status = 'approved'
     and regional_review_status = 'approved';
end $$;
