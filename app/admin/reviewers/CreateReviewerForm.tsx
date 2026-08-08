"use client";

import { useActionState, useState } from "react";
import { createReviewerAccount, type CreateReviewerState } from "./actions";
import type { AppRoleCode } from "@/types/database";

const initialState: CreateReviewerState = { status: "idle", message: "" };

export function CreateReviewerForm({
  districts,
  regions,
}: {
  districts: string[];
  regions: string[];
}) {
  const [state, formAction, pending] = useActionState(
    createReviewerAccount,
    initialState
  );
  const [role, setRole] = useState<AppRoleCode>("district_director");

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end">
      <div className="flex flex-col gap-1 sm:col-span-1">
        <label className="text-xs font-semibold text-chapman-muted">Full name</label>
        <input
          name="full_name"
          type="text"
          required
          className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-1">
        <label className="text-xs font-semibold text-chapman-muted">Email</label>
        <input
          name="email"
          type="email"
          required
          className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-1">
        <label className="text-xs font-semibold text-chapman-muted">Role</label>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as AppRoleCode)}
          className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
        >
          <option value="district_director">District Director</option>
          <option value="rvp">Regional Vice President</option>
        </select>
      </div>
      {role === "district_director" ? (
        <div className="flex flex-col gap-1 sm:col-span-1">
          <label className="text-xs font-semibold text-chapman-muted">District</label>
          <input
            name="district"
            type="text"
            required
            list="district-options"
            className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
          />
          <datalist id="district-options">
            {districts.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
      ) : (
        <div className="flex flex-col gap-1 sm:col-span-1">
          <label className="text-xs font-semibold text-chapman-muted">Region</label>
          <input
            name="region"
            type="text"
            required
            list="region-options"
            className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
          />
          <datalist id="region-options">
            {regions.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-chapman-gold px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60 sm:col-span-1"
      >
        {pending ? "Sending invite…" : "Invite Reviewer"}
      </button>

      {state.status !== "idle" && (
        <p
          className={`sm:col-span-5 rounded-lg px-3 py-2 text-sm ${
            state.status === "success"
              ? "bg-chapman-green-soft text-chapman-green"
              : "bg-chapman-red-soft text-chapman-red"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
