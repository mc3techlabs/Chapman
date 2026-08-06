"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { approveExecutive, returnSubmission } from "@/lib/data/approvals";

export async function approveExecutiveSubmission(submissionId: string) {
  const profile = await requireRole(["executive_director"]);
  const supabase = await createClient();
  await approveExecutive(supabase, submissionId, profile.id);
  revalidatePath("/national/approvals");
}

export async function returnExecutiveSubmission(
  submissionId: string,
  formData: FormData
) {
  const profile = await requireRole(["executive_director"]);
  const supabase = await createClient();
  const comment = String(formData.get("comment") ?? "");
  await returnSubmission(
    supabase,
    submissionId,
    profile.id,
    "executive_director",
    comment
  );
  revalidatePath("/national/approvals");
}
