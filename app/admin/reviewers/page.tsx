import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { listAllChapters } from "@/lib/data/chapters";
import { listAssignments } from "@/lib/data/reviewerAssignments";
import { listProfilesByRole } from "@/lib/data/profiles";
import { assignReviewers } from "./actions";
import { CreateReviewerForm } from "./CreateReviewerForm";
import { ChapterCombobox } from "@/components/ChapterCombobox";
import type { AssignmentWithNames } from "@/types/domain";

export default async function AdminReviewersPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const [chapters, assignments, districtDirectors, rvps] = await Promise.all([
    listAllChapters(supabase),
    listAssignments(supabase),
    listProfilesByRole(supabase, "district_director"),
    listProfilesByRole(supabase, "rvp"),
  ]);

  const districts = Array.from(new Set(chapters.map((c) => c.district))).sort();
  const regions = Array.from(new Set(chapters.map((c) => c.region))).sort();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">
        Reviewer Assignment
      </h1>
      <p className="text-sm text-chapman-muted">
        Create named District Director / RVP accounts below, then assign
        them to chapters.
      </p>

      <div className="rounded-xl border border-chapman-line bg-white p-5">
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Create Reviewer Account
        </h2>
        <p className="mb-4 text-sm text-chapman-muted">
          Sends a Supabase invite email — the reviewer sets their own
          password by clicking the link, so this never handles a password.
          Creating a District Director auto-assigns them to every chapter in
          their district (and an RVP to every chapter in their region) —
          use Assign / Update below only for one-off overrides.
        </p>
        <CreateReviewerForm districts={districts} regions={regions} />
      </div>

      <div className="rounded-xl border border-chapman-line bg-[#faf7ee] p-5 text-sm text-chapman-muted">
        <span className="font-bold text-chapman-ink">Bulk import:</span> for
        many reviewers at once, bulk-load from{" "}
        <code>supabase/seed/reviewer_directory_template.csv</code> and{" "}
        <code>supabase/seed/reviewer_assignments_template.csv</code> instead
        of the form above. In-app CSV upload for these isn&apos;t wired up
        yet — load the CSVs via Supabase for bulk setup.
      </div>

      <div className="rounded-xl border border-chapman-line bg-white p-5">
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Assign / Update
        </h2>
        <form action={assignReviewers} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-chapman-muted">
              Chapter
            </label>
            <ChapterCombobox chapters={chapters} name="chapter_id" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-chapman-muted">
              District Director
            </label>
            <select
              name="district_director_id"
              className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {districtDirectors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.district})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-chapman-muted">
              Regional Vice President
            </label>
            <select
              name="rvp_id"
              className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {rvps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.region})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-chapman-gold px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
          >
            Save Assignment
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Current Assignments ({assignments.length})
        </h2>
        <div className="overflow-hidden rounded-xl border border-chapman-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#faf7ee] text-left">
              <tr>
                <th className="px-4 py-2.5">Chapter</th>
                <th className="px-4 py-2.5">District Director</th>
                <th className="px-4 py-2.5">Regional Vice President</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-chapman-muted">
                    No assignments yet.
                  </td>
                </tr>
              )}
              {assignments.map((a: AssignmentWithNames) => (
                <tr key={a.id} className="border-t border-chapman-line">
                  <td className="px-4 py-2.5">
                    {a.chapter?.chapter_name} ({a.chapter?.chapter_key})
                  </td>
                  <td className="px-4 py-2.5">
                    {a.district_director?.full_name ?? "— Unassigned —"}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.regional_vice_president?.full_name ?? "— Unassigned —"}
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
