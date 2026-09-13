import Link from "next/link";
import { ReviewStatusBadge } from "@/components/SubmissionStatusBadge";
import type { ReviewQueueSubmission } from "@/types/domain";

const CHAPTER_TYPE_LABEL: Record<string, string> = {
  collegiate: "College",
  alumni: "Alumni",
};

export function ReviewQueueCard({
  submission,
  detailHref,
  approveAction,
  canAct,
}: {
  submission: ReviewQueueSubmission;
  detailHref: string;
  approveAction: (formData: FormData) => Promise<void>;
  canAct: boolean;
}) {
  const chapter = submission.chapter;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-t border-chapman-line py-4 first:border-t-0 first:pt-0">
      <div className="min-w-[220px] flex-1">
        <Link
          href={detailHref}
          className="font-bold text-chapman-ink hover:text-chapman-gold"
        >
          {chapter?.chapter_name}
        </Link>{" "}
        <span className="text-sm text-chapman-muted">{chapter?.chapter_key}</span>
        <div className="text-sm text-chapman-muted">
          {chapter?.district} • {chapter?.region} •{" "}
          {chapter ? CHAPTER_TYPE_LABEL[chapter.chapter_type_code] : ""}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ReviewStatusBadge prefix="District" status={submission.district_review_status} />
          <ReviewStatusBadge prefix="Regional" status={submission.regional_review_status} />
          <ReviewStatusBadge prefix="Executive" status={submission.executive_review_status} />
        </div>
      </div>

      <div className="text-right">
        <div className="text-lg font-extrabold text-chapman-ink">
          {submission.final_score} / {submission.max_score}
        </div>
        <div className="text-xs capitalize text-chapman-muted">
          {submission.term_code} score
        </div>
        <div className="mt-2 flex justify-end gap-2">
          {canAct ? (
            <>
              <Link
                href={detailHref}
                className="rounded-lg border border-chapman-line px-3 py-1.5 text-xs font-bold text-chapman-ink transition hover:border-chapman-red"
              >
                Request Revision
              </Link>
              <form action={approveAction}>
                <button
                  type="submit"
                  className="rounded-lg bg-chapman-gold px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-95"
                >
                  Approve
                </button>
              </form>
            </>
          ) : (
            <Link
              href={detailHref}
              className="rounded-lg border border-chapman-line px-3 py-1.5 text-xs font-bold text-chapman-ink transition hover:border-chapman-gold"
            >
              View →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
