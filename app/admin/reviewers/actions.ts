"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/roles";
import { upsertAssignment } from "@/lib/data/reviewerAssignments";
import { parseCsv } from "@/lib/csv";
import { logAudit } from "@/lib/data/audit";
import type { AppRoleCode } from "@/types/database";

// Reviewer-directory bulk import is for named DD/RVP/ED/admin accounts —
// "chapter" is a different account model (shared login, no named person)
// and isn't something this CSV should be able to assign.
const REVIEWER_DIRECTORY_ROLE_CODES: AppRoleCode[] = [
  "district_director",
  "rvp",
  "executive_director",
  "admin",
];

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
  const actorProfile = await requireRole(["admin"]);

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

  // A district is supposed to sit in exactly one region — if that region
  // already has an active RVP, pair them in on the same chapters instead of
  // leaving the RVP column empty until someone notices (a district's DD and
  // its region's RVP being created in either order should both end up fully
  // assigned, not just whichever one happened to be created second). Only
  // trust that assumption when every chapter in this district actually
  // agrees on the region — matchingChapters[0] alone, with no ORDER BY,
  // would otherwise risk pairing on an arbitrary row's region and wrongly
  // handing some of this DD's chapters to the wrong RVP.
  let pairedRvpId: string | null = null;
  if (role === "district_director" && matchingChapters && matchingChapters.length > 0) {
    const districtRegions = new Set(matchingChapters.map((c) => c.region));
    if (districtRegions.size === 1) {
      const [districtRegion] = districtRegions;
      const { data: existingRvps } = await admin
        .from("profiles")
        .select("id")
        .eq("role_code", "rvp")
        .eq("region", districtRegion)
        .eq("is_active", true)
        .limit(1);
      pairedRvpId = existingRvps?.[0]?.id ?? null;
    }
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

  await logAudit(admin, {
    actorProfileId: actorProfile.id,
    entityType: "profile",
    entityId: data.user.id,
    action: "reviewer_invited",
    metadata: { role, email, district, region },
  });

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

export interface CsvImportResultState {
  status: "idle" | "success" | "error";
  message: string;
}

/**
 * Bulk version of createReviewerAccount, from a CSV shaped like
 * supabase/seed/reviewer_directory_template.csv (full_name, email,
 * role_code, district, region, is_active). Invites new emails; updates
 * name/role/district/region in place for emails that already have a
 * profile, rather than erroring — the directory is meant to be re-uploaded
 * as it's corrected, not just used once. A row with is_active=false
 * deactivates an existing profile (rather than being silently skipped) but
 * is never used to invite a brand-new one. A row that would change an
 * existing executive_director or admin profile's role is rejected — that's
 * a deliberate, one-at-a-time change, not something a bulk re-upload with a
 * typo'd role_code column should be able to do by accident.
 */
export async function importReviewerDirectory(
  _prevState: CsvImportResultState,
  formData: FormData
): Promise<CsvImportResultState> {
  await requireRole(["admin"]);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a CSV file first." };
  }
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { status: "error", message: "No rows found in that file." };
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

  let invited = 0;
  let updated = 0;
  let deactivated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const line = i + 2;
    const row = rows[i];
    const fullName = (row["full_name"] ?? "").trim();
    const email = (row["email"] ?? "").trim();
    const roleCode = (row["role_code"] ?? "").trim() as AppRoleCode;
    const district = (row["district"] ?? "").trim();
    const region = (row["region"] ?? "").trim();
    const isActive = (row["is_active"] ?? "true").trim().toLowerCase() !== "false";

    if (!fullName || !email) {
      skipped++; // blank template row
      continue;
    }

    const { data: existing } = await admin
      .from("profiles")
      .select("id, role_code")
      .eq("email", email)
      .maybeSingle();

    if (!isActive) {
      if (!existing) {
        skipped++; // nothing to deactivate, and we don't invite an already-inactive account
        continue;
      }
      const { error: deactivateError } = await admin
        .from("profiles")
        .update({ is_active: false })
        .eq("id", existing.id);
      if (deactivateError) {
        errors.push(`Row ${line} (${email}): ${deactivateError.message}`);
        continue;
      }
      deactivated++;
      continue;
    }

    if (!REVIEWER_DIRECTORY_ROLE_CODES.includes(roleCode)) {
      errors.push(`Row ${line} (${email}): invalid role_code "${row["role_code"]}".`);
      continue;
    }

    // Only the field that applies to this role gets set — a stray value in
    // the other column (e.g. a copy-paste leftover in the spreadsheet) must
    // not silently widen this account's RLS scope to a region/district it
    // has no business seeing, the same way createReviewerAccount already
    // guards the single-account form.
    const scopedDistrict = roleCode === "district_director" ? district || null : null;
    const scopedRegion = roleCode === "rvp" ? region || null : null;

    if (existing) {
      if (
        (existing.role_code === "executive_director" || existing.role_code === "admin") &&
        existing.role_code !== roleCode
      ) {
        errors.push(
          `Row ${line} (${email}): refusing to change this account's role from "${existing.role_code}" via bulk import — use the Supabase dashboard for that.`
        );
        continue;
      }
      const { error: updateError } = await admin
        .from("profiles")
        .update({
          full_name: fullName,
          role_code: roleCode,
          district: scopedDistrict,
          region: scopedRegion,
          is_active: true,
        })
        .eq("id", existing.id);
      if (updateError) {
        errors.push(`Row ${line} (${email}): ${updateError.message}`);
        continue;
      }
      updated++;
      continue;
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { role_code: roleCode, full_name: fullName },
      redirectTo: `${siteUrl}/auth/confirm`,
    });
    if (error || !data.user) {
      errors.push(`Row ${line} (${email}): ${error?.message ?? "invite failed"}`);
      continue;
    }
    if (scopedDistrict || scopedRegion) {
      await admin
        .from("profiles")
        .update({ district: scopedDistrict, region: scopedRegion })
        .eq("id", data.user.id);
    }
    invited++;
  }

  revalidatePath("/admin/reviewers");

  const summary = `Invited ${invited}, updated ${updated}${deactivated > 0 ? `, deactivated ${deactivated}` : ""}${skipped > 0 ? `, skipped ${skipped} blank row(s)` : ""}.`;
  if (errors.length > 0) {
    const shown = errors.slice(0, 20);
    const more = errors.length > 20 ? `\n…and ${errors.length - 20} more.` : "";
    return {
      status: invited + updated > 0 ? "success" : "error",
      message: `${summary} ${errors.length} row${errors.length === 1 ? "" : "s"} failed:\n${shown.join("\n")}${more}`,
    };
  }
  return { status: "success", message: summary };
}

/**
 * Bulk assignment from a CSV shaped like
 * supabase/seed/reviewer_assignments_template.csv (chapter_key,
 * chapter_name, district, region, district_director_name,
 * district_director_email, regional_vice_president_name,
 * regional_vice_president_email). Reviewer accounts must already exist —
 * run the directory import first. Only touches the DD/RVP column a row
 * actually has an email for, same partial-upsert behavior as
 * createReviewerAccount's auto-assignment.
 */
export async function importReviewerAssignments(
  _prevState: CsvImportResultState,
  formData: FormData
): Promise<CsvImportResultState> {
  await requireRole(["admin"]);
  const supabase = await createClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a CSV file first." };
  }
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { status: "error", message: "No rows found in that file." };
  }

  let assigned = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const line = i + 2;
    const row = rows[i];
    const chapterKey = (row["chapter_key"] ?? "").trim();
    const ddEmail = (row["district_director_email"] ?? "").trim();
    const rvpEmail = (row["regional_vice_president_email"] ?? "").trim();

    if (!chapterKey) {
      errors.push(`Row ${line}: chapter_key is required.`);
      continue;
    }
    if (!ddEmail && !rvpEmail) continue; // template row with nothing filled in yet

    const { data: chapter } = await supabase
      .from("chapters")
      .select("id")
      .eq("chapter_key", chapterKey)
      .maybeSingle();
    if (!chapter) {
      errors.push(`Row ${line}: no chapter with key "${chapterKey}".`);
      continue;
    }

    const update: Record<string, string> = {};

    if (ddEmail) {
      const { data: ddProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", ddEmail)
        .maybeSingle();
      if (!ddProfile) {
        errors.push(
          `Row ${line} (${chapterKey}): no reviewer account for DD email "${ddEmail}" — import the directory first.`
        );
        continue;
      }
      update.district_director_profile_id = ddProfile.id;
    }

    if (rvpEmail) {
      const { data: rvpProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", rvpEmail)
        .maybeSingle();
      if (!rvpProfile) {
        errors.push(
          `Row ${line} (${chapterKey}): no reviewer account for RVP email "${rvpEmail}" — import the directory first.`
        );
        continue;
      }
      update.regional_vice_president_profile_id = rvpProfile.id;
    }

    const { error } = await supabase
      .from("reviewer_assignments")
      .upsert({ chapter_id: chapter.id, ...update }, { onConflict: "chapter_id" });
    if (error) {
      errors.push(`Row ${line} (${chapterKey}): ${error.message}`);
      continue;
    }
    assigned++;
  }

  revalidatePath("/admin/reviewers");

  const summary = `Assigned ${assigned} chapter${assigned === 1 ? "" : "s"}.`;
  if (errors.length > 0) {
    const shown = errors.slice(0, 20);
    const more = errors.length > 20 ? `\n…and ${errors.length - 20} more.` : "";
    return {
      status: assigned > 0 ? "success" : "error",
      message: `${summary} ${errors.length} row${errors.length === 1 ? "" : "s"} failed:\n${shown.join("\n")}${more}`,
    };
  }
  return { status: "success", message: summary };
}
