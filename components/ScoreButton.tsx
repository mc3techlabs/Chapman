"use client";

import { useFormStatus } from "react-dom";

/**
 * Disables + dims itself the instant its form starts submitting (before
 * the network round-trip even resolves), so a click gives immediate
 * feedback instead of feeling unresponsive during the save.
 */
export function ScoreButton({
  colorClass,
  children,
}: {
  colorClass: string;
  children: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${colorClass}`}
    >
      {children}
    </button>
  );
}
