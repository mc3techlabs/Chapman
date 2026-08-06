import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { getChapterForProfile } from "@/lib/data/chapters";
import { listSubmissionsForChapter } from "@/lib/data/submissions";
import { getCurrentReportingPeriod } from "@/lib/reportingPeriod";
import { ChapterIdentityCard } from "@/components/ChapterIdentityCard";
import { KpiCard } from "@/components/KpiCard";
import { WorkflowStatusBadge } from "@/components/SubmissionStatusBadge";

export default async function ChapterDashboardPage() {
  const profile = await requireRole(["chapter"]);
  const supabase = await createClient();

  const chapter = await getChapterForProfile(supabase, profile.id);
  if (!chapter) {
    return <p className="text-chapman-muted">No chapter is linked to this account yet.</p>;
  }

  const [submissions, period] = await Promise.all([
    listSubmissionsForChapter(supabase, chapter.id),
    getCurrentReportingPeriod(supabase),
  ]);

  const currentSubmission = submissions.find(
    (s) =>
      s.term_code === period.termCode && s.reporting_year === period.reportingYear
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">Chapter Dashboard</h1>

      <ChapterIdentityCard
        identity={{
          chapterKey: chapter.chapter_key,
          chapterName: chapter.chapter_name,
          district: chapter.district,
          region: chapter.region,
        }}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Current Period"
          value={`${period.termCode === "fall" ? "Fall" : "Spring"} ${period.reportingYear}`}
        />
        <KpiCard
          label="Current Status"
          value={currentSubmission ? currentSubmission.workflow_status.replace("_", " ") : "Not started"}
        />
        <KpiCard
          label="Score"
          value={
            currentSubmission
              ? `${currentSubmission.final_score} / ${currentSubmission.max_score}`
              : "—"
          }
        />
      </div>

      <Link
        href="/chapter/submission"
        className="w-fit rounded-lg bg-chapman-gold px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
      >
        Go to Submission Workspace
      </Link>

      <div>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Submission History
        </h2>
        <div className="overflow-hidden rounded-xl border border-chapman-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#faf7ee] text-left">
              <tr>
                <th className="px-4 py-2.5">Term</th>
                <th className="px-4 py-2.5">Year</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Score</th>
              </tr>
            </thead>
            <tbody>
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-chapman-muted">
                    No submissions yet.
                  </td>
                </tr>
              )}
              {submissions.map((s) => (
                <tr key={s.id} className="border-t border-chapman-line">
                  <td className="px-4 py-2.5 capitalize">{s.term_code}</td>
                  <td className="px-4 py-2.5">{s.reporting_year}</td>
                  <td className="px-4 py-2.5">
                    <WorkflowStatusBadge status={s.workflow_status} />
                  </td>
                  <td className="px-4 py-2.5">
                    {s.final_score} / {s.max_score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
