"use server";

import { requireRole } from "@/lib/auth/roles";

/**
 * Placeholder for CSV-driven chapter import. The initial 879-chapter master
 * list already ships as supabase/seed/chapters.csv and is loaded via the
 * Supabase SQL editor / CLI per supabase/docs/README_IMPORT_GUIDE.md.
 * Wire this up to parse an uploaded CSV and upsert via lib/data/chapters.ts
 * (upsertChapter) once an in-app import flow is needed.
 */
export async function importChaptersPlaceholder(
  _prevState: { status: string; message: string },
  _formData: FormData
) {
  await requireRole(["admin"]);
  return {
    status: "not_implemented",
    message:
      "In-app chapter import isn't wired up yet. Use the Supabase SQL editor or CLI to load supabase/seed/chapters.csv for now.",
  };
}
