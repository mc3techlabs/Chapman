import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ReportTermCode } from "@/types/database";
import type { Submission, SubmissionWithChapter } from "@/types/domain";
import { getActiveRubricVersion } from "./rubrics";
import { getChapterById } from "./chapters";

type Client = SupabaseClient<Database>;

/** Fetches the chapter's submission for a term/year, creating a draft if none exists. */
export async function getOrCreateDraftSubmission(
  supabase: Client,
  chapterId: string,
  termCode: ReportTermCode,
  reportingYear: number
): Promise<Submission | null> {
  const { data: existing } = await supabase
    .from("submissions")
    .select("*")
    .eq("chapter_id", chapterId)
    .eq("term_code", termCode)
    .eq("reporting_year", reportingYear)
    .maybeSingle();

  if (existing) return existing;

  const chapter = await getChapterById(supabase, chapterId);
  if (!chapter) return null;

  const rubricVersion = await getActiveRubricVersion(
    supabase,
    chapter.chapter_type_code
  );
  if (!rubricVersion) return null;

  const { data: created } = await supabase
    .from("submissions")
    .insert({
      chapter_id: chapterId,
      rubric_version_id: rubricVersion.id,
      term_code: termCode,
      reporting_year: reportingYear,
    })
    .select()
    .single();

  return created;
}

export async function getSubmissionById(supabase: Client, id: string) {
  const { data } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function listSubmissionsForChapter(
  supabase: Client,
  chapterId: string
) {
  const { data } = await supabase
    .from("submissions")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("reporting_year", { ascending: false });
  return data ?? [];
}

/** Submissions awaiting this reviewer type, scoped by district/region chapters. */
export async function listSubmissionsAwaitingReview(
  supabase: Client,
  chapterIds: string[],
  reviewColumn: "district_review_status" | "regional_review_status"
): Promise<SubmissionWithChapter[]> {
  if (chapterIds.length === 0) return [];
  const { data } = await supabase
    .from("submissions")
    .select("*, chapter:chapters(chapter_key, chapter_name, district, region)")
    .in("chapter_id", chapterIds)
    .eq(reviewColumn, "pending")
    .eq("workflow_status", "submitted")
    .order("submitted_at");
  return (data ?? []) as unknown as SubmissionWithChapter[];
}

export async function listSubmissionsAwaitingExecutiveApproval(
  supabase: Client
): Promise<SubmissionWithChapter[]> {
  const { data } = await supabase
    .from("submissions")
    .select("*, chapter:chapters(chapter_key, chapter_name, district, region)")
    .eq("workflow_status", "pending_executive")
    .eq("executive_review_status", "pending")
    .order("submitted_at");
  return (data ?? []) as unknown as SubmissionWithChapter[];
}

/** Recomputes final_score/max_score from saved responses and active rubric items. */
export async function recalcSubmissionScore(
  supabase: Client,
  submissionId: string
) {
  const submission = await getSubmissionById(supabase, submissionId);
  if (!submission) return null;

  const [{ data: responses }, { data: items }] = await Promise.all([
    supabase
      .from("submission_item_responses")
      .select("awarded_points")
      .eq("submission_id", submissionId),
    supabase
      .from("rubric_items")
      .select("default_point_value")
      .eq("rubric_version_id", submission.rubric_version_id)
      .eq("active", true),
  ]);

  const finalScore = (responses ?? []).reduce(
    (sum, r) => sum + r.awarded_points,
    0
  );
  const maxScore = (items ?? []).reduce(
    (sum, i) => sum + i.default_point_value,
    0
  );

  return supabase
    .from("submissions")
    .update({ final_score: finalScore, max_score: maxScore })
    .eq("id", submissionId)
    .select()
    .single();
}

/** Chapter action: moves a draft into the parallel DD/RVP review stage. */
export async function submitReport(
  supabase: Client,
  submissionId: string,
  submittedByProfileId: string
) {
  await recalcSubmissionScore(supabase, submissionId);

  return supabase
    .from("submissions")
    .update({
      workflow_status: "submitted",
      district_review_status: "pending",
      regional_review_status: "pending",
      executive_review_status: "pending",
      submitted_by_profile_id: submittedByProfileId,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
    .select()
    .single();
}
