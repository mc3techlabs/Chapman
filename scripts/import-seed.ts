/**
 * Loads supabase/seed/*.csv into a Supabase project in the order documented
 * in supabase/migrations/0004_seed_load_order_notes.sql. Run the SQL
 * migrations first (see README.md), then:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/import-seed.ts
 *
 * Uses the service role key because seeding lookup/reference tables and the
 * chapter master needs to bypass RLS — never expose that key to the browser.
 * Skips reviewer_directory_template.csv, reviewer_assignments_template.csv,
 * and reporting_windows_template.csv: those need real names/emails/dates
 * filled in first (see supabase/docs/README_IMPORT_GUIDE.md).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv, toBool, toInt, toIntOrNull } from "./csv";

const SEED_DIR = join(__dirname, "..", "supabase", "seed");

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey);

function readSeed(fileName: string) {
  return parseCsv(readFileSync(join(SEED_DIR, fileName), "utf-8"));
}

async function upsert(table: string, rows: object[], onConflict: string) {
  if (rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length} rows`);
}

/**
 * rubric_items has no reliable natural key to upsert on — the source
 * spreadsheet reuses criterion_code across genuinely different items in a
 * few spots (see supabase/migrations/0005_drop_rubric_items_code_unique.sql).
 * Replace-all keeps this script safe to re-run instead of duplicating rows.
 */
async function replaceAll(table: string, rows: object[]) {
  const { error: deleteError } = await supabase
    .from(table)
    .delete()
    .not("id", "is", null);
  if (deleteError) throw new Error(`${table} (clear): ${deleteError.message}`);

  if (rows.length === 0) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length} rows`);
}

async function idMapByCode(table: string, codeColumn: string) {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return new Map(
    (data ?? []).map((r: Record<string, unknown>) => [
      r[codeColumn] as string,
      r.id as string,
    ])
  );
}

async function main() {
  console.log("Loading lookup tables...");
  await upsert(
    "chapter_types",
    readSeed("chapter_types.csv"),
    "code"
  );
  await upsert(
    "chapter_statuses",
    readSeed("chapter_statuses.csv").map((r) => ({
      ...r,
      sort_order: toInt(r.sort_order),
      is_active: toBool(r.is_active),
    })),
    "code"
  );
  await upsert(
    "app_roles",
    readSeed("app_roles.csv").map((r) => ({ ...r, sort_order: toInt(r.sort_order) })),
    "code"
  );
  await upsert(
    "report_terms",
    readSeed("report_terms.csv").map((r) => ({ ...r, sort_order: toInt(r.sort_order) })),
    "code"
  );
  await upsert(
    "system_contacts",
    readSeed("system_contacts.csv").map((r) => ({
      ...r,
      is_active: toBool(r.is_active),
    })),
    "contact_key"
  );

  console.log("Loading chapter master...");
  await upsert(
    "chapters",
    readSeed("chapters.csv").map((r) => ({
      ...r,
      is_dechartered: toBool(r.is_dechartered),
    })),
    "chapter_key"
  );

  console.log("Loading rubric structure...");
  await upsert(
    "rubric_versions",
    readSeed("rubric_versions.csv").map((r) => ({
      ...r,
      reporting_year: toIntOrNull(r.reporting_year),
      is_active: toBool(r.is_active),
    })),
    "version_code"
  );
  const versionIdByCode = await idMapByCode("rubric_versions", "version_code");

  const sectionRows = readSeed("rubric_sections.csv").map((r) => ({
    rubric_version_id: versionIdByCode.get(r.rubric_version_code),
    section_code: r.section_code,
    section_name: r.section_name,
    display_order: toInt(r.display_order),
    active: toBool(r.active),
  }));
  await upsert("rubric_sections", sectionRows, "rubric_version_id,section_code");

  const { data: sectionRowsWithIds } = await supabase
    .from("rubric_sections")
    .select("id, rubric_version_id, section_code");
  const sectionIdByKey = new Map(
    (
      sectionRowsWithIds as
        | { id: string; rubric_version_id: string; section_code: string }[]
        | null
        ?? []
    ).map((r) => [`${r.rubric_version_id}::${r.section_code}`, r.id])
  );

  const subsectionRows = readSeed("rubric_subsections.csv").map((r) => {
    const versionId = versionIdByCode.get(r.rubric_version_code);
    return {
      rubric_section_id: sectionIdByKey.get(`${versionId}::${r.section_code}`),
      subsection_code: r.subsection_code,
      subsection_name: r.subsection_name,
      display_order: toInt(r.display_order),
      active: toBool(r.active),
    };
  });
  await upsert(
    "rubric_subsections",
    subsectionRows,
    "rubric_section_id,subsection_code"
  );

  const { data: subsectionRowsWithIds } = await supabase
    .from("rubric_subsections")
    .select("id, rubric_section_id, subsection_code");
  const subsectionIdByKey = new Map(
    (
      subsectionRowsWithIds as
        | { id: string; rubric_section_id: string; subsection_code: string }[]
        | null
        ?? []
    ).map((r) => [`${r.rubric_section_id}::${r.subsection_code}`, r.id])
  );

  const itemRows = readSeed("rubric_items.csv").map((r) => {
    const versionId = versionIdByCode.get(r.rubric_version_code);
    const sectionId = sectionIdByKey.get(`${versionId}::${r.section_code}`);
    const subsectionId = subsectionIdByKey.get(`${sectionId}::${r.subsection_code}`);
    return {
      rubric_version_id: versionId,
      rubric_section_id: sectionId,
      rubric_subsection_id: subsectionId,
      criterion_code: r.criterion_code,
      criterion_text: r.criterion_text,
      item_type: r.item_type,
      is_required: toBool(r.is_required),
      default_point_value: toInt(r.default_point_value, 1),
      display_order: toInt(r.display_order),
      active: toBool(r.active),
    };
  });
  await replaceAll("rubric_items", itemRows);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
