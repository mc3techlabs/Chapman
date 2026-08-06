"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type SessionStatus = "checking" | "ready" | "no-session";

export default function SetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setStatus(session ? "ready" : "no-session");
    });

    // The invite link lands here with the session in the URL fragment; the
    // browser client parses it asynchronously, so listen for that too.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setStatus("ready");
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-chapman-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-chapman-line bg-chapman-panel p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-extrabold text-chapman-ink">
            Set Your Password
          </h1>
          <p className="mt-1 text-sm text-chapman-muted">
            Chapman Reporting Portal
          </p>
        </div>

        {status === "checking" && (
          <p className="text-center text-sm text-chapman-muted">
            Verifying your invite link…
          </p>
        )}

        {status === "no-session" && (
          <p className="rounded-lg bg-chapman-red-soft px-3 py-2 text-sm text-chapman-red">
            This link is invalid or has expired. Ask an admin to send a new
            invite.
          </p>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="password"
                className="text-sm font-semibold text-chapman-ink"
              >
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-chapman-line bg-white px-3 py-2 text-chapman-ink outline-none focus:border-chapman-gold"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="confirmPassword"
                className="text-sm font-semibold text-chapman-ink"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="rounded-lg border border-chapman-line bg-white px-3 py-2 text-chapman-ink outline-none focus:border-chapman-gold"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-chapman-red-soft px-3 py-2 text-sm text-chapman-red">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-lg bg-chapman-gold px-4 py-2 font-bold text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Set password and continue"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
