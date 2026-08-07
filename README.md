# Chapman Reporting Portal

Production scaffold for the Alpha Phi Alpha Fraternity, Inc. Chapman
Reporting Portal — Next.js (App Router) + TypeScript + Tailwind + Supabase.

Live: https://chapman-wheat.vercel.app

The prior GenSpark prototype lives at `docs/prototype-reference.html`; its
color palette, accordion rubric layout, and chapter identity display
(`Name: X (Key)` / `District/Region: A - B`) are what the real UI is built
against.

## Stack

- Next.js 15.5 (App Router), TypeScript, Tailwind CSS v4 — pinned below
  16.x; see the comment in `middleware.ts` for why
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
2. Run the migrations, in filename order. Easiest is the included runner
   against the **direct** connection string (Project Settings -> Database ->
   Connection string -> Direct connection — not the pooler, DDL needs a
   plain session):
   ```bash
   SUPABASE_DB_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" \
   npm run db:migrate
   ```
   This applies every `.sql` file in `supabase/migrations/` once. There's no
   migration-history table, so re-running the full set will fail on
   `create policy` statements that already exist — to apply just one new
   file later, pass its name: `npm run db:migrate -- 0005_some_fix.sql`.
   (Equivalent: paste each file into the Supabase SQL editor in order.
   `0004_seed_load_order_notes.sql` is comments only, not executable SQL.)
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
5. Before inviting anyone, set up Auth URLs and the invite email template
   (one-time project setup):
   - **Authentication -> URL Configuration -> Site URL**: your deployed app
     origin (e.g. `https://chapman-wheat.vercel.app`), not `localhost`.
   - **Authentication -> URL Configuration -> Redirect URLs**: add
     `<that origin>/**`.
   - **Authentication -> Email Templates -> Invite user**: replace the
     default template's link so it points at our own click-to-confirm page
     instead of Supabase's `/auth/v1/verify` endpoint directly. This
     matters — the default template auto-verifies the one-time token on a
     plain page load, so email security scanners / antivirus / link-preview
     fetchers that prefetch links in the email silently burn the token
     before the real user clicks it (shows as `otp_expired` /
     `access_denied` in the redirect). Set the template body to:
     ```html
     <h2>You have been invited</h2>
     <p>You have been invited to create a user on {{ .SiteURL }}. Follow this link to accept the invite:</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accept the invite</a></p>
     ```
     `app/auth/confirm/page.tsx` requires an actual button click before
     calling `verifyOtp`, so passive prefetches can't consume it.
6. Create Supabase Auth users for each chapter (one shared login) and for
   every named reviewer (DD, RVP, Executive Director, admin). The
   `handle_new_profile` trigger auto-creates a matching `public.profiles`
   row with `role_code` from `raw_user_meta_data.role_code` (defaults to
   `chapter` if omitted).
   For named reviewers/admins with a real inbox, use the invite script —
   it sends a Supabase invite email and the person sets their own password
   on `/auth/set-password`, so this never handles a password:
   ```bash
   SUPABASE_URL=https://<project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   npm run invite:user -- --email=someone@example.com --role=admin \
     --app-url=https://chapman-wheat.vercel.app \
     [--name="Full Name"] [--district="Texas"] [--region="Southwestern"]
   ```
   `--role` is one of `chapter, district_director, rvp, executive_director,
   admin`; `--district`/`--region` only matter for `district_director`/`rvp`
   (they scope that reviewer's queues). Add `--force` to resend (deletes
   and recreates the auth user for that email first). For chapter shared
   logins (not tied to one person's inbox), create the user via the
   Supabase dashboard (Authentication -> Users -> Add user) instead,
   setting `role_code: "chapter"` in raw user metadata.
7. Create chapter shared logins. Chapters have no email address in the
   source data (a chapter is a shared account, not a person), so this is
   different from the reviewer invite flow — it generates a synthetic
   login email + random password per chapter and links it via
   `chapter_user_links`:
   ```bash
   SUPABASE_URL=https://<project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   npm run chapters:create-logins -- --count=5
   # or specific chapters:
   npm run chapters:create-logins -- --keys=1,23,45
   ```
   Writes a CSV of `chapter_key,chapter_name,district,region,email,password`
   to `--out` (default `chapter-logins-<timestamp>.csv`, gitignored) — it
   has real passwords in plain text. Distribute it to chapters securely and
   delete it once they have their credentials; there's no other record of
   the plaintext password afterward. `--force` recreates a chapter's login
   (unlinks + creates fresh) if it already has one.
8. Set up reviewer assignments via `/admin/reviewers` in the app, or by
   loading `reviewer_assignments_template.csv` once it's filled in.
9. Open a reporting window for the current term (chapters/reviewers see
   whichever window is `is_active` and most recently created as "current" —
   see `lib/reportingPeriod.ts`):
   ```bash
   SUPABASE_URL=https://<project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
   npm run window:create -- --term=spring --year=2027 \
     --opens=2027-01-01 --closes=2027-05-01
   ```
   `--term` is `fall` or `spring`. Add `--inactive` to create one without
   making it the current window yet.

## Vercel deployment checklist

1. Push this repo to GitHub (already connected: `mc3techlabs/Chapman`).
2. Import the repo at vercel.com/new.
3. **Before** clicking Deploy, expand Environment Variables and add the two
   `NEXT_PUBLIC_*` values from `.env.example` — click into each Value field
   and confirm the real text is there (it's easy to leave the gray
   placeholder example showing and think it's filled in). The service-role
   variables are only needed for running scripts locally — do not add them
   to Vercel.
4. Deploy. Default Next.js build/output settings work as-is.
5. Currently live at https://chapman-wheat.vercel.app.

**If you hit `MIDDLEWARE_INVOCATION_FAILED` or every route 404ing despite a
"Ready" deployment**: first check env vars are actually saved (see above).
If that's not it and it persists across multiple fresh redeploys with no
code change, it may be a Vercel account/team issue rather than an app bug —
we hit exactly this after renaming a Vercel team mid-session (API tokens
and the dashboard's commit-author display both started showing "User not
found"). Creating a brand new Vercel project resolved it; if that doesn't,
it's a Vercel support matter.

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
- **Admin role provisioning**: the first `admin` profile has to be
  provisioned via `scripts/invite-user.ts` (or the Supabase dashboard) —
  there's no self-serve admin signup.
- Route access is enforced with server-side role checks
  (`lib/auth/roles.ts`) in every route group's `layout.tsx`, on top of the
  RLS policies in `0002_rls_policies.sql` — the UI check is a redirect for
  UX, RLS is what actually protects the data if it's ever bypassed.

## What to do next

1. Named reviewer/admin accounts: `scripts/invite-user.ts` (invite-email
   flow). Chapter shared logins: `scripts/create-chapter-logins.ts`
   (generated email + password, since a shared account has no real inbox).
   Both are CLI-only for now — an in-app admin UI for either would remove
   the need to run scripts by hand.
2. A reporting window is open (see `lib/reportingPeriod.ts` /
   `scripts/create-reporting-window.ts`) — add more as terms roll over.
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
