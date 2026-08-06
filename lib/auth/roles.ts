import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRoleCode } from "@/types/database";
import type { Profile } from "@/types/domain";

/** Home route each role lands on after login / when hitting a route it can't access. */
export const ROLE_HOME: Record<AppRoleCode, string> = {
  chapter: "/chapter",
  district_director: "/district",
  rvp: "/region",
  executive_director: "/national",
  admin: "/admin",
};

/** Loads the signed-in user's profile, or redirects to /login if unauthenticated. */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    redirect("/login");
  }

  return profile;
}

/** Loads the profile and redirects to that role's home if it isn't one of `allowed`. */
export async function requireRole(
  allowed: AppRoleCode[]
): Promise<Profile> {
  const profile = await requireProfile();

  if (!allowed.includes(profile.role_code)) {
    redirect(ROLE_HOME[profile.role_code] ?? "/login");
  }

  return profile;
}
