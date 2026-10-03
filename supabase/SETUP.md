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

> **In practice you do not create these by hand.** Use the in-app
> **Administration → Access & Logins** console (`/admin/access`). It creates the
> reviewer accounts, emails the invites, and generates + downloads the chapter
> credential sheet for you. The manual steps above are only the fallback.

---

## Admin Access console (`/admin/access`)

Once you are signed in as an **admin**, open **Administration → Access & Logins**.
Three things live there:

| Screen | Path | What it does |
|--------|------|--------------|
| Overview | `/admin/access` | KPIs (roster size, chapter logins issued, reviewer counts) + cards |
| Chapter logins | `/admin/access/chapters` | Bulk-provision chapter logins, per-row single create, CSV download |
| Reviewers | `/admin/access/reviewers` | Invite District Directors / RVPs, activate / deactivate |

### Chapter logins — naming + generated passwords

Every chapter gets **one shared login** following your convention:

```
<chapter_key>@apa1906.net
```

`chapter_key` is the numeric chapter number exactly as it appears in
`supabase/seed/chapters.csv` (e.g. chapter 23 → **`23@apa1906.net`**). The
`@apa1906.net` mailbox does **not** need to exist and does **not** receive mail —
it is only a login identifier.

Passwords are **auto-generated per chapter** (14 chars, crypto-random, with
look-alike characters `0/O/1/l/I` removed). They are shown **once** on the result
screen and included in a **downloadable credentials sheet** (`.csv`):

```
chapter_key,email,password,status
1,1@apa1906.net,<generated>,created
23,23@apa1906.net,<generated>,created
```

> **Store that file securely — the passwords cannot be read back later.** If a
> chapter loses its password, open **Chapter logins**, find its row (it will show
> `issued`), and click **Reset password** — this issues a fresh one-time password
> and shows the same download sheet. The old password stops working immediately.

**To issue logins:**

1. Go to **Access & Logins → Chapter logins**.
2. Optionally narrow by **region** and/or **district**.
3. Set **how many** chapters to provision (1–300) and submit.
4. Download the **credentials sheet** and distribute each row to its chapter.

Each create (bulk batch *or* a single roster-row **Create login**) lands on a
result screen with the one-time password and that download link — if you created
a single login earlier and saw only "created" with no password, use **Reset
password** on that row to issue a fresh one.

The **"Download username template"** button gives you a pre-filled
`chapter_key,email` sheet for the currently selected scope, with no passwords.

### Reviewers — email invites (requires SMTP, below)

Reviewers are **named individuals** and set **their own password**: the console
sends them a Supabase **invitation email**. Pick a district (District Director)
or a region (RVP) on the Reviewers screen and invite.

Inviting a reviewer automatically:

- creates the auth user via `admin.auth.admin.inviteUserByEmail`,
- sets their `role_code` and scope (`district` / `region`) in user metadata,
- **fans out `reviewer_assignments`** to every chapter in that district
  (DD) or region (RVP), so their queue is pre-scoped.

The invitee lands on **`/auth/accept`**, sets a password, and is redirected to
the login page. **This flow only works after the SMTP + redirect-URL setup
below — do that first or the emails will not send.**

---

## SMTP for reviewer invitations (required)

Chapter logins need **no email**. Reviewer invites are emailed, so Supabase's
built-in mailer must be swapped for your SMTP provider before inviting anyone.

### 1. Point Supabase at your SMTP server

Supabase dashboard → **Authentication → SMTP Settings** (older projects:
**Project Settings → Auth → SMTP Settings**) → enable **Custom SMTP** and fill in
the values from your mail provider:

| Field | Value | Example (Google Workspace) |
|-------|-------|----------------------------|
| Host | SMTP host | `smtp.gmail.com` |
| Port | `465` (SSL) or `587` (STARTTLS) | `587` |
| Username | your sending mailbox | `noreply@yourdomain.org` |
| Password | app password / API key | *(provider-generated)* |
| Sender email | From address | `noreply@yourdomain.org` |
| Sender name | Display name | `Chapman Reporting Portal` |

Common providers: **Google Workspace / Gmail** (create an **App Password** —
plain account passwords are rejected), **Microsoft 365**, **SendGrid**
(`smtp.sendgrid.net`, user literally `apikey`), **Postmark**
(`smtp.postmarkapp.com`), **Mailgun** (`smtp.mailgun.org`), **Amazon SES**.

> The **Sender email** must be an address your provider is allowed to send as,
> or mail will be rejected/spam-filtered (for Gmail/Workspace, verify it as an
> alias or a "Send mail as" identity).

### 2. Allow the invitation redirect URL

Invite links must be allowed to bounce back to this app. Supabase dashboard →
**Authentication → URL Configuration**:

- **Site URL**: `https://chapman-portal.pages.dev`
- **Redirect URLs** — add **all** of these (add your `*.pages.dev` preview and any
  custom domain you later attach):

  ```
  https://chapman-portal.pages.dev/auth/accept
  https://chapman-portal.pages.dev/**
  http://localhost:3000/auth/accept
  ```

If `/auth/accept` is missing, Supabase silently falls back to the Site URL and
the invitee never reaches the set-password form.

### 3. Email templates (optional)

**Authentication → Email Templates → Invite user**: the default works. If you
edit it, keep the `{{ .ConfirmationURL }}` placeholder — that is the link the
invitee clicks.

### 4. Verify end to end

1. Open **Access & Logins → Reviewers**, enter a real address you can check,
   pick a scope, and **Send invite**.
2. Confirm the email arrives. It should link to
   `https://chapman-portal.pages.dev/auth/accept#access_token=…`.
3. Open it, set a password (≥8 chars), and confirm you land on `/login`.
4. Sign in with the new reviewer account and confirm their queue shows the
   chapters for that district/region.

> **Rate limits.** Supabase's built-in mailer caps out at a handful of emails per
> hour and is **not** for production; your custom SMTP above removes that cap
> (your provider's own limits then apply).

---

## Reporting window

The bootstrap already opens an active **Fall 2026** window. Manage windows in the
app at **/admin/windows** (or insert into `reporting_windows` directly).

---

## Adding AlphaMX SSO later

AlphaMX SSO lands as an additional Supabase auth provider (SAML/OIDC). **No app
code changes** — the login flow is isolated behind `Store.signIn`. Note: Supabase
SAML SSO requires a paid plan.
