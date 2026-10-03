-- Closes three write-side RLS gaps found in a security review of this
-- schema. profiles and submissions both need to compare a row's OLD values
-- to its NEW values to decide whether a write is legitimate (e.g. "did
-- role_code change", "did workflow_status jump straight to finalized") —
-- a declarative RLS policy's USING clause only sees the pre-update row and
-- WITH CHECK only the post-update row, with no way to compare the two to
-- each other within one policy expression. Both are fixed with BEFORE
-- UPDATE triggers, which get both OLD and NEW. documents_update has no
-- legitimate non-admin write path in the app today (listDocuments/
-- createDocument are the only document operations in src/lib/store/
-- supabase.ts — nothing ever updates a document row), so that one is a
-- direct policy fix instead of a trigger.

-- ---------------------------------------------------------------------
-- 1. profiles: profiles_self_update's WITH CHECK reuses the same row-scope
--    predicate as USING (id = auth.uid() or is_admin()) with no column
--    restriction, so any signed-in user — including a chapter's shared
--    login — can PATCH their own profiles row to role_code='admin', or to
--    any other district/region, directly via the REST API, bypassing the
--    app (and its UI-only role checks) entirely. current_role()/
--    current_district()/current_region() read straight off this row, so
--    that write alone grants real admin access (or a stolen review scope)
--    to every other policy in this schema.
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

-- ---------------------------------------------------------------------
-- 2. submissions: submissions_chapter_update and submissions_reviewer_update
--    gate which row can be touched but never which columns change. A
--    chapter's own session could PATCH its submission straight to
--    workflow_status='submitted' with both review statuses 'approved' and
--    an inflated final_score — self-approving without district, regional,
--    or executive review ever happening — and a district director or RVP's
--    session (submissions_reviewer_update's WITH CHECK is `true`) could set
--    workflow_status='finalized' directly, skipping the executive lane.
--
--    This trigger only allows the exact transitions src/lib/store/
--    supabase.ts actually performs: saveResponse's recalc() (score columns
--    only, while draft/returned), submitReport() (status reset to
--    submitted/pending + submitted_by/submitted_at, score untouched), and
--    approve()/returnSubmission() for district_director/rvp (their own lane
--    only, workflow_status advancing to pending_executive/returned exactly
--    as approve()/returnSubmission() do it in one combined update). Admin,
--    Executive Director, and the service-role key are trusted and bypass
--    this entirely, same as the RLS policies they already bypass.
-- ---------------------------------------------------------------------
create or replace function public.enforce_submission_transition()
returns trigger language plpgsql security definer set search_path = public as $$
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

    raise exception 'Chapters can only save draft answers or submit a draft/returned report.';
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
$$;

drop trigger if exists enforce_submission_transition_trigger on public.submissions;
create trigger enforce_submission_transition_trigger
  before update on public.submissions
  for each row execute procedure public.enforce_submission_transition();

-- ---------------------------------------------------------------------
-- 3. documents: documents_update's WITH CHECK is `true` — any actor who
--    passes the row-scope USING clause (including a chapter updating its
--    own upload) can set any column to any value, e.g. self-accepting its
--    own document (status='accepted') or reassigning chapter_id/
--    storage_path. Nothing in src/lib/store/supabase.ts or src/routes/
--    documents.tsx ever updates a document row today (only insert/list),
--    so there is no legitimate non-admin write path to preserve — this
--    locks the policy to admin-only, matching actual usage.
-- ---------------------------------------------------------------------
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
  using (public.is_admin())
  with check (public.is_admin());
