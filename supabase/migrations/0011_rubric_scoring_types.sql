-- ---------------------------------------------------------------------------
-- Rubric scoring types: upload buckets (chapter / admin) and fill-in values.
--
-- Every item already earns its point through the same mechanism —
-- submission_item_responses.answer_code ('yes'|'no'|'na') feeding
-- compute_response_points() via the enforce_response_integrity trigger — so
-- that trigger and the scoring SQL functions (0008) need no changes at all.
-- This migration only:
--   1. Adds the four new document types the upload-scored items need.
--   2. Tags each rubric_item with how it earns its point (scoring_type) and,
--      for the two upload types, which document_type_code satisfies it.
--   3. Adds submission_item_responses.response_value, so a fill-in item's
--      actual entered text (a percentage, a count) is kept alongside the
--      yes/no it resolves to for scoring.
-- ---------------------------------------------------------------------------

-- Pre-existing data repair: document_types.csv had these three rows' multi-
-- value allowed_extensions unquoted, which silently misaligned every column
-- after it in both bootstrap generators (demo + bootstrap.sql). The live
-- project's own bootstrap run inherited the corruption — grip_submission
-- came in with allowed_extensions=['pdf'], applies_to_types=['xlsx'],
-- is_active=false, display_order=0, which also disabled the "other"
-- document-upload page entirely. Corrected here; the seed CSV is fixed in
-- the same change so a future bootstrap regeneration doesn't reintroduce it.
update public.document_types set
  allowed_extensions = array['pdf', 'csv', 'xlsx'], applies_to_types = array[]::text[],
  is_active = true, display_order = 50
where code = 'grip_submission';
update public.document_types set
  allowed_extensions = array['pdf', 'docx', 'xlsx', 'csv'], applies_to_types = array[]::text[],
  is_active = true, display_order = 60
where code = 'special_event_checklist';
update public.document_types set
  allowed_extensions = array['pdf', 'docx'], applies_to_types = array[]::text[],
  is_active = true, display_order = 70
where code = 'special_event_after_action';

insert into public.document_types (code, label, category, description, allowed_extensions, max_size_mb, applies_to_types, is_active, display_order)
values
  ('bank_account_verification', 'Bank Account Verification', 'other',
   'Evidence of a valid chapter bank account with the appropriate account holder (Chapman criterion 1.1).',
   array['pdf','png','jpg','jpeg'], 25, array[]::text[], true, 80),
  ('district_fees_payment', 'District Fees Payment Confirmation', 'other',
   'Confirmation of District conference registration and chapter assessment fees paid.',
   array['pdf','png','jpg','jpeg'], 25, array[]::text[], true, 90),
  ('regional_fees_payment', 'Regional Fees Payment Confirmation', 'other',
   'Confirmation of Regional convention registration and chapter assessment fees paid.',
   array['pdf','png','jpg','jpeg'], 25, array[]::text[], true, 100),
  ('general_fees_payment', 'General Fees Payment Confirmation', 'other',
   'Confirmation of chapter tax, chapter insurance, and premium insurance fees paid.',
   array['pdf','png','jpg','jpeg'], 25, array[]::text[], true, 110)
on conflict (code) do nothing;

-- scoring_type: how the item's point is earned.
--   yes_no         — chapter answers yes/no/na directly (today's behavior; default).
--   fill_in        — chapter enters a value (percentage, count, free text); a
--                     non-blank value resolves to answer_code='yes', blank to 'no'
--                     (no N/A grace for this type, per the board's direction).
--   chapter_upload — the chapter must upload a matching document; the upload
--                     resolves the item to answer_code='yes'.
--   admin_upload   — same, but only the General Office can satisfy it on the
--                     chapter's behalf.
alter table public.rubric_items
  add column if not exists scoring_type text not null default 'yes_no'
    check (scoring_type in ('yes_no', 'fill_in', 'chapter_upload', 'admin_upload')),
  add column if not exists document_type_code text references public.document_types(code);

alter table public.rubric_items
  drop constraint if exists rubric_items_upload_needs_doc_type;
alter table public.rubric_items
  add constraint rubric_items_upload_needs_doc_type
    check (
      (scoring_type in ('chapter_upload', 'admin_upload')) = (document_type_code is not null)
    );

-- Backfill, mirroring the classification the board applied to the rubric
-- export (chapman-rubrics.xlsx "Criteria" column) — same rules for both the
-- Collegiate and Alumni versions, whose criterion text is near-identical.
update public.rubric_items set
  scoring_type = case
    when criterion_text ilike '%bank account%' then 'chapter_upload'
    when criterion_text ilike '%district fees%' then 'admin_upload'
    when criterion_text ilike '%regional fees%' then 'admin_upload'
    when criterion_text ilike '%general fees%' then 'admin_upload'
    when criterion_text ilike '%submission of grip%' then 'chapter_upload'
    when criterion_text ilike '%audit%' and criterion_text ilike '%submission%' then 'chapter_upload'
    when criterion_text ilike '%990 form%' then 'chapter_upload'
    -- Go To High School / Go To College event counts are reported as a plain
    -- yes/no (did the chapter hold one), not an entered number, per the
    -- board's own Collegiate tagging.
    when criterion_text ilike '%go to high school%' and criterion_text ilike '%go to college%' then 'yes_no'
    when criterion_text ilike '%gpa%' then 'fill_in'
    when criterion_text ~* '(percentage|pecentage|amount of|number of|select all)' then 'fill_in'
    else 'yes_no'
  end,
  document_type_code = case
    when criterion_text ilike '%bank account%' then 'bank_account_verification'
    when criterion_text ilike '%district fees%' then 'district_fees_payment'
    when criterion_text ilike '%regional fees%' then 'regional_fees_payment'
    when criterion_text ilike '%general fees%' then 'general_fees_payment'
    when criterion_text ilike '%submission of grip%' then 'grip_submission'
    when criterion_text ilike '%audit%' and criterion_text ilike '%submission%' then 'chapter_audit'
    when criterion_text ilike '%990 form%' then 'foundation_990'
    else null
  end;

alter table public.submission_item_responses
  add column if not exists response_value text;
