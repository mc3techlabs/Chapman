"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { approveRegional, returnSubmission } from "@/lib/data/approvals";

export async function approveRegionalSubmission(submissionId: string) {
  const profile = await requireRole(["rvp"]);
  const supabase = await createClient();
  await approveRegional(supabase, submissionId, profile.id);
  revalidatePath("/region/review");
}

export async function returnRegionalSubmission(
  submissionId: string,
  formData: FormData
) {
  const profile = await requireRole(["rvp"]);
  const supabase = await createClient();
  const comment = String(formData.get("comment") ?? "");
  await returnSubmission(supabase, submissionId, profile.id, "rvp", comment);
  revalidatePath("/region/review");
}
