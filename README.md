# Chapman Reporting Portal

A national reporting and review platform for the **Alpha Phi Alpha Fraternity, Inc.** chapter
reporting program (the "Chapman Report"). Built to serve **800+ chapters**, with separate
College and Alumni rubrics, Fall and Spring reporting, parallel District/Regional review, and
Executive Director final approval.

This is a **fresh build**, separate from the earlier prototype repo. The application is written
to be **database-agnostic**: it runs credential-free in a seeded demo mode, and attaches to your
existing Supabase project by setting environment variables — no code changes required.

- **Stack**: Hono 4 + TypeScript on Cloudflare Pages (Workers runtime) + Supabase (Postgres / Auth / RLS / Storage)
- **Scoring model**: Yes = 1, No = 0, N/A = baseline 1 — with a `mandatory_penalty` column already in
  the schema so the future "mandatory item = −1" rule ships with **no migration**.
- **Auth today**: email + password (one shared login per chapter; named reviewer accounts).
  **AlphaMX SSO** is planned as a later Supabase auth provider behind the same sign-in interface.

---

## 1. Project status

| Item | State |
|------|-------|
| Application code | ✅ Complete (demo-previewable end to end) |
| Typecheck (`tsc --noEmit`) | ✅ Clean (0 errors) |
| Production build (`vite build`) | ✅ Passing (`dist/_worker.js`, ~430 kB) |
| Schema + RLS + rollup views | ✅ Written (`supabase/migrations/`) + `supabase/bootstrap.sql` |
| Seed data | ✅ 872 chapters, 300 rubric items (156 collegiate + 144 alumni), 7 document types |
| SQL validated | ✅ `bootstrap.sql` run twice on Postgres 17 — 0 errors, idempotent |
| Deployed to Cloudflare | ✅ **Live** — https://chapman-portal.pages.dev |
| Attached to your Supabase DB | ✅ Attached — schema + seed applied, secrets set, auth verified |

---

## 2. Currently completed features

### Reporting (chapter side)
- Chapter dashboard: current reporting period, progress, open/closed window handling.
- Submission workspace with the **triple answer model**: `Yes` / `No` / `N/A`.
  - `Yes` → item's `default_point_value` (1 for standard items)
  - `No` → 0 (or `mandatory_penalty` when the item is flagged `is_required`, default 0)
  - `N/A` → baseline `default_point_value` (non-applicable items are not penalized)
- Per-section and overall scoring, auto-saved answers, and an explicit **Submit** that locks the sheet.
- Document upload area for the chapter's own reporting documents.

### Review (parallel, then executive)
- **District Director** queue and **Regional Vice President** queue operate **in parallel** —
  each records its own decision independently (`district_review_status`, `regional_review_status`).
- **Executive Director final approval is gated**: it is only unlocked when **both** the district
  and regional reviews are `approved`. The gate is enforced in the data/update logic, not only
  in the UI.
- Review detail pages with the scored rubric, reviewer comments, and approve/return decisions.

### Rollups
- District, Regional, and National rollup tables built from reporting views.
- **CSV export** at every level (`/rollups/export`).

### Admin
- Overview dashboard with national KPIs.
- Chapters: paginated roster (search + district/region filters), **spreadsheet import**,
  downloadable **import template**, and roster **export**.
- Reviewers: assign and invite reviewers (District Director / RVP / Executive Director / Admin).
- Rubrics: inspect the collegiate and alumni rubric trees.
- Reporting windows: open/close the active Fall/Spring window.
- **Document framework (the upload module you asked for):**
  - **Tax documents** (`annual_irs_990`, `chapter_audit`, `chapter_tax_return`, `foundation_990`)
  - **Special event checklists** (`special_event_checklist`, `special_event_after_action`, `grip_submission`)
  - This is the **framework** with file-type / size validation and signed-URL download; the
    per-document **format and required-field lists are intentionally left to be filled in later**.

### Platform
- Email + password login (Supabase Auth), httpOnly cookie sessions.
- Row Level Security on every table, with helper functions so chapters only ever see their own
  data, District Directors their district, RVPs their region.
- All reporting views set `security_invoker = on` so RLS re-evaluates as the querying role
  (prevents cross-district leaks).
- **Demo mode**: with no credentials configured, the app runs an in-memory store seeded from the
  real CSVs, so every screen and the full workflow can be previewed immediately.

---

## 3. Functional entry URIs

All routes are GET unless noted. `:id` = submission id.

### Auth & platform
| Path | Purpose |
|------|---------|
| `/login` | Login page (POST `/login` submits email + password) |
| `/logout` | POST — clears session |
| `/health` | JSON status: `{ ok, mode: "demo" \| "supabase" }` |
| `/demo/preview` | Demo mode only — passwordless entry as the default persona |
| `/demo/persona` | Demo mode only — POST `persona` to switch role |

### Chapter
| Path | Purpose |
|------|---------|
| `/chapter` | Chapter dashboard |
| `/chapter/submission` | Submission workspace (query: `term`, `year`) |
| `/chapter/submission/answer` | POST — record one answer (`itemId`, `answer`, `comment`) |
| `/chapter/submission/submit` | POST — submit / lock the sheet |
| `/chapter/documents` | Chapter document area |

### Review
| Path | Purpose |
|------|---------|
| `/district` | District Director dashboard |
| `/district/review` | District review queue |
| `/district/review/:id` | Review one submission |
| `/district/review/:id/decision` | POST — approve / return |
| `/region` | RVP dashboard |
| `/region/review` | Regional review queue |
| `/region/review/:id` | Review one submission |
| `/region/review/:id/decision` | POST — approve / return |
| `/national` | Executive Director dashboard |
| `/national/approvals` | Final-approval queue (only submissions with **both** reviews approved) |
| `/national/approvals/:id` | Final review |
| `/national/approvals/:id/decision` | POST — final approve / return |

### Rollups
| Path | Purpose |
|------|---------|
| `/national/rollups` | National rollup table |
| `/admin/rollups` | Admin rollup table |
| `/rollups/export` | CSV export (query: `view`, `district`, `region`, `term`, `year`) |

### Admin
| Path | Purpose |
|------|---------|
| `/admin` | Admin overview |
| `/admin/chapters` | Roster (search, pagination, district/region filters) |
| `/admin/chapters/import` | POST — spreadsheet import |
| `/admin/chapters/template` | Download import template |
| `/admin/chapters/export` | Export roster |
| `/admin/reviewers` | Reviewer list |
| `/admin/reviewers/invite` | POST — invite a reviewer |
| `/admin/rubrics` | Rubric trees |
| `/admin/windows` | Reporting windows |
| `/admin/windows/create` | POST — open a window |
| `/admin/documents` | Tax-document framework |
| `/admin/special-events` | Special-event-checklist framework |
| `/documents/upload` | POST — upload a document to Storage |
| `/documents/:id/download` | Signed-URL download |

---

## 4. Architecture

```
Browser ──▶ Cloudflare Worker (Hono, dist/_worker.js)
              │
              ├─ /static/*         static assets (CSS, crest, favicon)
              ├─ routes/*          chapter · review · rollups · admin · documents
              └─ lib/store         ONE Store interface, TWO implementations:
                                     ├─ supabase.ts  → your live DB (RLS via user token)
                                     └─ demo.ts      → in-memory, seeded (no credentials)
                                                          ▲
Supabase (Postgres + Auth + RLS + Storage) ───────────────┘
```

The entire app only ever talks to the `Store` interface, so **demo mode and the live database run
identical UI and workflow logic**. `getStore(c)` picks Supabase when `SUPABASE_URL` is set and the
in-memory store otherwise.

### Data model (high level)
- **Org**: `regions` → `districts` → `chapters` (879 seeded), `chapter_types`, `chapter_statuses`.
- **People**: `profiles` (role, district, region), `chapter_user_links` (shared chapter login),
  `reviewer_assignments`.
- **Rubric**: `rubric_versions` → `rubric_sections` → `rubric_subsections` → `rubric_items`
  (each item: `default_point_value`, `is_required`, `mandatory_penalty`).
- **Reporting**: `reporting_windows`, `submissions`, `submission_item_responses`
  (`answer_code` ∈ `yes|no|na`, `awarded_points`).
- **Workflow**: `approval_actions` (district / regional / executive decisions), `audit_log`.
- **Documents**: `document_types` (with `allowed_extensions`, `max_size_mb`), `documents`.

### Storage services
- **Supabase Postgres** for all relational data.
- **Supabase Storage** for uploads — private bucket (`chapman-documents` by default), written with
  the service-role key, served via short-lived signed URLs.

---

## 5. Local development

```bash
npm install
npm run gen:seed        # regenerate src/lib/demo/data.json from supabase/seed/*.csv
npm run build           # vite build -> dist/_worker.js
pm2 start ecosystem.config.cjs   # wrangler pages dev dist on port 3000
curl http://localhost:3000/health
```

With **no** environment variables set the app starts in **demo mode** — open `/demo/preview` to
explore every role. Demo personas (set via `/demo/persona`):

`admin`, `executive_director`, `rvp:<Region>`, `district_director:<District>`, `chapter:<id>`
(e.g. `district_director:Alabama`, `chapter:1`).

---

## 6. Attaching your Supabase project

Full walkthrough: [`supabase/SETUP.md`](supabase/SETUP.md). Short version:

1. **Schema** — `SUPABASE_DB_URL="postgresql://…" npm run db:migrate`
   (applies `0001_schema.sql`, `0002_rls_policies.sql`, `0003_reporting_views.sql`).
2. **Seed** — `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run db:seed`
   (real 879-chapter roster, 300 rubric items, lookups, document types).
3. **Storage** — create a **private** bucket `chapman-documents`.
4. **Env vars** — `.dev.vars` locally, Cloudflare Pages settings in production:

   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_ANON_KEY=<anon-key>                 # public, RLS-protected
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # SECRET — server only, never in the browser
   DOCUMENTS_BUCKET=chapman-documents
   ```

5. **Users** — create auth users; set `role_code` in user metadata; the
   `on_auth_user_created` trigger creates the matching `profiles` row.
6. **Window** — insert an active row in `reporting_windows` (`term_code`, `reporting_year`,
   `opens_on`, `closes_on`, `is_active = true`).

> **Security note:** the service-role key bypasses RLS entirely. Keep it server-side only
> (Cloudflare secret / `.dev.vars`, both gitignored). Regular user requests are served through the
> RLS-scoped store using the user's own access token.

---

## 7. Not yet implemented / next steps

- **AlphaMX SSO** — planned as a Supabase SAML/OIDC provider behind `Store.signIn`
  (no UI change). Requires a paid Supabase tier.
- **Document formats** — the tax-document and special-event-checklist modules are frameworks;
  the exact required fields / templates per document type still need to be defined.
- **Notifications** — reminder emails for open windows and review requests.
- **Audit-log UI** — the table is written to; a viewer is not built.
- **Optional `mandatory_penalty = -1` rollout** — column exists; only the admin rubric editor
  needs to expose it.

---

## 8. Deployment

- **Platform**: Cloudflare Pages (deployed to the owner's own Cloudflare account via a user API token)
- **Production URL**: **https://chapman-portal.pages.dev**
- **Project name**: `chapman-portal`
- **Status**: ✅ **Live** — attached to Supabase (`/health` → `mode: supabase`)
- **Build output**: `dist/` (`_worker.js` + `static/`)
- **Last updated**: 2026-10-03

### Going live (Supabase attached)

1. Run `supabase/bootstrap.sql` in the Supabase SQL Editor (see §6).
2. Set the four secrets on the Pages project:

   ```bash
   echo "https://kqmudztvvvnldttklstc.supabase.co" | npx wrangler pages secret put SUPABASE_URL --project-name chapman-portal
   echo "<anon-key>"      | npx wrangler pages secret put SUPABASE_ANON_KEY --project-name chapman-portal
   echo "<service-role>"  | npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name chapman-portal
   echo "chapman-documents" | npx wrangler pages secret put DOCUMENTS_BUCKET --project-name chapman-portal
   ```

3. Create the first `admin` user in Supabase Auth (§6), then log in at
   **https://chapman-portal.pages.dev/login**.

Redeploy any time with `npm run build && npx wrangler pages deploy dist --project-name chapman-portal`.
