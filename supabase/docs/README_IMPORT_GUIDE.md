# Chapman Reporting Portal — Supabase SQL schema + seed package

## What is included
- `sql/01_schema.sql` — tables, triggers, indexes
- `sql/02_rls_policies.sql` — row-level security starter policies
- `sql/03_reporting_views.sql` — district, region, and national rollup views
- `sql/04_seed_load_order.sql` — recommended import order
- `seeds/chapters.csv` — normalized chapter master from APA Population.xlsx Sheet1
- `seeds/rubric_versions.csv`
- `seeds/rubric_sections.csv`
- `seeds/rubric_subsections.csv`
- `seeds/rubric_items.csv`
- `seeds/reviewer_assignments_template.csv`
- `seeds/reviewer_directory_template.csv`
- `seeds/system_contacts.csv`
- lookup/reference seed CSVs

## Source files used
- APA Population.xlsx / Sheet1
- Updated Chapter Management Report-REV1.xlsx

## Counts
- Chapters: 879
- Collegiate rubric items: 156
- Alumni rubric items: 144
- Total rubric items: 300

## Recommended load sequence in Supabase
1. Run `sql/01_schema.sql`
2. Run `sql/02_rls_policies.sql`
3. Run `sql/03_reporting_views.sql`
4. Import the CSVs in the order listed in `sql/04_seed_load_order.sql`

## Important implementation notes
- `profiles.id` references `auth.users.id`, so reviewer and chapter auth users should be created through Supabase Auth or your app before linking them.
- Chapter login model assumes **one shared account per chapter**. That shared auth user should be linked in `chapter_user_links`.
- Executive Director contact is pre-seeded as **Brother Sean L. McCaskill / seanmccaskill@apa1906.net**.
- Reviewer assignment template only includes **District Director** and **Regional Vice President** fields, per your approved workflow.
- Rubric items are seeded as **Yes/No binary scoring** with `default_point_value = 1` and `is_required = false` for now.

## Suggested Claude Code prompt starter
“Load the SQL files first, then import the CSV seeds into Supabase in the documented order. After that, generate TypeScript types, Supabase queries, and admin import scripts for reviewer directory and chapter-user links.”
