import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { listChapterIdsForDistrictDirector } from "@/lib/data/reviewerAssignments";
import { listReviewQueueForTerm } from "@/lib/data/submissions";
import { getDistrictRollup, getReportingTerms } from "@/lib/data/reporting";
import { resolveRequestedPeriod } from "@/lib/reportingPeriod";
import { TermYearFilter } from "@/components/TermYearFilter";
import { ReviewQueueCard } from "@/components/ReviewQueueCard";
import { approveDistrictSubmission } from "./actions";

export default async function DistrictReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const profile = await requireRole(["district_director"]);
  const supabase = await createClient();
  const params = await searchParams;

  const { termCode, reportingYear } = await resolveRequestedPeriod(
    supabase,
    params.period
  );

  const [chapterIds, terms] = await Promise.all([
    listChapterIdsForDistrictDirector(supabase, profile.id),
    getReportingTerms(supabase),
  ]);

  const [submissions, rollup] = await Promise.all([
    listReviewQueueForTerm(supabase, chapterIds, termCode, reportingYear),
    getDistrictRollup(supabase, { termCode, reportingYear }),
  ]);

  // RLS scopes v_district_rollup to chapters this reviewer can see, so for a
  // district director this is already just their own district's row.
  const snapshot = rollup.find((r) => r.district === profile.district);
  const startedPct =
    snapshot && snapshot.total_chapters > 0
      ? Math.round((snapshot.started_count / snapshot.total_chapters) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-chapman-ink">
            District Director Review
          </h1>
          <p className="mt-1 text-sm text-chapman-muted">
            State-level reviewer queue with compliance checks, chapter
            scores, and approval actions.
          </p>
        </div>
        <TermYearFilter terms={terms} currentTerm={termCode} currentYear={reportingYear} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-chapman-line bg-white p-5">
          <h2 className="mb-1 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
            Review queue
          </h2>
          {submissions.length === 0 ? (
            <p className="py-4 text-sm text-chapman-muted">
              Nothing in your district has been submitted for {termCode}{" "}
              {reportingYear} yet.
            </p>
          ) : (
            <div>
              {submissions.map((s) => (
                <ReviewQueueCard
                  key={s.id}
                  submission={s}
                  detailHref={`/district/review/${s.id}`}
                  approveAction={approveDistrictSubmission.bind(null, s.id)}
                  canAct={
                    s.workflow_status === "submitted" &&
                    s.district_review_status === "pending"
                  }
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-chapman-line bg-white p-5">
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
            District snapshot
          </h2>
          {snapshot ? (
            <table className="w-full text-sm">
              <thead className="text-left text-chapman-muted">
                <tr>
                  <th className="pb-2">District</th>
                  <th className="pb-2">Started</th>
                  <th className="pb-2">Approved</th>
                  <th className="pb-2">Completion</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-chapman-line">
                  <td className="py-2 font-semibold text-chapman-ink">
                    {snapshot.district}
                  </td>
                  <td className="py-2">
                    {snapshot.started_count} / {snapshot.total_chapters}
                  </td>
                  <td className="py-2">{snapshot.district_approved_count}</td>
                  <td className="py-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-chapman-line">
                      <span
                        className="block h-full bg-chapman-gold"
                        style={{ width: `${startedPct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-chapman-muted">
              No data yet for {termCode} {reportingYear}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
