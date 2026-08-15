"use client";

import { useActionState } from "react";

export interface CsvImportState {
  status: "idle" | "success" | "error";
  message: string;
}

export function CsvImportForm({
  action,
  buttonLabel,
  pendingLabel,
}: {
  action: (
    prevState: CsvImportState,
    formData: FormData
  ) => Promise<CsvImportState>;
  buttonLabel: string;
  pendingLabel: string;
}) {
  const initialState: CsvImportState = { status: "idle", message: "" };
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="file" name="file" accept=".csv" className="text-sm" />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-chapman-gold px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
      >
        {pending ? pendingLabel : buttonLabel}
      </button>
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
