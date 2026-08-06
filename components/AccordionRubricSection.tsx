import type { RubricSectionWithContent } from "@/types/domain";
import { ScoringItemRow } from "./ScoringItemRow";

type AnswerAction = (rubricItemId: string, answerYes: boolean) => Promise<void>;

export function AccordionRubricSection({
  section,
  defaultOpen = false,
  editAction,
}: {
  section: RubricSectionWithContent;
  defaultOpen?: boolean;
  /** Bound server action (submissionId already applied) taking (rubricItemId, answerYes). Omit for read-only. */
  editAction?: AnswerAction;
}) {
  const allItems = section.subsections.flatMap((s) => s.items);
  const possible = allItems.reduce((sum, i) => sum + i.default_point_value, 0);
  const earned = allItems.reduce(
    (sum, i) => sum + (i.response?.awarded_points ?? 0),
    0
  );

  return (
    <details className="accordion mb-3.5 overflow-hidden rounded-2xl border border-chapman-line bg-white" open={defaultOpen}>
      <summary className="flex items-center justify-between bg-[#faf7ee] px-4 py-3.5 font-extrabold">
        <span>{section.section_name}</span>
        <span className="text-sm font-semibold text-chapman-muted">
          {earned} / {possible} complete
        </span>
      </summary>
      <div className="px-3.5 pb-3.5">
        {section.subsections.map((subsection) => (
          <div key={subsection.id} className="mt-3 first:mt-2">
            <div className="mb-1.5 rounded-xl border border-[#eadfb6] bg-chapman-gold-soft px-3 py-2 text-sm font-bold">
              {subsection.subsection_name}
            </div>
            <div className="rounded-xl border border-chapman-line">
              {subsection.items.map((item) => (
                <ScoringItemRow
                  key={item.id}
                  item={item}
                  editAction={
                    editAction ? editAction.bind(null, item.id) : undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
