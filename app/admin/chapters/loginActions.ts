"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/roles";
import { logAudit } from "@/lib/data/audit";
import { generateChapterPassword, chapterLoginEmail } from "@/lib/auth/chapterPassword";

export interface ChapterCredential {
  chapter_key: string;
  chapter_name: string;
  email: string;
  password: string;
}

const BULK_CONCURRENCY = 10;

export interface BulkChapterLoginState {
  status: "idle" | "success" | "error";
  message: string;
  credentials: ChapterCredential[];
}

/**
 * Creates a shared login for every chapter that doesn't already have one.
 * Skips chapters with an active primary chapter_user_links row, so this is
 * safe to click again later (e.g. after new chapters are imported, or if a
 * prior run was interrupted partway through).
 */
export async function createAllChapterLogins(
  _prevState: BulkChapterLoginState,
  _formData: FormData
): Promise<BulkChapterLoginState> {
  const actor = await requireRole(["admin"]);

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "SUPABASE_SERVICE_ROLE_KEY is not configured for this deployment.",
      credentials: [],
    };
  }

  const { data: chapters, error: chaptersError } = await admin
    .from("chapters")
    .select("id, chapter_key, chapter_name")
    .order("chapter_name");
  if (chaptersError) {
    return {
      status: "error",
      message: `Failed to load chapters: ${chaptersError.message}`,
      credentials: [],
    };
  }
  if (!chapters || chapters.length === 0) {
    return { status: "error", message: "No chapters found.", credentials: [] };
  }

  const { data: existingLinks, error: linksError } = await admin
    .from("chapter_user_links")
    .select("chapter_id")
    .eq("is_active", true)
    .eq("is_primary", true);
  if (linksError) {
    return {
      status: "error",
      message: `Failed to check existing logins: ${linksError.message}`,
      credentials: [],
    };
  }
  const alreadyLinked = new Set((existingLinks ?? []).map((l) => l.chapter_id));
  const pending = chapters.filter((c) => !alreadyLinked.has(c.id));

  if (pending.length === 0) {
    return {
      status: "success",
      message: "Every chapter already has a login.",
      credentials: [],
    };
  }

  const credentials: ChapterCredential[] = [];
  const errors: string[] = [];

  for (let i = 0; i < pending.length; i += BULK_CONCURRENCY) {
    const batch = pending.slice(i, i + BULK_CONCURRENCY);
    const results = await Promise.all(batch.map((chapter) => createLogin(admin, chapter)));
    for (const result of results) {
      if (result.credential) credentials.push(result.credential);
      if (result.error) errors.push(result.error);
    }
  }

  if (credentials.length > 0) {
    await logAudit(admin, {
      actorProfileId: actor.id,
      entityType: "chapter_user_links",
      action: "chapter_logins_bulk_created",
      metadata: { count: credentials.length, errors: errors.length },
    });
  }

  revalidatePath("/admin/chapters");

  const summary = `Created ${credentials.length} login${credentials.length === 1 ? "" : "s"}.`;
  if (errors.length > 0) {
    const shown = errors.slice(0, 20);
    const more = errors.length > 20 ? `\n…and ${errors.length - 20} more.` : "";
    return {
      status: credentials.length > 0 ? "success" : "error",
      message: `${summary} ${errors.length} failed:\n${shown.join("\n")}${more}`,
      credentials,
    };
  }

  return {
    status: "success",
    message: `${summary} Copy these now — passwords aren't shown again.`,
    credentials,
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function createLogin(
  admin: AdminClient,
  chapter: { id: string; chapter_key: string; chapter_name: string }
): Promise<{ credential?: ChapterCredential; error?: string }> {
  const email = chapterLoginEmail(chapter.chapter_key);
  const password = generateChapterPassword();

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role_code: "chapter", full_name: chapter.chapter_name },
  });
  if (userError || !userData.user) {
    return { error: `${chapter.chapter_key}: ${userError?.message ?? "create user failed"}` };
  }

  const { error: linkError } = await admin.from("chapter_user_links").insert({
    chapter_id: chapter.id,
    profile_id: userData.user.id,
    is_primary: true,
    is_active: true,
  });
  if (linkError) {
    return { error: `${chapter.chapter_key}: ${linkError.message}` };
  }

  return {
    credential: {
      chapter_key: chapter.chapter_key,
      chapter_name: chapter.chapter_name,
      email,
      password,
    },
  };
}

export interface ResetChapterLoginState {
  status: "idle" | "success" | "error";
  message: string;
  credential: ChapterCredential | null;
}

/**
 * Resets one chapter's login password, creating the login first if it
 * doesn't have one yet. This is the "update when needed" path — e.g. a
 * chapter forgot/leaked its shared password and needs a new one issued.
 */
export async function resetChapterLogin(
  _prevState: ResetChapterLoginState,
  formData: FormData
): Promise<ResetChapterLoginState> {
  const actor = await requireRole(["admin"]);
  const chapterId = String(formData.get("chapter_id") ?? "");
  if (!chapterId) {
    return { status: "error", message: "Missing chapter.", credential: null };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "SUPABASE_SERVICE_ROLE_KEY is not configured for this deployment.",
      credential: null,
    };
  }

  const { data: chapter, error: chapterError } = await admin
    .from("chapters")
    .select("id, chapter_key, chapter_name")
    .eq("id", chapterId)
    .maybeSingle();
  if (chapterError || !chapter) {
    return { status: "error", message: "Chapter not found.", credential: null };
  }

  const { data: existingLink } = await admin
    .from("chapter_user_links")
    .select("profile_id")
    .eq("chapter_id", chapterId)
    .eq("is_active", true)
    .eq("is_primary", true)
    .maybeSingle();

  let credential: ChapterCredential;

  if (existingLink) {
    const password = generateChapterPassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(
      existingLink.profile_id,
      { password }
    );
    if (updateError) {
      return {
        status: "error",
        message: `Failed to reset password: ${updateError.message}`,
        credential: null,
      };
    }
    credential = {
      chapter_key: chapter.chapter_key,
      chapter_name: chapter.chapter_name,
      email: chapterLoginEmail(chapter.chapter_key),
      password,
    };
  } else {
    const result = await createLogin(admin, chapter);
    if (result.error || !result.credential) {
      return { status: "error", message: result.error ?? "Failed to create login.", credential: null };
    }
    credential = result.credential;
  }

  await logAudit(admin, {
    actorProfileId: actor.id,
    entityType: "chapter_user_links",
    entityId: chapterId,
    action: existingLink ? "chapter_login_password_reset" : "chapter_login_created",
    metadata: { chapter_key: chapter.chapter_key },
  });

  revalidatePath("/admin/chapters");

  return {
    status: "success",
    message: existingLink ? "Password reset." : "Login created.",
    credential,
  };
}
