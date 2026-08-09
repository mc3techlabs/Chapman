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

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error
          ? err.message
          : "SUPABASE_SERVICE_ROLE_KEY is not configured for this deployment.",
    };
  }

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

  // Auto-assign this reviewer to every chapter in their district/region —
  // a DD/RVP covers their whole district/region, not one chapter at a time.
  // Upserting only the relevant column (not the other reviewer's) so an
  // existing DD/RVP assignment on a chapter isn't clobbered.
  const scopeColumn = role === "district_director" ? "district" : "region";
  const scopeValue = role === "district_director" ? district : region;

  const { data: matchingChapters, error: chaptersError } = await admin
    .from("chapters")
    .select("id, region")
    .eq(scopeColumn, scopeValue);

  if (chaptersError) {
    return {
      status: "error",
      message: `Invite sent, but failed to look up chapters for auto-assignment: ${chaptersError.message}`,
    };
  }

  // A district sits in exactly one region — if that region already has an
  // active RVP, pair them in on the same chapters instead of leaving the
  // RVP column empty until someone notices (a district's DD and its
  // region's RVP being created in either order should both end up fully
  // assigned, not just whichever one happened to be created second).
  let pairedRvpId: string | null = null;
  if (role === "district_director" && matchingChapters && matchingChapters.length > 0) {
    const districtRegion = matchingChapters[0].region;
    const { data: existingRvps } = await admin
      .from("profiles")
      .select("id")
      .eq("role_code", "rvp")
      .eq("region", districtRegion)
      .eq("is_active", true)
      .limit(1);
    pairedRvpId = existingRvps?.[0]?.id ?? null;
  }

  if (matchingChapters && matchingChapters.length > 0) {
    const assignmentRows = matchingChapters.map((c) =>
      role === "district_director"
        ? {
            chapter_id: c.id,
            district_director_profile_id: data.user.id,
            ...(pairedRvpId
              ? { regional_vice_president_profile_id: pairedRvpId }
              : {}),
          }
        : { chapter_id: c.id, regional_vice_president_profile_id: data.user.id }
    );
    const { error: assignError } = await admin
      .from("reviewer_assignments")
      .upsert(assignmentRows, { onConflict: "chapter_id" });
    if (assignError) {
      return {
        status: "error",
        message: `Invite sent, but failed to auto-assign chapters: ${assignError.message}`,
      };
    }
  }

  revalidatePath("/admin/reviewers");
  const chapterCount = matchingChapters?.length ?? 0;
  return {
    status: "success",
    message:
      `Invited ${fullName} (${email}) as ${role === "district_director" ? "District Director" : "RVP"}` +
      (chapterCount > 0
        ? ` — auto-assigned to ${chapterCount} chapter${chapterCount === 1 ? "" : "s"}` +
          (pairedRvpId ? " (paired with the existing RVP for that region)." : ".")
        : "."),
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
