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

## 2. Defect inventory (carried forward from the security review)

Each entry: verdict as last established, severity, evidence, target phase.

| # | Defect | Verdict | Severity | Evidence | Phase |
|---|---|---|---|---|---|
| 1a | New signup / missing-profile row can self-assign `role_code` via user metadata (`INSERT` path — `prevent_profile_self_escalation` is `UPDATE`-only, never guards this) | CONFIRMED as coded | CRITICAL (contingent on public signup being enabled, or any profile going missing — both realistic) | `0004_rls_write_hardening.sql:43-46` (UPDATE-only); `bootstrap.sql:2850-2910` (`handle_new_profile`/`ensure_profile`, both plain `INSERT`) | 1 |
| 1b | Existing-account escalation via `auth.updateUser()` on an already-profiled user | Likely blocked by `prevent_profile_self_escalation` firing on the nested write, but **not independently confirmed against a live project** | N/A pending verification | traced in review; execution-context facts (GoTrue connection JWT-claims behavior) remain unverified | 1 (verify only) |
| 2 | Chapter can write arbitrary `submission_item_responses.awarded_points` / unrelated `rubric_item_id`, and arbitrary `submissions.final_score`/`max_score` while in draft/returned, via direct PostgREST | CONFIRMED | CRITICAL | `0002_rls_policies.sql:226-242` (no WITH CHECK on value); `0007_chapter_withdraw_submission.sql:50-59` (score columns unconstrained in the "recalc" trigger branch) | 1 |
| 3 | Executive approval's "both lanes approved" gate exists only in TypeScript, not DB; `is_executive()` is fully exempted from `enforce_submission_transition` | CONFIRMED | HIGH | `0002_rls_policies.sql:198-209` (`WITH CHECK (true)`); trigger bypass line in `0004`/`0007`; app-level gate in `supabase.ts:483-487` and `review.tsx:484-490` | 1 |
| 4 | Parallel DD/RVP approval is a read-then-write race; can strand a submission at `workflow_status='submitted'` with both lanes approved, invisible to the executive queue | CONFIRMED | HIGH (correctness) | `supabase.ts:469-495` (SELECT then separate UPDATE); queue filter `supabase.ts:444-448` | 2 |
| 5 | Mutation functions never check `{ error }` from their `.update()` before writing `approval_actions`/`audit_log`, so a rejected write can still log as succeeded | CONFIRMED | HIGH | `supabase.ts:416-516` (`submitReport`, `withdrawSubmission`, `approve`, `returnSubmission`, `reopenSubmission`) | 1 |
| 6 | Deactivated accounts are not denied by the app session layer or by RLS — only by Auth `ban_duration`, which doesn't revoke an already-issued JWT | CONFIRMED | HIGH (bounded by JWT TTL — unverified) | `supabase.ts:72-117` (`profileAndSession` never checks `is_active`); `0002_rls_policies.sql:12-42` (role helpers never check `is_active`); `provisioning.ts:361-370` | 1 |
| 7 | `approval_actions` INSERT policy lets anyone who can *see* a submission insert a row claiming any `reviewer_role_code`/`action` — a chapter can forge its own "approved by district_director" history | CONFIRMED | CRITICAL | `0002_rls_policies.sql:255-261` (`WITH CHECK` only checks `reviewer_profile_id = auth.uid()`, never validates role or assignment) | 1 |
| 8 | `reporting_windows.opens_on`/`closes_on` are never read by any policy, trigger, or route — deadlines are purely advisory | CONFIRMED | MEDIUM | grep across `supabase/migrations/` and `src/routes/` for `closes_on`/`opens_on`: zero matches outside the table definition | 3 |
| 9 | Two divergent deployment paths (`migrations/0001…0007` vs `bootstrap.sql` vs `fix-auth-profiles.sql`) produce different live behavior for the same repo, and there is no mechanism confirming which one is actually deployed | CONFIRMED | CRITICAL (blocks verifying every other finding) | §1 above; `README.md` §6 vs §8 | 0 |

**Note on 1a/1b**: the earlier correction downgraded the *existing-account*
escalation path from "confirmed" to "likely blocked, unverified" — the
*new-account/missing-profile* path remains fully confirmed as coded. Phase 1
must close both regardless of which is currently exploitable in practice;
treat the "likely blocked" status as **not a pass**, only as a reason it
isn't the top line item.

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
- Reconcile `bootstrap.sql` vs `migrations/0001-0007` vs
  `fix-auth-profiles.sql` into the single source of truth described in
  §4.1.
- Add a repeatable **drift check**: a script that connects to a target
  Supabase project (read-only: `pg_get_functiondef`, `pg_get_triggerdef`,
  `pg_policies`, `information_schema.role_table_grants`) and diffs it
  against what applying the canonical migrations in order *would* produce,
  surfacing any mismatch instead of assuming consistency.
- Migration runner requirements (this is "the catalog manifest" and
  "migration identity/locking/checksum" vocabulary from the review
  checklist, scoped here as explicit deliverables rather than assumed):
  advisory-lock the migration run so two concurrent applies can't race;
  record an identity/checksum per applied migration so a modified
  already-applied file is detected, not silently re-run or ignored; wrap
  each migration in a transaction; support a dry-run mode that reports
  what *would* change without applying it.
- **Exit criteria**: running the migration set twice against a fresh DB is
  idempotent and produces identical `pg_get_functiondef`/`pg_policies`
  output both times; the drift-check script run against a real (non-prod)
  Supabase project reports zero drift.

### Phase 1 — Authorization hardening (the critical findings)
Closes defects 1a, 1b (verify), 2, 3, 5, 6, 7 from §2.
- `handle_new_profile`: INSERT-only, no metadata-driven role assignment on
  an existing row, ever. `ensure_profile`: same constraint — self-heal
  fills a *missing* row but never lets user-supplied metadata choose a
  privileged role without an explicit admin-controlled path.
- `submissions`/`submission_item_responses`: server-computed score
  trigger replaces client-trusted `final_score`/`max_score`/`awarded_points`
  in every branch, including the chapter "recalc" path; add the
  `rubric_item_id`-belongs-to-`rubric_version_id` check.
- `enforce_submission_transition`: fold the two-lane executive gate into
  the trigger itself instead of exempting `is_executive()` entirely.
- Every mutation in `supabase.ts` (`submitReport`, `withdrawSubmission`,
  `approve`, `returnSubmission`, `reopenSubmission`) checks `{ error }`
  from its `.update()` before writing an audit/approval record, and
  propagates failure to the caller.
- `profileAndSession()` and the RLS role helpers (`current_role()`,
  `is_admin()`, etc.) check `profiles.is_active`; a deactivated account's
  session stops resolving even with a technically-valid JWT.
- `approval_actions` INSERT policy (or a `BEFORE INSERT` trigger) validates
  `reviewer_role_code = current_role()` and that the actor is the actual
  assigned reviewer for that submission's chapter — not merely that they
  can see the row.
- **Exit criteria**: every acceptance test listed against defects 1a, 2, 3,
  5, 6, 7 in the original review passes against a disposable test database
  (§6), independently re-run, not just reported by the implementer.

### Phase 2 — Workflow consistency
Closes defect 4.
- Replace the SELECT-then-UPDATE approve() pattern with a single atomic
  UPDATE (conditional `CASE` on the live row, not a stale snapshot read
  earlier in the request).
- One-time reconciliation query/admin action to find and repair any
  already-stranded submissions (`district_review_status='approved' AND
  regional_review_status='approved' AND workflow_status='submitted'`).
- **Exit criteria**: concurrent approve() calls from DD and RVP against the
  same submission always converge on `pending_executive`, verified with an
  actual concurrent test (not reasoned about statically).

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

- `pg_get_functiondef`/`pg_get_triggerdef` for `handle_new_profile`,
  `ensure_profile`, `prevent_profile_self_escalation`,
  `enforce_submission_transition` — settles which deployment path (§1/§4.1)
  is actually live today.
- `pg_policies` + `information_schema.role_table_grants` for the `public`
  schema — confirms live RLS matches the repo.
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
