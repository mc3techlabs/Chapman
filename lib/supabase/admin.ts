import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-role client for privileged operations (inviting Auth users) that
 * the regular session-bound client can't do. Server-only — SUPABASE_SERVICE_ROLE_KEY
 * has no NEXT_PUBLIC_ prefix, so Next.js never ships it to the browser, but
 * every caller must still check requireRole(["admin"]) first: this client
 * bypasses RLS entirely.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — the " +
        "service role key must be set in this deployment's environment " +
        "variables for admin actions like inviting reviewers."
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
