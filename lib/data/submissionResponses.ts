import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** Saves one Yes/No answer as a draft response and returns the row. */
export async function upsertResponse(
  supabase: Client,
  submissionId: string,
  rubricItemId: string,
  answerYes: boolean,
  pointValueIfYes: number
) {
  return supabase
    .from("submission_item_responses")
    .upsert(
      {
        submission_id: submissionId,
        rubric_item_id: rubricItemId,
        answer_yes: answerYes,
        awarded_points: answerYes ? pointValueIfYes : 0,
      },
      { onConflict: "submission_id,rubric_item_id" }
    )
    .select()
    .single();
}

export async function listResponsesForSubmission(
  supabase: Client,
  submissionId: string
) {
  const { data } = await supabase
    .from("submission_item_responses")
    .select("*")
    .eq("submission_id", submissionId);
  return data ?? [];
}
