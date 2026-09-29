"use client";

import { useActionState } from "react";
import { importTaxCompliance, type TaxImportState } from "@/app/admin/chapters/taxComplianceActions";

const initialState: TaxImportState = { status: "idle", message: "" };

export function TaxComplianceImportForm({
  defaultTerm,
  defaultYear,
}: {
  defaultTerm: "fall" | "spring";
  defaultYear: number;
}) {
  const [state, formAction, pending] = useActionState(importTaxCompliance, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-chapman-muted">Term</label>
          <select
            name="term_code"
            defaultValue={defaultTerm}
            className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
          >
            <option value="fall">Fall</option>
            <option value="spring">Spring</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-chapman-muted">Year</label>
          <input
            name="reporting_year"
            type="number"
            defaultValue={defaultYear}
            required
            className="w-24 rounded-lg border border-chapman-line px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-chapman-muted">
            AlphaMX renewal billing export (.xlsx)
          </label>
          <input type="file" name="file" accept=".xlsx" className="text-sm" />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-chapman-gold px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
        >
          {pending ? "Importing…" : "Import Tax Compliance"}
        </button>
      </div>

      {state.message && (
        <p
          className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
            state.status === "error"
              ? "bg-chapman-red-soft text-chapman-red"
              : "bg-chapman-green-soft text-chapman-green"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
