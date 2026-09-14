import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { listChapterIdsForRvp } from "@/lib/data/reviewerAssignments";
import { listReviewQueueForTerm } from "@/lib/data/submissions";
import { getRegionRollup, getReportingTerms } from "@/lib/data/reporting";
import { resolveRequestedPeriod } from "@/lib/reportingPeriod";
import { TermYearFilter } from "@/components/TermYearFilter";
import { ReviewQueueCard } from "@/components/ReviewQueueCard";
import { approveRegionalSubmission } from "./actions";

export default async function RegionReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const profile = await requireRole(["rvp"]);
  const supabase = await createClient();
  const params = await searchParams;

  const { termCode, reportingYear } = await resolveRequestedPeriod(
    supabase,
    params.period
  );

  const [chapterIds, terms] = await Promise.all([
    listChapterIdsForRvp(supabase, profile.id),
    getReportingTerms(supabase),
  ]);

  const [submissions, rollup] = await Promise.all([
    listReviewQueueForTerm(supabase, chapterIds, termCode, reportingYear),
    getRegionRollup(supabase, { termCode, reportingYear }),
  ]);

  // RLS scopes v_region_rollup to chapters this reviewer can see, so for an
  // RVP this is already just their own region's row.
  const snapshot = rollup.find((r) => r.region === profile.region);
  const startedPct =
    snapshot && snapshot.total_chapters > 0
      ? Math.round((snapshot.started_count / snapshot.total_chapters) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-chapman-ink">
            Regional Vice President Review
          </h1>
          <p className="mt-1 text-sm text-chapman-muted">
            Regional queue running in parallel to district review, with
            multi-state visibility and hold/revision actions.
          </p>
        </div>
        <TermYearFilter terms={terms} currentTerm={termCode} currentYear={reportingYear} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-chapman-line bg-white p-5">
          <h2 className="mb-1 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
            Regional review queue
          </h2>
          {submissions.length === 0 ? (
            <p className="py-4 text-sm text-chapman-muted">
              Nothing in your region has been submitted for {termCode}{" "}
              {reportingYear} yet.
            </p>
          ) : (
            <div>
              {submissions.map((s) => (
                <ReviewQueueCard
                  key={s.id}
                  submission={s}
                  detailHref={`/region/review/${s.id}`}
                  approveAction={approveRegionalSubmission.bind(null, s.id)}
                  canAct={
                    s.workflow_status === "submitted" &&
                    s.regional_review_status === "pending"
                  }
                />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-chapman-line bg-white p-5">
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
            Regional snapshot
          </h2>
          {snapshot ? (
            <table className="w-full text-sm">
              <thead className="text-left text-chapman-muted">
                <tr>
                  <th className="pb-2">Region</th>
                  <th className="pb-2">Started</th>
                  <th className="pb-2">Approved</th>
                  <th className="pb-2">Completion</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-chapman-line">
                  <td className="py-2 font-semibold text-chapman-ink">
                    {snapshot.region}
                  </td>
                  <td className="py-2">
                    {snapshot.started_count} / {snapshot.total_chapters}
                  </td>
                  <td className="py-2">{snapshot.regional_approved_count}</td>
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
