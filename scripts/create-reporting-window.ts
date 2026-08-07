/**
 * Creates (or updates) a reporting window — the Fall/Spring submission
 * period chapters see as "current" in lib/reportingPeriod.ts.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/create-reporting-window.ts \
 *     --term=spring --year=2027 --opens=2027-01-01 --closes=2027-05-01 \
 *     [--code=spring_2027] [--inactive]
 *
 * --term must be one of: fall, spring (matches report_terms.code).
 * --code defaults to "<term>_<year>" and must be unique (upserts on it).
 * --inactive creates the window with is_active=false (won't show as the
 * "current" period until flipped on).
 */
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

const term = flag("term");
const year = flag("year");
const opensOn = flag("opens");
const closesOn = flag("closes");
const code = flag("code");
const inactive = hasFlag("inactive");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TERMS = ["fall", "spring"];

if (
  !term ||
  !VALID_TERMS.includes(term) ||
  !year ||
  !/^\d{4}$/.test(year) ||
  !opensOn ||
  !DATE_RE.test(opensOn) ||
  !closesOn ||
  !DATE_RE.test(closesOn)
) {
  console.error(
    `Usage: --term=<${VALID_TERMS.join("|")}> --year=YYYY --opens=YYYY-MM-DD --closes=YYYY-MM-DD [--code=...] [--inactive]`
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey);

async function main() {
  const windowCode = code ?? `${term}_${year}`;

  const { data, error } = await supabase
    .from("reporting_windows")
    .upsert(
      {
        window_code: windowCode,
        term_code: term,
        reporting_year: Number(year),
        opens_on: opensOn,
        closes_on: closesOn,
        is_active: !inactive,
      },
      { onConflict: "window_code" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  console.log(
    `${data.is_active ? "Active" : "Inactive"} window "${data.window_code}": ` +
      `${data.term_code} ${data.reporting_year}, opens ${data.opens_on}, closes ${data.closes_on}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
