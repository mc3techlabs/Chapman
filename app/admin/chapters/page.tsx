import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { listAllChapters } from "@/lib/data/chapters";
import { listChapterLoginStatus } from "@/lib/data/chapterLogins";
import { ImportForm } from "./ImportForm";
import { ChapterTable } from "@/components/ChapterTable";
import { ChapterLoginsPanel } from "@/components/ChapterLoginsPanel";

export default async function AdminChaptersPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const chapters = await listAllChapters(supabase);
  const loginStatuses = await listChapterLoginStatus(supabase);

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

      <div className="rounded-xl border border-chapman-line bg-white p-5">
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Chapter Logins
        </h2>
        <p className="mb-4 text-sm text-chapman-muted">
          Each chapter shares one login (not a named person, so there&rsquo;s no
          email to invite). Create passwords for every chapter at once, or
          reset a single chapter&rsquo;s password when needed — passwords are
          shown once, so copy them before leaving this page.
        </p>
        <ChapterLoginsPanel chapters={loginStatuses} />
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
