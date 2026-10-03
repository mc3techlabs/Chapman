# Supabase setup — copy to supabase/README.md or keep alongside the migrations

This app is **database-agnostic on setup**: it attaches to whatever Supabase
project you point it at via environment variables. There is nothing to change in
the code to move between projects.

## 1. Create / choose a Supabase project

You said you want to **keep your existing Supabase project** and have this app
attach to it. That's supported — point the env vars at it and run the steps
below. The migrations are written to be safe on a fresh project; on an existing
project, review them first (they create the Chapman tables alongside whatever is
already there).

## 2. Apply the schema

From **Project Settings → Database → Connection string → Direct connection**:

```bash
SUPABASE_DB_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres" \
  npm run db:migrate
```

This applies, in order:

| File | Purpose |
|------|---------|
| `0001_schema.sql` | Tables: chapters, profiles, rubric tree, submissions, responses, approvals, audit, documents |
| `0002_rls_policies.sql` | Row Level Security — the actual access boundary between districts/regions/chapters |
| `0003_reporting_views.sql` | District / regional / national rollup views |

## 3. Load the seed data

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  npm run db:seed
```

Loads the **real national roster (879 chapters)**, both rubrics
(**156 collegiate + 144 alumni criteria = 300 items**), all lookups, and the
document types (tax documents + special event checklists).

## 4. Create Storage bucket for uploads

In **Storage → New bucket**, create a **private** bucket named
`chapman-documents` (or set `DOCUMENTS_BUCKET` to whatever you name it).
The app uploads with the service-role key and serves files through short-lived
signed URLs, so the bucket must stay private.

## 5. Configure environment variables

Local dev → `.dev.vars` (gitignored). Production → Cloudflare Pages →
Settings → Environment variables (encrypted).

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>                 # public, RLS-protected
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> # SECRET — server only
DOCUMENTS_BUCKET=chapman-documents
```

## 6. Create the first users

Auth is email + password today (AlphaMX SSO planned). A chapter has **one
shared login**; reviewers are named individuals.

- **Chapter shared logins**: create users in Supabase → Authentication → Users,
  setting `role_code: "chapter"` in the user metadata, then link each to a
  chapter in `chapter_user_links` (or use the admin login-provisioning script).
- **Reviewers / admin**: create the auth user, set metadata
  `{ "role_code": "district_director" | "rvp" | "executive_director" | "admin",
     "district": "...", "region": "..." }`, and a matching `profiles` row is
  created automatically by the `on_auth_user_created` trigger.

## 7. Open a reporting window

Insert a row into `reporting_windows` (`term_code`, `reporting_year`, `opens_on`,
`closes_on`, `is_active = true`). The most recent active window is the "current"
period; without one the app falls back to a calendar default so chapters can
still report.

## Adding AlphaMX SSO later

AlphaMX SSO lands as an additional Supabase auth provider (SAML/OIDC). No app
code changes — the login flow is isolated behind `Store.signIn`. Note: Supabase
SAML SSO requires a paid plan.
