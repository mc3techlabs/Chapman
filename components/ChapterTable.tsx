"use client";

import { useMemo, useState } from "react";
import type { Chapter } from "@/types/domain";

type SortKey =
  | "chapter_key"
  | "chapter_name"
  | "chapter_type_code"
  | "district"
  | "region"
  | "status_code";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "chapter_key", label: "Key" },
  { key: "chapter_name", label: "Name" },
  { key: "chapter_type_code", label: "Type" },
  { key: "district", label: "District" },
  { key: "region", label: "Region" },
  { key: "status_code", label: "Status" },
];

export function ChapterTable({ chapters }: { chapters: Chapter[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("chapter_name");
  const [sortAsc, setSortAsc] = useState(true);

  const statuses = useMemo(
    () => Array.from(new Set(chapters.map((c) => c.status_code))).sort(),
    [chapters]
  );
  const regions = useMemo(
    () => Array.from(new Set(chapters.map((c) => c.region))).sort(),
    [chapters]
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((asc) => !asc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return chapters
      .filter((c) => {
        if (statusFilter !== "all" && c.status_code !== statusFilter) return false;
        if (typeFilter !== "all" && c.chapter_type_code !== typeFilter) return false;
        if (regionFilter !== "all" && c.region !== regionFilter) return false;
        if (!needle) return true;
        return (
          c.chapter_name.toLowerCase().includes(needle) ||
          c.chapter_key.toLowerCase().includes(needle) ||
          (c.university ?? "").toLowerCase().includes(needle) ||
          c.district.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const av = String(a[sortKey] ?? "");
        const bv = String(b[sortKey] ?? "");
        const cmp =
          sortKey === "chapter_key"
            ? Number(av) - Number(bv) || av.localeCompare(bv)
            : av.localeCompare(bv);
        return sortAsc ? cmp : -cmp;
      });
  }, [chapters, search, statusFilter, typeFilter, regionFilter, sortKey, sortAsc]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, key, university, district…"
          className="min-w-[220px] flex-1 rounded-lg border border-chapman-line px-3 py-2 text-sm outline-none focus:border-chapman-gold"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
        >
          <option value="all">All types</option>
          <option value="collegiate">Collegiate</option>
          <option value="alumni">Alumni</option>
        </select>
        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
          className="rounded-lg border border-chapman-line px-3 py-2 text-sm"
        >
          <option value="all">All regions</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs text-chapman-muted">
        Showing {filtered.length} of {chapters.length} chapters
      </div>

      <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-chapman-line bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#faf7ee] text-left">
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="flex items-center gap-1 font-bold hover:text-chapman-gold"
                  >
                    {col.label}
                    {sortKey === col.key && <span>{sortAsc ? "▲" : "▼"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-4 text-chapman-muted">
                  No chapters match these filters.
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-chapman-line">
                <td className="px-4 py-2.5">{c.chapter_key}</td>
                <td className="px-4 py-2.5">{c.chapter_name}</td>
                <td className="px-4 py-2.5 capitalize">{c.chapter_type_code}</td>
                <td className="px-4 py-2.5">{c.district}</td>
                <td className="px-4 py-2.5">{c.region}</td>
                <td className="px-4 py-2.5">
                  {c.status_code}
                  {c.is_dechartered && (
                    <span className="ml-1.5 text-xs font-bold text-chapman-red">
                      Dechartered
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
