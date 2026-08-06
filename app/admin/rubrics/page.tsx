import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import type { RubricVersionWithSectionCount } from "@/types/domain";

export default async function AdminRubricsPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const { data: versions } = await supabase
    .from("rubric_versions")
    .select("*, rubric_sections(count)")
    .order("chapter_type_code");
  const versionList = (versions ??
    []) as unknown as RubricVersionWithSectionCount[];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">
        Rubric Management
      </h1>
      <p className="text-sm text-chapman-muted">
        Collegiate and Alumni rubrics stay separate versions — editing tools
        for sections/subsections/items are not built yet. This is a
        read-only placeholder; edit rubric content directly via SQL or the
        Supabase table editor for now.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {versionList.map((v) => (
          <div
            key={v.id}
            className="rounded-xl border border-chapman-line bg-white p-5"
          >
            <div className="text-xs font-bold uppercase tracking-wide text-chapman-gold">
              {v.chapter_type_code}
            </div>
            <div className="mt-1 font-extrabold text-chapman-ink">
              {v.version_name}
            </div>
            <div className="mt-1 text-sm text-chapman-muted">
              {v.version_code} · {v.is_active ? "Active" : "Inactive"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
