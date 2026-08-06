-- Fixes a schema/data mismatch found while seeding: the source rubric
-- reuses criterion_code values (e.g. "7.2", "1.8") across genuinely
-- different items in a few spots, and display_order resets per subsection,
-- so neither can be a uniqueness key. See 0001_schema.sql for the same fix
-- applied to the table definition for fresh installs.
alter table public.rubric_items
  drop constraint if exists rubric_items_rubric_version_id_criterion_code_key;
