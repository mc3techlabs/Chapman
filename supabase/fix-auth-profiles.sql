-- fix-auth-profiles.sql
-- Run this if you can sign in with an existing Supabase user but the app
-- bounces you straight back to /login (no matching public.profiles row).
-- Safe and idempotent — paste into Supabase -> SQL Editor -> New query -> Run.

-- ===========================================================================
-- AUTH -> PROFILE BRIDGE
-- The app needs a public.profiles row for every signed-in user. Two guards:
--   1. The trigger fires on INSERT *and* UPDATE, so (re-)saving a user's
--      metadata in the dashboard repairs/updates their profile.
--   2. ensure_profile() lets a user self-heal a missing row at sign-in (the app
--      calls it automatically). Needed for accounts created before this schema.
-- Unknown role_code values degrade to 'chapter' instead of erroring on the FK.
-- ===========================================================================

create or replace function public.handle_new_profile()
returns trigger as $$
declare v_role text;
begin
  v_role := coalesce(
    (select code from public.app_roles where code = new.raw_user_meta_data ->> 'role_code'),
    'chapter'
  );
  insert into public.profiles (id, full_name, email, role_code, district, region)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    v_role,
    new.raw_user_meta_data ->> 'district',
    new.raw_user_meta_data ->> 'region'
  )
  on conflict (id) do update set
    full_name  = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    email      = coalesce(excluded.email, public.profiles.email),
    role_code  = case when new.raw_user_meta_data ->> 'role_code' is not null
                      then v_role else public.profiles.role_code end,
    district   = coalesce(excluded.district, public.profiles.district),
    region     = coalesce(excluded.region, public.profiles.region),
    updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute procedure public.handle_new_profile();

-- Self-heal: create the caller's profile if missing (no-op otherwise).
create or replace function public.ensure_profile()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_user auth.users;
  v_role text;
begin
  if v_uid is null then return; end if;
  if exists (select 1 from public.profiles where id = v_uid) then return; end if;
  select * into v_user from auth.users where id = v_uid;
  if not found then return; end if;
  v_role := coalesce(
    (select code from public.app_roles where code = v_user.raw_user_meta_data ->> 'role_code'),
    'chapter'
  );
  insert into public.profiles (id, full_name, email, role_code, district, region)
  values (
    v_uid,
    coalesce(v_user.raw_user_meta_data ->> 'full_name', ''),
    v_user.email,
    v_role,
    v_user.raw_user_meta_data ->> 'district',
    v_user.raw_user_meta_data ->> 'region'
  )
  on conflict (id) do nothing;
end $$;

grant execute on function public.ensure_profile() to authenticated;

-- Backfill profiles for existing auth users (an account created before this
-- schema was applied has no row). Idempotent.
insert into public.profiles (id, full_name, email, role_code, district, region)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  u.email,
  coalesce(
    (select code from public.app_roles ar where ar.code = u.raw_user_meta_data ->> 'role_code'),
    'chapter'
  ),
  u.raw_user_meta_data ->> 'district',
  u.raw_user_meta_data ->> 'region'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- Keep existing profiles in sync with their metadata (metadata wins; a value
-- with no metadata counterpart is preserved).
update public.profiles p
   set role_code  = coalesce(
                      (select code from public.app_roles ar where ar.code = u.raw_user_meta_data ->> 'role_code'),
                      p.role_code),
       full_name  = coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), p.full_name),
       district   = coalesce(u.raw_user_meta_data ->> 'district', p.district),
       region     = coalesce(u.raw_user_meta_data ->> 'region', p.region),
       updated_at = now()
  from auth.users u
 where u.id = p.id;


-- Result: your user should appear below with the expected role_code.
select id, email, full_name, role_code, district, region, is_active
from public.profiles order by created_at;
