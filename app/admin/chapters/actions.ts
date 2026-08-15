"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { parseCsv } from "@/lib/csv";
import { logAudit } from "@/lib/data/audit";
import type { Database, ChapterStatusCode, ChapterTypeCode } from "@/types/database";

const VALID_STATUSES: ChapterStatusCode[] = [
  "Active",
  "Inactive",
  "Suspended",
  "Dechartered",
  "Cease and Desist",
  "Provisional/Alumni",
  "Provisional/College",
  "Probation",
  "Dormant",
];

export interface ImportChaptersState {
  status: "idle" | "success" | "error";
  message: string;
}

/**
 * Validates and upserts a chapter master CSV. Columns per spec: Key,
 * Chapter Name, Type, University, District, Region, Status — no
 * is_dechartered column, that's derived from Status = "Dechartered".
 */
export async function importChapters(
  _prevState: ImportChaptersState,
  formData: FormData
): Promise<ImportChaptersState> {
  const profile = await requireRole(["admin"]);
  const supabase = await createClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a CSV file first." };
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { status: "error", message: "No rows found in that file." };
  }

  const seenKeys = new Set<string>();
  const errors: string[] = [];
  const toUpsert: Database["public"]["Tables"]["chapters"]["Insert"][] = [];

  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const key = (row["Key"] ?? "").trim();
    const name = (row["Chapter Name"] ?? "").trim();
    const typeRaw = (row["Type"] ?? "").trim().toLowerCase();
    const university = (row["University"] ?? "").trim();
    const district = (row["District"] ?? "").trim();
    const region = (row["Region"] ?? "").trim();
    const status = (row["Status"] ?? "").trim();

    if (!key) {
      errors.push(`Row ${line}: Key is required.`);
      return;
    }
    if (seenKeys.has(key)) {
      errors.push(`Row ${line}: duplicate Key "${key}" in this file.`);
      return;
    }
    seenKeys.add(key);

    if (!name) {
      errors.push(`Row ${line} (${key}): Chapter Name is required.`);
      return;
    }

    let typeCode: ChapterTypeCode;
    if (typeRaw === "collegiate") typeCode = "collegiate";
    else if (typeRaw === "alumni") typeCode = "alumni";
    else {
      errors.push(
        `Row ${line} (${key}): Type "${row["Type"]}" must be Collegiate or Alumni.`
      );
      return;
    }

    if (!district) {
      errors.push(`Row ${line} (${key}): District is required.`);
      return;
    }
    if (!region) {
      errors.push(`Row ${line} (${key}): Region is required.`);
      return;
    }

    if (!VALID_STATUSES.includes(status as ChapterStatusCode)) {
      errors.push(
        `Row ${line} (${key}): Status "${status}" must be one of ${VALID_STATUSES.join(", ")}.`
      );
      return;
    }

    toUpsert.push({
      chapter_key: key,
      chapter_name: name,
      chapter_type_code: typeCode,
      university: university || null,
      district,
      region,
      status_code: status as ChapterStatusCode,
      is_dechartered: status === "Dechartered",
    });
  });

  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from("chapters")
      .upsert(toUpsert, { onConflict: "chapter_key" });
    if (error) {
      return { status: "error", message: `Import failed: ${error.message}` };
    }
    await logAudit(supabase, {
      actorProfileId: profile.id,
      entityType: "chapters",
      action: "chapters_imported",
      metadata: { count: toUpsert.length, errors: errors.length },
    });
  }

  revalidatePath("/admin/chapters");

  const summary = `Imported ${toUpsert.length} chapter${toUpsert.length === 1 ? "" : "s"}.`;
  if (errors.length > 0) {
    const shown = errors.slice(0, 20);
    const more = errors.length > 20 ? `\n…and ${errors.length - 20} more.` : "";
    return {
      status: toUpsert.length > 0 ? "success" : "error",
      message: `${summary} ${errors.length} row${errors.length === 1 ? "" : "s"} skipped:\n${shown.join("\n")}${more}`,
    };
  }

  return { status: "success", message: summary };
}
