"use client";

import { useActionState } from "react";
import { importChaptersPlaceholder } from "./actions";

const initialState = { status: "idle" as const, message: "" };

export function ImportForm() {
  const [state, formAction, pending] = useActionState(
    importChaptersPlaceholder,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        type="file"
        name="file"
        accept=".csv"
        className="text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-chapman-gold px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Uploading…" : "Import Chapters CSV"}
      </button>
      {state.message && (
        <p className="rounded-lg bg-chapman-amber-soft px-3 py-2 text-sm text-[#8a6400]">
          {state.message}
        </p>
      )}
    </form>
  );
}
