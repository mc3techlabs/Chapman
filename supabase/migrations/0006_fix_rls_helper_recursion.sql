-- Fixes infinite RLS recursion found while testing chapter submission
-- creation (Postgres error 54001, "stack depth limit exceeded"): is_admin(),
-- is_exec(), current_role_code(), current_user_district(), and
-- current_user_region() all query public.profiles, but profiles' own RLS
-- policy (profiles_self_select) calls is_admin()/is_exec() — without
-- security definer to bypass RLS on that internal lookup, calling one of
-- these functions from another table's policy re-triggers profiles' RLS,
-- which calls them again, recursing until Postgres hits its stack limit.
-- See 0002_rls_policies.sql for the same fix applied to fresh installs.
create or replace function public.current_role_code()
returns text language sql stable security definer set search_path = public as $$
  select role_code from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_code() = 'admin', false)
$$;

create or replace function public.is_exec()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_code() = 'executive_director', false)
$$;

create or replace function public.current_user_district()
returns text language sql stable security definer set search_path = public as $$
  select district from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_region()
returns text language sql stable security definer set search_path = public as $$
  select region from public.profiles where id = auth.uid()
$$;
