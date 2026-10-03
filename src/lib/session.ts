/**
 * Session + auth plumbing.
 *
 * Today: Supabase email/password. A chapter has ONE shared login (created by an
 * admin); reviewers are named individuals. Sessions are held in httpOnly
 * cookies carrying the Supabase access/refresh tokens.
 *
 * Later: AlphaMX SSO drops in as another Supabase auth provider (SAML/OIDC) —
 * it lands in the same `signIn`/callback flow, so nothing in the UI changes.
 */
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export const ACCESS_COOKIE = "cp_access";
export const REFRESH_COOKIE = "cp_refresh";
export const DEMO_COOKIE = "cp_demo";

const COOKIE_BASE = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
};

export function isDemoMode(env: { DEMO_MODE?: string; SUPABASE_URL?: string }): boolean {
  if (env.DEMO_MODE === "1" || env.DEMO_MODE === "true") return true;
  // No Supabase configured -> run the in-memory store so the UI is previewable.
  return !env.SUPABASE_URL;
}

export function readTokens(c: Context): { accessToken: string | null; refreshToken: string | null } {
  return {
    accessToken: getCookie(c, ACCESS_COOKIE) ?? null,
    refreshToken: getCookie(c, REFRESH_COOKIE) ?? null,
  };
}

export function writeSession(
  c: Context,
  tokens: { access_token: string; refresh_token: string }
): void {
  setCookie(c, ACCESS_COOKIE, tokens.access_token, { ...COOKIE_BASE, maxAge: 60 * 60 });
  setCookie(c, REFRESH_COOKIE, tokens.refresh_token, {
    ...COOKIE_BASE,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, ACCESS_COOKIE, { path: "/" });
  deleteCookie(c, REFRESH_COOKIE, { path: "/" });
}

export function readDemoPersona(c: Context): string | undefined {
  return getCookie(c, DEMO_COOKIE);
}

export function writeDemoPersona(c: Context, persona: string): void {
  setCookie(c, DEMO_COOKIE, persona, { path: "/", sameSite: "Lax", maxAge: 60 * 60 * 24 });
}

/**
 * Validates a chapter-import row and normalises it. Returns the cleaned row or
 * an error string. Kept here (not in the route) so the same rules apply whether
 * the roster arrives via the in-app upload or the seed script.
 */
export interface ChapterImportInput {
  chapter_key: string;
  chapter_name: string;
  chapter_type_code: string;
  university?: string | null;
  district: string;
  region: string;
  status_code: string;
  is_dechartered?: boolean;
}

export function normalizeChapterType(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (["collegiate", "college", "c"].includes(v)) return "collegiate";
  if (["alumni", "a"].includes(v)) return "alumni";
  if (v === "unknown") return "unknown";
  return null;
}

/** Validates an uploaded file against a document type's rules. */
export function validateUpload(
  file: { name: string; size: number; type: string },
  docType: { allowed_extensions: string[]; max_size_mb: number }
): { ok: true } | { ok: false; error: string } {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowed = (docType.allowed_extensions ?? []).map((e) => e.toLowerCase().replace(/^\./, ""));
  if (allowed.length && !allowed.includes(ext)) {
    return {
      ok: false,
      error: `File type ".${ext}" is not allowed. Accepted: ${allowed.join(", ")}.`,
    };
  }
  const maxBytes = (docType.max_size_mb ?? 25) * 1024 * 1024;
  if (file.size > maxBytes) {
    return { ok: false, error: `File exceeds the ${docType.max_size_mb} MB limit.` };
  }
  return { ok: true };
}
