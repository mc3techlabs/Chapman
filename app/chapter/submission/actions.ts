"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { upsertResponse } from "@/lib/data/submissionResponses";
import { getSubmissionById, recalcFinalScoreOnly, submitReport } from "@/lib/data/submissions";

/** Bound as (submissionId, rubricItemId, pointValue, answerYes) from AccordionRubricSection. */
export async function answerRubricItem(
  submissionId: string,
  rubricItemId: string,
  pointValue: number,
  answerYes: boolean
) {
  await requireRole(["chapter"]);
  const supabase = await createClient();

  // The UI already hides the answer control once a report isn't
  // draft/returned (app/chapter/submission/page.tsx's isEditable check),
  // but that's rendering only — this is the real guard, matching what RLS
  // now enforces (0012_rls_write_hardening.sql) so a stale page or a
  // direct call fails cleanly instead of surfacing a raw Postgres error.
  const submission = await getSubmissionById(supabase, submissionId);
  if (!submission || (submission.workflow_status !== "draft" && submission.workflow_status !== "returned")) {
    return;
  }

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
