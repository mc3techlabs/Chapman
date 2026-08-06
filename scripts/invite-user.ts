/**
 * Invites a named reviewer or admin account via Supabase Auth. Sends a real
 * invite email; the user sets their own password by clicking the link — this
 * script never handles a password. For chapter shared logins, use the
 * Supabase dashboard (Authentication -> Users -> Invite) or extend this
 * script, since those aren't tied to a person's real inbox.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/invite-user.ts \
 *     --email=someone@example.com --role=admin [--name="Full Name"] \
 *     [--district="Texas"] [--region="Southwestern"]
 *
 * --role must be one of: chapter, district_director, rvp,
 * executive_director, admin (matches app_roles.code). district/region only
 * matter for district_director / rvp — they're what scopes their queues.
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

const email = flag("email");
const role = flag("role");
const fullName = flag("name");
const district = flag("district");
const region = flag("region");

const VALID_ROLES = [
  "chapter",
  "district_director",
  "rvp",
  "executive_director",
  "admin",
];

if (!email || !role || !VALID_ROLES.includes(role)) {
  console.error(
    `Usage: --email=... --role=<${VALID_ROLES.join("|")}> [--name=...] [--district=...] [--region=...]`
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey);

async function main() {
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(
    email!,
    { data: { role_code: role, full_name: fullName ?? "" } }
  );

  if (error || !data.user) {
    throw new Error(error?.message ?? "Invite failed with no error detail.");
  }

  console.log(`Invited ${email} as ${role} (user id ${data.user.id}).`);

  if (district || region) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ district: district ?? null, region: region ?? null })
      .eq("id", data.user.id);
    if (updateError) throw new Error(`profiles update: ${updateError.message}`);
    console.log(`  set district=${district ?? "—"} region=${region ?? "—"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
