import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { getNationalRollup, getRegionRollup } from "@/lib/data/reporting";
import { KpiCard } from "@/components/KpiCard";
import type { RegionRollupRow } from "@/types/domain";

export default async function NationalDashboardPage() {
  await requireRole(["executive_director"]);
  const supabase = await createClient();

  const [nationalRollup, regionRollup] = await Promise.all([
    getNationalRollup(supabase, {}),
    getRegionRollup(supabase, {}),
  ]);

  const latest = nationalRollup[0];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">
        National Dashboard
      </h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Submissions Reported" value={latest?.submission_count ?? 0} />
        <KpiCard
          label="National Avg. Score"
          value={latest ? `${latest.pct_score}%` : "—"}
        />
        <KpiCard
          label="Most Recent Period"
          value={latest ? `${latest.term_code} ${latest.reporting_year}` : "—"}
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Regional Rollup
        </h2>
        <div className="overflow-hidden rounded-xl border border-chapman-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#faf7ee] text-left">
              <tr>
                <th className="px-4 py-2.5">Region</th>
                <th className="px-4 py-2.5">Term</th>
                <th className="px-4 py-2.5">Submissions</th>
                <th className="px-4 py-2.5">Avg. Score</th>
              </tr>
            </thead>
            <tbody>
              {regionRollup.map((r: RegionRollupRow, i: number) => (
                <tr key={i} className="border-t border-chapman-line">
                  <td className="px-4 py-2.5">{r.region}</td>
                  <td className="px-4 py-2.5 capitalize">
                    {r.term_code} {r.reporting_year}
                  </td>
                  <td className="px-4 py-2.5">{r.submission_count}</td>
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
