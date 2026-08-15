import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import {
  getNationalRollup,
  getRegionRollup,
  getReportingTerms,
} from "@/lib/data/reporting";
import { listAllChapters } from "@/lib/data/chapters";
import { resolveRequestedPeriod } from "@/lib/reportingPeriod";
import { KpiCard } from "@/components/KpiCard";
import { TermYearFilter } from "@/components/TermYearFilter";
import type { RegionRollupRow } from "@/types/domain";

export default async function NationalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireRole(["executive_director"]);
  const supabase = await createClient();
  const params = await searchParams;

  const { termCode, reportingYear } = await resolveRequestedPeriod(
    supabase,
    params.period
  );

  const [nationalRollup, regionRollup, terms, chapters] = await Promise.all([
    getNationalRollup(supabase, { termCode, reportingYear }),
    getRegionRollup(supabase, { termCode, reportingYear }),
    getReportingTerms(supabase),
    listAllChapters(supabase),
  ]);

  const current = nationalRollup[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-chapman-ink">
          National Dashboard
        </h1>
        <TermYearFilter
          terms={terms}
          currentTerm={termCode}
          currentYear={reportingYear}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Active Chapters"
          value={
            current?.total_chapters ??
            chapters.filter((c) => c.status_code === "Active").length
          }
        />
        <KpiCard
          label="Completion Rate"
          value={current ? `${current.completion_rate_pct}%` : "—"}
        />
        <KpiCard label="Submitted" value={current?.submitted_count ?? 0} />
        <KpiCard label="Returned" value={current?.returned_count ?? 0} />
        <KpiCard label="Finalized" value={current?.finalized_count ?? 0} />
        <KpiCard
          label="National Avg. Score"
          value={current ? `${current.pct_score}%` : "—"}
          sublabel={
            current
              ? `${current.total_points} / ${current.total_possible_points} pts`
              : undefined
          }
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Regional Rollup — {termCode} {reportingYear}
        </h2>
        <div className="overflow-hidden rounded-xl border border-chapman-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#faf7ee] text-left">
              <tr>
                <th className="px-4 py-2.5">Region</th>
                <th className="px-4 py-2.5">Chapters</th>
                <th className="px-4 py-2.5">Completion</th>
                <th className="px-4 py-2.5">Submitted</th>
                <th className="px-4 py-2.5">Returned</th>
                <th className="px-4 py-2.5">Finalized</th>
                <th className="px-4 py-2.5">Avg. Score</th>
              </tr>
            </thead>
            <tbody>
              {regionRollup.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-4 text-chapman-muted">
                    No data for this period.
                  </td>
                </tr>
              )}
              {regionRollup.map((r: RegionRollupRow, i: number) => (
                <tr key={i} className="border-t border-chapman-line">
                  <td className="px-4 py-2.5">{r.region}</td>
                  <td className="px-4 py-2.5">{r.total_chapters}</td>
                  <td className="px-4 py-2.5">{r.completion_rate_pct}%</td>
                  <td className="px-4 py-2.5">{r.submitted_count}</td>
                  <td className="px-4 py-2.5">{r.returned_count}</td>
                  <td className="px-4 py-2.5">{r.finalized_count}</td>
                  <td className="px-4 py-2.5">{r.pct_score}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
