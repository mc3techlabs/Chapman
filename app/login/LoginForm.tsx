"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, {
    error: null as string | null,
  });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-semibold text-chapman-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-lg border border-chapman-line bg-white px-3 py-2 text-chapman-ink outline-none focus:border-chapman-gold"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-semibold text-chapman-ink">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-lg border border-chapman-line bg-white px-3 py-2 text-chapman-ink outline-none focus:border-chapman-gold"
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-chapman-red-soft px-3 py-2 text-sm text-chapman-red">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-chapman-gold px-4 py-2 font-bold text-white transition hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
