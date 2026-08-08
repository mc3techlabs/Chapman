"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/roles";
import { upsertAssignment } from "@/lib/data/reviewerAssignments";
import type { AppRoleCode } from "@/types/database";

async function currentSiteUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export interface CreateReviewerState {
  status: "idle" | "success" | "error";
  message: string;
}

export async function createReviewerAccount(
  _prevState: CreateReviewerState,
  formData: FormData
): Promise<CreateReviewerState> {
  await requireRole(["admin"]);

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "") as AppRoleCode;
  const district = String(formData.get("district") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();

  if (!fullName || !email) {
    return { status: "error", message: "Name and email are required." };
  }
  if (role !== "district_director" && role !== "rvp") {
    return { status: "error", message: "Invalid role." };
  }
  if (role === "district_director" && !district) {
    return { status: "error", message: "District is required for a District Director." };
  }
  if (role === "rvp" && !region) {
    return { status: "error", message: "Region is required for a Regional Vice President." };
  }

  const admin = createAdminClient();
  const siteUrl = await currentSiteUrl();

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role_code: role, full_name: fullName },
    redirectTo: `${siteUrl}/auth/confirm`,
  });

  if (error || !data.user) {
    return {
      status: "error",
      message: error?.message ?? "Failed to send invite.",
    };
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({
      district: role === "district_director" ? district : null,
      region: role === "rvp" ? region : null,
    })
    .eq("id", data.user.id);

  if (updateError) {
    return {
      status: "error",
      message: `Invite sent, but failed to set district/region: ${updateError.message}`,
    };
  }

  revalidatePath("/admin/reviewers");
  return {
    status: "success",
    message: `Invited ${fullName} (${email}) as ${role === "district_director" ? "District Director" : "RVP"}.`,
  };
}

export async function assignReviewers(formData: FormData) {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const chapterId = String(formData.get("chapter_id") ?? "");
  const districtDirectorId = String(formData.get("district_director_id") ?? "");
  const rvpId = String(formData.get("rvp_id") ?? "");

  if (!chapterId) return;

  await upsertAssignment(supabase, {
    chapter_id: chapterId,
    district_director_profile_id: districtDirectorId || null,
    regional_vice_president_profile_id: rvpId || null,
  });

  revalidatePath("/admin/reviewers");
}
