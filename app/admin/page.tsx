import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/roles";
import { KpiCard } from "@/components/KpiCard";

export default async function AdminHomePage() {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const [{ count: chapterCount }, { count: decharteredCount }, { count: reviewerCount }] =
    await Promise.all([
      supabase.from("chapters").select("*", { count: "exact", head: true }),
      supabase
        .from("chapters")
        .select("*", { count: "exact", head: true })
        .eq("is_dechartered", true),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .in("role_code", ["district_director", "rvp"]),
    ]);

  const tools = [
    {
      href: "/admin/chapters",
      title: "Chapter Import",
      description: "Import or update the chapter master list.",
    },
    {
      href: "/admin/reviewers",
      title: "Reviewer Assignment",
      description: "Assign District Directors and RVPs to chapters.",
    },
    {
      href: "/admin/rubrics",
      title: "Rubric Management",
      description: "Review Collegiate and Alumni rubric structure.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-extrabold text-chapman-ink">Admin</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Chapters" value={chapterCount ?? 0} />
        <KpiCard label="Dechartered Chapters" value={decharteredCount ?? 0} />
        <KpiCard label="Active Reviewers" value={reviewerCount ?? 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="rounded-xl border border-chapman-line bg-white p-5 transition hover:border-chapman-gold"
          >
            <div className="font-extrabold text-chapman-ink">{tool.title}</div>
            <div className="mt-1 text-sm text-chapman-muted">
              {tool.description}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
