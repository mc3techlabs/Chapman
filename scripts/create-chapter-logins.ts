/**
 * Bulk-creates shared chapter login accounts. Chapters have no email
 * address in the source data (they're a shared account, not a person), so
 * this generates a synthetic login email + a random password per chapter,
 * creates the auth user, links it to the chapter via chapter_user_links,
 * and writes the credentials to a CSV file for you to distribute securely
 * (delete the file once you've handed the credentials off).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/create-chapter-logins.ts \
 *     --count=5
 *   # or target specific chapters by chapter_key:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/create-chapter-logins.ts \
 *     --keys=1,23,45
 *
 * --out sets the output CSV path (default: ./chapter-logins-<timestamp>.csv,
 * gitignored — never commit this file, it contains real passwords).
 * --force recreates the login for a chapter that already has one linked.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script."
  );
  process.exit(1);
}

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

const count = flag("count");
const keysArg = flag("keys");
const outPath = flag("out") ?? `chapter-logins-${Date.now()}.csv`;
const force = hasFlag("force");

if (!count && !keysArg) {
  console.error("Usage: --count=N or --keys=1,23,45 [--out=path.csv] [--force]");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey);

const PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
function generatePassword(length = 16): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join(
    ""
  );
}

function loginEmailFor(chapterKey: string): string {
  // chapman-accounts.internal is a synthetic, non-deliverable domain used
  // only as a unique Auth identifier — these accounts never receive email.
  return `chapter-${chapterKey}@chapman-accounts.internal`;
}

async function main() {
  let query = supabase
    .from("chapters")
    .select("id, chapter_key, chapter_name, district, region")
    .order("chapter_name");

  if (keysArg) {
    query = query.in(
      "chapter_key",
      keysArg.split(",").map((k) => k.trim())
    );
  } else {
    query = query.limit(Number(count));
  }

  const { data: chapters, error } = await query;
  if (error) throw new Error(`chapters: ${error.message}`);
  if (!chapters || chapters.length === 0) {
    console.log("No matching chapters found.");
    return;
  }

  const rows: {
    chapter_key: string;
    chapter_name: string;
    district: string;
    region: string;
    email: string;
    password: string;
  }[] = [];

  for (const chapter of chapters) {
    if (force) {
      const { error: unlinkError } = await supabase
        .from("chapter_user_links")
        .delete()
        .eq("chapter_id", chapter.id);
      if (unlinkError) {
        throw new Error(`unlink ${chapter.chapter_key}: ${unlinkError.message}`);
      }
    } else {
      const { data: existingLink } = await supabase
        .from("chapter_user_links")
        .select("id")
        .eq("chapter_id", chapter.id)
        .maybeSingle();
      if (existingLink) {
        console.log(
          `Skipping ${chapter.chapter_name} (${chapter.chapter_key}) — already has a login. Use --force to recreate.`
        );
        continue;
      }
    }

    const email = loginEmailFor(chapter.chapter_key);
    const password = generatePassword();

    const { data: userData, error: userError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role_code: "chapter",
          full_name: chapter.chapter_name,
        },
      });
    if (userError || !userData.user) {
      throw new Error(
        `createUser ${chapter.chapter_key}: ${userError?.message ?? "unknown error"}`
      );
    }

    const { error: linkError } = await supabase
      .from("chapter_user_links")
      .insert({
        chapter_id: chapter.id,
        profile_id: userData.user.id,
        is_primary: true,
        is_active: true,
      });
    if (linkError) {
      throw new Error(`link ${chapter.chapter_key}: ${linkError.message}`);
    }

    rows.push({
      chapter_key: chapter.chapter_key,
      chapter_name: chapter.chapter_name,
      district: chapter.district,
      region: chapter.region,
      email,
      password,
    });
    console.log(`Created login for ${chapter.chapter_name} (${chapter.chapter_key}).`);
  }

  if (rows.length === 0) {
    console.log("No new logins created.");
    return;
  }

  const header = "chapter_key,chapter_name,district,region,email,password";
  const csv = [
    header,
    ...rows.map((r) =>
      [r.chapter_key, r.chapter_name, r.district, r.region, r.email, r.password]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");

  writeFileSync(outPath, csv, "utf-8");
  console.log(
    `\nWrote ${rows.length} login(s) to ${outPath}. This file has real passwords — ` +
      `distribute it securely and delete it once chapters have their credentials.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
