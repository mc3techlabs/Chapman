import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { getSubmissionById } from "@/lib/data/submissions";
import { getChapterById } from "@/lib/data/chapters";
import { getRubricTree } from "@/lib/data/rubrics";
import { ChapterIdentityCard } from "@/components/ChapterIdentityCard";
import { AccordionRubricSection } from "@/components/AccordionRubricSection";
import { WorkflowStatusBadge } from "@/components/SubmissionStatusBadge";
import { ReviewActionPanel } from "@/components/ReviewActionPanel";
import { approveDistrictSubmission, returnDistrictSubmission } from "../actions";

export default async function DistrictReviewDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  await requireRole(["district_director"]);
  const { submissionId } = await params;
  const supabase = await createClient();

  const submission = await getSubmissionById(supabase, submissionId);
  if (!submission) notFound();

  const chapter = await getChapterById(supabase, submission.chapter_id);
  if (!chapter) notFound();

  const tree = await getRubricTree(
    supabase,
    submission.rubric_version_id,
    submission.id
  );

  const isPending = submission.district_review_status === "pending";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-chapman-ink">
          Review Submission
        </h1>
        <WorkflowStatusBadge status={submission.workflow_status} />
      </div>

      <ChapterIdentityCard
        identity={{
          chapterKey: chapter.chapter_key,
          chapterName: chapter.chapter_name,
          district: chapter.district,
          region: chapter.region,
        }}
      />

      {tree?.sections.map((section, index) => (
        <AccordionRubricSection
          key={section.id}
          section={section}
          defaultOpen={index === 0}
        />
      ))}

      <ReviewActionPanel
        approveAction={approveDistrictSubmission.bind(null, submission.id)}
        returnAction={returnDistrictSubmission.bind(null, submission.id)}
        disabled={!isPending}
        disabledReason={`District review already ${submission.district_review_status}.`}
      />
    </div>
  );
}
