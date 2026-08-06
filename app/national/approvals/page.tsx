import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { listSubmissionsAwaitingExecutiveApproval } from "@/lib/data/submissions";
import { WorkflowStatusBadge } from "@/components/SubmissionStatusBadge";
import type { SubmissionWithChapter } from "@/types/domain";

export default async function ExecutiveApprovalsQueuePage() {
  await requireRole(["executive_director"]);
  const supabase = await createClient();

  const submissions = await listSubmissionsAwaitingExecutiveApproval(supabase);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">
        Executive Director Final Approval Queue
      </h1>
      <p className="text-sm text-chapman-muted">
        These submissions have already been approved by both the District
        Director and the Regional Vice President.
      </p>

      <div className="overflow-hidden rounded-xl border border-chapman-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#faf7ee] text-left">
            <tr>
              <th className="px-4 py-2.5">Chapter</th>
              <th className="px-4 py-2.5">Term</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Score</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {submissions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-chapman-muted">
                  Nothing awaiting final approval right now.
                </td>
              </tr>
            )}
            {submissions.map((s: SubmissionWithChapter) => (
              <tr key={s.id} className="border-t border-chapman-line">
                <td className="px-4 py-2.5">
                  {s.chapter?.chapter_name} ({s.chapter?.chapter_key})
                </td>
                <td className="px-4 py-2.5 capitalize">
                  {s.term_code} {s.reporting_year}
                </td>
                <td className="px-4 py-2.5">
                  <WorkflowStatusBadge status={s.workflow_status} />
                </td>
                <td className="px-4 py-2.5">
                  {s.final_score} / {s.max_score}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/national/approvals/${s.id}`}
                    className="font-bold text-chapman-blue hover:underline"
                  >
                    Review →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
