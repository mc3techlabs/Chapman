-- Lets a chapter withdraw its own submitted report back to draft, but only
-- while neither reviewer has acted yet (both lanes still pending) - once a
-- district director or RVP has approved or returned it, the chapter can no
-- longer unilaterally pull it back. Needed because a chapter whose district/
-- region has no reviewer assigned yet currently has no way to recover a
-- report it submitted too early: RLS didn't even let a chapter's own session
-- touch a 'submitted' row (the chapter_update policy's USING clause only
-- covered draft/returned), so there was nothing to extend at the trigger
-- level until the row itself became reachable.

drop policy if exists submissions_chapter_update on public.submissions;
create policy submissions_chapter_update on public.submissions
  for update to authenticated
  using (
    chapter_id in (select public.current_chapter_ids())
    and workflow_status in ('draft', 'returned', 'submitted')
  )
  with check (
    chapter_id in (select public.current_chapter_ids())
    and workflow_status in ('draft', 'returned', 'submitted')
  );

create or replace function public.enforce_submission_transition()
returns trigger language plpgsql security definer set search_path = public as $enforce_transition$
declare
  actor_role text;
  is_assigned boolean;
begin
  if auth.role() = 'service_role' or public.is_admin() or public.is_executive() then
    return new;
  end if;

  if new.chapter_id != old.chapter_id
     or new.rubric_version_id != old.rubric_version_id
     or new.term_code != old.term_code
     or new.reporting_year != old.reporting_year then
    raise exception 'Cannot change a submission''s chapter, rubric version, term, or year.';
  end if;

  actor_role := public.current_role();

  if actor_role = 'chapter' then
    if not exists (
      select 1 from public.chapter_user_links cul
      where cul.chapter_id = new.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    ) then
      raise exception 'Not authorized to update this submission.';
    end if;

    -- saveResponse's recalc(): only the score columns change.
    if old.workflow_status in ('draft', 'returned')
       and new.workflow_status = old.workflow_status
       and new.district_review_status = old.district_review_status
       and new.regional_review_status = old.regional_review_status
       and new.executive_review_status = old.executive_review_status
       and new.submitted_by_profile_id is not distinct from old.submitted_by_profile_id
       and new.submitted_at is not distinct from old.submitted_at then
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

    if new.final_score != old.final_score or new.max_score != old.max_score then
      raise exception 'Reviewers cannot change a submission''s score.';
    end if;
    if new.submitted_by_profile_id is distinct from old.submitted_by_profile_id
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'Reviewers cannot change submission metadata.';
    end if;

    if actor_role = 'district_director' then
      -- approve(): district lane flips to approved; workflow_status may
      -- also advance to pending_executive in the SAME update if the
      -- regional lane was already approved (src/lib/store/supabase.ts
      -- approve() builds one combined patch, not two separate writes).
      if old.district_review_status = 'pending' and new.district_review_status = 'approved'
         and new.regional_review_status = old.regional_review_status
         and new.executive_review_status = old.executive_review_status
         and (
           new.workflow_status = old.workflow_status
           or (old.workflow_status = 'submitted' and new.workflow_status = 'pending_executive'
               and old.regional_review_status = 'approved')
         ) then
        return new;
      end if;
      -- returnSubmission(): district lane and workflow_status change together.
      if old.district_review_status = 'pending' and new.district_review_status = 'returned'
         and new.workflow_status = 'returned'
         and new.regional_review_status = old.regional_review_status
         and new.executive_review_status = old.executive_review_status then
        return new;
      end if;
      raise exception 'District directors can only approve or return a pending submission.';
    else
      if old.regional_review_status = 'pending' and new.regional_review_status = 'approved'
         and new.district_review_status = old.district_review_status
         and new.executive_review_status = old.executive_review_status
         and (
           new.workflow_status = old.workflow_status
           or (old.workflow_status = 'submitted' and new.workflow_status = 'pending_executive'
               and old.district_review_status = 'approved')
         ) then
        return new;
      end if;
      if old.regional_review_status = 'pending' and new.regional_review_status = 'returned'
         and new.workflow_status = 'returned'
         and new.district_review_status = old.district_review_status
         and new.executive_review_status = old.executive_review_status then
        return new;
      end if;
      raise exception 'Regional vice presidents can only approve or return a pending submission.';
    end if;
  end if;

  raise exception 'Not authorized to update submissions.';
end;
$enforce_transition$;
