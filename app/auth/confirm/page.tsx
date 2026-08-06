"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

function ConfirmInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [supabase] = useState(() => createClient());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  async function handleAccept() {
    if (!tokenHash || !type) {
      setError("This link is missing required information.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    setSubmitting(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    router.push("/auth/set-password");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-chapman-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-chapman-line bg-chapman-panel p-8 text-center shadow-sm">
        <h1 className="mb-1 text-lg font-extrabold text-chapman-ink">
          Accept Your Invite
        </h1>
        <p className="mb-6 text-sm text-chapman-muted">
          Chapman Reporting Portal
        </p>

        {!tokenHash || !type ? (
          <p className="rounded-lg bg-chapman-red-soft px-3 py-2 text-sm text-chapman-red">
            This link is invalid. Ask an admin to send a new invite.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-chapman-ink">
              Click below to confirm this is you and continue to setting your
              password.
            </p>
            <button
              onClick={handleAccept}
              disabled={submitting}
              className="w-full rounded-lg bg-chapman-gold px-4 py-2 font-bold text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {submitting ? "Confirming…" : "Accept invite"}
            </button>
            {error && (
              <p className="mt-4 rounded-lg bg-chapman-red-soft px-3 py-2 text-sm text-chapman-red">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function ConfirmInvitePage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInviteForm />
    </Suspense>
  );
}
