# Chapman Reporting Portal

Production scaffold for the Alpha Phi Alpha Fraternity, Inc. Chapman
Reporting Portal — Next.js (App Router) + TypeScript + Tailwind + Supabase.

The prior GenSpark prototype lives at `docs/prototype-reference.html`; its
color palette, accordion rubric layout, and chapter identity display
(`Name: X (Key)` / `District/Region: A - B`) are what the real UI is built
against.

## Stack

- Next.js 16 (App Router), TypeScript, Tailwind CSS v4
- Supabase (Postgres, Auth, Row Level Security) via `@supabase/ssr`
- Deploys to Vercel

## Local setup checklist

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the Supabase values (see
   below).
3. Complete the **Supabase setup checklist** first — the app has nothing to
   query until the schema and seed data exist.
4. `npm run dev` and open `http://localhost:3000`.
5. Create at least one user per role in Supabase Auth (see **Assumptions**)
   so you can sign in and exercise each screen.

## Supabase setup checklist

1. Create a Supabase project.
2. In the SQL editor (or via `supabase db push` / CLI migrations), run, in
   order:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_rls_policies.sql`
   - `supabase/migrations/0003_reporting_views.sql`
   - (`0004_seed_load_order_notes.sql` is comments only, not executable SQL)
3. Load lookup tables, the chapter master, and rubric structure:
   ```bash
   SUPABASE_URL=https://<project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   npm run db:seed
   ```
   This runs `scripts/import-seed.ts` against the CSVs in `supabase/seed/`,
   in the documented order, resolving rubric section/subsection/item
   references by their natural keys. It seeds: chapter types & statuses,
   app roles, report terms, the Executive Director system contact, the
   879-chapter master, and both rubric versions (Collegiate + Alumni, 300
   items total).
4. **Not seeded automatically** (need real data first — see
   `supabase/docs/README_IMPORT_GUIDE.md`):
   - `reporting_windows_template.csv` — add real open/close dates, then load.
   - `reviewer_directory_template.csv` — add real reviewer names/emails.
   - `reviewer_assignments_template.csv` — load after reviewer auth users
     and their `profiles` rows exist.
5. Create Supabase Auth users for each chapter (one shared login) and for
   every named reviewer (DD, RVP, Executive Director, admin). The
   `handle_new_profile` trigger auto-creates a matching `public.profiles`
   row with `role_code` from `raw_user_meta_data.role_code` (defaults to
   `chapter` if omitted) — set that in the Auth user's metadata, or update
   `profiles.role_code`/`district`/`region` afterward.
6. Link each chapter's shared auth user to its chapter row in
   `chapter_user_links`.
7. Set up reviewer assignments via `/admin/reviewers` in the app, or by
   loading `reviewer_assignments_template.csv` once it's filled in.

## Vercel deployment checklist

1. Push this repo to GitHub (already connected: `mc3techlabs/Chapman`).
2. Import the repo in Vercel.
3. Add the two `NEXT_PUBLIC_*` environment variables from `.env.example` in
   Vercel's project settings (Production + Preview). The service-role
   variables are only needed for running `scripts/import-seed.ts` locally —
   do not add them to Vercel.
4. Deploy. Default Next.js build/output settings work as-is.

## Environment variables

See `.env.example`. `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
are required for the app to run at all (client + server + middleware).
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are only used by the local seed
script.

## Assumptions made while scaffolding

- **Auth**: email/password via Supabase Auth for both the shared chapter
  login and individual reviewer logins — no magic link/SSO, since none was
  specified.
- **"Current" reporting period**: `lib/reportingPeriod.ts` prefers an active
  row in `reporting_windows`; if none is configured yet, it falls back to a
  calendar default (Jan–Jun = spring, Jul–Dec = fall) so the chapter
  workspace is usable before an admin sets up windows.
- **Score display**: `submissions.final_score` / `max_score` are
  recalculated server-side from `submission_item_responses` and active
  `rubric_items` every time an answer is saved or a report is submitted —
  matches the "Yes = 1, No = 0, no weighting" rule from the schema/RLS
  package.
- **Parallel approval gate**: enforced in `lib/data/approvals.ts`
  (`approveDistrict`/`approveRegional`), not just in the UI — a submission
  only flips to `pending_executive` once both `district_review_status` and
  `regional_review_status` are `approved`. `approveExecutive` re-checks
  `workflow_status === 'pending_executive'` server-side before allowing
  final approval.
- **Resubmission**: a `returned` submission is edited in place (same row)
  and re-submitting resets all three review statuses to `pending` — there's
  no separate submission history/versioning table.
- **Reviewer assignment UI**: `/admin/reviewers` assigns from *existing*
  named profiles (created in Supabase Auth first); it does not create Auth
  users. Bulk CSV upload for the reviewer directory / assignments templates
  is documented but not wired up in-app yet (see that page).
- **Chapter CSV import**: `/admin/chapters` has a working file input but
  the parse-and-upsert action is a stub (`app/admin/chapters/actions.ts`) —
  the initial 879-chapter load goes through `scripts/import-seed.ts`
  instead. Wire the stub up if in-app reimport/refresh is needed later.
- **Admin role provisioning**: the first `admin` profile has to be created
  by hand (set `role_code = 'admin'` on a `profiles` row after that user
  signs up) — there's no self-serve admin signup.
- Route access is enforced with server-side role checks
  (`lib/auth/roles.ts`) in every route group's `layout.tsx`, on top of the
  RLS policies in `0002_rls_policies.sql` — the UI check is a redirect for
  UX, RLS is what actually protects the data if it's ever bypassed.

## What to do next

1. Wire up real auth user creation (chapter shared accounts + reviewer
   accounts) — likely an admin flow that calls
   `supabase.auth.admin.createUser` with a service-role key from a secure
   server context.
2. Fill in `reporting_windows_template.csv` with real Fall/Spring open and
   close dates and load it, so the app stops relying on the calendar
   fallback in `lib/reportingPeriod.ts`.
3. Fill in and load the reviewer directory + assignments templates (or use
   `/admin/reviewers` one at a time).
4. Build out the chapter CSV import action
   (`app/admin/chapters/actions.ts`) if ongoing in-app chapter master
   updates are needed, beyond the one-time `db:seed` load.
5. Add a rubric editing UI in `/admin/rubrics` if rubric content needs to
   change without going through SQL.
6. Regenerate `types/database.ts` from the live schema
   (`npx supabase gen types typescript --project-id <id>`) once the project
   exists, to catch drift from these hand-written types.
7. Add automated tests around the approval workflow
   (`lib/data/approvals.ts`) — it's the part of the app where a bug would
   be hardest to notice (a submission skipping the parallel-approval gate).
8. Visual pass on the UI — current screens are implementation-ready but
   intentionally not pixel-polished.
