"use client";

import { useActionState, useState } from "react";
import {
  createAllChapterLogins,
  resetChapterLogin,
  type ChapterCredential,
  type BulkChapterLoginState,
  type ResetChapterLoginState,
} from "@/app/admin/chapters/loginActions";
import type { ChapterLoginStatus } from "@/lib/data/chapterLogins";

const bulkInitialState: BulkChapterLoginState = {
  status: "idle",
  message: "",
  credentials: [],
};

const resetInitialState: ResetChapterLoginState = {
  status: "idle",
  message: "",
  credential: null,
};

function CredentialsTable({ credentials }: { credentials: ChapterCredential[] }) {
  if (credentials.length === 0) return null;
  return (
    <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-chapman-line">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[#faf7ee] text-left">
          <tr>
            <th className="px-3 py-2">Chapter</th>
            <th className="px-3 py-2">Login email</th>
            <th className="px-3 py-2">Password</th>
          </tr>
        </thead>
        <tbody>
          {credentials.map((c) => (
            <tr key={c.chapter_key} className="border-t border-chapman-line">
              <td className="px-3 py-1.5">
                {c.chapter_name} ({c.chapter_key})
              </td>
              <td className="px-3 py-1.5 font-mono">{c.email}</td>
              <td className="px-3 py-1.5 font-mono">{c.password}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateAllButton() {
  const [state, formAction, pending] = useActionState(
    createAllChapterLogins,
    bulkInitialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-chapman-gold px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
        >
          {pending ? "Creating passwords…" : "Create All Passwords"}
        </button>
        <span className="text-xs text-chapman-muted">
          Only creates logins for chapters that don&rsquo;t have one yet.
        </span>
      </div>

      {state.status !== "idle" && (
        <div>
          <p
            className={`whitespace-pre-line rounded-lg px-3 py-2 text-sm ${
              state.status === "success"
                ? "bg-chapman-green-soft text-chapman-green"
                : "bg-chapman-red-soft text-chapman-red"
            }`}
          >
            {state.message}
          </p>
          <CredentialsTable credentials={state.credentials} />
        </div>
      )}
    </form>
  );
}

function ChapterLoginRow({ chapter }: { chapter: ChapterLoginStatus }) {
  const [state, formAction, pending] = useActionState(
    resetChapterLogin,
    resetInitialState
  );

  return (
    <tr className="border-t border-chapman-line align-top">
      <td className="px-4 py-2.5">
        {chapter.chapter_name} ({chapter.chapter_key})
      </td>
      <td className="px-4 py-2.5 font-mono text-xs">
        {state.credential?.email ?? chapter.login_email ?? (
          <span className="text-chapman-muted">No login yet</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <form action={formAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="chapter_id" value={chapter.id} />
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-lg border border-chapman-line px-3 py-1.5 text-xs font-bold text-chapman-ink transition hover:border-chapman-gold disabled:opacity-60"
          >
            {pending
              ? "Working…"
              : chapter.login_email
                ? "Reset Password"
                : "Create Login"}
          </button>
          {state.status === "error" && (
            <span className="text-xs text-chapman-red">{state.message}</span>
          )}
          {state.status === "success" && state.credential && (
            <span className="text-xs text-chapman-green">
              New password: <span className="font-mono">{state.credential.password}</span>{" "}
              — copy it now, it won&rsquo;t be shown again.
            </span>
          )}
        </form>
      </td>
    </tr>
  );
}

export function ChapterLoginsPanel({
  chapters,
}: {
  chapters: ChapterLoginStatus[];
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? chapters.filter(
        (c) =>
          c.chapter_name.toLowerCase().includes(needle) ||
          c.chapter_key.toLowerCase().includes(needle)
      )
    : chapters;
  const withLogin = chapters.filter((c) => c.login_email).length;

  return (
    <div className="flex flex-col gap-4">
      <CreateAllButton />

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-chapman-muted">
            {withLogin} of {chapters.length} chapters have a login
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chapter name or key…"
            className="min-w-[220px] rounded-lg border border-chapman-line px-3 py-2 text-sm outline-none focus:border-chapman-gold"
          />
        </div>
        <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-chapman-line bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#faf7ee] text-left">
              <tr>
                <th className="px-4 py-2.5 font-bold">Chapter</th>
                <th className="px-4 py-2.5 font-bold">Login email</th>
                <th className="px-4 py-2.5 font-bold">Password</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-chapman-muted">
                    No chapters match that search.
                  </td>
                </tr>
              )}
              {filtered.map((chapter) => (
                <ChapterLoginRow key={chapter.id} chapter={chapter} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
