"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { upsertResponse } from "@/lib/data/submissionResponses";
import { recalcFinalScoreOnly, submitReport } from "@/lib/data/submissions";

/** Bound as (submissionId, rubricItemId, pointValue, answerYes) from AccordionRubricSection. */
export async function answerRubricItem(
  submissionId: string,
  rubricItemId: string,
  pointValue: number,
  answerYes: boolean
) {
  await requireRole(["chapter"]);
  const supabase = await createClient();

  await upsertResponse(supabase, submissionId, rubricItemId, answerYes, pointValue);
  await recalcFinalScoreOnly(supabase, submissionId);

  revalidatePath("/chapter/submission");
}

export async function submitCurrentSubmission(submissionId: string) {
  const profile = await requireRole(["chapter"]);
  const supabase = await createClient();

  await submitReport(supabase, submissionId, profile.id);

  revalidatePath("/chapter/submission");
  revalidatePath("/chapter");
}
