import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { listAllChapters } from "@/lib/data/chapters";
import { listChapterLoginStatus } from "@/lib/data/chapterLogins";
import { getCurrentReportingPeriod } from "@/lib/reportingPeriod";
import { ImportForm } from "./ImportForm";
import { ChapterTable } from "@/components/ChapterTable";
import { ChapterLoginsPanel } from "@/components/ChapterLoginsPanel";
import { TaxComplianceImportForm } from "@/components/TaxComplianceImportForm";

export default async function AdminChaptersPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const chapters = await listAllChapters(supabase);
  const loginStatuses = await listChapterLoginStatus(supabase);
  const currentPeriod = await getCurrentReportingPeriod(supabase);

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

      <div className="rounded-xl border border-chapman-line bg-white p-5">
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
          Tax Compliance Import — 1.1c General Fees
        </h2>
        <p className="mb-4 text-sm text-chapman-muted">
          Upload an AlphaMX renewal billing export (.xlsx). A chapter is
          marked <strong>Yes</strong> on General Fees (Chapter Tax, Chapter
          Insurance, Premium Insurance) if Chapter Tax and Chapter Insurance
          both show as paid — Premium Insurance only counts against a
          chapter if AlphaMX actually billed them for it and they
          haven&rsquo;t paid; it isn&rsquo;t required for every chapter, so
          no row for it isn&rsquo;t treated as missing. Only touches
          chapters mentioned in the file, and skips (with a note) any report
          that&rsquo;s already been submitted for that term.
        </p>
        <TaxComplianceImportForm
          defaultTerm={currentPeriod.termCode}
          defaultYear={currentPeriod.reportingYear}
        />
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
