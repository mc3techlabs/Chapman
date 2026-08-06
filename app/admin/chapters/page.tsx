import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { listAllChapters } from "@/lib/data/chapters";
import { ImportForm } from "./ImportForm";

export default async function AdminChaptersPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const chapters = await listAllChapters(supabase);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">Chapter Import</h1>

      <div className="rounded-xl border border-chapman-line bg-white p-5">
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Import from CSV
        </h2>
        <p className="mb-4 text-sm text-chapman-muted">
          Fields: Key, Chapter Name, Type, University, District, Region, Status.
          The initial 879-chapter master list is already seeded from{" "}
          <code>supabase/seed/chapters.csv</code>.
        </p>
        <ImportForm />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Chapters ({chapters.length})
        </h2>
        <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-chapman-line bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#faf7ee] text-left">
              <tr>
                <th className="px-4 py-2.5">Key</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">District</th>
                <th className="px-4 py-2.5">Region</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((c) => (
                <tr key={c.id} className="border-t border-chapman-line">
                  <td className="px-4 py-2.5">{c.chapter_key}</td>
                  <td className="px-4 py-2.5">{c.chapter_name}</td>
                  <td className="px-4 py-2.5 capitalize">{c.chapter_type_code}</td>
                  <td className="px-4 py-2.5">{c.district}</td>
                  <td className="px-4 py-2.5">{c.region}</td>
                  <td className="px-4 py-2.5">
                    {c.status_code}
                    {c.is_dechartered && (
                      <span className="ml-1.5 text-xs font-bold text-chapman-red">
                        Dechartered
                      </span>
                    )}
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
