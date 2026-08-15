"use client";

import { CsvImportForm } from "@/components/CsvImportForm";
import { importChapters } from "./actions";

export function ImportForm() {
  return (
    <CsvImportForm
      action={importChapters}
      buttonLabel="Import Chapters CSV"
      pendingLabel="Importing…"
    />
  );
}
