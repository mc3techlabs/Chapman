import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { getRubricTree } from "@/lib/data/rubrics";
import { AccordionRubricSection } from "@/components/AccordionRubricSection";
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

  const trees = await Promise.all(
    versionList.map((v) => getRubricTree(supabase, v.id))
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">
        Rubric Management
      </h1>
      <p className="text-sm text-chapman-muted">
        Collegiate and Alumni rubrics stay separate versions. This is
        read-only — editing tools for sections/subsections/items are not
        built yet; change content via SQL or the Supabase table editor for
        now.
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

      {trees.map((tree, i) => {
        if (!tree) return null;
        const itemCount = tree.sections.reduce(
          (sum, s) =>
            sum + s.subsections.reduce((s2, sub) => s2 + sub.items.length, 0),
          0
        );
        return (
          <div key={tree.version.id} className="flex flex-col gap-3">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-chapman-muted">
              {tree.version.version_name} ({itemCount} items)
            </h2>
            {tree.sections.map((section, sIdx) => (
              <AccordionRubricSection
                key={section.id}
                section={section}
                defaultOpen={i === 0 && sIdx === 0}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
