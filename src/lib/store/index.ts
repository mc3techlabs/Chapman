import type { Context } from "hono";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Store } from "./types";
import { createDemoStore } from "./demo";
import { createSupabaseStore, type SupabaseEnv } from "./supabase";
import { isDemoMode, readDemoPersona, readTokens, writeSession } from "../session";

export interface AppEnv {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DOCUMENTS_BUCKET?: string;
  DEMO_MODE?: string;
}

/**
 * Chooses the data backend for a request:
 *   - Supabase when SUPABASE_URL + anon key are configured (production)
 *   - the in-memory demo store otherwise (credential-free preview)
 *
 * The rest of the app only ever sees the `Store` interface, so both paths run
 * identical UI and workflow logic.
 */
export function getStore(c: Context): Store {
  const env = (c.env ?? {}) as AppEnv;
  if (isDemoMode(env)) {
    return createDemoStore(readDemoPersona(c));
  }
  const { accessToken, refreshToken } = readTokens(c);
  // Pass the refresh token so an expired access token is renewed, and persist
  // any refreshed tokens back onto the response cookie.
  return createSupabaseStore(env as SupabaseEnv, accessToken, refreshToken, (t) =>
    writeSession(c, t)
  );
}

/**
 * Service-role client for privileged provisioning only: creating chapter /
 * reviewer logins, bulk roster import, and Storage writes. Never used to read
 * data on behalf of a user — those reads go through the RLS-scoped store.
 */
export function getAdminClient(env: AppEnv): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getAnonClient(env: AppEnv): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type { Store, SupabaseEnv };
export { createDemoStore, createSupabaseStore, isDemoMode };
