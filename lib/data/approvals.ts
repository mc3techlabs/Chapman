import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AppRoleCode } from "@/types/database";
import { logAudit } from "./audit";

type Client = SupabaseClient<Database>;

async function logApprovalAction(
  supabase: Client,
  submissionId: string,
  reviewerProfileId: string,
  reviewerRoleCode: AppRoleCode,
  action: "approved" | "returned" | "reopened",
  comment: string | null
) {
  await supabase.from("approval_actions").insert({
    submission_id: submissionId,
    reviewer_profile_id: reviewerProfileId,
    reviewer_role_code: reviewerRoleCode,
    action,
    action_comment: comment,
  });
}

/**
 * District Director and RVP review in parallel. The Executive Director's
 * queue only opens once BOTH have approved (enforced here, not just in the
 * UI) — approving one lane checks the other lane before flipping the
 * submission to pending_executive.
 */
export async function approveDistrict(
  supabase: Client,
  submissionId: string,
  reviewerProfileId: string,
  comment: string | null = null
) {
  await logApprovalAction(
    supabase,
    submissionId,
    reviewerProfileId,
    "district_director",
    "approved",
    comment
  );
  await logAudit(supabase, {
    actorProfileId: reviewerProfileId,
    entityType: "submission",
    entityId: submissionId,
    action: "submission_approved_district",
  });

  const { data: submission } = await supabase
    .from("submissions")
    .update({ district_review_status: "approved" })
    .eq("id", submissionId)
    .select()
    .single();

  return maybeAdvanceToExecutive(supabase, submissionId, submission);
}

export async function approveRegional(
  supabase: Client,
  submissionId: string,
  reviewerProfileId: string,
  comment: string | null = null
) {
  await logApprovalAction(
    supabase,
    submissionId,
    reviewerProfileId,
    "rvp",
    "approved",
    comment
  );
  await logAudit(supabase, {
    actorProfileId: reviewerProfileId,
    entityType: "submission",
    entityId: submissionId,
    action: "submission_approved_regional",
  });

  const { data: submission } = await supabase
    .from("submissions")
    .update({ regional_review_status: "approved" })
    .eq("id", submissionId)
    .select()
    .single();

  return maybeAdvanceToExecutive(supabase, submissionId, submission);
}

async function maybeAdvanceToExecutive(
  supabase: Client,
  submissionId: string,
  submission: Database["public"]["Tables"]["submissions"]["Row"] | null
) {
  if (
    submission?.district_review_status === "approved" &&
    submission?.regional_review_status === "approved"
  ) {
    return supabase
      .from("submissions")
      .update({ workflow_status: "pending_executive" })
      .eq("id", submissionId)
      .select()
      .single();
  }
  return { data: submission, error: null };
}

export async function returnSubmission(
  supabase: Client,
  submissionId: string,
  reviewerProfileId: string,
  reviewerRoleCode: Extract<
    AppRoleCode,
    "district_director" | "rvp" | "executive_director"
  >,
  comment: string
) {
  await logApprovalAction(
    supabase,
    submissionId,
    reviewerProfileId,
    reviewerRoleCode,
    "returned",
    comment
  );
  await logAudit(supabase, {
    actorProfileId: reviewerProfileId,
    entityType: "submission",
    entityId: submissionId,
    action: "submission_returned",
    metadata: { reviewer_role_code: reviewerRoleCode },
  });

  const update: Database["public"]["Tables"]["submissions"]["Update"] = {
    workflow_status: "returned",
  };
  if (reviewerRoleCode === "district_director") {
    update.district_review_status = "returned";
  } else if (reviewerRoleCode === "rvp") {
    update.regional_review_status = "returned";
  } else {
    update.executive_review_status = "returned";
  }

  return supabase
    .from("submissions")
    .update(update)
    .eq("id", submissionId)
    .select()
    .single();
}

/** Executive Director final approval — only valid once both lanes have approved. */
export async function approveExecutive(
  supabase: Client,
  submissionId: string,
  reviewerProfileId: string,
  comment: string | null = null
) {
  const { data: submission } = await supabase
    .from("submissions")
    .select("workflow_status")
    .eq("id", submissionId)
    .single();

  if (submission?.workflow_status !== "pending_executive") {
    return {
      data: null,
      error: new Error(
        "Submission is not awaiting Executive Director approval."
      ),
    };
  }

  await logApprovalAction(
    supabase,
    submissionId,
    reviewerProfileId,
    "executive_director",
    "approved",
    comment
  );
  await logAudit(supabase, {
    actorProfileId: reviewerProfileId,
    entityType: "submission",
    entityId: submissionId,
    action: "submission_finalized",
  });

  return supabase
    .from("submissions")
    .update({
      executive_review_status: "approved",
      workflow_status: "finalized",
    })
    .eq("id", submissionId)
    .select()
    .single();
}

/**
 * Reopens a finalized submission for editing. Sets workflow_status back to
 * "returned" (the existing isEditable check already treats that as
 * editable) and resets all three review statuses to "pending" up front —
 * submitReport resets them again on resubmit regardless, but doing it here
 * too means nothing in the interim (submission history views, an admin
 * looking at the row) shows a stale "approved" on a review that's about to
 * be redone.
 */
export async function reopenSubmission(
  supabase: Client,
  submissionId: string,
  actorProfileId: string,
  actorRoleCode: Extract<AppRoleCode, "executive_director" | "admin">,
  comment: string | null = null
) {
  const { data: submission } = await supabase
    .from("submissions")
    .select("workflow_status")
    .eq("id", submissionId)
    .single();

  if (submission?.workflow_status !== "finalized") {
    return {
      data: null,
      error: new Error("Only a finalized submission can be reopened."),
    };
  }

  await logApprovalAction(
    supabase,
    submissionId,
    actorProfileId,
    actorRoleCode,
    "reopened",
    comment
  );
  await logAudit(supabase, {
    actorProfileId,
    entityType: "submission",
    entityId: submissionId,
    action: "submission_reopened",
  });

  return supabase
    .from("submissions")
    .update({
      workflow_status: "returned",
      district_review_status: "pending",
      regional_review_status: "pending",
      executive_review_status: "pending",
    })
    .eq("id", submissionId)
    .select()
    .single();
}
