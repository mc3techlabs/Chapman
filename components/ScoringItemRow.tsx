import type { RubricItemWithResponse } from "@/types/domain";

type AnswerAction = (answerYes: boolean) => Promise<void>;

export function ScoringItemRow({
  item,
  editAction,
}: {
  item: RubricItemWithResponse;
  /** Bound server action (submissionId + rubricItemId already applied). Omit for read-only display. */
  editAction?: AnswerAction;
}) {
  const answered = item.response !== null;
  const isYes = item.response?.answer_yes === true;

  return (
    <div className="criterion-row flex items-center justify-between gap-4 border-b border-chapman-line px-3 py-2.5 last:border-b-0">
      <div className="flex-1 text-sm">
        <span className="font-semibold text-chapman-ink">
          {item.criterion_code}
        </span>{" "}
        <span className="text-chapman-ink">{item.criterion_text}</span>
        {item.is_required && (
          <span className="ml-2 text-xs font-bold text-chapman-red">
            Required
          </span>
        )}
      </div>

      {editAction ? (
        <div className="flex shrink-0 gap-2">
          <form action={editAction.bind(null, true)}>
            <button
              type="submit"
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                answered && isYes
                  ? "bg-chapman-green text-white"
                  : "bg-chapman-green-soft text-chapman-green hover:brightness-95"
              }`}
            >
              Yes
            </button>
          </form>
          <form action={editAction.bind(null, false)}>
            <button
              type="submit"
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                answered && !isYes
                  ? "bg-chapman-red text-white"
                  : "bg-chapman-red-soft text-chapman-red hover:brightness-95"
              }`}
            >
              No
            </button>
          </form>
        </div>
      ) : (
        <span
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold ${
            !answered
              ? "bg-gray-100 text-chapman-muted"
              : isYes
                ? "bg-chapman-green-soft text-chapman-green"
                : "bg-chapman-red-soft text-chapman-red"
          }`}
        >
          {!answered ? "Not answered" : isYes ? "Yes" : "No"}
        </span>
      )}
    </div>
  );
}
