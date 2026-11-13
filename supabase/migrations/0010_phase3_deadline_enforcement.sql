-- ===========================================================================
-- Phase 3: reporting-deadline enforcement (docs/security-architecture-plan.md).
-- Closes defect 8. Per the organization's own confirmed answer (§8): reporting
-- deadlines are hard-enforced, not advisory - once a reporting_windows row's
-- closes_on date passes, no chapter write and no reviewer decision on a
-- submission in that window is accepted, except by an admin (who already
-- bypasses this entire trigger, and who has record_review_approval/
-- enforce_submission_transition's shared is_admin() escape hatch to still act
-- - the concrete admin override is reopenSubmission(), now wired to
-- /admin/submissions in this same change).
--
-- A window with no row at all, or a row whose closes_on is null, never blocks
-- anything here - this only fires once an actual deadline has been set and
-- has actually passed, never from the mere absence of a configured window.
--
-- The check applies to UPDATE only, not INSERT: the app lazily
-- auto-creates a submission's canonical empty draft row the first time a
-- chapter visits its dashboard for a period (getOrCreateSubmission), with
-- no separate user-facing "start a new submission" action to gate - and an
-- auto-created row that can never be edited or submitted (because the
-- UPDATE path below is blocked) accomplishes nothing for a chapter anyway.
-- Blocking the INSERT would only turn a routine dashboard page load into an
-- unhandled exception for any chapter that never visited during an
-- already-closed window, for no real enforcement gain.
-- ===========================================================================

create or replace function public.reporting_window_closed(p_term_code text, p_reporting_year integer)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select closes_on < current_date
      from public.reporting_windows
      where term_code = p_term_code and reporting_year = p_reporting_year
      order by created_at desc
      limit 1
    ),
    false
  );
$$;

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
  if public.reporting_window_closed(new.term_code, new.reporting_year) then
    raise exception 'This reporting window has closed. An admin can reopen this submission from Admin -> Submissions if changes are still needed.';
  end if;

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
