import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Chapter } from "@/types/domain";

type Client = SupabaseClient<Database>;

/** The chapter linked to a chapter-user's profile via chapter_user_links. */
export async function getChapterForProfile(
  supabase: Client,
  profileId: string
): Promise<Chapter | null> {
  const { data: link, error } = await supabase
    .from("chapter_user_links")
    .select("chapter_id")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !link) return null;
  return getChapterById(supabase, link.chapter_id);
}

export async function getChapterById(
  supabase: Client,
  chapterId: string
): Promise<Chapter | null> {
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .eq("id", chapterId)
    .maybeSingle();
  return data;
}

export async function listChaptersForDistrict(
  supabase: Client,
  district: string
): Promise<Chapter[]> {
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .eq("district", district)
    .order("chapter_name");
  return data ?? [];
}

export async function listChaptersForRegion(
  supabase: Client,
  region: string
): Promise<Chapter[]> {
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .eq("region", region)
    .order("chapter_name");
  return data ?? [];
}

export async function listAllChapters(supabase: Client): Promise<Chapter[]> {
  const { data } = await supabase
    .from("chapters")
    .select("*")
    .order("region")
    .order("district")
    .order("chapter_name");
  return data ?? [];
}

export async function upsertChapter(
  supabase: Client,
  chapter: Database["public"]["Tables"]["chapters"]["Insert"]
) {
  return supabase
    .from("chapters")
    .upsert(chapter, { onConflict: "chapter_key" })
    .select()
    .single();
}
