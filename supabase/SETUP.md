# Supabase setup — attaching this app to your project

Your project: **`https://kqmudztvvvnldttklstc.supabase.co`**

The app is **database-agnostic on setup**: it attaches to whatever Supabase
project you point it at via environment variables. Nothing in the code changes
between projects.

> **Note on your project today:** it already contains an **older scaffold** of
> this schema — `chapters`, `profiles`, `submissions`, the rubric tables,
> `reporting_windows`, `approval_actions`, `audit_log`, `chapter_user_links`,
> `reviewer_assignments`, and the lookup tables — all currently **empty**. It is
> **missing** `regions`, `districts`, `document_types`, `documents`,
> `rubric_items.mandatory_penalty`, and `submission_item_responses.answer_code`.
> The bootstrap script below converges it in place; it never drops anything.

---

## Recommended: one-shot bootstrap (no database password needed)

`supabase/bootstrap.sql` is a single, **idempotent** script that:

1. Applies the full schema (`0001_schema.sql`, `0002_rls_policies.sql`,
   `0003_reporting_views.sql`) — safe to run over the existing scaffold.
2. Adds the two known gaps (`rubric_items.mandatory_penalty`,
   `submission_item_responses.answer_code`) and back-fills them.
3. Creates the unique-key guards the app upserts against.
4. Seeds the 879-row national roster, both rubrics (300 items), all lookups, the
   geography (6 regions / 38 districts), the 7 document types, and a default
   Fall-2026 reporting window.

**Run it:**

1. Open the Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase/bootstrap.sql`.
3. Click **Run**.
4. The final query prints the row counts to confirm — you should see:

   | entity | count |
   |--------|-------|
   | chapters | 872 |
   | districts | 38 |
   | document_types | 7 |
   | regions | 6 |
   | rubric_items | 300 |
   | rubric_versions | 2 |

It is safe to re-run at any time. Re-running never duplicates rows and never
overwrites rows you have since edited through the app.

> Regenerate the file after changing seed data with `npm run gen:bootstrap`.

---

## Alternative: run the migrations from the sandbox

If you would rather have the migrations applied over a DB connection:

```bash
SUPABASE_DB_URL="postgresql://postgres:[password]@db.kqmudztvvvnldttklstc.supabase.co:5432/postgres" \
  npm run db:migrate
```

…then load the seed with the **service-role key** (bypasses RLS — a setup task):

```bash
SUPABASE_URL=https://kqmudztvvvnldttklstc.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  npm run db:seed
```

The SQL-file path above is preferred: it needs neither the DB password nor the
service-role key.

---

## Storage bucket for uploads

In **Storage → New bucket**, create a **private** bucket named
`chapman-documents` (or set `DOCUMENTS_BUCKET` to whatever you name it). The app
writes with the service-role key and serves files through short-lived signed
URLs, so the bucket must stay private.

---

## Environment variables

Local dev → `.dev.vars` (gitignored). Production → Cloudflare dashboard →
**Workers & Pages → chapman-portal → Settings → Variables and Secrets**
(encrypted).

```
SUPABASE_URL=https://kqmudztvvvnldttklstc.supabase.co
SUPABASE_ANON_KEY=<anon-key>                  # public, RLS-protected
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # SECRET — server only, never in the browser
DOCUMENTS_BUCKET=chapman-documents
```

> `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. Keep it server-side only
> (Cloudflare secret / `.dev.vars`). Regular user requests are served through the
> RLS-scoped store using the user's own access token.

> **Do not set these until the bootstrap has run** — pointing the app at Supabase
> before the schema and a first user exist will fail on every page. Until then the
> app runs in demo mode.

---

## Create the first users

Auth is email + password today (AlphaMX SSO planned as a later provider). A
chapter has **one shared login**; reviewers are named individuals.

In **Authentication → Users → Add user**, create a user, then set its metadata
(**User metadata**, not app metadata):

```json
{ "role_code": "admin", "full_name": "Your Name" }
```

The `on_auth_user_created` trigger creates the matching `profiles` row
automatically. Role values: `chapter` | `district_director` | `rvp` |
`executive_director` | `admin`.

- **Reviewers**: also set `"district": "<District Name>"` and/or
  `"region": "<Region Name>"` so their queue scopes correctly.
- **Chapter shared logins**: set `role_code: "chapter"`, then link the user to a
  chapter with a row in `chapter_user_links` (`chapter_id`, `profile_id`).

---

## Reporting window

The bootstrap already opens an active **Fall 2026** window. Manage windows in the
app at **/admin/windows** (or insert into `reporting_windows` directly).

---

## Adding AlphaMX SSO later

AlphaMX SSO lands as an additional Supabase auth provider (SAML/OIDC). **No app
code changes** — the login flow is isolated behind `Store.signIn`. Note: Supabase
SAML SSO requires a paid plan.
