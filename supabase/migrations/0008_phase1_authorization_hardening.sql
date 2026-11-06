-- ===========================================================================
-- Phase 1: authorization hardening (docs/security-architecture-plan.md).
-- Closes defects 1a, 1c, 2, 3, 4 (draft-approval gap only - the race itself
-- is Phase 2), 6 (DB side), 7, 10, 11.
--
-- Nothing here changes the approved UI or workflow. Every legitimate path
-- already exercised by src/lib/store/supabase.ts and src/lib/provisioning.ts
-- continues to work exactly as before - the fixes below only close paths no
-- part of this app ever legitimately used (a chapter writing its own score,
-- a brand-new signup choosing its own role, a reviewer approving a draft).
-- ===========================================================================

-- ---------------------------------------------------------------------
-- 1c. profiles_admin_insert: a missing-profile account could directly
--     POST /rest/v1/profiles with role_code='admin'. The admin branch is
--     unchanged (an admin can insert any profile); the self-insert branch
--     can now only ever create the non-privileged default row - exactly
--     what handle_new_profile would have created for it anyway.
-- ---------------------------------------------------------------------
drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      id = auth.uid()
      and role_code = 'chapter'
      and district is null
      and region is null
      and is_active = true
    )
  );

-- ---------------------------------------------------------------------
-- 1a. handle_new_profile / ensure_profile: a new auth user's own
--     raw_user_meta_data was trusted directly for role_code/district/
--     region on initial INSERT - a public signUp() call (or a missing-
--     profile self-heal) could choose role_code:'admin' with nothing to
--     stop it, since prevent_profile_self_escalation only guards UPDATE.
--     Every new profile now always starts as the non-privileged default,
--     full stop - metadata is never read for authorization again. Actual
--     role/scope assignment is unaffected: src/lib/provisioning.ts's
--     createReviewerAccount/createAdminAccount/setProfileScope already
--     run as the service-role client immediately after inviting a user,
--     which bypasses RLS and this trigger's INSERT branch entirely isn't
--     involved in that upgrade step - it only ever fires for the initial
--     INSERT, and that second write still happens exactly as before.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role_code, district, region)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    'chapter',
    null,
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_profile();

-- Self-heal a missing row at sign-in (src/lib/store/supabase.ts calls this
-- best-effort after signIn()). Same non-privileged-default rule as above -
-- this is a parity repair for an account whose INSERT-time trigger somehow
-- never ran, never a second chance to choose a role from metadata.
create or replace function public.ensure_profile()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_user auth.users;
begin
  if v_uid is null then return; end if;
  if exists (select 1 from public.profiles where id = v_uid) then return; end if;
  select * into v_user from auth.users where id = v_uid;
  if not found then return; end if;
  insert into public.profiles (id, full_name, email, role_code, district, region)
  values (v_uid, coalesce(v_user.raw_user_meta_data ->> 'full_name', ''), v_user.email, 'chapter', null, null)
  on conflict (id) do nothing;
end;
$$;

grant execute on function public.ensure_profile() to authenticated;

-- ---------------------------------------------------------------------
-- 6 (DB side) + 7 (admin_readonly scope creep): every role helper now
-- requires the underlying profile to be active, so a deactivated account
-- loses every role/scope/chapter-link grant immediately (bounded only by
-- however long its already-issued JWT remains valid - the app session
-- layer gets its own check in the same change). current_chapter_ids() also
-- now requires the caller to actually be a 'chapter' role - previously any
-- role with a stale, still-active chapter_user_links row (e.g.
-- admin_readonly) inherited real chapter-scoped write access through every
-- policy that ORs in "chapter_id in (select current_chapter_ids())".
-- ---------------------------------------------------------------------
create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select role_code from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.current_district()
returns text language sql stable security definer set search_path = public as $$
  select district from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.current_region()
returns text language sql stable security definer set search_path = public as $$
  select region from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.current_chapter_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select cul.chapter_id from public.chapter_user_links cul
  join public.profiles p on p.id = cul.profile_id
   where cul.profile_id = auth.uid() and cul.is_active = true
     and p.is_active = true and p.role_code = 'chapter';
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

create or replace function public.is_admin_readonly()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'admin_readonly', false);
$$;

create or replace function public.is_executive()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'executive_director', false);
$$;

-- ---------------------------------------------------------------------
-- 2, 3, 4 (draft-approval gap), 10: submissions + submission_item_responses.
--
-- enforce_response_integrity (new, on submission_item_responses):
--   - rejects a response whose rubric_item_id doesn't belong to the
--     parent submission's own rubric_version_id (closes the "unrelated
--     rubric item" half of defect 2);
--   - always recomputes awarded_points itself from the item's definition
--     and the given answer_code, ignoring whatever the client supplied
--     (closes the "arbitrary awarded_points" half of defect 2). This
--     mirrors src/lib/scoring.ts's pointsFor() exactly, so the app's own
--     already-correct writes are unaffected.
--
-- enforce_submission_transition (rewritten): now also fires BEFORE INSERT,
-- and:
--   - a chapter's own INSERT must start from the canonical state (defect
--     10): both review lanes pending, no executive decision, no
--     submitted_by/submitted_at, a rubric_version_id that actually matches
--     the chapter's own chapter_type_code, and max_score/final_score equal
--     to the server-computed total for that rubric (0 earned before any
--     answers exist);
--   - a chapter's own UPDATE while draft/returned (the app's recalc()
--     path) must set final_score/max_score to the server-computed total
--     from the submission's current (now always-correct)
--     submission_item_responses rows, never an arbitrary value (the rest
--     of defect 2);
--   - a district_director/rvp decision now requires the submission to
--     actually be workflow_status='submitted' first (defect 4's draft-
--     approval gap - a reviewer could previously act on a report the
--     chapter hadn't submitted yet), for both the approve and the return
--     branch;
--   - executive_director is no longer exempted from this trigger
--     entirely: finalizing now requires both prior lanes already
--     approved, enforced here rather than only in application code.
-- ---------------------------------------------------------------------
create or replace function public.compute_rubric_max_score(p_rubric_version_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(default_point_value), 0)::integer
  from public.rubric_items
  where rubric_version_id = p_rubric_version_id and active = true;
$$;

create or replace function public.compute_response_points(p_default_point_value integer, p_is_required boolean, p_mandatory_penalty integer, p_answer_code text)
returns integer language sql immutable as $$
  select case p_answer_code
    when 'yes' then coalesce(p_default_point_value, 1)
    when 'na'  then coalesce(p_default_point_value, 1)
    when 'no'  then case when p_is_required then coalesce(p_mandatory_penalty, 0) else 0 end
    else 0
  end;
$$;

create or replace function public.compute_submission_earned_score(p_submission_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(awarded_points), 0)::integer
  from public.submission_item_responses
  where submission_id = p_submission_id;
$$;

create or replace function public.enforce_response_integrity()
returns trigger language plpgsql security definer set search_path = public as $enforce_response$
declare
  v_item public.rubric_items;
  v_submission public.submissions;
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  select * into v_submission from public.submissions where id = new.submission_id;
  if not found then
    raise exception 'Submission not found.';
  end if;

  select * into v_item from public.rubric_items where id = new.rubric_item_id;
  if not found or v_item.rubric_version_id != v_submission.rubric_version_id then
    raise exception 'This rubric item does not belong to the submission''s rubric version.';
  end if;

  new.awarded_points := public.compute_response_points(
    v_item.default_point_value, v_item.is_required, v_item.mandatory_penalty, new.answer_code
  );
  return new;
end;
$enforce_response$;

drop trigger if exists enforce_response_integrity_trigger on public.submission_item_responses;
create trigger enforce_response_integrity_trigger
  before insert or update on public.submission_item_responses
  for each row execute procedure public.enforce_response_integrity();

create or replace function public.enforce_submission_transition()
returns trigger language plpgsql security definer set search_path = public as $enforce_transition$
declare
  actor_role text;
  is_assigned boolean;
  expected_max integer;
  expected_earned integer;
  chapter_type text;
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if TG_OP = 'UPDATE' and (
       new.chapter_id != old.chapter_id
    or new.rubric_version_id != old.rubric_version_id
    or new.term_code != old.term_code
    or new.reporting_year != old.reporting_year
  ) then
    raise exception 'Cannot change a submission''s chapter, rubric version, term, or year.';
  end if;

  actor_role := public.current_role();

  if TG_OP = 'INSERT' then
    if actor_role != 'chapter' then
      raise exception 'Only a chapter can create its own submission.';
    end if;
    if not exists (
      select 1 from public.chapter_user_links cul
      where cul.chapter_id = new.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    ) then
      raise exception 'Not authorized to create a submission for this chapter.';
    end if;

    select c.chapter_type_code into chapter_type from public.chapters c where c.id = new.chapter_id;
    if not exists (
      select 1 from public.rubric_versions rv
      where rv.id = new.rubric_version_id and rv.chapter_type_code = chapter_type and rv.is_active = true
    ) then
      raise exception 'rubric_version_id does not match this chapter''s type, or is not active.';
    end if;

    expected_max := public.compute_rubric_max_score(new.rubric_version_id);

    if new.workflow_status != 'draft'
       or new.district_review_status != 'pending'
       or new.regional_review_status != 'pending'
       or new.executive_review_status != 'pending'
       or new.submitted_by_profile_id is not null
       or new.submitted_at is not null
       or new.final_score != 0
       or new.max_score != expected_max
    then
      raise exception 'A new submission must start in the canonical draft state with no score yet.';
    end if;

    return new;
  end if;

  -- TG_OP = 'UPDATE' from here on.
  if actor_role = 'chapter' then
    if not exists (
      select 1 from public.chapter_user_links cul
      where cul.chapter_id = new.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    ) then
      raise exception 'Not authorized to update this submission.';
    end if;

    -- saveResponse's recalc(): only the score columns change, and they
    -- must equal the server-computed total - never an arbitrary value.
    if old.workflow_status in ('draft', 'returned')
       and new.workflow_status = old.workflow_status
       and new.district_review_status = old.district_review_status
       and new.regional_review_status = old.regional_review_status
       and new.executive_review_status = old.executive_review_status
       and new.submitted_by_profile_id is not distinct from old.submitted_by_profile_id
       and new.submitted_at is not distinct from old.submitted_at then
      expected_earned := public.compute_submission_earned_score(new.id);
      expected_max := public.compute_rubric_max_score(new.rubric_version_id);
      if new.final_score != expected_earned or new.max_score != expected_max then
        raise exception 'final_score/max_score must equal the server-computed total from this submission''s responses.';
      end if;
      return new;
    end if;

    -- submitReport(): status resets to submitted/pending; the score is
    -- whatever the prior recalc() already left it as, not supplied fresh.
    if old.workflow_status in ('draft', 'returned')
       and new.workflow_status = 'submitted'
       and new.district_review_status = 'pending'
       and new.regional_review_status = 'pending'
       and new.executive_review_status = 'pending'
       and new.submitted_by_profile_id = auth.uid()
       and new.final_score = old.final_score
       and new.max_score = old.max_score then
      return new;
    end if;

    -- withdrawSubmission(): submitted -> draft, only while both review
    -- lanes are still untouched. submitted_by/submitted_at and the score
    -- are left as-is (a future resubmit overwrites them); only
    -- workflow_status actually changes.
    if old.workflow_status = 'submitted'
       and new.workflow_status = 'draft'
       and old.district_review_status = 'pending' and new.district_review_status = 'pending'
       and old.regional_review_status = 'pending' and new.regional_review_status = 'pending'
       and old.executive_review_status = 'pending' and new.executive_review_status = 'pending'
       and new.submitted_by_profile_id is not distinct from old.submitted_by_profile_id
       and new.submitted_at is not distinct from old.submitted_at
       and new.final_score = old.final_score
       and new.max_score = old.max_score then
      return new;
    end if;

    raise exception 'Chapters can only save draft answers, submit a draft/returned report, or withdraw an unreviewed submission.';
  end if;

  if actor_role in ('district_director', 'rvp') then
    if actor_role = 'district_director' then
      is_assigned := exists (
        select 1 from public.chapters c
        where c.id = new.chapter_id and c.district = public.current_district()
      );
    else
      is_assigned := exists (
        select 1 from public.chapters c
        where c.id = new.chapter_id and c.region = public.current_region()
      );
    end if;

    if not is_assigned then
      raise exception 'Not authorized to review this submission.';
    end if;

    -- Defect 4 (draft-approval gap): a reviewer may only act once the
    -- chapter has actually submitted - never while it's still a draft.
    if old.workflow_status != 'submitted' then
      raise exception 'Can only act on a submitted report.';
    end if;

    if new.final_score != old.final_score or new.max_score != old.max_score then
      raise exception 'Reviewers cannot change a submission''s score.';
    end if;
    if new.submitted_by_profile_id is distinct from old.submitted_by_profile_id
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'Reviewers cannot change submission metadata.';
    end if;

    if actor_role = 'district_director' then
      if old.district_review_status = 'pending' and new.district_review_status = 'approved'
         and new.regional_review_status = old.regional_review_status
         and new.executive_review_status = old.executive_review_status
         and (
           new.workflow_status = old.workflow_status
           or (new.workflow_status = 'pending_executive' and old.regional_review_status = 'approved')
         ) then
        return new;
      end if;
      if old.district_review_status = 'pending' and new.district_review_status = 'returned'
         and new.workflow_status = 'returned'
         and new.regional_review_status = old.regional_review_status
         and new.executive_review_status = old.executive_review_status then
        return new;
      end if;
      raise exception 'District directors can only approve or return a submitted report.';
    else
      if old.regional_review_status = 'pending' and new.regional_review_status = 'approved'
         and new.district_review_status = old.district_review_status
         and new.executive_review_status = old.executive_review_status
         and (
           new.workflow_status = old.workflow_status
           or (new.workflow_status = 'pending_executive' and old.district_review_status = 'approved')
         ) then
        return new;
      end if;
      if old.regional_review_status = 'pending' and new.regional_review_status = 'returned'
         and new.workflow_status = 'returned'
         and new.district_review_status = old.district_review_status
         and new.executive_review_status = old.executive_review_status then
        return new;
      end if;
      raise exception 'Regional vice presidents can only approve or return a submitted report.';
    end if;
  end if;

  if actor_role = 'executive_director' then
    if old.district_review_status != 'approved' or old.regional_review_status != 'approved' then
      raise exception 'Both district and regional approvals are required before final approval.';
    end if;
    if new.final_score != old.final_score or new.max_score != old.max_score then
      raise exception 'Reviewers cannot change a submission''s score.';
    end if;
    if new.submitted_by_profile_id is distinct from old.submitted_by_profile_id
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'Reviewers cannot change submission metadata.';
    end if;
    if old.executive_review_status = 'pending' and new.executive_review_status = 'approved'
       and new.workflow_status = 'finalized'
       and new.district_review_status = old.district_review_status
       and new.regional_review_status = old.regional_review_status then
      return new;
    end if;
    raise exception 'Executive directors can only finalize a submission with both prior approvals.';
  end if;

  raise exception 'Not authorized to update submissions.';
end;
$enforce_transition$;

drop trigger if exists enforce_submission_transition_trigger on public.submissions;
create trigger enforce_submission_transition_trigger
  before insert or update on public.submissions
  for each row execute procedure public.enforce_submission_transition();

-- submissions_chapter_insert's RLS WITH CHECK still only constrains
-- chapter_id/workflow_status (defect 10's RLS half) - the trigger above now
-- constrains everything else, but the RLS layer should not be weaker than
-- necessary either, so this also pins workflow_status to 'draft' on create
-- (a chapter has never had a legitimate reason to INSERT directly into
-- 'returned' - that status only ever arises from a reviewer's decision).
drop policy if exists submissions_chapter_insert on public.submissions;
create policy submissions_chapter_insert on public.submissions
  for insert to authenticated
  with check (
    chapter_id in (select public.current_chapter_ids())
    and workflow_status = 'draft'
  );

-- ---------------------------------------------------------------------
-- 11. documents_insert: a chapter could INSERT a document row claiming
--     status='accepted' with a fabricated reviewer/review-date, without
--     ever uploading anything. Mirrors the documents_update hardening
--     from 0004 - a chapter-initiated insert is now pinned to the
--     unreviewed starting state; only an admin (via documents_update,
--     already admin-only) can ever move it further.
-- ---------------------------------------------------------------------
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      chapter_id in (select public.current_chapter_ids())
      and status = 'uploaded'
      and reviewed_by_profile_id is null
      and reviewed_at is null
    )
  );

-- ---------------------------------------------------------------------
-- 7. approval_actions: insertable by anyone who could merely SEE the
--    submission, claiming any reviewer_role_code/action at all - a
--    chapter could forge its own "approved by district_director" row.
--    This BEFORE INSERT trigger requires the actor's claimed role to be
--    their own real current role, and for district_director/rvp, that
--    they are actually the assigned reviewer for that submission's
--    chapter - not merely that the row is visible to them.
-- ---------------------------------------------------------------------
create or replace function public.enforce_approval_action_integrity()
returns trigger language plpgsql security definer set search_path = public as $enforce_approval$
declare
  actor_role text;
  v_chapter_id uuid;
  is_assigned boolean;
begin
  if auth.role() = 'service_role' or public.is_admin() or public.is_executive() then
    return new;
  end if;

  actor_role := public.current_role();

  if new.reviewer_profile_id != auth.uid() then
    raise exception 'Cannot record a decision as another profile.';
  end if;
  if new.reviewer_role_code != actor_role then
    raise exception 'Cannot record a decision under a role other than your own.';
  end if;
  if actor_role not in ('district_director', 'rvp') then
    raise exception 'Only an assigned reviewer, admin, or executive can record a decision.';
  end if;

  select chapter_id into v_chapter_id from public.submissions where id = new.submission_id;
  if v_chapter_id is null then
    raise exception 'Submission not found.';
  end if;

  if actor_role = 'district_director' then
    is_assigned := exists (
      select 1 from public.chapters c where c.id = v_chapter_id and c.district = public.current_district()
    );
  else
    is_assigned := exists (
      select 1 from public.chapters c where c.id = v_chapter_id and c.region = public.current_region()
    );
  end if;
  if not is_assigned then
    raise exception 'Not the assigned reviewer for this submission''s chapter.';
  end if;

  return new;
end;
$enforce_approval$;

drop trigger if exists enforce_approval_action_integrity_trigger on public.approval_actions;
create trigger enforce_approval_action_integrity_trigger
  before insert on public.approval_actions
  for each row execute procedure public.enforce_approval_action_integrity();
