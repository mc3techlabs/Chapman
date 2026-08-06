import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { getChapterForProfile } from "@/lib/data/chapters";
import { getOrCreateDraftSubmission } from "@/lib/data/submissions";
import { getRubricTree } from "@/lib/data/rubrics";
import { getCurrentReportingPeriod } from "@/lib/reportingPeriod";
import { ChapterIdentityCard } from "@/components/ChapterIdentityCard";
import { AccordionRubricSection } from "@/components/AccordionRubricSection";
import { WorkflowStatusBadge } from "@/components/SubmissionStatusBadge";
import { answerRubricItem, submitCurrentSubmission } from "./actions";

export default async function ChapterSubmissionPage() {
  const profile = await requireRole(["chapter"]);
  const supabase = await createClient();

  const chapter = await getChapterForProfile(supabase, profile.id);
  if (!chapter) {
    return <p className="text-chapman-muted">No chapter is linked to this account yet.</p>;
  }

  const period = await getCurrentReportingPeriod(supabase);
  const submission = await getOrCreateDraftSubmission(
    supabase,
    chapter.id,
    period.termCode,
    period.reportingYear
  );

  if (!submission) {
    return (
      <p className="text-chapman-muted">
        No active rubric is configured for {chapter.chapter_type_code} chapters yet.
      </p>
    );
  }

  const tree = await getRubricTree(
    supabase,
    submission.rubric_version_id,
    submission.id
  );

  const isEditable =
    submission.workflow_status === "draft" ||
    submission.workflow_status === "returned";

  const boundAnswer = isEditable
    ? answerRubricItem.bind(null, submission.id)
    : undefined;
  const boundSubmit = submitCurrentSubmission.bind(null, submission.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-chapman-ink">
          {period.termCode === "fall" ? "Fall" : "Spring"} {period.reportingYear} Submission
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

      <div className="rounded-xl border-l-4 border-chapman-gold bg-[#fffaf0] px-4 py-3 text-sm">
        Scoring: Yes = 1, No = 0. Sections are collapsible — expand a section
        to answer its items.
      </div>

      {tree?.sections.map((section, index) => (
        <AccordionRubricSection
          key={section.id}
          section={section}
          defaultOpen={index === 0}
          editAction={boundAnswer}
        />
      ))}

      {isEditable ? (
        <form action={boundSubmit} className="flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-chapman-gold px-6 py-2.5 text-sm font-bold text-white transition hover:brightness-95"
          >
            Submit Report
          </button>
        </form>
      ) : (
        <p className="text-sm text-chapman-muted">
          This submission is {submission.workflow_status.replace("_", " ")} and can no
          longer be edited from here.
        </p>
      )}
    </div>
  );
}
