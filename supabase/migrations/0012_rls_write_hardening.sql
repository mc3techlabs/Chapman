-- Closes three write-side RLS gaps found in a security review of this
-- schema. Both profiles and submissions need to compare a row's OLD values
-- to its NEW values to decide whether a write is legitimate (e.g. "did
-- role_code change", "did workflow_status jump straight to finalized") —
-- a declarative RLS policy's USING clause only sees the pre-update row and
-- WITH CHECK only the post-update row, with no way to compare the two to
-- each other within one policy expression. Both are fixed with BEFORE
-- UPDATE triggers, which get both OLD and NEW. The third (responses) is a
-- plain EXISTS condition on the parent submission's current status, so
-- that one's a direct policy change.

-- ---------------------------------------------------------------------
-- 1. profiles: profiles_self_update had no WITH CHECK, so Postgres reused
--    USING (id = auth.uid()) for both sides of the write — any signed-in
--    user (including a chapter's shared login) could PATCH their own
--    profiles row to role_code='admin', or to any district/region,
--    directly via the REST API, bypassing the app (and its UI-only role
--    checks) entirely. is_admin()/is_exec() read role_code straight off
--    this table, so that write alone grants real admin/exec access to
--    every other policy in the schema.
-- ---------------------------------------------------------------------
create or replace function public.prevent_profile_self_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.role_code is distinct from old.role_code
     or new.district is distinct from old.district
     or new.region is distinct from old.region
     or new.is_active is distinct from old.is_active then
    raise exception 'Only an admin can change role_code, district, region, or is_active.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_profile_self_escalation_trigger on public.profiles;
create trigger prevent_profile_self_escalation_trigger
  before update on public.profiles
  for each row execute procedure public.prevent_profile_self_escalation();

-- Belt-and-suspenders: make the row-scope explicit instead of relying on
-- Postgres silently defaulting WITH CHECK to the USING clause.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- 2. submissions: submissions_update_scope's USING and WITH CHECK were
--    identical row-scope checks (same chapter_user_links/district/region
--    match used for reads) with no restriction on *which* columns
--    changed. A chapter's own session could PATCH its submission straight
--    to workflow_status='finalized' with every review status 'approved'
--    and an inflated score — self-approving without district, regional,
--    or executive review ever actually happening — and a district
--    director or RVP's session could do the equivalent for the other
--    lane, or edit a submission outside their own district/region.
--
--    This trigger only allows the exact transitions lib/data/submissions.ts
--    (submitReport) and lib/data/approvals.ts (approveDistrict,
--    approveRegional, returnSubmission) actually perform. Those approve
--    functions write in two separate steps — first the reviewer's own
--    lane, then (only once both lanes already show 'approved') a second,
--    separate update that advances workflow_status alone — so this
--    mirrors that as two allowed patterns rather than one combined one.
--    Admin, Executive Director, and the service-role key (used by admin
--    bulk actions and the tax-compliance import) are trusted and bypass
--    this entirely, same as everywhere else in this schema.
-- ---------------------------------------------------------------------
create or replace function public.enforce_submission_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  is_assigned boolean;
begin
  if auth.role() = 'service_role' or public.is_admin() or public.is_exec() then
    return new;
  end if;

  if new.chapter_id != old.chapter_id
     or new.rubric_version_id != old.rubric_version_id
     or new.term_code != old.term_code
     or new.reporting_year != old.reporting_year then
    raise exception 'Cannot change a submission''s chapter, rubric version, term, or year.';
  end if;

  actor_role := public.current_role_code();

  if actor_role = 'chapter' then
    if not exists (
      select 1 from public.chapter_user_links cul
      where cul.chapter_id = new.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    ) then
      raise exception 'Not authorized to update this submission.';
    end if;

    -- Saving a draft answer (recalcFinalScoreOnly / recalcSubmissionScore):
    -- only the score columns may change.
    if old.workflow_status in ('draft', 'returned')
       and new.workflow_status = old.workflow_status
       and new.district_review_status = old.district_review_status
       and new.regional_review_status = old.regional_review_status
       and new.executive_review_status = old.executive_review_status
       and new.submitted_by_profile_id is not distinct from old.submitted_by_profile_id
       and new.submitted_at is not distinct from old.submitted_at then
      return new;
    end if;

    -- Submitting a draft/returned report (submitReport calls
    -- recalcSubmissionScore as a separate, prior statement — already
    -- covered by the draft-save pattern above — so this specific update
    -- must leave the score exactly as that prior statement left it, not
    -- accept a score supplied in the same request).
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

    raise exception 'Chapters can only save draft answers or submit a draft/returned report.';
  end if;

  if actor_role in ('district_director', 'rvp') then
    if actor_role = 'district_director' then
      is_assigned := exists (
        select 1 from public.chapters c
        where c.id = new.chapter_id and c.district = public.current_user_district()
      );
    else
      is_assigned := exists (
        select 1 from public.chapters c
        where c.id = new.chapter_id and c.region = public.current_user_region()
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

    -- Step 2 of either approve path (maybeAdvanceToExecutive): once both
    -- lanes already show 'approved', whichever reviewer approved second
    -- triggers this separate, workflow_status-only update.
    if old.workflow_status = 'submitted' and new.workflow_status = 'pending_executive'
       and old.district_review_status = 'approved' and old.regional_review_status = 'approved'
       and new.district_review_status = old.district_review_status
       and new.regional_review_status = old.regional_review_status
       and new.executive_review_status = old.executive_review_status then
      return new;
    end if;

    if actor_role = 'district_director' then
      -- Step 1 of approveDistrict: only the district lane changes;
      -- workflow_status is untouched here even if this is the second
      -- approval (that's the separate "step 2" update above).
      if old.district_review_status = 'pending' and new.district_review_status = 'approved'
         and new.workflow_status = old.workflow_status
         and new.regional_review_status = old.regional_review_status
         and new.executive_review_status = old.executive_review_status then
        return new;
      end if;
      -- returnSubmission: district lane and workflow_status change together.
      if old.district_review_status = 'pending' and new.district_review_status = 'returned'
         and new.workflow_status = 'returned'
         and new.regional_review_status = old.regional_review_status
         and new.executive_review_status = old.executive_review_status then
        return new;
      end if;
      raise exception 'District directors can only approve or return a pending submission.';
    else
      if old.regional_review_status = 'pending' and new.regional_review_status = 'approved'
         and new.workflow_status = old.workflow_status
         and new.district_review_status = old.district_review_status
         and new.executive_review_status = old.executive_review_status then
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
$$;

drop trigger if exists enforce_submission_transition_trigger on public.submissions;
create trigger enforce_submission_transition_trigger
  before update on public.submissions
  for each row execute procedure public.enforce_submission_transition();

-- ---------------------------------------------------------------------
-- 3. submission_item_responses: responses_write_for_scope never checked
--    the parent submission's workflow_status, so a chapter could keep
--    inserting/editing scored answers after their report was submitted,
--    reviewed, or finalized — the app's isEditable check (which hides the
--    answer control once it's not draft/returned) is UI-only and was
--    never enforced server-side or in RLS.
-- ---------------------------------------------------------------------
drop policy if exists responses_write_for_scope on public.submission_item_responses;
create policy responses_write_for_scope on public.submission_item_responses for all using (
  public.is_admin() or
  exists (
    select 1 from public.submissions s
    join public.chapter_user_links cul on cul.chapter_id = s.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    where s.id = submission_item_responses.submission_id
      and s.workflow_status in ('draft', 'returned')
  )
) with check (
  public.is_admin() or
  exists (
    select 1 from public.submissions s
    join public.chapter_user_links cul on cul.chapter_id = s.chapter_id and cul.profile_id = auth.uid() and cul.is_active = true
    where s.id = submission_item_responses.submission_id
      and s.workflow_status in ('draft', 'returned')
  )
);
