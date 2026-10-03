/**
 * Loads the seed CSVs in supabase/seed/ into the attached Supabase project via
 * the service-role key (bypasses RLS — this is a setup task).
 *
 * Load order matters: lookups → geography → rubric versions → sections →
 * subsections → items → chapters → document types.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *     npm run db:seed
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(here, "../supabase/seed");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Usage: SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> npm run db:seed"
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function readCsv(name: string): Record<string, string>[] {
  const text = readFileSync(resolve(seedDir, name), "utf8");
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const toBool = (v: string | undefined) => v === "true" || v === "1";
const toInt = (v: string | undefined, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

async function upsert(table: string, rows: Record<string, unknown>[], onConflict?: string) {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await db.from(table).upsert(slice, onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`  ${table}: ${rows.length} row(s)`);
}

console.log("Loading seed data…");

// 1. Lookups
await upsert(
  "chapter_types",
  readCsv("chapter_types.csv").map((r) => ({ code: r.code, label: r.label })),
  "code"
);
await upsert(
  "chapter_statuses",
  readCsv("chapter_statuses.csv").map((r) => ({
    code: r.code,
    label: r.label,
    sort_order: toInt(r.sort_order),
    is_active: toBool(r.is_active),
  })),
  "code"
);
await upsert(
  "app_roles",
  readCsv("app_roles.csv").map((r) => ({
    code: r.code,
    label: r.label,
    sort_order: toInt(r.sort_order),
  })),
  "code"
);
await upsert(
  "report_terms",
  readCsv("report_terms.csv").map((r) => ({
    code: r.code,
    label: r.label,
    sort_order: toInt(r.sort_order),
  })),
  "code"
);

// 2. Geography
await upsert(
  "regions",
  readCsv("regions.csv").map((r) => ({
    code: r.code,
    name: r.name,
    sort_order: toInt(r.sort_order),
  })),
  "code"
);
await upsert(
  "districts",
  readCsv("districts.csv").map((r) => ({
    code: r.code,
    name: r.name,
    region_code: r.region_code,
  })),
  "code"
);

// 3. Rubric versions → sections → subsections → items
const versions = readCsv("rubric_versions.csv");
await upsert(
  "rubric_versions",
  versions.map((r) => ({
    version_code: r.version_code,
    version_name: r.version_name,
    chapter_type_code: r.chapter_type_code,
    reporting_year: r.reporting_year ? toInt(r.reporting_year) : null,
    is_active: toBool(r.is_active),
  })),
  "version_code"
);

const { data: versionRows } = await db.from("rubric_versions").select("id, version_code");
const versionId = new Map((versionRows ?? []).map((v: any) => [v.version_code, v.id]));

const sections = readCsv("rubric_sections.csv");
await upsert(
  "rubric_sections",
  sections.map((r) => ({
    rubric_version_id: versionId.get(r.rubric_version_code),
    section_code: r.section_code,
    section_name: r.section_name,
    display_order: toInt(r.display_order),
    active: toBool(r.active),
  })),
  "rubric_version_id,section_code"
);

const { data: sectionRows } = await db
  .from("rubric_sections")
  .select("id, section_code, rubric_version_id");
const sectionId = new Map(
  (sectionRows ?? []).map((s: any) => [`${s.rubric_version_id}:${s.section_code}`, s.id])
);

const subsections = readCsv("rubric_subsections.csv");
await upsert(
  "rubric_subsections",
  subsections.map((r) => ({
    rubric_section_id: sectionId.get(
      `${versionId.get(r.rubric_version_code)}:${r.section_code}`
    ),
    subsection_code: r.subsection_code,
    subsection_name: r.subsection_name,
    display_order: toInt(r.display_order),
    active: toBool(r.active),
  })),
  "rubric_section_id,subsection_code"
);

const { data: subRows } = await db
  .from("rubric_subsections")
  .select("id, subsection_code, rubric_section_id");
const subsectionId = new Map(
  (subRows ?? []).map((s: any) => [`${s.rubric_section_id}:${s.subsection_code}`, s.id])
);

const items = readCsv("rubric_items.csv");
await upsert("rubric_items", items.map((r) => ({
  rubric_version_id: versionId.get(r.rubric_version_code),
  rubric_section_id: sectionId.get(`${versionId.get(r.rubric_version_code)}:${r.section_code}`),
  rubric_subsection_id: subsectionId.get(
    `${sectionId.get(`${versionId.get(r.rubric_version_code)}:${r.section_code}`)}:${r.subsection_code}`
  ),
  criterion_code: r.criterion_code,
  criterion_text: r.criterion_text,
  item_type: r.item_type === "metric" ? "metric" : "activity",
  is_required: toBool(r.is_required),
  default_point_value: toInt(r.default_point_value, 1),
  mandatory_penalty: 0,
  display_order: toInt(r.display_order),
  active: toBool(r.active),
})));

// 4. Chapters (skip rows with no district/region — surfaced, not silently lost)
const chapters = readCsv("chapters.csv");
const valid = chapters.filter((r) => r.district && r.region);
const skipped = chapters.length - valid.length;
await upsert(
  "chapters",
  valid.map((r) => ({
    chapter_key: r.chapter_key,
    chapter_name: r.chapter_name,
    chapter_type_code: r.chapter_type_code,
    university: r.university || null,
    district: r.district,
    region: r.region,
    status_code: r.status_code,
    is_dechartered: toBool(r.is_dechartered) || /decharter/i.test(r.status_code),
  })),
  "chapter_key"
);
if (skipped) console.log(`  chapters: skipped ${skipped} row(s) with no district/region`);

// 5. Document types (tax + special event framework)
await upsert(
  "document_types",
  readCsv("document_types.csv").map((r) => ({
    code: r.code,
    label: r.label,
    category: r.category,
    description: r.description || null,
    allowed_extensions: (r.allowed_extensions || "").split(",").map((s) => s.trim()).filter(Boolean),
    max_size_mb: toInt(r.max_size_mb, 25),
    applies_to_types: (r.applies_to_types || "").split(",").map((s) => s.trim()).filter(Boolean),
    is_active: toBool(r.is_active),
    display_order: toInt(r.display_order),
  })),
  "code"
);

console.log("\nSeed complete.");
