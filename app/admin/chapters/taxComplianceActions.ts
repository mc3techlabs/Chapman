"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { getActiveRubricVersion, getRubricItemByCode } from "@/lib/data/rubrics";
import { getOrCreateDraftSubmission, recalcSubmissionScore } from "@/lib/data/submissions";
import { upsertResponse } from "@/lib/data/submissionResponses";
import { logAudit } from "@/lib/data/audit";
import type { ReportTermCode } from "@/types/database";

// Where "General Fees (Chapter Tax, Chapter Insurance, Premium Insurance)"
// lives in both the Collegiate and Alumni rubrics — see supabase/seed/rubric_items.csv.
const TAX_ITEM_SECTION_CODE = "operational_excellence";
const TAX_ITEM_SUBSECTION_CODE = "1_financial_management";
const TAX_ITEM_CRITERION_CODE = "c.";

// Column names as exported by AlphaMX's renewal billing report. If a future
// export renames these, the missing-column check below fails loudly rather
// than silently mis-reading a different column.
const COL_BENEFIT = "Benefit";
const COL_RATE = "Rate";
const COL_STATUS = "Benefit Status";
const COL_CHAPTER = "Chapter";
const COL_BILL_TO = "Bill to Customer";
const COL_TAX_PAID_ON = "Chapter Tax Invoice Paid On (Invoice) (Invoice)";

type TaxType = "chapter_tax" | "chapter_insurance" | "premium_insurance";
// Chapter Tax and Chapter Insurance apply to every chapter. Premium
// Insurance doesn't — smaller college chapters aren't required to carry it
// — so it's only held against a chapter that AlphaMX actually billed for
// it (see premiumInsuranceBilledChapters below); a chapter never billed
// for it at all isn't penalized for lacking a row.
const ALWAYS_REQUIRED_TAX_TYPES: TaxType[] = ["chapter_tax", "chapter_insurance"];

export interface TaxImportState {
  status: "idle" | "success" | "error";
  message: string;
}

/**
 * Classifies one AlphaMX billing row into one of the three taxes 1.1c
 * bundles, and whether that row counts as paid:
 *  - Chapter Tax has an actual paid-invoice date column; a row without one
 *    is billed but not yet paid.
 *  - Chapter Insurance / Premium Insurance have no paid-date column in this
 *    export — a "Terminated" status is the only signal that a row isn't
 *    current, so anything else (New/Renew) counts as paid.
 */
function classifyRow(
  row: Record<string, unknown>
): { taxType: TaxType; paid: boolean } | null {
  const benefit = String(row[COL_BENEFIT] ?? "").trim();
  const rate = String(row[COL_RATE] ?? "").trim();
  const status = String(row[COL_STATUS] ?? "").trim();

  if (benefit === "Chapter Tax") {
    const paidOn = row[COL_TAX_PAID_ON];
    return { taxType: "chapter_tax", paid: paidOn != null && String(paidOn).trim() !== "" };
  }
  if (benefit === "Chapter Insurance" && rate === "Yearly charge") {
    return { taxType: "chapter_insurance", paid: status !== "Terminated" };
  }
  if (benefit === "Chapter Insurance" && rate.includes("Premium Insurance Assessment")) {
    return { taxType: "premium_insurance", paid: status !== "Terminated" };
  }
  return null;
}

export async function importTaxCompliance(
  _prevState: TaxImportState,
  formData: FormData
): Promise<TaxImportState> {
  const profile = await requireRole(["admin"]);
  const supabase = await createClient();

  const file = formData.get("file");
  const termCode = String(formData.get("term_code") ?? "") as ReportTermCode;
  const reportingYear = Number(formData.get("reporting_year"));

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose an Excel (.xlsx) file first." };
  }
  if (termCode !== "fall" && termCode !== "spring") {
    return { status: "error", message: "Choose a term." };
  }
  if (!Number.isInteger(reportingYear)) {
    return { status: "error", message: "Choose a reporting year." };
  }

  let rows: Record<string, unknown>[];
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  } catch (err) {
    return {
      status: "error",
      message: `Failed to read that file as an Excel workbook: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
  if (rows.length === 0) {
    return { status: "error", message: "No rows found in that file." };
  }

  const requiredColumns = [
    COL_BENEFIT,
    COL_RATE,
    COL_STATUS,
    COL_CHAPTER,
    COL_BILL_TO,
    COL_TAX_PAID_ON,
  ];
  const missingColumns = requiredColumns.filter((c) => !(c in rows[0]));
  if (missingColumns.length > 0) {
    return {
      status: "error",
      message: `This doesn't look like an AlphaMX renewal billing export — missing column(s): ${missingColumns.join(", ")}.`,
    };
  }

  // Every chapter mentioned anywhere in the file (billed for at least one
  // tax, paid or not) vs. which of the three taxes each chapter actually
  // paid, vs. which chapters were billed for Premium Insurance at all (it's
  // not required for every chapter, so absence isn't the same as unpaid —
  // see premiumInsuranceBilledChapters). A chapter absent from the file
  // entirely is left untouched — this import only speaks to what it was
  // told about.
  const chapterNamesInFile = new Set<string>();
  const paidTaxesByChapter = new Map<string, Set<TaxType>>();
  const premiumInsuranceBilledChapters = new Set<string>();

  for (const row of rows) {
    const chapterName = String(row[COL_CHAPTER] ?? row[COL_BILL_TO] ?? "").trim();
    if (!chapterName) continue;
    chapterNamesInFile.add(chapterName);

    const classified = classifyRow(row);
    if (!classified) continue;

    if (classified.taxType === "premium_insurance") {
      premiumInsuranceBilledChapters.add(chapterName);
    }

    if (!classified.paid) continue;
    if (!paidTaxesByChapter.has(chapterName)) {
      paidTaxesByChapter.set(chapterName, new Set());
    }
    paidTaxesByChapter.get(chapterName)!.add(classified.taxType);
  }

  if (chapterNamesInFile.size === 0) {
    return { status: "error", message: "No recognizable chapter/billing rows found in that file." };
  }

  // Resolve the General Fees (1.1c) item once per rubric version, reused
  // for every chapter below instead of a lookup per row.
  const [collegiateVersion, alumniVersion] = await Promise.all([
    getActiveRubricVersion(supabase, "collegiate"),
    getActiveRubricVersion(supabase, "alumni"),
  ]);
  const itemByVersionId = new Map<string, { id: string; default_point_value: number }>();
  for (const version of [collegiateVersion, alumniVersion]) {
    if (!version) continue;
    const item = await getRubricItemByCode(
      supabase,
      version.id,
      TAX_ITEM_SECTION_CODE,
      TAX_ITEM_SUBSECTION_CODE,
      TAX_ITEM_CRITERION_CODE
    );
    if (item) itemByVersionId.set(version.id, item);
  }
  if (itemByVersionId.size === 0) {
    return {
      status: "error",
      message: "Couldn't find the General Fees (1.1c) rubric item in the active rubric — check rubric setup first.",
    };
  }

  let markedYes = 0;
  let markedNo = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const chapterName of chapterNamesInFile) {
    const { data: chapter } = await supabase
      .from("chapters")
      .select("id, chapter_type_code")
      .eq("chapter_name", chapterName)
      .maybeSingle();
    if (!chapter) {
      errors.push(`"${chapterName}": no chapter with this exact name — check for a naming mismatch.`);
      continue;
    }

    const submission = await getOrCreateDraftSubmission(
      supabase,
      chapter.id,
      termCode,
      reportingYear
    );
    if (!submission) {
      errors.push(
        `${chapterName}: no active rubric configured for ${chapter.chapter_type_code} chapters.`
      );
      continue;
    }
    if (submission.workflow_status !== "draft" && submission.workflow_status !== "returned") {
      errors.push(
        `${chapterName}: report for ${termCode} ${reportingYear} is already ${submission.workflow_status.replace("_", " ")} — skipped.`
      );
      skipped++;
      continue;
    }

    const item = itemByVersionId.get(submission.rubric_version_id);
    if (!item) {
      errors.push(`${chapterName}: General Fees (1.1c) item not found for this chapter's rubric.`);
      continue;
    }

    const paidTaxes = paidTaxesByChapter.get(chapterName) ?? new Set<TaxType>();
    const premiumInsuranceRequired = premiumInsuranceBilledChapters.has(chapterName);
    const allPaid =
      ALWAYS_REQUIRED_TAX_TYPES.every((t) => paidTaxes.has(t)) &&
      (!premiumInsuranceRequired || paidTaxes.has("premium_insurance"));

    await upsertResponse(supabase, submission.id, item.id, allPaid, item.default_point_value);
    await recalcSubmissionScore(supabase, submission.id, submission.rubric_version_id);
    if (allPaid) {
      markedYes++;
    } else {
      markedNo++;
    }
  }

  if (markedYes + markedNo > 0) {
    await logAudit(supabase, {
      actorProfileId: profile.id,
      entityType: "submissions",
      action: "tax_compliance_imported",
      metadata: {
        term_code: termCode,
        reporting_year: reportingYear,
        marked_yes: markedYes,
        marked_no: markedNo,
        skipped,
        errors: errors.length,
      },
    });
  }

  revalidatePath("/admin/chapters");

  const summary = `Marked ${markedYes} chapter${markedYes === 1 ? "" : "s"} Yes and ${markedNo} No for General Fees (1.1c), ${termCode} ${reportingYear}.`;
  if (errors.length > 0) {
    const shown = errors.slice(0, 20);
    const more = errors.length > 20 ? `\n…and ${errors.length - 20} more.` : "";
    return {
      status: markedYes + markedNo > 0 ? "success" : "error",
      message: `${summary} ${errors.length} chapter${errors.length === 1 ? "" : "s"} skipped:\n${shown.join("\n")}${more}`,
    };
  }
  return { status: "success", message: summary };
}
