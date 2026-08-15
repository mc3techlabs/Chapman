-- Found while testing: audit_log.actor_profile_id had no ON DELETE
-- behavior (defaults to RESTRICT), so deleting any profile that had ever
-- triggered an audited action (chapter import, reviewer invite, submission
-- action) failed with a foreign key violation — blocking legitimate account
-- cleanup, not just test data. audit_log is a general activity trail
-- (unlike approval_actions, which records who approved/returned a specific
-- submission and should stay RESTRICT — that's a real organizational
-- record, deleting that reviewer should be a deliberate, blocked-by-default
-- decision). SET NULL keeps the log entry and its action/metadata, just
-- drops the now-dangling actor reference.
alter table public.audit_log
  drop constraint if exists audit_log_actor_profile_id_fkey;

alter table public.audit_log
  add constraint audit_log_actor_profile_id_fkey
  foreign key (actor_profile_id) references public.profiles(id) on delete set null;
