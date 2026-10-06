/**
 * Account provisioning — the "assign logins" layer.
 *
 * Everything here runs through the **service-role** client (never the browser),
 * because creating auth users and writing scope rows is an administrative act
 * beyond any user's RLS scope. Two audiences:
 *
 *   • Chapters (~800) — one SHARED login per chapter. ~800 invite emails is
 *     impractical and Supabase's built-in mailer is rate-limited, so we generate
 *     a strong password per chapter, create the account pre-confirmed, and hand
 *     the administrator a one-time credentials sheet to distribute.
 *
 *   • Reviewers (District Directors, RVPs) — named individuals, small in number.
 *     They get a real Supabase **invite email** and choose their own password.
 *     Creating one also wires their whole review scope automatically: a DD for a
 *     district is assigned to every chapter in that district, an RVP to every
 *     chapter in their region — so nobody hand-links 800 rows.
 */
import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Chapter logins follow `chapter_key@apa1906.net` (e.g. 1@apa1906.net). */
export const CHAPTER_EMAIL_DOMAIN = "apa1906.net";

export function chapterEmail(chapterKey: string): string {
  return `${chapterKey}@${CHAPTER_EMAIL_DOMAIN}`;
}

// Unambiguous alphabet (no 0/O/1/l/I) so a password read off a sheet and typed
// by a chapter officer is far less error-prone. 14 chars ≈ 90 bits.
const PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generatePassword(len = 14): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
  return out;
}

export interface ChapterRef {
  id: string;
  chapter_key: string;
  chapter_name: string;
  district?: string | null;
  region?: string | null;
}

export interface ProvisionResult {
  chapter_key: string;
  chapter_name: string;
  email: string;
  status: "created" | "exists" | "skipped" | "error";
  /** Present only when we generated/created the credential (one-time sheet). */
  password?: string;
  message?: string;
}

/** Runs `fn` over `items` with bounded concurrency (keeps 800 rows under limits). */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Every auth user (paginated), for "does this chapter already have a login?". */
export async function listAllAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const all: User[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    all.push(...data.users);
    if (data.users.length < 1000) break;
    page++;
  }
  return all;
}

export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string
): Promise<User | null> {
  const users = await listAllAuthUsers(admin);
  const target = email.toLowerCase();
  return users.find((u) => (u.email ?? "").toLowerCase() === target) ?? null;
}

/**
 * Creates one chapter login (or reports that it already exists) and links it to
 * the chapter via chapter_user_links. The profile row is created by the
 * on_auth_user_created trigger from the user metadata.
 */
export async function provisionChapterLogin(
  admin: SupabaseClient,
  chapter: ChapterRef,
  opts: { email?: string; password?: string } = {}
): Promise<ProvisionResult> {
  const email = (opts.email || chapterEmail(chapter.chapter_key)).toLowerCase();
  const base: ProvisionResult = {
    chapter_key: chapter.chapter_key,
    chapter_name: chapter.chapter_name,
    email,
    status: "error",
  };

  const password = opts.password || generatePassword();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role_code: "chapter",
      full_name: chapter.chapter_name,
    },
  });

  if (error || !data?.user) {
    const msg = error?.message ?? "create failed";
    if (/already|exists|registered|duplicate/i.test(msg)) {
      // Already provisioned — make sure the chapter link exists, then report.
      const existing = await findAuthUserByEmail(admin, email);
      if (existing) {
        try {
          await linkChapter(admin, chapter.id, existing.id);
        } catch (linkError) {
          return { ...base, status: "error", message: (linkError as Error).message };
        }
      }
      return { ...base, status: "exists", message: "Login already exists." };
    }
    return { ...base, status: "error", message: msg };
  }

  try {
    await linkChapter(admin, chapter.id, data.user.id);
  } catch (linkError) {
    return { ...base, status: "error", message: (linkError as Error).message };
  }
  return { ...base, status: "created", password };
}

/**
 * Reissues the password for an EXISTING chapter login and re-links it.
 *
 * Provisioning generates the password once and never stores it, so if the
 * administrator loses the credentials sheet the only recovery is to set a new
 * one. This finds the account by its `<chapter_key>@apa1906.net` address, sets a
 * fresh password, re-confirms the email, and re-asserts the chapter link, so a
 * chapter login can be recovered without touching the roster.
 */
export async function resetChapterLogin(
  admin: SupabaseClient,
  chapter: ChapterRef,
  opts: { password?: string } = {}
): Promise<ProvisionResult> {
  const email = chapterEmail(chapter.chapter_key).toLowerCase();
  const base: ProvisionResult = {
    chapter_key: chapter.chapter_key,
    chapter_name: chapter.chapter_name,
    email,
    status: "error",
  };

  const existing = await findAuthUserByEmail(admin, email);
  if (!existing) {
    return { ...base, status: "skipped", message: "No login exists yet — create it first." };
  }

  const password = opts.password || generatePassword();
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (error) return { ...base, status: "error", message: error.message };

  try {
    await linkChapter(admin, chapter.id, existing.id);
  } catch (linkError) {
    return { ...base, status: "error", message: (linkError as Error).message };
  }
  return { ...base, status: "created", password, message: "Password reset." };
}

/**
 * Upserts the shared chapter<->login link (idempotent). Throws on failure
 * (e.g. the uq_chapter_user_primary constraint when a stale link is still
 * active for this chapter) so a caller's status: "created" response can't
 * claim success while the chapter is actually left unlinked.
 */
async function linkChapter(admin: SupabaseClient, chapterId: string, profileId: string) {
  const { error } = await admin
    .from("chapter_user_links")
    .upsert(
      { chapter_id: chapterId, profile_id: profileId, is_primary: true, is_active: true },
      { onConflict: "chapter_id,profile_id" }
    );
  if (error) throw new Error(`Failed to link chapter: ${error.message}`);
}

/** Bulk chapter provisioning with bounded concurrency. Skips existing logins. */
export async function provisionChapterLogins(
  admin: SupabaseClient,
  chapters: ChapterRef[],
  opts: { skipExisting?: boolean } = {}
): Promise<ProvisionResult[]> {
  const skip = opts.skipExisting ?? true;
  let existingEmails = new Set<string>();
  if (skip) {
    const users = await listAllAuthUsers(admin);
    existingEmails = new Set(users.map((u) => (u.email ?? "").toLowerCase()));
  }
  return pool(chapters, 8, async (ch) => {
    const email = chapterEmail(ch.chapter_key).toLowerCase();
    if (skip && existingEmails.has(email)) {
      // Ensure the link exists for a pre-existing account. A failure here
      // (e.g. a conflicting stale link already active for this chapter) must
      // not reject the whole batch - pool() doesn't catch per-item errors.
      const existing = await findAuthUserByEmail(admin, email);
      if (existing) {
        try {
          await linkChapter(admin, ch.id, existing.id);
        } catch (linkError) {
          return {
            chapter_key: ch.chapter_key,
            chapter_name: ch.chapter_name,
            email,
            status: "error" as const,
            message: (linkError as Error).message,
          };
        }
      }
      return {
        chapter_key: ch.chapter_key,
        chapter_name: ch.chapter_name,
        email,
        status: "exists" as const,
        message: "Login already exists.",
      };
    }
    return provisionChapterLogin(admin, ch, { email });
  });
}

export interface ReviewerInput {
  email: string;
  fullName: string;
  role: "district_director" | "rvp";
  district?: string | null;
  region?: string | null;
  origin: string;
}

/**
 * Invites a reviewer (Supabase sends the email; they set their own password) and
 * immediately wires their review scope.
 */
export async function createReviewerAccount(
  admin: SupabaseClient,
  input: ReviewerInput
): Promise<{ ok: boolean; userId?: string; email: string; message?: string }> {
  const email = input.email.toLowerCase().trim();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      role_code: input.role,
      full_name: input.fullName,
      district: input.district ?? null,
      region: input.region ?? null,
    },
    redirectTo: `${input.origin}/auth/accept`,
  });
  if (error) {
    return { ok: false, email, message: error.message };
  }
  const userId = data?.user?.id;
  if (!userId) return { ok: false, email, message: "Invite sent but no user id returned." };

  // The trigger creates the profile; give it the exact scope, then fan out the
  // assignments across every chapter the reviewer is responsible for.
  await setProfileScope(admin, userId, {
    role: input.role,
    district: input.role === "district_director" ? input.district ?? null : null,
    region: input.role === "rvp" ? input.region ?? null : null,
  });
  await syncReviewerAssignments(admin, userId, input.role, {
    district: input.district ?? null,
    region: input.region ?? null,
  });
  return { ok: true, userId, email };
}

/**
 * Invites a new admin (Supabase sends the email; they set their own
 * password), the same individually-attributed-account pattern as
 * createReviewerAccount, just with no district/region scope to assign.
 */
export async function createAdminAccount(
  admin: SupabaseClient,
  input: { email: string; fullName: string; origin: string }
): Promise<{ ok: boolean; userId?: string; email: string; message?: string }> {
  const email = input.email.toLowerCase().trim();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role_code: "admin", full_name: input.fullName },
    redirectTo: `${input.origin}/auth/accept`,
  });
  if (error) return { ok: false, email, message: error.message };
  const userId = data?.user?.id;
  if (!userId) return { ok: false, email, message: "Invite sent but no user id returned." };

  // Belt-and-suspenders, matching createReviewerAccount: the on_auth_user_created
  // trigger already sets role_code from the invite metadata, this just
  // guarantees it even if the trigger's metadata read ever changes.
  await setProfileScope(admin, userId, { role: "admin" });
  return { ok: true, userId, email };
}

/**
 * Sends an individually-attributed account (reviewer or admin) a
 * password-reset email (the same Supabase mailer that sends invites). The
 * admin triggering this never generates or sees the new password - the
 * account holder sets it themselves by following the email link, which
 * lands on the same /auth/accept page the invite flow already uses (it
 * only cares about a valid access_token in the URL, not whether it came
 * from an invite or a recovery request).
 */
export async function resetReviewerPassword(
  admin: SupabaseClient,
  email: string,
  origin: string
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await admin.auth.resetPasswordForEmail(email.toLowerCase().trim(), {
    redirectTo: `${origin}/auth/accept`,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** Sets role / scope on a profile. */
export async function setProfileScope(
  admin: SupabaseClient,
  profileId: string,
  scope: { role?: string; district?: string | null; region?: string | null }
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (scope.role !== undefined) patch.role_code = scope.role;
  if (scope.district !== undefined) patch.district = scope.district;
  if (scope.region !== undefined) patch.region = scope.region;
  await admin.from("profiles").update(patch).eq("id", profileId);
}

/** Deactivates / reactivates a login (profiles.is_active gates sign-in). */
export async function setAccountActive(admin: SupabaseClient, profileId: string, active: boolean) {
  await admin
    .from("profiles")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", profileId);
  // Also stop the underlying auth user from refreshing a session.
  await admin.auth.admin
    .updateUserById(profileId, { ban_duration: active ? "none" : "876000h" })
    .catch(() => undefined);
}

/**
 * Assigns a reviewer to every chapter in their scope. A DD is linked as the
 * district director for all chapters in their district; an RVP as the regional
 * VP for all chapters in their region. Idempotent (upsert on chapter_id).
 */
export async function syncReviewerAssignments(
  admin: SupabaseClient,
  profileId: string,
  role: "district_director" | "rvp",
  scope: { district?: string | null; region?: string | null }
): Promise<number> {
  if (role === "district_director" && !scope.district) return 0;
  if (role === "rvp" && !scope.region) return 0;

  const col = role === "district_director" ? "district" : "region";
  const val = role === "district_director" ? scope.district : scope.region;
  const { data: chapters } = await admin
    .from("chapters")
    .select("id")
    .eq(col, val as string)
    .eq("is_dechartered", false);
  const ids = (chapters ?? []).map((c: { id: string }) => c.id);
  if (!ids.length) return 0;

  const field =
    role === "district_director"
      ? "district_director_profile_id"
      : "regional_vice_president_profile_id";

  const rows = ids.map((chapter_id) => ({ chapter_id, [field]: profileId }));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await admin
      .from("reviewer_assignments")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "chapter_id" });
  }
  return ids.length;
}
