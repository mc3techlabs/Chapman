import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ReviewerAssignment, AssignmentWithNames } from "@/types/domain";

type Client = SupabaseClient<Database>;

export async function getAssignmentForChapter(
  supabase: Client,
  chapterId: string
): Promise<ReviewerAssignment | null> {
  const { data } = await supabase
    .from("reviewer_assignments")
    .select("*")
    .eq("chapter_id", chapterId)
    .maybeSingle();
  return data;
}

export async function listAssignments(
  supabase: Client
): Promise<AssignmentWithNames[]> {
  const { data } = await supabase
    .from("reviewer_assignments")
    .select(
      `*,
      chapter:chapters(chapter_key, chapter_name, district, region),
      district_director:profiles!district_director_profile_id(full_name, email),
      regional_vice_president:profiles!regional_vice_president_profile_id(full_name, email)`
    )
    .order("created_at");
  return (data ?? []) as unknown as AssignmentWithNames[];
}

export async function upsertAssignment(
  supabase: Client,
  assignment: Database["public"]["Tables"]["reviewer_assignments"]["Insert"]
) {
  return supabase
    .from("reviewer_assignments")
    .upsert(assignment, { onConflict: "chapter_id" })
    .select()
    .single();
}

/** Chapters where `profileId` is the assigned District Director. */
export async function listChapterIdsForDistrictDirector(
  supabase: Client,
  profileId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("reviewer_assignments")
    .select("chapter_id")
    .eq("district_director_profile_id", profileId);
  return (data ?? []).map((row) => row.chapter_id);
}

/** Chapters where `profileId` is the assigned Regional Vice President. */
export async function listChapterIdsForRvp(
  supabase: Client,
  profileId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("reviewer_assignments")
    .select("chapter_id")
    .eq("regional_vice_president_profile_id", profileId);
  return (data ?? []).map((row) => row.chapter_id);
}
