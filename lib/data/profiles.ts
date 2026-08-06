import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AppRoleCode } from "@/types/database";

type Client = SupabaseClient<Database>;

export async function listProfilesByRole(supabase: Client, role: AppRoleCode) {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("role_code", role)
    .eq("is_active", true)
    .order("full_name");
  return data ?? [];
}
