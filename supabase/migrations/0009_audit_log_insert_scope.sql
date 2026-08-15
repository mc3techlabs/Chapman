-- Found in review: audit_insert_authenticated (0002_rls_policies.sql) only
-- checked auth.role() = 'authenticated', not that the row's
-- actor_profile_id actually belongs to the inserting user. Since this
-- migration set was written, lib/data/audit.ts started actually writing to
-- this table from app code — which also means any authenticated role
-- (including a chapter's shared login) could otherwise POST directly to
-- the audit_log REST endpoint with an arbitrary actor_profile_id and forge
-- entries attributed to someone else (e.g. the Executive Director). Reads
-- are already correctly restricted to admin/exec (audit_admin_only), so
-- this was an integrity gap, not a confidentiality one, but it defeats the
-- point of having an audit trail at all.
drop policy if exists audit_insert_authenticated on public.audit_log;

create policy audit_insert_own_or_admin on public.audit_log for insert with check (
  actor_profile_id = auth.uid() or public.is_admin()
);
