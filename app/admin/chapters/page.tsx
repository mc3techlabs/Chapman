import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { listAllChapters } from "@/lib/data/chapters";
import { ImportForm } from "./ImportForm";
import { ChapterTable } from "@/components/ChapterTable";

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
        <ChapterTable chapters={chapters} />
      </div>
    </div>
  );
}
