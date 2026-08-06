import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { getDistrictRollup } from "@/lib/data/reporting";
import { listChaptersForDistrict } from "@/lib/data/chapters";
import { KpiCard } from "@/components/KpiCard";
import type { DistrictRollupRow, Chapter } from "@/types/domain";

export default async function DistrictDashboardPage() {
  const profile = await requireRole(["district_director"]);
  const supabase = await createClient();

  const district = profile.district ?? "";
  const [rollup, chapters] = await Promise.all([
    getDistrictRollup(supabase, {}),
    listChaptersForDistrict(supabase, district),
  ]);

  const districtRollup = rollup.filter(
    (r: DistrictRollupRow) => r.district === district
  );
  const latest = districtRollup[0];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">
        {district} District Dashboard
      </h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Chapters" value={chapters.length} />
        <KpiCard
          label="Submissions Reported"
          value={latest?.submission_count ?? 0}
        />
        <KpiCard
          label="District Avg. Score"
          value={latest ? `${latest.pct_score}%` : "—"}
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
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">University</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((c: Chapter) => (
                <tr key={c.id} className="border-t border-chapman-line">
                  <td className="px-4 py-2.5">
                    {c.chapter_name} ({c.chapter_key})
                  </td>
                  <td className="px-4 py-2.5 capitalize">{c.chapter_type_code}</td>
                  <td className="px-4 py-2.5">{c.university ?? "—"}</td>
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
