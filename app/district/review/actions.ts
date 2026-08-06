"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { approveDistrict, returnSubmission } from "@/lib/data/approvals";

export async function approveDistrictSubmission(submissionId: string) {
  const profile = await requireRole(["district_director"]);
  const supabase = await createClient();
  await approveDistrict(supabase, submissionId, profile.id);
  revalidatePath("/district/review");
}

export async function returnDistrictSubmission(
  submissionId: string,
  formData: FormData
) {
  const profile = await requireRole(["district_director"]);
  const supabase = await createClient();
  const comment = String(formData.get("comment") ?? "");
  await returnSubmission(
    supabase,
    submissionId,
    profile.id,
    "district_director",
    comment
  );
  revalidatePath("/district/review");
}
