/**
 * Builds `src/lib/demo/data.json` — a compact, credential-free dataset used by
 * the in-memory store so the whole UI can be previewed before a Supabase
 * project is attached.
 *
 * It reads the SAME seed CSVs that load into Supabase, so the demo mirrors
 * production shape exactly (879-chapter roster is trimmed to a balanced
 * ~60-chapter sample to keep the bundle small; the full 300-item rubric and
 * every lookup are included in full).
 *
 * Run: npm run gen:seed
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const seedDir = resolve(root, "supabase/seed");
const outFile = resolve(root, "src/lib/demo/data.json");

function readCsv(name: string): Record<string, string>[] {
  const text = readFileSync(resolve(seedDir, name), "utf8");
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()!;
  return rows
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---------------------------------------------------------------------------
// Lookups (full)
// ---------------------------------------------------------------------------
const chapterTypes = readCsv("chapter_types.csv");
const chapterStatuses = readCsv("chapter_statuses.csv");
const appRoles = readCsv("app_roles.csv");
const reportTerms = readCsv("report_terms.csv");
const regions = readCsv("regions.csv");
const districts = readCsv("districts.csv");
const documentTypes = readCsv("document_types.csv");

// ---------------------------------------------------------------------------
// Chapters — balanced sample so every region/district/type is represented.
// Full roster still loads into Supabase via the seed script.
// ---------------------------------------------------------------------------
const allChapters = readCsv("chapters.csv");
const byRegion = new Map<string, Record<string, string>[]>();
for (const c of allChapters) {
  const r = c.region?.trim();
  if (!r) continue;
  if (!byRegion.has(r)) byRegion.set(r, []);
  byRegion.get(r)!.push(c);
}
const PER_REGION = 10;
const sampled: Record<string, string>[] = [];
for (const [, list] of byRegion) {
  const active = list.filter((c) => c.status_code === "Active");
  const collegians = active.filter((c) => c.chapter_type_code === "collegiate");
  const alumni = active.filter((c) => c.chapter_type_code === "alumni");
  const take: Record<string, string>[] = [];
  for (let i = 0; take.length < PER_REGION && i < 20; i++) {
    if (collegians[i]) take.push(collegians[i]);
    if (take.length < PER_REGION && alumni[i]) take.push(alumni[i]);
  }
  sampled.push(...take);
}

const chapters = sampled.map((c) => ({
  chapter_key: c.chapter_key,
  chapter_name: c.chapter_name,
  chapter_type_code: c.chapter_type_code,
  university: c.university || null,
  district: c.district,
  region: c.region,
  status_code: c.status_code,
  is_dechartered: c.is_dechartered === "true",
}));

// ---------------------------------------------------------------------------
// Rubric — every section/subsection/item (full fidelity).
// ---------------------------------------------------------------------------
const rubricVersions = readCsv("rubric_versions.csv").map((v) => ({
  version_code: v.version_code,
  version_name: v.version_name,
  chapter_type_code: v.chapter_type_code,
  reporting_year: v.reporting_year ? Number(v.reporting_year) : null,
  is_active: v.is_active === "true",
}));

const sectionsRaw = readCsv("rubric_sections.csv");
const subsRaw = readCsv("rubric_subsections.csv");
const itemsRaw = readCsv("rubric_items.csv");

const rubric = rubricVersions.map((v) => {
  const sections = sectionsRaw
    .filter((s) => s.rubric_version_code === v.version_code)
    .map((s) => ({
      section_code: s.section_code,
      section_name: s.section_name,
      display_order: Number(s.display_order),
      subsections: subsRaw
        .filter((ss) => ss.rubric_version_code === v.version_code && ss.section_code === s.section_code)
        .map((ss) => ({
          subsection_code: ss.subsection_code,
          subsection_name: ss.subsection_name,
          display_order: Number(ss.display_order),
          items: itemsRaw
            .filter(
              (it) =>
                it.rubric_version_code === v.version_code &&
                it.subsection_code === ss.subsection_code &&
                it.section_code === s.section_code
            )
            .map((it) => ({
              criterion_code: it.criterion_code,
              criterion_text: it.criterion_text,
              item_type: it.item_type,
              is_required: it.is_required === "true",
              default_point_value: Number(it.default_point_value) || 1,
              display_order: Number(it.display_order),
            }))
            .sort((a, b) => a.display_order - b.display_order),
        }))
        .sort((a, b) => a.display_order - b.display_order),
    }))
    .sort((a, b) => a.display_order - b.display_order);
  const itemCount = sections.reduce(
    (n, s) => n + s.subsections.reduce((m, ss) => m + ss.items.length, 0),
    0
  );
  return { ...v, sections, item_count: itemCount };
});

const out = {
  generated_from: "supabase/seed/*.csv",
  counts: {
    chapters_total_in_source: allChapters.length,
    chapters_in_sample: chapters.length,
    rubric_items: rubric.reduce((n, v) => n + v.item_count, 0),
  },
  lookups: { chapterTypes, chapterStatuses, appRoles, reportTerms, regions, districts, documentTypes },
  chapters,
  rubric,
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out, null, 0));
console.log(
  `demo seed written: ${chapters.length} chapters, ` +
    `${out.counts.rubric_items} rubric items, ${documentTypes.length} document types -> ${outFile}`
);
