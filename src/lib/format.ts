import type { AnswerCode, RoleCode, TermCode } from "./types";

/** 61.5 -> "61.5%" ; 60 -> "60%" */
export function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const rounded = Math.round(n * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export const ROLE_LABELS: Record<RoleCode, string> = {
  chapter: "Chapter User",
  district_director: "District Director",
  rvp: "Regional Vice President",
  executive_director: "Executive Director",
  admin: "System Admin",
};

export const ROLE_HOME: Record<RoleCode, string> = {
  chapter: "/chapter",
  district_director: "/district",
  rvp: "/region",
  executive_director: "/national",
  admin: "/admin",
};

export const TERM_LABELS: Record<TermCode, string> = {
  fall: "Fall",
  spring: "Spring",
};

export type Tone = "green" | "amber" | "red" | "blue" | "gray" | "gold";

export function workflowTone(status: string): Tone {
  switch (status) {
    case "finalized":
      return "green";
    case "pending_executive":
      return "amber";
    case "returned":
      return "red";
    case "submitted":
      return "blue";
    default:
      return "gray";
  }
}

export function reviewTone(status: string): Tone {
  switch (status) {
    case "approved":
      return "green";
    case "returned":
      return "red";
    default:
      return "amber";
  }
}

export function answerTone(answer: AnswerCode | undefined): Tone {
  switch (answer) {
    case "yes":
      return "green";
    case "no":
      return "red";
    case "na":
      return "amber";
    default:
      return "gray";
  }
}

export const WORKFLOW_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  returned: "Returned",
  pending_executive: "Pending Executive",
  finalized: "Finalized",
};

export const REVIEW_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  returned: "Returned",
};

export function workflowLabel(status: string): string {
  return WORKFLOW_LABELS[status] ?? status;
}

export function reviewLabel(status: string): string {
  return REVIEW_LABELS[status] ?? status;
}

export function chapterIdentity(ch: {
  chapter_name: string;
  chapter_key: string;
  district: string;
  region: string;
}): string {
  return `${ch.chapter_name} (${ch.chapter_key}) — ${ch.district} / ${ch.region}`;
}

/** Truncate long criterion text without cutting mid-word. */
export function clip(text: string, max = 120): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

export function periodLabel(term: TermCode, year: number): string {
  return `${TERM_LABELS[term] ?? term} ${year}`;
}
