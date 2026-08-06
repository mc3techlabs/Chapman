import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_HOME } from "@/lib/auth/roles";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role_code")
    .eq("id", user.id)
    .single();

  redirect(profile ? ROLE_HOME[profile.role_code] ?? "/login" : "/login");
}
