-- ---------------------------------------------------------------------------
-- Drops submission_item_responses.answer_yes — a leftover column from a
-- pre-migration prototype schema (predates 0001, never referenced anywhere
-- in this codebase or in any numbered migration). It was NOT NULL with no
-- default, which meant every INSERT into submission_item_responses that
-- didn't explicitly supply it failed outright — i.e. every brand-new
-- response to a rubric item, from any chapter, for the first time, on this
-- table's real production copy. The app only ever reads/writes answer_code;
-- answer_yes was always dead weight, just silently fatal dead weight.
-- ---------------------------------------------------------------------------
alter table public.submission_item_responses
  drop column if exists answer_yes;
