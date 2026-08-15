import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { getRegionRollup, getReportingTerms } from "@/lib/data/reporting";
import { listChaptersForRegion } from "@/lib/data/chapters";
import { getCurrentReportingPeriod } from "@/lib/reportingPeriod";
import { KpiCard } from "@/components/KpiCard";
import { TermYearFilter } from "@/components/TermYearFilter";
import type { RegionRollupRow, Chapter } from "@/types/domain";
import type { ReportTermCode } from "@/types/database";

export default async function RegionDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const profile = await requireRole(["rvp"]);
  const supabase = await createClient();
  const params = await searchParams;

  const region = profile.region ?? "";

  let termCode: ReportTermCode;
  let reportingYear: number;
  if (params.period && params.period.includes(":")) {
    const [t, y] = params.period.split(":");
    termCode = t as ReportTermCode;
    reportingYear = Number(y);
  } else {
    const current = await getCurrentReportingPeriod(supabase);
    termCode = current.termCode;
    reportingYear = current.reportingYear;
  }

  const [rollup, chapters, terms] = await Promise.all([
    getRegionRollup(supabase, { termCode, reportingYear }),
    listChaptersForRegion(supabase, region),
    getReportingTerms(supabase),
  ]);

  const current = rollup.find((r: RegionRollupRow) => r.region === region);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-chapman-ink">
          {region} Regional Dashboard
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
          label="Avg. Score"
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
          Chapters
        </h2>
        <div className="overflow-hidden rounded-xl border border-chapman-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#faf7ee] text-left">
              <tr>
                <th className="px-4 py-2.5">Chapter</th>
                <th className="px-4 py-2.5">District</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((c: Chapter) => (
                <tr key={c.id} className="border-t border-chapman-line">
                  <td className="px-4 py-2.5">
                    {c.chapter_name} ({c.chapter_key})
                  </td>
                  <td className="px-4 py-2.5">{c.district}</td>
                  <td className="px-4 py-2.5 capitalize">{c.chapter_type_code}</td>
                  <td className="px-4 py-2.5">{c.status_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
