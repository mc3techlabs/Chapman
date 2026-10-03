import type {
  AnswerCode,
  ItemResponse,
  RubricItem,
  RubricItemWithResponse,
  RubricSection,
  RubricSectionWithContent,
  RubricTree,
  RubricTreeWithResponses,
  ScoreSummary,
} from "./types";

/**
 * Scoring model — confirmed direction, single source of truth.
 *
 *   yes -> default_point_value (normally 1)
 *   no  -> 0 ... unless the item is required AND carries a mandatory_penalty,
 *          in which case the penalty (e.g. -1) is applied. mandatory_penalty
 *          defaults to 0 today, so nothing changes until the board turns it on
 *          per item — no schema or code change needed when it does.
 *   na  -> baseline: default_point_value (a non-applicable item is not held
 *          against the chapter; it counts as satisfied for scoring purposes).
 */
export function pointsFor(item: RubricItem, answer: AnswerCode): number {
  const base = item.default_point_value ?? 1;
  switch (answer) {
    case "yes":
      return base;
    case "na":
      return base; // baseline for non-applicable items
    case "no":
      return item.is_required ? (item.mandatory_penalty ?? 0) : 0;
    default:
      return 0;
  }
}

/** Max a chapter can earn for one item — used to build the denominator. */
export function maxFor(item: RubricItem): number {
  return item.default_point_value ?? 1;
}

export function summarize(
  items: RubricItemWithResponse[]
): ScoreSummary {
  let earned = 0;
  let possible = 0;
  let answered = 0;
  for (const item of items) {
    possible += maxFor(item);
    if (item.response) {
      answered++;
      earned += item.response.awarded_points;
    }
  }
  return {
    earned,
    possible,
    answered,
    total: items.length,
    percent: possible > 0 ? Math.round((earned / possible) * 100) : 0,
  };
}

/** Flattens a plain rubric tree into items (for the denominator/possible). */
export function flattenItems(tree: RubricTree): RubricItem[] {
  const out: RubricItem[] = [];
  for (const s of tree.sections) for (const ss of s.subsections) out.push(...ss.items);
  return out;
}

export function flattenItemsWithResponses(
  tree: RubricTreeWithResponses
): RubricItemWithResponse[] {
  const out: RubricItemWithResponse[] = [];
  for (const s of tree.sections) for (const ss of s.subsections) out.push(...ss.items);
  return out;
}

/**
 * Recomputes server-side totals from the stored responses. The chapter's
 * displayed score is always derived here, never trusted from the client.
 */
export function computeTotals(
  items: RubricItem[],
  responses: ItemResponse[]
): { finalScore: number; maxScore: number } {
  const byItem = new Map(responses.map((r) => [r.rubric_item_id, r]));
  let finalScore = 0;
  let maxScore = 0;
  for (const item of items) {
    maxScore += maxFor(item);
    const resp = byItem.get(item.id);
    if (resp) finalScore += resp.awarded_points;
  }
  return { finalScore, maxScore };
}

/** Overlays saved responses onto a rubric tree for rendering. */
export function attachResponses(
  tree: RubricTree,
  responses: ItemResponse[]
): RubricTreeWithResponses {
  const byItem = new Map(responses.map((r) => [r.rubric_item_id, r]));
  const sections: RubricSectionWithContent[] = tree.sections.map((s) => ({
    ...s,
    subsections: s.subsections.map((ss) => ({
      ...ss,
      items: ss.items.map((it) => ({
        ...it,
        response: byItem.get(it.id) ?? null,
      })),
    })),
  }));
  return { version: tree.version, sections, item_count: tree.item_count };
}

export const ANSWER_LABELS: Record<AnswerCode, string> = {
  yes: "Yes",
  no: "No",
  na: "N/A",
};

/** Human-readable status labels shared across every dashboard. */
export const WORKFLOW_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  returned: "Returned",
  pending_executive: "Pending Executive",
  finalized: "Finalized",
};

export const REVIEW_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  returned: "Returned",
};

/** Tailwind-ish status colors (used with the chapman-* palette classes). */
export const WORKFLOW_TONE: Record<string, string> = {
  draft: "info",
  submitted: "amber",
  returned: "red",
  pending_executive: "amber",
  finalized: "green",
};

export const REVIEW_TONE: Record<string, string> = {
  pending: "amber",
  approved: "green",
  returned: "red",
};

/**
 * The parallel-approval gate. A submission is eligible for the Executive
 * Director's final approval only when BOTH the district and the regional
 * reviews are approved. Mirrors the DB check in lib/store + RLS.
 */
export function isEligibleForExecutive(s: {
  district_review_status: string;
  regional_review_status: string;
}): boolean {
  return (
    s.district_review_status === "approved" &&
    s.regional_review_status === "approved"
  );
}
