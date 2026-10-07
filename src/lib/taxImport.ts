import type { Store } from "./store/types";
import type { TermCode } from "./types";

/**
 * Marks General Fees (1.1c) Yes/No per chapter from an AlphaMX renewal
 * billing export. Column names and Benefit/Rate values are exact matches
 * against a real export - see the comments on each constant below before
 * changing any of them, since a silent mismatch here would misclassify
 * real chapters' compliance status.
 */

// Column names as AlphaMX exports them. If a future export renames these,
// the missing-column check in parseTaxWorkbook fails loudly rather than
// silently mis-reading a different column.
const COL_BENEFIT = "Benefit";
const COL_RATE = "Rate";
const COL_STATUS = "Benefit Status";
const COL_CHAPTER = "Chapter";
const COL_BILL_TO = "Bill to Customer";
const COL_TAX_PAID_ON = "Chapter Tax Invoice Paid On (Invoice) (Invoice)";

// Where General Fees (1.1c) lives in both the Collegiate and Alumni
// rubrics - see supabase/seed/rubric_items.csv.
const SECTION_CODE = "operational_excellence";
const SUBSECTION_CODE = "1_financial_management";
const CRITERION_CODE = "c.";

type TaxType = "chapter_tax" | "chapter_insurance" | "delegate_premium";
// All three are required - unlike an earlier version of this import,
// Delegate Premium is not conditional on ever having been billed: the
// real export always carries a row for it (even a $0 one for a small
// chapter), so its absence is a real gap, not an exemption.
const REQUIRED_TYPES: TaxType[] = ["chapter_tax", "chapter_insurance", "delegate_premium"];

export const REQUIRED_TAX_COLUMNS = [
  COL_BENEFIT,
  COL_RATE,
  COL_STATUS,
  COL_CHAPTER,
  COL_BILL_TO,
  COL_TAX_PAID_ON,
];

/**
 * Classifies one AlphaMX billing row and whether it counts as fulfilled:
 *  - Chapter Tax has an actual paid-invoice date column; a row without one
 *    is billed but not yet paid, so it does NOT count.
 *  - Chapter Insurance ("Yearly charge" rate, flat $700) and Delegate
 *    Premium (either the Alumni or College "...Delegate Premium Insurance
 *    Assessment" rate, amount varies by chapter size, legitimately $0 for
 *    some small chapters) have no paid-date column in this export - a
 *    "Terminated" status is the only signal a row isn't current, so
 *    anything else (New/Renew) counts as fulfilled regardless of amount.
 */
function classifyRow(
  row: Record<string, unknown>
): { taxType: TaxType; fulfilled: boolean } | null {
  const benefit = String(row[COL_BENEFIT] ?? "").trim();
  const rate = String(row[COL_RATE] ?? "").trim();
  const status = String(row[COL_STATUS] ?? "").trim();

  if (benefit === "Chapter Tax") {
    const paidOn = row[COL_TAX_PAID_ON];
    return { taxType: "chapter_tax", fulfilled: paidOn != null && String(paidOn).trim() !== "" };
  }
  if (benefit === "Chapter Insurance" && rate === "Yearly charge") {
    return { taxType: "chapter_insurance", fulfilled: status !== "Terminated" };
  }
  if (benefit === "Chapter Insurance" && rate.includes("Delegate Premium")) {
    return { taxType: "delegate_premium", fulfilled: status !== "Terminated" };
  }
  return null;
}

export interface TaxImportResult {
  markedYes: number;
  markedNo: number;
  skipped: number;
  errors: string[];
}

/**
 * Marks General Fees (1.1c) Yes for every chapter mentioned in `rows` that
 * has all three required tax types fulfilled this cycle, No otherwise. A
 * chapter never mentioned anywhere in the file is left entirely untouched -
 * this import only speaks to what it was actually told about.
 */
export async function importTaxCompliance(
  store: Store,
  rows: Record<string, unknown>[],
  termCode: TermCode,
  reportingYear: number
): Promise<TaxImportResult> {
  const chapterNamesInFile = new Set<string>();
  const fulfilledByChapter = new Map<string, Set<TaxType>>();

  for (const row of rows) {
    const chapterName = String(row[COL_CHAPTER] ?? row[COL_BILL_TO] ?? "").trim();
    if (!chapterName) continue;
    chapterNamesInFile.add(chapterName);

    const classified = classifyRow(row);
    if (!classified || !classified.fulfilled) continue;
    if (!fulfilledByChapter.has(chapterName)) fulfilledByChapter.set(chapterName, new Set());
    fulfilledByChapter.get(chapterName)!.add(classified.taxType);
  }

  if (chapterNamesInFile.size === 0) {
    return { markedYes: 0, markedNo: 0, skipped: 0, errors: ["No recognizable chapter/billing rows found in that file."] };
  }

  // One roster fetch instead of a per-chapter lookup, and an exact
  // (case-insensitive) match - listChapters' `search` does a %like% partial
  // match, which would ambiguously match multiple chapters on a short name.
  const allChapters = (await store.listChapters({ limit: 1000 })).rows;
  const chapterByName = new Map(allChapters.map((c) => [c.chapter_name.trim().toLowerCase(), c]));

  // Resolve the General Fees (1.1c) item once per chapter type (collegiate/
  // alumni), reused for every chapter of that type below.
  const itemCache = new Map<string, { id: string } | null>();

  let markedYes = 0;
  let markedNo = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const chapterName of chapterNamesInFile) {
    const chapter = chapterByName.get(chapterName.toLowerCase());
    if (!chapter) {
      errors.push(`"${chapterName}": no chapter with this exact name - check for a naming mismatch.`);
      continue;
    }

    let item = itemCache.get(chapter.chapter_type_code);
    if (item === undefined) {
      const tree = await store.getRubricForType(chapter.chapter_type_code);
      const found = tree?.sections
        .find((s) => s.section_code === SECTION_CODE)
        ?.subsections.find((ss) => ss.subsection_code === SUBSECTION_CODE)
        ?.items.find((i) => i.criterion_code === CRITERION_CODE);
      item = found ? { id: found.id } : null;
      itemCache.set(chapter.chapter_type_code, item);
    }
    if (!item) {
      errors.push(`${chapterName}: General Fees (1.1c) item not found for ${chapter.chapter_type_code} chapters - check rubric setup.`);
      continue;
    }

    const submission = await store.getOrCreateSubmission(chapter.id, { termCode, reportingYear });
    if (submission.workflow_status !== "draft" && submission.workflow_status !== "returned") {
      errors.push(
        `${chapterName}: report for ${termCode} ${reportingYear} is already ${submission.workflow_status.replace("_", " ")} - skipped.`
      );
      skipped++;
      continue;
    }

    const fulfilled = fulfilledByChapter.get(chapterName) ?? new Set<TaxType>();
    const allFulfilled = REQUIRED_TYPES.every((t) => fulfilled.has(t));

    await store.setResponse(submission.id, item.id, allFulfilled ? "yes" : "no");
    if (allFulfilled) markedYes++;
    else markedNo++;
  }

  return { markedYes, markedNo, skipped, errors };
}
