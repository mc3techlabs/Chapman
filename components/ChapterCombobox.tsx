"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter } from "@/types/domain";

/**
 * Searchable chapter picker for plain <form action={serverAction}> submits:
 * a hidden input carries the actual chapter_id, while the visible text
 * input searches by name/key so picking one out of 879 doesn't mean
 * scrolling a giant <select>.
 */
export function ChapterCombobox({
  chapters,
  name,
}: {
  chapters: Chapter[];
  name: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = chapters.find((c) => c.id === selectedId);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return chapters
      .filter(
        (c) =>
          c.chapter_name.toLowerCase().includes(needle) ||
          c.chapter_key.toLowerCase().includes(needle)
      )
      .slice(0, 25);
  }, [chapters, query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={selectedId} required />
      <input
        type="text"
        value={selected ? `${selected.chapter_name} (${selected.chapter_key})` : query}
        onChange={(e) => {
          setSelectedId("");
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search chapter by name or key…"
        autoComplete="off"
        className="w-full rounded-lg border border-chapman-line px-3 py-2 text-sm outline-none focus:border-chapman-gold"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-chapman-line bg-white shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(c.id);
                  setQuery("");
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-chapman-gold-soft"
              >
                {c.chapter_name} ({c.chapter_key}) — {c.district}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
