# Chapman Reporting Portal — Security & Architecture Plan

Status: **DRAFT — planning document, not an implementation.** Nothing in this
file has been built. No migration numbered here exists yet. Treat every
"Phase" below as a scope definition for future work, not a progress report.

Grounding: this plan is written against `main` at commit
`2e9f7b98b254be551e7bfc6b5f25bff90d6c419b` (the last commit on `main` as of
this writing), following a full read-only architecture/security review of
that commit. It assumes the UI, rubric/scoring criteria, and the core
chapter → District Director / RVP (parallel) → Executive Director workflow
are the fixed product the organization has already approved — this plan
does not propose changing any of that, only how the data layer protects it.

---

## 0. How to use this document

- Each defect below carries the file:line evidence from the review, a
  target phase, and a severity. Nothing is "fixed" until a migration/PR
  exists, is independently reviewed against this plan's verification
  standards (§6), and is verified against a real (non-production) Supabase
  project (§7) — not just passed on a local Postgres instance.
- A session picking up a phase should read this file, then read only the
  defects assigned to that phase, implement them, and hand the result to an
  independent read-only review against this same document before claiming
  the phase done. "Independent" means a different session/reviewer than
  the one that wrote the change, following the standards in §6 — the same
  discipline already used earlier in this engagement.
- Nothing in this plan authorizes touching production. Every phase ships
  as migrations + code, verified against a disposable or staging Supabase
  project, and only reaches the live project through the same push →
  review → merge → deploy path already in use.

---

## 1. Current state (as verified, not assumed)

- **Stack**: Hono 4 + TypeScript on Cloudflare Workers; Supabase
  (Postgres/Auth/RLS/Storage). One `Store` interface, two implementations
  (`src/lib/store/supabase.ts` live, `demo.ts` in-memory).
- **Scale**: ~872 chapters, one shared login per chapter
  (`<chapter_key>@apa1906.net`), named-individual logins for District
  Directors, RVPs, Executive Director, and admins.
- **Workflow**: chapter submits a scored rubric response → District
  Director and RVP review *in parallel*, independently → Executive
  Director final approval, gated on both prior approvals.
- **Trust model as designed**: RLS is the declared enforcement boundary
  ("the app never relies on its own filtering for security" —
  `supabase.ts:41-42`). In practice, enforcement today is a mix of RLS,
  `BEFORE UPDATE` triggers, and TypeScript application logic, inconsistently
  applied — this is the core problem this plan addresses.
- **Deployment**: two divergent, both-currently-shipped paths produce
  different database states from the same repo —
  `supabase/migrations/0001…0007_*.sql` (sequential, intended as the
  source of truth) vs `supabase/bootstrap.sql` (2,957 lines, generated,
  README's own documented "going live" path) vs a third standalone
  `supabase/fix-auth-profiles.sql` break-glass script. These do not agree
  on `handle_new_profile()`'s trigger shape. **This divergence is itself
  Phase 0, blocking everything else** — no defect below can be verified
  as "fixed" while it's ambiguous which code is actually live.

---

## 2. Defect inventory

Each entry: verdict as last established, severity, evidence, target phase.
This list was extended after an independently commissioned second review
(a separate model, given only the raw source — not this document or the
original findings — and asked to form its own conclusions). Items 10–14
and several of the "Evidence" refinements below came from that pass and
were then independently re-verified against the actual source lines in
this repo before being accepted here — they are not taken on the second
review's word alone.

| # | Defect | Verdict | Severity | Evidence | Phase |
|---|---|---|---|---|---|
| 1a | New signup / missing-profile row can self-assign `role_code` via user metadata (`INSERT` path — `prevent_profile_self_escalation` is `UPDATE`-only, never guards this) | CONFIRMED as coded | CRITICAL (contingent on public signup being enabled, or any profile going missing — both realistic) | `0004_rls_write_hardening.sql:43-46` (UPDATE-only); `bootstrap.sql:2850-2910` (`handle_new_profile`/`ensure_profile`, both plain `INSERT`) | 1 |
| 1b | Existing-account escalation via `auth.updateUser()` on an already-profiled user | Likely blocked by `prevent_profile_self_escalation` firing on the nested write, but **not independently confirmed against a live project** | N/A pending verification | traced in review; execution-context facts (GoTrue connection JWT-claims behavior) remain unverified | 1 (verify only) |
| 1c | **Distinct from 1a/1b, and more direct: any authenticated user with no existing profile row can `POST /rest/v1/profiles` directly with `role_code: 'admin'`.** No trigger, no metadata, no dependency on which `handle_new_profile` version is live — a plain RLS gap. The missing-profile precondition is not hypothetical here: this engagement already found and fixed exactly that condition in production for invited admins/reviewers, so treat 1c as live-exploitable, not conditional. | CONFIRMED (independently re-verified against source) | CRITICAL | `0002_rls_policies.sql:109-111` (`profiles_admin_insert`, `with check (public.is_admin() or id = auth.uid())` — no column restriction) | 1 |
| 2 | Chapter can write arbitrary `submission_item_responses.awarded_points` / unrelated `rubric_item_id`, and arbitrary `submissions.final_score`/`max_score` while in draft/returned, via direct PostgREST | CONFIRMED | CRITICAL | `0002_rls_policies.sql:226-242` (no WITH CHECK on value); `0007_chapter_withdraw_submission.sql:50-59` (score columns unconstrained in the "recalc" trigger branch) | 1 |
| 3 | Executive approval's "both lanes approved" gate exists only in TypeScript, not DB; `is_executive()` is fully exempted from `enforce_submission_transition` | CONFIRMED | HIGH | `0002_rls_policies.sql:198-209` (`WITH CHECK (true)`); trigger bypass line in `0004`/`0007`; app-level gate in `supabase.ts:483-487` and `review.tsx:484-490` | 1 |
| 4 | Parallel DD/RVP approval is a read-then-write race; can strand a submission at `workflow_status='submitted'` with both lanes approved, invisible to the executive queue. **Separately**, the transition trigger's approve-branch only checks `district_review_status='pending'`, never `workflow_status='submitted'` — a DD/RVP can approve a chapter's still-in-progress draft before it's ever submitted. | CONFIRMED (race); CONFIRMED (draft-approval gap, independently re-verified) | HIGH (correctness) | `supabase.ts:469-495` (SELECT then separate UPDATE); queue filter `supabase.ts:444-448`; `0007_chapter_withdraw_submission.sql:93-109` (district-director branch never requires prior `workflow_status='submitted'`) | 2 |
| 5 | Mutation functions never check `{ error }` **or row count** from their `.update()` before writing `approval_actions`/`audit_log`, so a rejected write — including a silent, error-free RLS-filtered update matching zero rows — can still log as succeeded. (Checking `{ error }` alone is insufficient; this was a gap in the original recommended fix, now corrected.) | CONFIRMED | HIGH | `supabase.ts:416-516` (`submitReport`, `withdrawSubmission`, `approve`, `returnSubmission`, `reopenSubmission`) | 1 |
| 6 | Deactivated accounts are not denied by the app session layer or by RLS — only by Auth `ban_duration`, which doesn't revoke an already-issued JWT. **Separately**, the function that sets `is_active`/issues the ban itself never checks the result of either call, so deactivation can silently half-apply. | CONFIRMED | HIGH (bounded by JWT TTL — unverified) | `supabase.ts:72-117` (`profileAndSession` never checks `is_active`); `0002_rls_policies.sql:12-42` (role helpers never check `is_active`); `provisioning.ts:361-370` (`setAccountActive` — both the `profiles` update and the `auth.admin.updateUserById` ban call are unchecked, the latter actively `.catch(() => undefined)`-swallowed) | 1 |
| 7 | `approval_actions` INSERT policy lets anyone who can *see* a submission insert a row claiming any `reviewer_role_code`/`action` — a chapter can forge its own "approved by district_director" history. **Separately**, `admin_readonly` is not actually read-only: the same general actor-is-self policies let it insert approval/audit rows and, through `current_chapter_ids()` having no role check, write chapter-scoped data if it ever retains an active `chapter_user_links` row. | CONFIRMED | CRITICAL | `0002_rls_policies.sql:255-261` (`WITH CHECK` only checks `reviewer_profile_id = auth.uid()`); `0002_rls_policies.sql:28-32` (`current_chapter_ids()` filters on `profile_id`/`is_active` only, never `role_code`) | 1 |
| 8 | `reporting_windows.opens_on`/`closes_on` are never read by any policy, trigger, or route — deadlines are purely advisory | CONFIRMED | MEDIUM | grep across `supabase/migrations/` and `src/routes/` for `closes_on`/`opens_on`: zero matches outside the table definition | 3 |
| 9 | Two divergent deployment paths (`migrations/0001…0007` vs `bootstrap.sql` vs `fix-auth-profiles.sql`) produce different live behavior for the same repo, and there is no mechanism confirming which one is actually deployed. **Separately**, the migration runner itself hides partial failure: it logs `FAILED` per file, keeps going, and unconditionally prints `"Migrations applied."` at the end regardless of how many files errored — an operator has no signal anything went wrong. | CONFIRMED | CRITICAL (blocks verifying every other finding) | §1 above; `README.md` §6 vs §8; `scripts/apply-migrations.ts:43-62` (per-file catch logs and continues; no exit code or accumulated failure flag; unconditional success message) | 0 |
| 10 | `submissions_chapter_insert` constrains only `chapter_id` and `workflow_status` on INSERT — a chapter can create its *first* submission record with both review statuses pre-set to `'approved'`, an arbitrary score, a mismatched `rubric_version_id`, or `submitted_by_profile_id` naming a different profile. Cannot reach `workflow_status='finalized'` directly (the policy itself restricts that enum value), but can create an internally inconsistent, misleading record no trigger ever re-validates (the transition trigger is `UPDATE`-only). | CONFIRMED (independently re-verified against source) | HIGH | `0002_rls_policies.sql:177-183` | 1 |
| 11 | `documents_insert` constrains only chapter ownership — a chapter can INSERT a document row with `status: 'accepted'`, a fabricated `reviewed_by_profile_id`/`reviewed_at`, and an arbitrary `storage_path`/`submission_id`, without ever uploading a real file. The 0004 hardening locked down `documents_update` only; `documents_insert` was never touched. | CONFIRMED (independently re-verified against source) | HIGH | `0002_rls_policies.sql:296-302`; `0004_rls_write_hardening.sql:211-215` (update-only fix) | 1 |

**Note on 1a/1b/1c**: the earlier correction downgraded the *existing-account*
escalation path (1b) from "confirmed" to "likely blocked, unverified." 1a
(missing-profile/signup, via trigger+metadata) and 1c (missing-profile, via
direct RLS insert — simpler, no trigger dependency at all) both remain
fully confirmed as coded. Phase 1 must close all three regardless of which
is currently exploitable in practice; treat 1b's "likely blocked" status as
**not a pass**, only as a reason it isn't the top line item. 1c is, on
current evidence, the single easiest path to full compromise in this
schema — it should be the first line fixed in Phase 1, not 1a.

---

## 3. Scope — what "viable tool" means

**In scope for this plan (Phases 0–3):**
- A single, unambiguous, reproducible way to build the database schema
  (one source of truth, applied the same way every time, with a way to
  prove what's actually live matches the repo).
- Every write path a user-held JWT can reach is enforced at the database
  layer (RLS + trigger), not merely by app-level convention, for every
  defect in §2.
- Deactivated/unassigned accounts lose access within a bounded, known time.
- Reporting deadlines are enforced if the organization confirms they
  should be (open question, §8).
- A test/verification discipline that can actually prove the above,
  instead of inferring it from code reading alone.

**Explicitly out of scope for this plan** (not because they don't matter,
but because they are separate decisions/workstreams):
- AlphaMX SSO integration (README §7 — already called out as future work).
- Document-type format specifications (tax/special-event checklist exact
  fields — already a known gap, unrelated to security).
- Notification/reminder emails.
- Any UI/workflow redesign. This plan takes the existing approved UI and
  rubric/criteria as fixed and only hardens what sits underneath them —
  per the standing instruction not to turn this into an architecture
  proposal for the product itself.
- Multi-tenant/white-label productization (discussed earlier in this
  engagement as a possible future direction) — would need its own scoping
  pass once Phase 0–3 are done.

---

## 4. Target architecture decisions

1. **One migration source of truth.** `supabase/migrations/0001…NNNN` is
   canonical. `supabase/bootstrap.sql` becomes a *generated artifact* of
   running those migrations in order against an empty database — not a
   hand-maintained parallel definition — or is deleted outright in favor
   of always running the numbered migrations. `supabase/fix-auth-profiles.sql`
   is deleted once its logic is folded into a proper numbered migration
   (or confirmed unnecessary once Phase 0/1 land). Whichever path is kept,
   the README is updated to describe only that one path (§6.9 below).
2. **Metadata is never authoritative for authorization.** `auth.users`
   user-editable metadata (`raw_user_meta_data`) may be read once, at
   *initial* provisioning, by a trusted, actor-checked path — never by an
   unconditional trigger on every `INSERT`/`UPDATE` of `auth.users`. Role,
   district, region, and active/inactive status live in `profiles` and are
   writable only by admin/service-role paths, full stop.
3. **Every state transition a user-role JWT can reach is enforced in the
   database**, not just in `src/lib/store/supabase.ts`. The TypeScript
   layer's checks remain (defense in depth, and better error messages for
   the UI) but are never the only check.
4. **Deactivation is enforced at the RLS/session layer, not only at the
   Auth-ban layer.** A short, known worst-case window between deactivation
   and access loss is an accepted tradeoff only if it's a deliberate,
   documented number — not an unexamined side effect of JWT TTL.
5. **Environment separation is real.** Preview/staging deployments do not
   share a Supabase project (and therefore not a service-role key) with
   production. This needs confirming against the live Cloudflare/Supabase
   configuration (§7), not just asserted here.

---

## 5. Phased engineering plan

### Phase 0 — Deployment integrity (blocks everything else)
**Goal:** there is exactly one way to build the schema, and a way to prove
what's live matches the repo.

**Status: code complete, locally verified, NOT yet verified against a real
Supabase project.** What's done, each independently re-verified against a
genuine local Postgres instance (not just asserted to work):
- `scripts/gen-bootstrap.mjs` no longer defines anything beyond a
  mechanical concatenation of `supabase/migrations/0001-0007` plus seed
  data — the `authFix` block that silently installed a different
  `on_auth_user_created` trigger than the migrations define (defect 9) is
  gone, and `supabase/bootstrap.sql` has been regenerated to match.
  `supabase/fix-auth-profiles.sql` (generated from that same `authFix`
  block) is deleted outright rather than reconciled, since its actual
  content was the unsafe trigger shape in the first place. The UI message
  that pointed users at that file now points at the admin "Needs repair"
  flow instead (`src/index.tsx`).
- `scripts/apply-migrations.ts`: advisory-locks the run (verified: a
  concurrent run while the lock is held is correctly rejected, not
  blocked/racing), tracks each applied migration's SHA-256 checksum in
  `supabase_migrations.schema_migrations` (verified: re-running is a clean
  no-op, and editing an already-applied file's content is detected and
  refused, not silently re-run), runs each real apply in its own
  transaction, supports `--dry-run` (runs the whole pending batch in one
  outer transaction via savepoints, so later files can see earlier files'
  effects, then always rolls back — verified nothing persists), and stops
  immediately on first failure with a non-zero exit and no success message
  (verified against a genuine failure, not a simulated one).
- `scripts/drift-check.ts` (new): takes `EXPECTED_DB_URL` (a database the
  migrations were just applied to) and `TARGET_DB_URL` (the project to
  audit), and diffs live `pg_get_functiondef`/`pg_get_triggerdef`/
  `pg_policies`/RLS-enabled state between them — not by parsing migration
  SQL text (fragile), but by running identical introspection queries
  against two real databases. Verified against a true negative (two
  identically-migrated local databases report zero drift across 33
  functions, 13 triggers, 47 policies, 21 tables) and a true positive
  (installing the old vulnerable `handle_new_profile`/trigger pair onto
  one side is caught precisely, with no false positives from unrelated
  extension-owned functions).
- **What's NOT done**: none of the above has been run against an actual
  Supabase project — only a local, disposable PostgreSQL 16 instance on
  this machine. Supabase's actual `auth` schema, GoTrue's real connection
  behavior, and the project's real existing state (if any) are all
  unverified. Running `npm run drift-check` against a real (non-prod)
  Supabase project, with `EXPECTED_DB_URL` pointed at a fresh project the
  migrations were just applied to, is still required before this phase
  can be called done.
- **Exit criteria** (unchanged from the original plan): running the
  migration set twice against a fresh DB is idempotent and produces
  identical `pg_get_functiondef`/`pg_policies` output both times (met,
  locally); the drift-check script run against a real (non-prod) Supabase
  project reports zero drift (not yet attempted).

### Phase 1 — Authorization hardening (the critical findings)
Closes defects 1a, 1b (verify), 1c, 2, 3, 5, 6, 7, 10, 11 from §2.

**Status: code complete (migration `0008_phase1_authorization_hardening.sql`),
locally verified, NOT yet verified against a real Supabase project.** Every
item below was independently re-verified against a genuine local Postgres
instance by actually attempting the exploit as the restricted `authenticated`
role (via `SET ROLE` + `request.jwt.claim.*` GUCs, per §6.2 — never as
`postgres`/table owner) and confirming rejection, alongside the real app
flows still succeeding:
- **1c** (the most direct path, fixed first): `profiles_admin_insert` now
  requires a self-inserted row to be exactly the non-privileged default
  (`role_code='chapter'`, `district`/`region` null, `is_active=true`) — the
  admin branch is unchanged. Verified: a no-profile account inserting
  `role_code:'admin'` is rejected; inserting the default row succeeds.
- **1a**: `handle_new_profile`/`ensure_profile` never read
  `raw_user_meta_data` for `role_code`/`district`/`region` again — every
  new profile always starts as `'chapter'`. Verified: a brand-new signup
  with `role_code:'admin'` in its signup metadata still gets `'chapter'`.
  `src/lib/provisioning.ts`'s existing invite → `setProfileScope` upgrade
  flow (which runs as the service-role client immediately after) is
  unaffected — verified directly, since the local test identities for
  every reviewer/admin role were set up through exactly that two-step
  flow and all behaved correctly afterward.
- **2**: a new `enforce_response_integrity` trigger on
  `submission_item_responses` rejects a response whose `rubric_item_id`
  doesn't belong to the submission's own `rubric_version_id`, and always
  recomputes `awarded_points` itself (mirrors `src/lib/scoring.ts`'s
  `pointsFor()` exactly). `enforce_submission_transition`'s chapter-recalc
  branch now requires `final_score`/`max_score` to equal the
  server-computed total, rejecting any other value. Verified: an unrelated
  rubric's item is rejected; a client-supplied `awarded_points` of 999999
  is silently overwritten to the correct value; a direct
  `final_score: 999999` PATCH is rejected; writing the real computed total
  succeeds.
- **10**: `enforce_submission_transition` now also fires `BEFORE INSERT`
  and requires a chapter's new submission to start in the canonical state
  (both lanes pending, zero score, `rubric_version_id` matching the
  chapter's own type) — `submissions_chapter_insert`'s RLS also now pins
  `workflow_status='draft'`. Verified: an INSERT pre-approved on both lanes
  is rejected; an INSERT against the wrong chapter-type's rubric is
  rejected.
- **4 (draft-approval-gap piece only — the race itself is Phase 2)**: both
  the approve and return branches for `district_director`/`rvp` now
  require `old.workflow_status = 'submitted'`. Verified: a DD cannot
  approve or return a submission still in draft; both succeed once the
  chapter has actually submitted.
- **3**: the executive branch is no longer exempted from the trigger —
  finalizing now requires both prior lanes already `'approved'`, checked
  against the row's actual current state. Verified: an executive cannot
  finalize before both lanes are approved; finalizing succeeds once they
  are, via the real approve → approve → finalize sequence exercised
  end-to-end.
- **7**: a new `enforce_approval_action_integrity` trigger on
  `approval_actions` requires `reviewer_role_code` to equal the actor's own
  real current role, and for `district_director`/`rvp`, that they're
  actually assigned to that submission's chapter. `current_chapter_ids()`
  now also requires `role_code = 'chapter'`, closing the `admin_readonly`
  scope-creep (a stale `chapter_user_links` row no longer grants
  chapter-scoped write access to any other role). Verified: a chapter
  cannot forge a `district_director` approval on its own submission; an
  unassigned DD cannot record a decision; the actual assigned DD can; an
  `admin_readonly` account with a lingering active chapter link cannot
  write chapter-scoped data.
- **11**: `documents_insert` now mirrors the existing `documents_update`
  hardening — a chapter-initiated insert is pinned to
  `status: 'uploaded'`, `reviewed_by_profile_id`/`reviewed_at` null.
  Verified: a chapter cannot self-accept a fabricated document with a fake
  reviewer; a real upload in the default state succeeds.
- **6**: every RLS role helper (`current_role`, `is_admin`,
  `is_admin_readonly`, `is_executive`, `current_district`,
  `current_region`, `current_chapter_ids`) now requires
  `profiles.is_active = true`; `profileAndSession()` in `supabase.ts` also
  checks it, so a deactivated account's session stops resolving even with
  a technically-valid JWT rather than failing confusingly at the first
  write. `setAccountActive()` now checks and reports both its calls'
  results instead of swallowing them. Verified: a deactivated chapter
  account cannot create a submission even with its `chapter_user_links`
  row still active.
- **5**: `submitReport`, `withdrawSubmission`, `approve`,
  `returnSubmission`, `reopenSubmission`, and `recalc()` all now go through
  a shared `updateSubmissionOrThrow()` helper that checks both `{ error }`
  and that a row actually came back from `.select()` — an RLS-filtered
  update matching zero rows (observed directly during testing: a
  wrong-district DD's attempted approval returned `UPDATE 0`, not an
  error) now throws instead of silently appearing to succeed.
- Also fixed while regenerating `bootstrap.sql` for this migration:
  `scripts/gen-bootstrap.mjs`'s schema-file list was hardcoded to the
  seven pre-Phase-1 migration filenames rather than reading the directory
  — exactly the kind of silent drift Phase 0 exists to prevent, just one
  migration away from recurring. It now reads `supabase/migrations/`
  dynamically, sorted, matching `apply-migrations.ts` exactly. Re-verified
  Phase 0's own property after this fix: `drift-check` run between a
  `db:migrate`-built database and a `bootstrap.sql`-built database (both
  now including migration 0008) reports zero drift in functions, triggers,
  policies, and RLS-enabled state.
- **What's NOT done**: as with Phase 0, none of this has been run against
  an actual Supabase project — only local, disposable PostgreSQL 16. GoTrue's
  real signup behavior, actual deployed grants, and defect 1b's
  execution-context question remain unverified against a live project.
- `profiles_admin_insert` (defect 1c): tighten the WITH CHECK so a
  self-inserted row can never set `role_code` to anything but the
  schema's non-privileged default, regardless of what the caller supplies
  — the admin branch stays, the `id = auth.uid()` branch stops being able
  to choose its own authority. **Do this first** — it's the most direct
  path to full compromise in the current schema.
- `handle_new_profile`: INSERT-only, no metadata-driven role assignment on
  an existing row, ever. `ensure_profile`: same constraint — self-heal
  fills a *missing* row but never lets user-supplied metadata choose a
  privileged role without an explicit admin-controlled path.
- `submissions`/`submission_item_responses`: server-computed score
  trigger replaces client-trusted `final_score`/`max_score`/`awarded_points`
  in every branch, including the chapter "recalc" path; add the
  `rubric_item_id`-belongs-to-`rubric_version_id` check.
- `submissions_chapter_insert` (defect 10): constrain the initial INSERT to
  a canonical starting state — both review statuses `'pending'`, score
  columns zeroed or server-computed, `rubric_version_id` matching the
  chapter's actual type, `submitted_by_profile_id`/timestamps left for the
  server to set, not the caller.
- `documents_insert` (defect 11): mirror the `documents_update` hardening
  — chapter-initiated inserts are pinned to `status: 'uploaded'`, with
  `reviewed_by_profile_id`/`reviewed_at` left null until a real,
  admin/reviewer-driven review transition sets them.
- `enforce_submission_transition`: fold the two-lane executive gate into
  the trigger itself instead of exempting `is_executive()` entirely;
  while in there, also require `old.workflow_status = 'submitted'` before
  permitting a DD/RVP lane approval (closing the draft-approval gap noted
  under defect 4).
- Every mutation in `supabase.ts` (`submitReport`, `withdrawSubmission`,
  `approve`, `returnSubmission`, `reopenSubmission`) checks `{ error }`
  **and that a row actually came back** from its `.update()` before
  writing an audit/approval record, and propagates failure to the caller.
- `profileAndSession()` and the RLS role helpers (`current_role()`,
  `is_admin()`, etc.) check `profiles.is_active`; a deactivated account's
  session stops resolving even with a technically-valid JWT.
  `setAccountActive()` checks the result of both its `profiles` update and
  its Auth ban call, and reports (not swallows) a partial failure.
- `approval_actions` INSERT policy (or a `BEFORE INSERT` trigger) validates
  `reviewer_role_code = current_role()` and that the actor is the actual
  assigned reviewer for that submission's chapter — not merely that they
  can see the row. While touching this, make `current_chapter_ids()` (or
  its callers) respect role, so `admin_readonly` can't acquire
  chapter-scoped write access by way of a stale `chapter_user_links` row.
- **Exit criteria**: every acceptance test listed against defects 1a, 1c,
  2, 3, 5, 6, 7, 10, 11 in the original review passes against a disposable
  test database (§6), independently re-run, not just reported by the
  implementer.

### Phase 2 — Workflow consistency
Closes defect 4 (the parallel-approval race specifically; the draft-approval
gap half of defect 4 was already closed in Phase 0008 — see Phase 1 above).

**Status: code complete (migration `0009_phase2_workflow_consistency.sql`),
locally verified, NOT yet verified against a real Supabase project.**
- `src/lib/store/supabase.ts`'s `approve()` and `returnSubmission()` no
  longer do a client-side read-decide-write: they call two new `security
  invoker` RPC functions, `record_review_approval()` and
  `record_review_return()`, which do the decide-and-write as a single
  atomic SQL `UPDATE ... SET workflow_status = CASE WHEN <other lane
  already approved> THEN 'pending_executive' ELSE workflow_status END`
  evaluated under Postgres's own row lock against the row's current value
  — never a value read in an earlier, separate request. Both functions run
  with the calling user's own privileges (not `security definer`), so RLS
  and the existing `enforce_submission_transition` /
  `enforce_approval_action_integrity` triggers from migration 0008 still
  apply exactly as before; the actor's role is read server-side via
  `current_role()`, never trusted from a client-supplied parameter.
  PostgREST's REST API has no way to express "set this column based on
  another column's current value" in a single `.update()` call — that's
  the actual reason this needed a stored function rather than just
  app-code discipline.
- A one-time idempotent reconciliation block in the same migration repairs
  any submission already stranded by the old race
  (`workflow_status='submitted'` with both lanes `'approved'`), presenting
  as `service_role` for that one statement so it passes
  `enforce_submission_transition` the same way a real service-role
  PostgREST request would.
- **Verified against a genuine local Postgres instance** (never as
  `postgres`/table owner — per §6.2, connected as `authenticated` via `SET
  ROLE` + real `request.jwt.claim.*` GUCs):
  - A deterministic lock-blocking test: Session A opens the RPC inside a
    transaction and holds it before committing; Session B's concurrent
    call to the other lane's RPC genuinely blocks on Session A's row lock
    (measured ~2.56s wait, not a race that silently interleaves) and only
    proceeds — correctly converging on `pending_executive` — after Session
    A commits.
  - 8 separate, genuinely concurrent DD+RVP approval trials (both RPCs
    fired at the same submission at the same time, not sequentially), each
    starting from a freshly-reset row verified clean before the run (the
    first attempt at this test gave misleading results because the
    per-run reset itself was being silently rejected by
    `enforce_submission_transition` — fixed by having the reset present as
    `service_role` and verifying post-reset state before each trial). All
    8 converged correctly on `workflow_status='pending_executive'` with
    both lanes `'approved'` and zero errors.
  - The reconciliation block, tested against a row manually stranded at
    `workflow_status='submitted'` with both lanes pre-set to `'approved'`:
    re-running the migration's `do $$ ... $$` block correctly advances it
    to `'pending_executive'`, and is a no-op when re-run again.
  - Executive-finalize and `record_review_return()` exercised directly as
    well: an executive director's approval still requires both prior lanes
    already `'approved'` (unchanged from Phase 1) and now goes through the
    same atomic RPC; a DD/RVP return still requires
    `workflow_status='submitted'` and correctly sets both
    `workflow_status` and the specific lane's status to `'returned'`.
  - `drift-check` re-run between a `db:migrate`-built database and a
    `bootstrap.sql`-built database (both now including migration 0009)
    reports zero drift across 19 functions, 15 triggers, 47 policies, and
    21 tables' RLS-enabled state — `scripts/gen-bootstrap.mjs`'s dynamic
    directory read (fixed in Phase 1) correctly picked up the new
    migration with no manual file-list edit.
- **What's NOT done**: as with Phases 0 and 1, none of this has been run
  against an actual Supabase project — only local, disposable PostgreSQL
  16. In particular, genuine network-level concurrency through PostgREST
  itself (two real simultaneous HTTP requests hitting a live Supabase
  project, rather than two psql sessions against local Postgres) is still
  unverified; the local test proves the SQL-level race is closed, not that
  nothing upstream of Postgres (connection pooling, PostgREST's own request
  handling) reintroduces a window.
- Original plan (for reference — both items above are now implemented):
  - Replace the SELECT-then-UPDATE approve() pattern with a single atomic
    UPDATE (conditional `CASE` on the live row, not a stale snapshot read
    earlier in the request).
  - One-time reconciliation query/admin action to find and repair any
    already-stranded submissions (`district_review_status='approved' AND
    regional_review_status='approved' AND workflow_status='submitted'`).
- **Exit criteria**: concurrent approve() calls from DD and RVP against the
  same submission always converge on `pending_executive`, verified with an
  actual concurrent test (met, locally — see above; not yet attempted
  against a real Supabase project).

### Phase 3 — Operational hardening
Closes defect 8 plus the Step-3 deployment unknowns this plan depends on
being resolved, not assumed:
- Reporting-deadline enforcement, *if* the organization confirms deadlines
  should be hard rather than advisory (open question, §8).
- Confirm (not assume) JWT/session TTL, public-signup setting, MFA posture
  for admin/executive roles, Storage bucket privacy, backup/PITR
  configuration, and environment separation between Preview and
  Production Supabase projects — each against the live project directly,
  per §7.
- README/SETUP.md rewritten to match whatever single deployment path
  Phase 0 settled on, verified line-by-line against the actual scripts
  (review item 9 from the earlier checklist) rather than updated from
  memory of what should be true.

---

## 6. Verification standards (apply to every phase, not just Phase 1)

These are the engineering-rigor requirements implied by the earlier review
checklist, made explicit here so a future implementation session knows the
bar before starting, not after being reviewed against it:

1. **Independent review, every phase.** The session that writes a phase's
   migrations/code does not also sign off on it. A separate read-only
   review pass — against this document plus the actual worktree/branch,
   not against a description of one — gates moving to the next phase.
2. **RLS tests run as the actual restricted Postgres roles** (`anon`,
   `authenticated` with a specific JWT claims set), never as `postgres`
   or the table owner. A test harness that runs assertions as a
   superuser and calls that "testing RLS" is invalid — it doesn't
   exercise the policy at all. Any test shim must be inspected to confirm
   it switches role/claims per test, not merely connects once as an
   elevated role.
3. **Routing tests exercise the real Hono app** (actual HTTP
   request/response through the router, real cookie-based session
   handling, real redirects) — a test that mocks the HTTP layer and only
   asserts on function calls is a unit test of a handler, not a routing
   test, and must be labeled as such, not presented as integration
   coverage.
4. **Catalog/manifest-style claims (e.g. "these migrations cover these
   controls") are independently checked against the actual SQL**, not
   generated from the implementation and accepted on the implementer's
   say-so — a manifest that only restates what the code already does
   proves nothing about whether the code does the *right* thing.
5. **Destructive scripts (test-db setup/teardown) are read in full before
   execution, every time**, and only ever run against a database whose
   disposability is independently confirmed (e.g. a freshly created local
   Postgres container, or a project explicitly provisioned and labeled as
   scratch) — never inferred from a variable name, a `.env` comment, or
   the word "test" appearing in a connection string.
6. **No phase is called "production ready" on the strength of local or
   mocked tests alone.** Final verification for each phase happens
   against a real (non-production) Supabase project, because this
   engagement has already found real divergences (Finding 9, the FK-vs-
   seed-data incident) between how things behave on paper and how
   Supabase's actual managed Auth/Postgres behaves in practice.
7. **Actual results are reported separately from an implementer's claimed
   results.** If a session says "all tests pass," the reviewing session
   re-runs them (where safe to do so, per item 5) rather than restating
   the claim.

---

## 7. Exact remaining real-Supabase verification requirements

These cannot be settled by reading code — they require read-only queries
or dashboard checks against the actual live project (carried forward from
the original review's Step 3, since nothing has resolved them since):

- ~~`pg_get_functiondef`/`pg_get_triggerdef` for `handle_new_profile`,
  `ensure_profile`, `prevent_profile_self_escalation`,
  `enforce_submission_transition` — settles which deployment path (§1/§4.1)
  is actually live today.~~ **RESOLVED 2026-11-10 — see §7.1 below.**
- ~~`pg_policies` + `information_schema.role_table_grants` for the `public`
  schema — confirms live RLS matches the repo.~~ **RESOLVED 2026-11-10 —
  see §7.1 below.**
- `select * from app_roles` — confirms no other seed rows are missing
  (one was already found missing and fixed live, outside this plan's
  scope, during this engagement).
- Auth → Settings: JWT/access-token expiry, public signup enabled/disabled,
  email-confirmation requirement, MFA enforcement.
- Storage → bucket privacy for `chapman-documents`.
- Whether Preview deployments (Cloudflare Pages auto-builds every branch
  push) point at a separate Supabase project from Production, or share
  credentials.
- Database → Backups: PITR enabled, retention window.

---

### 7.1 Real-Supabase audit findings (2026-11-10)

**Method:** this session has no outbound network path to any raw Postgres
connection (the cloud sandbox only proxies HTTPS; DNS resolution itself
fails for every external host except a special-cased git path) — a
structural sandbox limitation, not a policy choice, confirmed by testing
generic unlisted hosts, not just the Supabase one. So this was done
manually: the operator ran the five read-only introspection queries
`scripts/drift-check.ts` itself uses (`pg_get_functiondef`,
`pg_get_triggerdef`, `pg_policies`, RLS-enabled flags, `role_table_grants`)
directly in the Supabase SQL Editor against the real project, and pasted
the results back for analysis against a local database with all 9
migrations applied. Every query run was a plain `SELECT` — nothing was
written in the course of gathering these findings.

**Headline finding: the live project's schema was never built by running
`supabase/migrations/0001-0009` in sequence.** It was assembled by some
other, untracked process over time. Evidence: helper functions and a
trigger exist in production that appear nowhere in any migration file
(`current_role_code()`, `current_user_district()`, `current_user_region()`,
`is_exec()`, `prevent_profile_self_escalation()` +
`prevent_profile_self_escalation_trigger`), and on tables like
`submissions`, `submission_item_responses`, and `approval_actions`, an
*older* generation of RLS policies (e.g. `submissions_insert_chapter`,
`submissions_update_scope`, `responses_write_for_scope`,
`approvals_insert_scope`) sits alongside a *newer* generation that matches
our migration-tracked policy names. Postgres combines multiple
`PERMISSIVE` policies for the same command with logical OR, so the old,
looser policy still grants access even where the newer-named policy looks
tight — meaning simply applying migrations 0001-0009 to this project would
**not** have been sufficient on its own; it would have left every
untracked old policy/function/trigger in place, still OR'd in.

**Confirmed open on production at audit time** (before the one fix
described below):
- **Defect 1c (critical, standalone)** — `profiles_admin_insert`'s `WITH
  CHECK` was `is_admin() OR (id = auth.uid())`, no restriction on
  `role_code` at all. Any authenticated user could self-insert a profile
  with `role_code: 'admin'`.
- **Defect 10** — old `submissions_insert_chapter` policy had no
  `workflow_status` restriction; OR'd with the newer restricted policy, a
  chapter could insert a pre-finalized submission directly.
- **Defect 2** — old `responses_write_for_scope` policy had no status
  restriction, and `enforce_response_integrity` (migration 0008) does not
  exist on this project. A chapter could alter rubric responses/scores on
  a submission in any status, not just drafts.
- **Defect 7** — `approvals_insert_scope`'s check was just `is_admin() OR
  (reviewer_profile_id = auth.uid())`, no assignment/role check, and
  `enforce_approval_action_integrity` (migration 0008) does not exist on
  this project. Anyone could insert a fabricated approval record for any
  submission.
- **Defects 3 / 4 (draft-approval-gap half)** — the live
  `enforce_submission_transition_trigger` fires `BEFORE UPDATE` only (no
  `BEFORE INSERT`, confirming defect 10 again independently) and its
  function body is the pre-Phase-1 version: executives are exempted
  outright (`if ... is_executive() then return new;`), and DD/RVP approval
  never requires `old.workflow_status = 'submitted'`.
- **Defect 4 (parallel-approval race half)** — no `record_review_approval`/
  `record_review_return` RPC exists on this project; the app must still be
  doing the old client-side read-then-write.
- **Defect 6** — no role helper, old name or new, checks `profiles.is_active`
  anywhere on this project.

**Confirmed NOT a problem:** RLS is enabled (`relrowsecurity = true`) on
every one of the 22 base tables — there is no table sitting fully open
with zero row-level protection. The blanket `GRANT ALL` to
`anon`/`authenticated`/`service_role` found on every table is the normal
Supabase default (RLS, not table grants, is the intended boundary) and is
not itself a finding.

**Fix applied directly to production, 2026-11-10 (narrowly scoped, by
explicit operator instruction — "lock down `profiles_admin_insert` first,
before anything else"):** the operator ran, in the Supabase SQL Editor,
the exact `profiles_admin_insert` definition from migration 0008 (`drop
policy if exists ... ; create policy ... with check (public.is_admin() or
(id = auth.uid() and role_code = 'chapter' and district is null and region
is null and is_active = true))`). Verified applied correctly via a
follow-up `select ... from pg_policies` showing the new `with_check` text
exactly matching. **This closes both halves of defect 1c** on production:
the INSERT path by this fix, and the UPDATE path (an existing row's
`role_code`/`district`/`region`/`is_active` being changed by a non-admin)
was already blocked by the live, untracked `prevent_profile_self_escalation`
trigger. No other policy, function, or trigger was touched.

### 7.2 Table/column structure comparison, and an urgent RPC fix (2026-11-11)

**Method:** same as §7.1 — three more read-only queries
(`information_schema.columns`, `pg_constraint` via `pg_get_constraintdef`,
`pg_indexes`) run by the operator in the SQL Editor, diffed against a local
database with all 9 migrations applied.

**Result: the base table/column/constraint layer matches our migration
history almost exactly.** Every column (name, type, nullability, default),
every primary key, foreign key, unique constraint, and check constraint
for every table our migrations define is identical between production and
the local 9-migration baseline — including the `workflow_status`/review-
status `CHECK` constraints, which hold the same allowed values on both
sides. The only differences:
- One entirely extra, untracked table, `system_contacts`, with its own
  columns/constraints/indexes/RLS policy — appears in no migration file,
  consistent with the same untracked-object pattern found in §7.1. Its
  only policy grants read to any authenticated user; no write policy
  exists for it at all (service_role-only writes). Not itself a security
  concern, just another confirmed instance of out-of-band schema changes.
- Seven redundant unique indexes on production (e.g.
  `uq_chapter_user_links`, `uq_chapters_chapter_key`,
  `uq_rubric_versions_code`) that duplicate an existing constraint-backed
  unique index on the same columns. Harmless — extra write overhead only,
  no functional difference.
- Column *order* differs on two tables (`rubric_items`, 
  `submission_item_responses`) — cosmetic only, confirms again that
  production's columns were added via some ad hoc sequence of `ALTER
  TABLE` statements rather than by replaying our migrations in order, but
  doesn't affect anything the app or RLS relies on.

**This meaningfully de-risks further remediation.** Migrations `0008` and
`0009` contain zero `CREATE TABLE`/`ALTER TABLE` statements — confirmed by
re-reading both files — only `create or replace function`, `drop trigger
if exists ... ; create trigger ...`, and `drop policy if exists ... ;
create policy ...`, all idempotent. Combined with the exact table/column
match above, this means both migrations can very likely be applied to
production's current state directly, without the "relation already
exists" / column-mismatch errors a less-idempotent migration set would
risk.

**Urgent, time-sensitive finding surfaced by this session's own actions:**
merging PR #10 to `main` deployed `src/lib/store/supabase.ts` code that
calls `record_review_approval()`/`record_review_return()` — RPC functions
that, per §7.1, did not exist on this Supabase project. Since Cloudflare
Pages deploys every push to `main` as a production build, this created a
real risk that the live app's approve/return actions would start failing
outright (`function does not exist`) the moment that deploy went live,
if production Cloudflare Pages is wired to this same Supabase project
(still not confirmed either way — see §7's still-open Preview/Production
separation item).

**Fix applied directly to production, 2026-11-11 (by explicit operator
instruction, given the urgency):** the full content of migration `0009`
— both RPC functions, their grants, and the idempotent reconciliation
block — applied via the SQL Editor. Nothing old or untracked was touched;
both function names are new and unique. Verified applied correctly via a
follow-up `select proname, pg_get_function_identity_arguments(oid) ...`
confirming both functions now exist with the correct argument signatures.

**Revised remediation-sequencing read, now that the table layer is known
to be compatible:** applying migration `0008` directly to production
would close most of the remaining defects even *before* any of the
untracked old-generation duplicate policies are retired, because the
trigger-level backstops it installs apply regardless of which RLS policy
let a request through:
- **Defects 2, 7, 10** would be substantively closed — `enforce_response_
  integrity`, `enforce_approval_action_integrity`, and
  `enforce_submission_transition`'s new `BEFORE INSERT` branch all
  independently reject the bad outcome even if an old permissive RLS
  policy still lets the request reach the table.
- **Defects 3 and 4 (draft-gap)** would be closed outright — `create or
  replace function enforce_submission_transition` takes effect on the
  *existing* trigger immediately; no need to touch the trigger definition
  itself.
- **Defect 6 would only be partially closed.** `0008` adds `is_active`
  checks to `is_admin`/`is_executive`/`current_district`/`current_region`/
  `current_role`, which immediately benefits any old *or* new policy that
  calls those exact names — but the untracked twin functions
  (`is_exec()`, `current_user_district()`, `current_user_region()`) are
  untouched by `0008` and would still skip the check wherever an old
  policy calls them instead (mostly read-scoping for execs/DDs/RVPs —
  information exposure to a deactivated account, not a write/escalation
  path).
- The old untracked duplicate policies themselves would still exist after
  applying `0008` — they just stop being the operative gate for most
  write paths, because the trigger backstops catch what they'd let
  through. Fully retiring them (dropping by exact name) is still the
  correct end state, just no longer the blocking precondition for closing
  defects 2/3/4/7/10.

### 7.3 Migration 0008 applied directly to production (2026-11-11)

**Pre-flight check (read-only), run before applying anything:** since
`0008`'s rewritten `enforce_submission_transition` requires a chapter's
score-save (`recalc()`) to match a server-computed `max_score` exactly,
any *existing* in-progress submission whose stored `max_score` didn't
already match that formula would be locked out of further edits the
moment the trigger landed. A query comparing every `draft`/`returned`
submission's `max_score` against `sum(rubric_items.default_point_value)`
for its rubric version found exactly one such row: a draft submission
with `max_score = 0` against an expected `156` (created, like everything
else in this audit, under the untracked pre-existing code path, which
apparently defaults `max_score` to 0 at creation rather than the full
rubric total). Fixed first, narrowly, with the same `service_role`
`set_config` pattern `0009`'s reconciliation block uses (a plain `UPDATE`
from the SQL Editor has no JWT claims, so it doesn't match the existing
trigger's `auth.role() = 'service_role'` bypass otherwise): `update
submissions set max_score = 156 where id = '5c0fc578-...'`. Re-ran the
pre-flight query afterward — zero rows.

**Migration applied:** the full, unmodified content of
`0008_phase1_authorization_hardening.sql` — confirmed beforehand to
contain zero `CREATE TABLE`/`ALTER TABLE` statements, consistent with
§7.2's finding that the table layer was already compatible. Applied via
the SQL Editor, by explicit operator instruction.

**Verified applied correctly**, via three follow-up read-only queries:
- `pg_policies` for `documents_insert` and `submissions_chapter_insert` —
  both show the exact new `with_check` text.
- `pg_trigger` for `submissions`/`submission_item_responses`/
  `approval_actions` — `enforce_submission_transition_trigger` now fires
  `BEFORE INSERT OR UPDATE` (previously `UPDATE`-only, confirmed in
  §7.1); `enforce_response_integrity_trigger` and
  `enforce_approval_action_integrity_trigger` now exist (confirmed absent
  in §7.1). (One query attempt along the way returned zero rows due to a
  mistake in how it matched schema-qualified table names, not an
  application failure — corrected and re-run before treating the result
  as real.)

**This closes, on production: defects 1a, 2, 3, 4 (draft-approval-gap
half — the race half was already closed by applying `0009`'s RPCs, see
§7.2), 7, 10, 11, and partially 6** (the new-named role helpers
`is_admin`/`is_executive`/`current_district`/`current_region`/
`current_role` now check `is_active`; the untracked old-named twins
`is_exec()`/`current_user_district()`/`current_user_region()` still don't
— lower severity, read-scoping exposure for a deactivated exec/DD/RVP,
not a write/escalation path).

**Still open on production:** the remainder of defect 6 (the old-named
helper twins), and the old untracked duplicate RLS policies themselves —
no longer the operative gate for the write paths covered above, since
the new triggers backstop them regardless of which policy let a request
through, but not yet retired.

---

## 8. Open questions for the organization (not engineering decisions)

- Should reporting deadlines (`closes_on`) be hard-enforced, or remain
  advisory with reviewers manually handling late submissions? (Affects
  whether Phase 3's defect-8 fix is a blocking rule or stays a dashboard
  indicator.)
- Is public self-service signup required for any role, or should every
  account (chapter, reviewer, admin) only ever be created through the
  existing admin provisioning/invite flow? (Directly determines how much
  of defect 1a's blast radius is reachable at all.)
- What JWT/session TTL and MFA posture does the organization want for
  admin and executive_director accounts specifically, given they hold the
  most privileged roles in the system?

---

## 9. Definition of "viable tool"

Phases 0–2 complete, their exit criteria independently verified per §6,
and the §7 live-project facts confirmed (not assumed) — at that point the
tool's data layer enforces what its UI and workflow already promise.
Phase 3 and the §8 decisions harden operations and policy on top of that
foundation but are not, by themselves, blockers to calling the core
workflow trustworthy.
