import Link from "next/link";
import { signOut } from "@/app/login/actions";
import type { AppRoleCode } from "@/types/database";

interface NavItem {
  href: string;
  label: string;
}

const NAV_BY_ROLE: Record<AppRoleCode, NavItem[]> = {
  chapter: [
    { href: "/chapter", label: "Dashboard" },
    { href: "/chapter/submission", label: "Submission Workspace" },
  ],
  district_director: [
    { href: "/district", label: "District Dashboard" },
    { href: "/district/review", label: "Review Queue" },
  ],
  rvp: [
    { href: "/region", label: "Regional Dashboard" },
    { href: "/region/review", label: "Review Queue" },
  ],
  executive_director: [
    { href: "/national", label: "National Dashboard" },
    { href: "/national/approvals", label: "Final Approval Queue" },
  ],
  admin: [
    { href: "/admin", label: "Admin Home" },
    { href: "/admin/chapters", label: "Chapter Import" },
    { href: "/admin/reviewers", label: "Reviewer Assignment" },
    { href: "/admin/rubrics", label: "Rubric Management" },
  ],
};

const ROLE_LABEL: Record<AppRoleCode, string> = {
  chapter: "Chapter",
  district_director: "District Director",
  rvp: "Regional Vice President",
  executive_director: "Executive Director",
  admin: "Administrator",
};

export function Sidebar({
  role,
  fullName,
}: {
  role: AppRoleCode;
  fullName: string | null;
}) {
  const items = NAV_BY_ROLE[role];

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-chapman-sidebar p-6 text-white">
      <div className="mb-8 text-center">
        <div className="text-lg font-extrabold leading-tight">
          Chapman Reporting Portal
        </div>
        <div className="mt-1.5 text-xs font-semibold text-chapman-gold">
          Alpha Phi Alpha Fraternity, Inc.
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/10 hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-8 border-t border-white/10 pt-4 text-xs text-gray-400">
        <div className="mb-1 font-semibold text-gray-200">
          {fullName ?? "Signed in"}
        </div>
        <div className="mb-3">{ROLE_LABEL[role]}</div>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full rounded-lg border border-white/20 px-3 py-1.5 text-left font-medium text-gray-200 transition hover:bg-white/10"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
