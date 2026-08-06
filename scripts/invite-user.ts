/**
 * Invites a named reviewer or admin account via Supabase Auth. Sends a real
 * invite email; the user sets their own password on /auth/set-password
 * after clicking the link — this script never handles a password. For
 * chapter shared logins, use the Supabase dashboard (Authentication ->
 * Users -> Add user) or extend this script, since those aren't tied to a
 * person's real inbox.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/invite-user.ts \
 *     --email=someone@example.com --role=admin --app-url=https://your-app.vercel.app \
 *     [--name="Full Name"] [--district="Texas"] [--region="Southwestern"] [--force]
 *
 * --role must be one of: chapter, district_director, rvp,
 * executive_director, admin (matches app_roles.code). district/region only
 * matter for district_director / rvp — they're what scopes their queues.
 * --app-url must also be added to Authentication -> URL Configuration ->
 * Redirect URLs in the Supabase dashboard, or the invite link will fail.
 * --force deletes and recreates the auth user if that email already
 * exists — use it to resend an invite (e.g. after fixing --app-url).
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

const email = flag("email");
const role = flag("role");
const fullName = flag("name");
const district = flag("district");
const region = flag("region");
const appUrl = flag("app-url");
const force = hasFlag("force");

const VALID_ROLES = [
  "chapter",
  "district_director",
  "rvp",
  "executive_director",
  "admin",
];

if (!email || !role || !VALID_ROLES.includes(role) || !appUrl) {
  console.error(
    `Usage: --email=... --role=<${VALID_ROLES.join("|")}> --app-url=https://... ` +
      `[--name=...] [--district=...] [--region=...] [--force]`
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey);

async function findExistingUserId(targetEmail: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const match = data.users.find(
    (u) => u.email?.toLowerCase() === targetEmail.toLowerCase()
  );
  return match?.id ?? null;
}

async function main() {
  if (force) {
    const existingId = await findExistingUserId(email!);
    if (existingId) {
      const { error } = await supabase.auth.admin.deleteUser(existingId);
      if (error) throw new Error(`deleteUser: ${error.message}`);
      console.log(`Deleted existing user ${email} (${existingId}) before re-inviting.`);
    }
  }

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(
    email!,
    {
      data: { role_code: role, full_name: fullName ?? "" },
      redirectTo: `${appUrl}/auth/set-password`,
    }
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
