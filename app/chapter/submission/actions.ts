"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { upsertResponse } from "@/lib/data/submissionResponses";
import { recalcSubmissionScore, submitReport } from "@/lib/data/submissions";

/** Bound as (submissionId, rubricItemId, answerYes) from AccordionRubricSection. */
export async function answerRubricItem(
  submissionId: string,
  rubricItemId: string,
  answerYes: boolean
) {
  await requireRole(["chapter"]);
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("rubric_items")
    .select("default_point_value")
    .eq("id", rubricItemId)
    .single();

  await upsertResponse(
    supabase,
    submissionId,
    rubricItemId,
    answerYes,
    item?.default_point_value ?? 1
  );
  await recalcSubmissionScore(supabase, submissionId);

  revalidatePath("/chapter/submission");
}

export async function submitCurrentSubmission(submissionId: string) {
  const profile = await requireRole(["chapter"]);
  const supabase = await createClient();

  await submitReport(supabase, submissionId, profile.id);

  revalidatePath("/chapter/submission");
  revalidatePath("/chapter");
}
