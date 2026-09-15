import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export interface ChapterLoginStatus {
  id: string;
  chapter_key: string;
  chapter_name: string;
  login_email: string | null;
}

/** Every non-dechartered chapter with its shared-login email, if one has
 * been created — a dechartered chapter can't submit reports, so it has no
 * business getting a login here. */
export async function listChapterLoginStatus(
  supabase: Client
): Promise<ChapterLoginStatus[]> {
  const { data: chapters } = await supabase
    .from("chapters")
    .select("id, chapter_key, chapter_name")
    .eq("is_dechartered", false)
    .order("chapter_name");

  const { data: links } = await supabase
    .from("chapter_user_links")
    .select("chapter_id, profile:profiles!profile_id(email)")
    .eq("is_active", true)
    .eq("is_primary", true);

  const emailByChapter = new Map<string, string | null>();
  for (const link of (links ?? []) as unknown as {
    chapter_id: string;
    profile: { email: string | null } | null;
  }[]) {
    emailByChapter.set(link.chapter_id, link.profile?.email ?? null);
  }

  return (chapters ?? []).map((c) => ({
    ...c,
    login_email: emailByChapter.get(c.id) ?? null,
  }));
}
