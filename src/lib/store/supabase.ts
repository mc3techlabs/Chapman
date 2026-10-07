import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ApprovalAction,
  AnswerCode,
  Chapter,
  ChapterPage,
  DistrictRollup,
  DocumentRow,
  DocumentType,
  ItemResponse,
  ListChaptersParams,
  NationalRollup,
  OrgUnits,
  Profile,
  RegionRollup,
  ReportingPeriod,
  RoleCode,
  RubricTree,
  SessionUser,
  Submission,
  SubmissionWithChapter,
  TermCode,
} from "../types";
import { attachResponses } from "../scoring";
import type { Store } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DOCUMENTS_BUCKET?: string;
}

/**
 * Builds a Supabase-backed Store.
 *
 * `accessToken` is the user's Supabase access token (from the session cookie).
 * Passing it on every request means all reads/writes run as that user, so the
 * RLS policies in 0002_rls_policies.sql are what actually enforce scoping —
 * the app never relies on its own filtering for security.
 *
 * The optional service-role client (`admin`) is used only for provisioning
 * (creating chapter/reviewer logins, Storage writes) and never for reads the
 * user is not entitled to.
 */
export function createSupabaseStore(
  env: SupabaseEnv,
  accessToken: string | null,
  refreshToken: string | null = null,
  onTokens?: (t: { access_token: string; refresh_token: string }) => void
): Store {
  const makeClient = (token: string | null): SupabaseClient =>
    createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    });

  // Token is mutable: a refresh replaces the client so subsequent queries in the
  // same request run as the refreshed user.
  let client: SupabaseClient = makeClient(accessToken);
  let token: string | null = accessToken;
  let refreshTok: string | null = refreshToken;

  const admin = env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  async function profileAndSession(): Promise<SessionUser | null> {
    // The client is stateless (persistSession: false), so identity must be
    // resolved from the access token explicitly. If it has expired, try the
    // refresh token once; on success the client is rebuilt with the new token,
    // so this same request's data queries stay authenticated.
    let user: { id: string; email?: string | null } | null = null;
    if (token) {
      let res = await client.auth.getUser(token);
      if (res.error && refreshTok) {
        const refreshed = await client.auth.refreshSession({ refresh_token: refreshTok });
        if (!refreshed.error && refreshed.data?.session) {
          token = refreshed.data.session.access_token;
          refreshTok = refreshed.data.session.refresh_token;
          client = makeClient(token);
          onTokens?.({ access_token: token, refresh_token: refreshTok });
          res = await client.auth.getUser(token);
        }
      }
      if (res.error) return null;
      user = res.data?.user ?? null;
    } else {
      const { data } = await client.auth.getUser();
      user = data?.user ?? null;
    }
    if (!user) return null;
    const { data: profile } = await client
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile) return null;
    const { data: links } = await client
      .from("chapter_user_links")
      .select("chapter_id")
      .eq("profile_id", user.id)
      .eq("is_active", true);
    return {
      profileId: user.id,
      email: profile.email ?? user.email ?? "",
      fullName: profile.full_name ?? "",
      role: profile.role_code as RoleCode,
      district: profile.district ?? null,
      region: profile.region ?? null,
      chapterIds: (links ?? []).map((l: any) => l.chapter_id),
    };
  }

  // Resolves the signed-in user's id as the database sees it. Needed for writes
  // (submitted_by, reviewer, audit actor) that must belong to the caller — the
  // client is stateless, so the id comes from the access token, never client
  // session state.
  async function currentUserId(): Promise<string | null> {
    const s = await profileAndSession();
    return s?.profileId ?? null;
  }

  async function buildRubric(versionCode: string): Promise<RubricTree | null> {
    const { data: version } = await client
      .from("rubric_versions")
      .select("*")
      .eq("version_code", versionCode)
      .maybeSingle();
    if (!version) return null;
    const { data: sections } = await client
      .from("rubric_sections")
      .select("*")
      .eq("rubric_version_id", version.id)
      .order("display_order");
    const { data: subsections } = await client
      .from("rubric_subsections")
      .select("*")
      .in("rubric_section_id", (sections ?? []).map((s: any) => s.id))
      .order("display_order");
    const { data: items } = await client
      .from("rubric_items")
      .select("*")
      .eq("rubric_version_id", version.id)
      .eq("active", true)
      .order("display_order");

    const itemsBySub = new Map<string, any[]>();
    for (const it of items ?? []) {
      if (!itemsBySub.has(it.rubric_subsection_id)) itemsBySub.set(it.rubric_subsection_id, []);
      itemsBySub.get(it.rubric_subsection_id)!.push(it);
    }
    const subsBySection = new Map<string, any[]>();
    for (const ss of subsections ?? []) {
      if (!subsBySection.has(ss.rubric_section_id)) subsBySection.set(ss.rubric_section_id, []);
      subsBySection.get(ss.rubric_section_id)!.push({ ...ss, items: itemsBySub.get(ss.id) ?? [] });
    }
    const tree: RubricTree = {
      version: version as any,
      sections: (sections ?? []).map((s: any) => ({
        ...s,
        subsections: subsBySection.get(s.id) ?? [],
      })),
      item_count: (items ?? []).length,
    };
    return tree;
  }

  return {
    async getSession() {
      return profileAndSession();
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data?.session) {
        return { error: "Invalid email or password." };
      }
      // Self-heal a missing profile row — e.g. an account created before the
      // schema was applied. Must run as the *signed-in* user (the helper is
      // SECURITY DEFINER and reads auth.uid()), so use a client carrying the new
      // token. Best-effort: ignored on a project without the helper.
      try {
        const authed = makeClient(data.session.access_token);
        await authed.rpc("ensure_profile");
      } catch {
        /* older project without the helper — ignore */
      }
      // Return the tokens so the caller can set the session cookie. The Supabase
      // client here is stateless, so nothing stays authenticated without them.
      return {
        tokens: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
      };
    },

    async signOut() {
      await client.auth.signOut();
    },

    async getCurrentPeriod(): Promise<ReportingPeriod> {
      const { data: window } = await client
        .from("reporting_windows")
        .select("term_code, reporting_year")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (window?.reporting_year) {
        return {
          termCode: window.term_code as TermCode,
          reportingYear: window.reporting_year,
        };
      }
      const now = new Date();
      return {
        termCode: now.getMonth() < 6 ? "spring" : "fall",
        reportingYear: now.getFullYear(),
      };
    },

    async listChapters(params: ListChaptersParams): Promise<ChapterPage> {
      const offset = params.offset ?? 0;
      const limit = params.limit ?? 25;
      let query = client.from("chapters").select("*", { count: "exact" });
      if (params.search) {
        const q = params.search;
        query = query.or(
          `chapter_name.ilike.%${q}%,chapter_key.ilike.%${q}%,university.ilike.%${q}%`
        );
      }
      if (params.district) query = query.eq("district", params.district);
      if (params.region) query = query.eq("region", params.region);
      if (params.type) query = query.eq("chapter_type_code", params.type);
      if (params.status) query = query.eq("status_code", params.status);
      // Dechartered chapters are hidden by default for every role.
      query = query.eq("is_dechartered", false);
      const { data, count } = await query
        .order("chapter_name")
        .range(offset, offset + limit - 1);
      return { rows: (data ?? []) as Chapter[], total: count ?? 0 };
    },

    async getChapter(id) {
      const { data } = await client.from("chapters").select("*").eq("id", id).maybeSingle();
      return (data as Chapter) ?? null;
    },

    async getChaptersByIds(ids) {
      if (!ids.length) return [];
      const { data } = await client.from("chapters").select("*").in("id", ids);
      return (data ?? []) as Chapter[];
    },

    async getReviewerAssignment(chapterId) {
      const empty = { districtDirector: null, regionalVp: null };
      const { data: ra } = await client
        .from("reviewer_assignments")
        .select("district_director_profile_id, regional_vice_president_profile_id")
        .eq("chapter_id", chapterId)
        .maybeSingle();
      if (!ra) return empty;
      const ddId = (ra as any).district_director_profile_id as string | null;
      const rvpId = (ra as any).regional_vice_president_profile_id as string | null;
      const ids = [ddId, rvpId].filter((id): id is string => !!id);
      if (ids.length === 0) return empty;
      const { data: profiles } = await client
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      return {
        districtDirector: ddId ? (byId.get(ddId) ?? null) : null,
        regionalVp: rvpId ? (byId.get(rvpId) ?? null) : null,
      };
    },

    async upsertChapters(rows) {
      const errors: string[] = [];
      const clean = rows.filter((r) => {
        if (!r.chapter_key || !r.chapter_name || !r.chapter_type_code) {
          errors.push(`Row skipped (missing key/name/type): ${JSON.stringify(r)}`);
          return false;
        }
        if (!r.district || !r.region) {
          errors.push(`Row ${r.chapter_key} missing district/region — flagged for review`);
          return false;
        }
        return true;
      });
      if (!clean.length) return { inserted: 0, updated: 0, errors };
      const { error } = await client
        .from("chapters")
        .upsert(clean, { onConflict: "chapter_key" });
      if (error) errors.push(error.message);
      return { inserted: clean.length, updated: 0, errors };
    },

    async getRubricForType(chapterTypeCode) {
      const { data: version } = await client
        .from("rubric_versions")
        .select("version_code")
        .eq("chapter_type_code", chapterTypeCode)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!version) return null;
      return buildRubric(version.version_code);
    },

    async getOrCreateSubmission(chapterId, period) {
      const { data: existing } = await client
        .from("submissions")
        .select("*")
        .eq("chapter_id", chapterId)
        .eq("term_code", period.termCode)
        .eq("reporting_year", period.reportingYear)
        .maybeSingle();
      if (existing) return existing as Submission;

      const chapter = await this.getChapter(chapterId);
      if (!chapter) throw new Error("Chapter not found");
      const tree = await this.getRubricForType(chapter.chapter_type_code);
      if (!tree) throw new Error("No active rubric for chapter type");
      const maxScore = tree.sections.reduce(
        (n, s) => n + s.subsections.reduce((m, ss) => m + ss.items.reduce((k, i) => k + i.default_point_value, 0), 0),
        0
      );
      const { data, error } = await client
        .from("submissions")
        .insert({
          chapter_id: chapterId,
          rubric_version_id: tree.version.id,
          term_code: period.termCode,
          reporting_year: period.reportingYear,
          max_score: maxScore,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Submission;
    },

    async getSubmission(id) {
      const { data } = await client.from("submissions").select("*").eq("id", id).maybeSingle();
      return (data as Submission) ?? null;
    },

    async getSubmissionDetail(id) {
      const { data: submission } = await client
        .from("submissions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!submission) return null;
      const chapter = await this.getChapter((submission as any).chapter_id);
      if (!chapter) return null;
      const { data: version } = await client
        .from("rubric_versions")
        .select("version_code")
        .eq("id", (submission as any).rubric_version_id)
        .maybeSingle();
      if (!version) return null;
      const tree = await buildRubric(version.version_code);
      if (!tree) return null;
      const { data: responses } = await client
        .from("submission_item_responses")
        .select("*")
        .eq("submission_id", id);
      return {
        submission: { ...(submission as Submission), chapter },
        rubric: attachResponses(tree, (responses ?? []) as ItemResponse[]),
      };
    },

    async listSubmissionsForChapter(chapterId) {
      const { data } = await client
        .from("submissions")
        .select("*")
        .eq("chapter_id", chapterId)
        .order("reporting_year", { ascending: false });
      return (data ?? []) as Submission[];
    },

    async setResponse(submissionId, rubricItemId, answer) {
      const { data: item } = await client
        .from("rubric_items")
        .select("*")
        .eq("id", rubricItemId)
        .maybeSingle();
      if (!item) return;
      const base = (item as any).default_point_value ?? 1;
      const isRequired = (item as any).is_required ?? false;
      const penalty = (item as any).mandatory_penalty ?? 0;
      const awarded =
        answer === "no" ? (isRequired ? penalty : 0) : base;
      await client.from("submission_item_responses").upsert(
        {
          submission_id: submissionId,
          rubric_item_id: rubricItemId,
          answer_code: answer,
          awarded_points: awarded,
        },
        { onConflict: "submission_id,rubric_item_id" }
      );
      await recalc(client, submissionId);
    },

    async submitReport(submissionId) {
      const actorId = await currentUserId();
      await client
        .from("submissions")
        .update({
          workflow_status: "submitted",
          district_review_status: "pending",
          regional_review_status: "pending",
          executive_review_status: "pending",
          submitted_at: new Date().toISOString(),
          submitted_by_profile_id: actorId,
        })
        .eq("id", submissionId);
      await logAction(client, submissionId, "submitted", {}, actorId);
    },

    async withdrawSubmission(submissionId) {
      const actorId = await currentUserId();
      await client.from("submissions").update({ workflow_status: "draft" }).eq("id", submissionId);
      await logAction(client, submissionId, "withdrawn", {}, actorId);
    },

    async listReviewQueue(role, period) {
      let query = client
        .from("submissions")
        .select("*, chapter:chapters(*)")
        .eq("term_code", period.termCode)
        .eq("reporting_year", period.reportingYear);
      if (role === "executive_director") {
        query = query
          .eq("district_review_status", "approved")
          .eq("regional_review_status", "approved")
          .in("workflow_status", ["pending_executive", "finalized"]);
      } else {
        query = query.in("workflow_status", ["submitted", "returned", "pending_executive", "finalized"]);
      }
      const { data } = await query.order("updated_at", { ascending: false });
      return (data ?? []).map((r: any) => ({
        ...r,
        chapter: r.chapter,
      })) as SubmissionWithChapter[];
    },

    async listVisibleSubmissions(period) {
      const { data } = await client
        .from("submissions")
        .select("*, chapter:chapters(*)")
        .eq("term_code", period.termCode)
        .eq("reporting_year", period.reportingYear)
        .order("updated_at", { ascending: false });
      return (data ?? []) as SubmissionWithChapter[];
    },

    async approve(submissionId, role, comment) {
      const { data: sub } = await client
        .from("submissions")
        .select("*")
        .eq("id", submissionId)
        .maybeSingle();
      if (!sub) return;
      const s: any = sub;
      const patch: any = {};
      if (role === "district_director") patch.district_review_status = "approved";
      if (role === "rvp") patch.regional_review_status = "approved";
      const nextDistrict = role === "district_director" ? "approved" : s.district_review_status;
      const nextRegional = role === "rvp" ? "approved" : s.regional_review_status;

      if (role === "executive_director") {
        // Server-side gate: executive may only finalize once both lanes approved.
        if (!(nextDistrict === "approved" && nextRegional === "approved")) {
          throw new Error("Both district and regional approvals are required before final approval.");
        }
        patch.executive_review_status = "approved";
        patch.workflow_status = "finalized";
      } else if (nextDistrict === "approved" && nextRegional === "approved") {
        patch.workflow_status = "pending_executive";
      }
      await client.from("submissions").update(patch).eq("id", submissionId);
      await recordApproval(client, submissionId, role, "approved", comment, await currentUserId());
    },

    async returnSubmission(submissionId, role, comment) {
      const patch: any = { workflow_status: "returned" };
      if (role === "district_director") patch.district_review_status = "returned";
      if (role === "rvp") patch.regional_review_status = "returned";
      await client.from("submissions").update(patch).eq("id", submissionId);
      await recordApproval(client, submissionId, role, "returned", comment, await currentUserId());
    },

    async reopenSubmission(submissionId, comment) {
      await client
        .from("submissions")
        .update({
          workflow_status: "returned",
          district_review_status: "pending",
          regional_review_status: "pending",
          executive_review_status: "pending",
        })
        .eq("id", submissionId);
      await logAction(client, submissionId, "reopened", { comment: comment ?? null }, await currentUserId());
    },

    async listApprovalActions(submissionId) {
      const { data } = await client
        .from("approval_actions")
        .select("*")
        .eq("submission_id", submissionId)
        .order("action_at", { ascending: true });
      return (data ?? []) as ApprovalAction[];
    },

    async getDistrictRollups(period) {
      const { data } = await client
        .from("v_district_rollup")
        .select("*")
        .eq("term_code", period.termCode)
        .eq("reporting_year", period.reportingYear)
        .order("district");
      return (data ?? []) as DistrictRollup[];
    },

    async getRegionRollups(period) {
      const { data } = await client
        .from("v_region_rollup")
        .select("*")
        .eq("term_code", period.termCode)
        .eq("reporting_year", period.reportingYear)
        .order("region");
      return (data ?? []) as RegionRollup[];
    },

    async getNationalRollup(period) {
      const { data } = await client
        .from("v_national_rollup")
        .select("*")
        .eq("term_code", period.termCode)
        .eq("reporting_year", period.reportingYear)
        .maybeSingle();
      return (data as NationalRollup) ?? null;
    },

    async getReportingTerms() {
      const { data } = await client.from("v_reporting_terms").select("*");
      return (data ?? []).map((r: any) => ({
        termCode: r.term_code as TermCode,
        reportingYear: r.reporting_year as number,
      }));
    },

    async listDocumentTypes() {
      const { data } = await client
        .from("document_types")
        .select("*")
        .eq("is_active", true)
        .order("display_order");
      return (data ?? []) as DocumentType[];
    },

    async listDocuments(params) {
      let query = client.from("documents").select("*").order("created_at", { ascending: false });
      if (params.chapterId) query = query.eq("chapter_id", params.chapterId);
      if (params.category) {
        const { data: types } = await client
          .from("document_types")
          .select("code")
          .eq("category", params.category);
        query = query.in("document_type_code", (types ?? []).map((t: any) => t.code));
      }
      const { data } = await query.limit(params.limit ?? 100);
      return (data ?? []) as DocumentRow[];
    },

    async createDocument(input) {
      const { data, error } = await client
        .from("documents")
        .insert({
          chapter_id: input.chapterId,
          document_type_code: input.documentTypeCode,
          storage_path: input.storagePath,
          file_name: input.fileName,
          content_type: input.contentType,
          size_bytes: input.sizeBytes,
          term_code: input.termCode ?? null,
          reporting_year: input.reportingYear ?? null,
          notes: input.notes ?? null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as DocumentRow;
    },

    async listProfilesByRole(role) {
      const source: SupabaseClient = admin ?? client;
      const { data } = await source
        .from("profiles")
        .select("*")
        .eq("role_code", role)
        .order("full_name");
      return (data ?? []) as Profile[];
    },

    async listOrgUnits(): Promise<OrgUnits> {
      // regions/districts are admin-write, authenticated-read reference tables;
      // `client` carries the caller's token so this is a normal user read.
      const [regions, districts] = await Promise.all([
        client.from("regions").select("code, name, sort_order").order("sort_order"),
        client.from("districts").select("code, name, region_code").order("name"),
      ]);
      return {
        regions: (regions.data ?? []) as any,
        districts: (districts.data ?? []) as any,
      };
    },
  };
}

/** Recomputes submission totals from stored responses (never trusts client). */
async function recalc(client: SupabaseClient, submissionId: string) {
  const { data: sub } = await client
    .from("submissions")
    .select("rubric_version_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return;
  const { data: items } = await client
    .from("rubric_items")
    .select("id, default_point_value")
    .eq("rubric_version_id", (sub as any).rubric_version_id)
    .eq("active", true);
  const { data: responses } = await client
    .from("submission_item_responses")
    .select("rubric_item_id, awarded_points")
    .eq("submission_id", submissionId);
  const maxMap = new Map((items ?? []).map((i: any) => [i.id, i.default_point_value ?? 1]));
  let finalScore = 0;
  let maxScore = 0;
  for (const [, v] of maxMap) maxScore += v as number;
  for (const r of responses ?? []) finalScore += (r as any).awarded_points ?? 0;
  await client
    .from("submissions")
    .update({ final_score: finalScore, max_score: maxScore })
    .eq("id", submissionId);
}

async function recordApproval(
  client: SupabaseClient,
  submissionId: string,
  role: string,
  action: "approved" | "returned" | "reopened",
  comment: string | undefined,
  actorId: string | null
) {
  if (!actorId) return;
  await client.from("approval_actions").insert({
    submission_id: submissionId,
    reviewer_profile_id: actorId,
    reviewer_role_code: role,
    action,
    action_comment: comment ?? null,
  });
}

async function logAction(
  client: SupabaseClient,
  entityId: string,
  action: string,
  metadata: Record<string, unknown>,
  actorId: string | null
) {
  await client.from("audit_log").insert({
    actor_profile_id: actorId,
    entity_type: "submission",
    entity_id: entityId,
    action,
    metadata_json: metadata,
  });
}
