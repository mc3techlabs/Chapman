"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { upsertAssignment } from "@/lib/data/reviewerAssignments";

export async function assignReviewers(formData: FormData) {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const chapterId = String(formData.get("chapter_id") ?? "");
  const districtDirectorId = String(formData.get("district_director_id") ?? "");
  const rvpId = String(formData.get("rvp_id") ?? "");

  if (!chapterId) return;

  await upsertAssignment(supabase, {
    chapter_id: chapterId,
    district_director_profile_id: districtDirectorId || null,
    regional_vice_president_profile_id: rvpId || null,
  });

  revalidatePath("/admin/reviewers");
}
