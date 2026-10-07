import demoData from "../demo/data.json";
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
  Region,
  RegionRollup,
  ReportingPeriod,
  RoleCode,
  RubricItem,
  RubricTree,
  RubricTreeWithResponses,
  SessionUser,
  Submission,
  SubmissionWithChapter,
  TermCode,
  WorkflowStatus,
} from "../types";
import { attachResponses, computeTotals, pointsFor } from "../scoring";
import type { Store } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = demoData as any;

const CURRENT_YEAR = new Date().getFullYear();
const PERIOD: ReportingPeriod = {
  termCode: new Date().getMonth() < 6 ? "spring" : "fall",
  reportingYear: CURRENT_YEAR,
};

// ---------------------------------------------------------------------------
// Static data (built once at module load — a demo, so process-lifetime state
// is acceptable; there's no persistence to violate).
// ---------------------------------------------------------------------------
const chapters: Chapter[] = raw.chapters.map((c: any) => ({
  id: `ch-${c.chapter_key}`,
  chapter_key: String(c.chapter_key),
  chapter_name: c.chapter_name,
  chapter_type_code: c.chapter_type_code,
  university: c.university ?? null,
  district: c.district || "Unassigned",
  region: c.region || "Unassigned",
  status_code: c.status_code,
  is_dechartered: !!c.is_dechartered,
}));

const chapterById = new Map(chapters.map((c) => [c.id, c]));

interface BuiltRubric {
  tree: RubricTree;
  items: RubricItem[];
}
const rubricsByType: Record<string, BuiltRubric> = {};

for (const v of raw.rubric as any[]) {
  const version = {
    id: `rv-${v.version_code}`,
    version_code: v.version_code,
    version_name: v.version_name,
    chapter_type_code: v.chapter_type_code,
    reporting_year: v.reporting_year ?? null,
    is_active: !!v.is_active,
  };
  const sections = (v.sections as any[]).map((s, si) => {
    const sectionId = `rs-${v.version_code}-${si}`;
    return {
      id: sectionId,
      rubric_version_id: version.id,
      section_code: s.section_code,
      section_name: s.section_name,
      display_order: s.display_order,
      subsections: (s.subsections as any[]).map((ss, ssi) => {
        const subId = `rss-${v.version_code}-${si}-${ssi}`;
        return {
          id: subId,
          rubric_section_id: sectionId,
          subsection_code: ss.subsection_code,
          subsection_name: ss.subsection_name,
          display_order: ss.display_order,
          items: (ss.items as any[]).map((it, ii) => ({
            id: `ri-${v.version_code}-${si}-${ssi}-${ii}`,
            rubric_version_id: version.id,
            rubric_section_id: sectionId,
            rubric_subsection_id: subId,
            criterion_code: it.criterion_code,
            criterion_text: it.criterion_text,
            item_type: it.item_type,
            is_required: !!it.is_required,
            default_point_value: it.default_point_value ?? 1,
            mandatory_penalty: 0,
            display_order: it.display_order,
          })),
        };
      }),
    };
  });
  const items: RubricItem[] = sections.flatMap((s: any) =>
    s.subsections.flatMap((ss: any) => ss.items)
  );
  rubricsByType[v.chapter_type_code] = {
    tree: { version, sections, item_count: items.length },
    items,
  };
}

const documentTypes: DocumentType[] = raw.lookups.documentTypes.map((d: any) => ({
  code: d.code,
  label: d.label,
  category: d.category,
  description: d.description || null,
  allowed_extensions: String(d.allowed_extensions || "").split(",").filter(Boolean),
  max_size_mb: Number(d.max_size_mb) || 25,
  applies_to_types: String(d.applies_to_types || "").split(",").filter(Boolean),
  is_active: d.is_active === "true" || d.is_active === true,
  display_order: Number(d.display_order) || 0,
}));

// ---------------------------------------------------------------------------
// Deterministic pseudo-scores so the demo's rollups look real and are stable.
// ---------------------------------------------------------------------------
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Distributions: ~80% yes, ~12% na (baseline), ~8% no. */
function answerFor(subId: string, itemId: string): AnswerCode {
  const p = hash(subId + "|" + itemId) % 100;
  if (p < 80) return "yes";
  if (p < 92) return "na";
  return "no";
}

const submissions: Submission[] = [];
const responsesBySubmission = new Map<string, Map<string, ItemResponse>>();
const actionsBySubmission = new Map<string, ApprovalAction[]>();

chapters.forEach((chapter, idx) => {
  const built = rubricsByType[chapter.chapter_type_code];
  if (!built) return;
  const submissionId = `sub-${chapter.chapter_key}-${PERIOD.termCode}-${PERIOD.reportingYear}`;
  const mod = idx % 7;
  let workflow: WorkflowStatus = "draft";
  let district = "pending";
  let regional = "pending";
  let executive = "pending";
  if (mod === 1) workflow = "submitted";
  else if (mod === 2) { workflow = "submitted"; district = "approved"; }
  else if (mod === 3) { workflow = "submitted"; regional = "approved"; }
  else if (mod === 4) { workflow = "pending_executive"; district = "approved"; regional = "approved"; }
  else if (mod === 5) { workflow = "finalized"; district = "approved"; regional = "approved"; executive = "approved"; }
  else if (mod === 6) { workflow = "returned"; district = "returned"; }

  const respMap = new Map<string, ItemResponse>();
  for (const item of built.items) {
    const ans = answerFor(submissionId, item.id);
    respMap.set(item.id, {
      id: `resp-${submissionId}-${item.id}`,
      submission_id: submissionId,
      rubric_item_id: item.id,
      answer_code: ans,
      awarded_points: pointsFor(item, ans),
      response_note: null,
    });
  }
  const { finalScore, maxScore } = computeTotals(
    built.items,
    [...respMap.values()]
  );

  submissions.push({
    id: submissionId,
    chapter_id: chapter.id,
    rubric_version_id: built.tree.version.id,
    term_code: PERIOD.termCode,
    reporting_year: PERIOD.reportingYear,
    workflow_status: workflow,
    district_review_status: district as any,
    regional_review_status: regional as any,
    executive_review_status: executive as any,
    submitted_at: workflow === "draft" ? null : new Date().toISOString(),
    final_score: finalScore,
    max_score: maxScore,
  });
  responsesBySubmission.set(submissionId, respMap);
  actionsBySubmission.set(submissionId, []);
});

// A few demo uploaded documents so the admin upload screens aren't empty.
const seedDocTypes = documentTypes.slice(0, 4);
const demoDocuments: DocumentRow[] = [];
chapters.slice(0, 10).forEach((c, i) => {
  const dt = seedDocTypes[i % seedDocTypes.length];
  if (!dt) return;
  demoDocuments.push({
    id: `doc-${i}`,
    chapter_id: c.id,
    submission_id: null,
    document_type_code: dt.code,
    storage_path: `demo/${c.chapter_key}/${dt.code}.pdf`,
    file_name: `${dt.code}-${c.chapter_key}.pdf`,
    content_type: "application/pdf",
    size_bytes: 120000 + i * 4500,
    term_code: PERIOD.termCode,
    reporting_year: PERIOD.reportingYear,
    status: i % 5 === 0 ? "accepted" : "uploaded",
    notes: null,
    uploaded_by_profile_id: null,
    created_at: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Demo identity — chosen via the `demo_session` cookie, e.g.
//   chapter:<chapter_key> | district_director:<district> | rvp:<region>
//   executive_director | admin
// ---------------------------------------------------------------------------
const PROFILES: Record<RoleCode, { id: string; name: string; email: string }> = {
  chapter: { id: "demo-chapter", name: "Shared Chapter Login", email: "chapter@demo" },
  district_director: { id: "demo-dd", name: "District Director", email: "dd@demo" },
  rvp: { id: "demo-rvp", name: "Regional Vice President", email: "rvp@demo" },
  executive_director: { id: "demo-ed", name: "Executive Director", email: "ed@demo" },
  admin: { id: "demo-admin", name: "Admin (Full access)", email: "admin@demo" },
  admin_readonly: { id: "demo-admin-readonly", name: "Admin (Read-only)", email: "admin-readonly@demo" },
};

function parseDemoCookie(cookieValue: string | undefined): SessionUser {
  const firstActiveCollege = chapters.find((c) => c.chapter_type_code === "collegiate") ?? chapters[0];
  const value = cookieValue || "admin";
  const [roleRaw, scopeRaw] = value.split(":");
  const role = (
    ["chapter", "district_director", "rvp", "executive_director", "admin", "admin_readonly"].includes(roleRaw)
      ? roleRaw
      : "admin"
  ) as RoleCode;

  let chapterIds: string[] = [];
  let district: string | null = null;
  let region: string | null = null;

  if (role === "chapter") {
    const ch = scopeRaw
      ? chapters.find((c) => c.chapter_key === scopeRaw || c.id === scopeRaw)
      : firstActiveCollege;
    if (ch) chapterIds = [ch.id];
  } else if (role === "district_director") {
    district = scopeRaw || chapters[0]?.district || null;
  } else if (role === "rvp") {
    region = scopeRaw || chapters[0]?.region || null;
  }

  const p = PROFILES[role];
  return {
    profileId: p.id,
    email: p.email,
    fullName: p.name,
    role,
    district,
    region,
    chapterIds,
  };
}

function visibleChapters(session: SessionUser): Chapter[] {
  if (session.role === "district_director" && session.district) {
    return chapters.filter((c) => c.district === session.district);
  }
  if (session.role === "rvp" && session.region) {
    return chapters.filter((c) => c.region === session.region);
  }
  if (session.role === "chapter") {
    return chapters.filter((c) => session.chapterIds.includes(c.id));
  }
  return chapters;
}

function submissionById(id: string): Submission | null {
  return submissions.find((s) => s.id === id) ?? null;
}

export function createDemoStore(cookie: string | undefined): Store {
  const session = parseDemoCookie(cookie);

  const withChapter = (s: Submission): SubmissionWithChapter => ({
    ...s,
    chapter: chapterById.get(s.chapter_id)!,
  });

  const scopedSubmissions = () => {
    const visibleIds = new Set(visibleChapters(session).map((c) => c.id));
    return submissions
      .filter((s) => visibleIds.has(s.chapter_id))
      .map(withChapter);
  };

  return {
    async getSession() {
      return session;
    },
    async signIn() {
      // Demo mode is persona-based; there is no token to return.
      return {};
    },
    async signOut() {},

    async getCurrentPeriod() {
      return PERIOD;
    },

    async listChapters(params: ListChaptersParams): Promise<ChapterPage> {
      let list = visibleChapters(session);
      if (params.search) {
        const q = params.search.toLowerCase();
        list = list.filter(
          (c) =>
            c.chapter_name.toLowerCase().includes(q) ||
            c.chapter_key.includes(q) ||
            (c.university ?? "").toLowerCase().includes(q)
        );
      }
      if (params.district) list = list.filter((c) => c.district === params.district);
      if (params.region) list = list.filter((c) => c.region === params.region);
      if (params.type) list = list.filter((c) => c.chapter_type_code === params.type);
      if (params.status) list = list.filter((c) => c.status_code === params.status);
      const total = list.length;
      const offset = params.offset ?? 0;
      const limit = params.limit ?? 25;
      return {
        rows: list.slice(offset, offset + limit),
        total,
      };
    },

    async getChapter(id) {
      return chapterById.get(id) ?? null;
    },

    async getChaptersByIds(ids) {
      return ids.map((id) => chapterById.get(id)).filter(Boolean) as Chapter[];
    },

    async upsertChapters(rows) {
      let inserted = 0;
      let updated = 0;
      const errors: string[] = [];
      for (const row of rows) {
        if (!row.chapter_key) {
          errors.push("Missing chapter key");
          continue;
        }
        const existing = chapters.find((c) => c.chapter_key === String(row.chapter_key));
        if (existing) {
          Object.assign(existing, row);
          updated++;
        } else {
          const created: Chapter = {
            id: `ch-${row.chapter_key}`,
            chapter_key: String(row.chapter_key),
            chapter_name: row.chapter_name ?? "",
            chapter_type_code: row.chapter_type_code ?? "collegiate",
            university: row.university ?? null,
            district: row.district ?? "Unassigned",
            region: row.region ?? "Unassigned",
            status_code: row.status_code ?? "Active",
            is_dechartered: row.is_dechartered ?? false,
          };
          chapters.push(created);
          chapterById.set(created.id, created);
          inserted++;
        }
      }
      return { inserted, updated, errors };
    },

    async getRubricForType(chapterTypeCode) {
      return rubricsByType[chapterTypeCode]?.tree ?? null;
    },

    async getOrCreateSubmission(chapterId, period) {
      const existing = submissions.find(
        (s) =>
          s.chapter_id === chapterId &&
          s.term_code === period.termCode &&
          s.reporting_year === period.reportingYear
      );
      if (existing) return existing;
      const chapter = chapterById.get(chapterId)!;
      const built = rubricsByType[chapter.chapter_type_code]!;
      const created: Submission = {
        id: `sub-${chapter.chapter_key}-${period.termCode}-${period.reportingYear}`,
        chapter_id: chapterId,
        rubric_version_id: built.tree.version.id,
        term_code: period.termCode,
        reporting_year: period.reportingYear,
        workflow_status: "draft",
        district_review_status: "pending",
        regional_review_status: "pending",
        executive_review_status: "pending",
        submitted_at: null,
        final_score: 0,
        max_score: built.items.reduce((n, i) => n + i.default_point_value, 0),
      };
      submissions.push(created);
      responsesBySubmission.set(created.id, new Map());
      actionsBySubmission.set(created.id, []);
      return created;
    },

    async getSubmission(id) {
      return submissionById(id);
    },

    async getSubmissionDetail(id) {
      const submission = submissionById(id);
      if (!submission) return null;
      const chapter = chapterById.get(submission.chapter_id);
      if (!chapter) return null;
      const built = rubricsByType[chapter.chapter_type_code];
      if (!built) return null;
      const responses = [...(responsesBySubmission.get(id)?.values() ?? [])];
      return {
        submission: { ...submission, chapter },
        rubric: attachResponses(built.tree, responses),
      };
    },

    async listSubmissionsForChapter(chapterId) {
      return submissions.filter((s) => s.chapter_id === chapterId);
    },

    async setResponse(submissionId, rubricItemId, answer) {
      const submission = submissionById(submissionId);
      if (!submission) return;
      const chapter = chapterById.get(submission.chapter_id)!;
      const built = rubricsByType[chapter.chapter_type_code]!;
      const item = built.items.find((i) => i.id === rubricItemId);
      if (!item) return;
      const map = responsesBySubmission.get(submissionId) ?? new Map();
      map.set(rubricItemId, {
        id: map.get(rubricItemId)?.id ?? `resp-${submissionId}-${rubricItemId}`,
        submission_id: submissionId,
        rubric_item_id: rubricItemId,
        answer_code: answer,
        awarded_points: pointsFor(item, answer),
        response_note: null,
      });
      responsesBySubmission.set(submissionId, map);
      const { finalScore, maxScore } = computeTotals(built.items, [...map.values()]);
      submission.final_score = finalScore;
      submission.max_score = maxScore;
    },

    async submitReport(submissionId) {
      const s = submissionById(submissionId);
      if (!s) return;
      s.workflow_status = "submitted";
      s.district_review_status = "pending";
      s.regional_review_status = "pending";
      s.executive_review_status = "pending";
      s.submitted_at = new Date().toISOString();
    },

    async listReviewQueue(role, period) {
      const pool = scopedSubmissions().filter(
        (s) => s.term_code === period.termCode && s.reporting_year === period.reportingYear
      );
      if (role === "executive_director") {
        return pool.filter(
          (s) =>
            s.district_review_status === "approved" &&
            s.regional_review_status === "approved"
        );
      }
      return pool.filter(
        (s) => s.workflow_status === "submitted" || s.workflow_status === "returned"
      );
    },

    async listVisibleSubmissions(period) {
      return scopedSubmissions().filter(
        (s) => s.term_code === period.termCode && s.reporting_year === period.reportingYear
      );
    },

    async approve(submissionId, role, comment) {
      const s = submissionById(submissionId);
      if (!s) return;
      if (role === "district_director") s.district_review_status = "approved";
      if (role === "rvp") s.regional_review_status = "approved";
      if (role === "executive_director") {
        s.executive_review_status = "approved";
        s.workflow_status = "finalized";
      }
      if (
        role !== "executive_director" &&
        s.district_review_status === "approved" &&
        s.regional_review_status === "approved"
      ) {
        s.workflow_status = "pending_executive";
      }
      const actions = actionsBySubmission.get(submissionId) ?? [];
      actions.push({
        id: `act-${actions.length}-${submissionId}`,
        submission_id: submissionId,
        reviewer_profile_id: session.profileId,
        reviewer_role_code: session.role,
        action: "approved",
        action_comment: comment ?? null,
        action_at: new Date().toISOString(),
      });
      actionsBySubmission.set(submissionId, actions);
    },

    async returnSubmission(submissionId, role, comment) {
      const s = submissionById(submissionId);
      if (!s) return;
      if (role === "district_director") s.district_review_status = "returned";
      if (role === "rvp") s.regional_review_status = "returned";
      s.workflow_status = "returned";
      const actions = actionsBySubmission.get(submissionId) ?? [];
      actions.push({
        id: `act-${actions.length}-${submissionId}`,
        submission_id: submissionId,
        reviewer_profile_id: session.profileId,
        reviewer_role_code: session.role,
        action: "returned",
        action_comment: comment,
        action_at: new Date().toISOString(),
      });
      actionsBySubmission.set(submissionId, actions);
    },

    async reopenSubmission(submissionId, comment) {
      const s = submissionById(submissionId);
      if (!s) return;
      s.workflow_status = "returned";
      s.district_review_status = "pending";
      s.regional_review_status = "pending";
      s.executive_review_status = "pending";
      const actions = actionsBySubmission.get(submissionId) ?? [];
      actions.push({
        id: `act-${actions.length}-${submissionId}`,
        submission_id: submissionId,
        reviewer_profile_id: session.profileId,
        reviewer_role_code: session.role,
        action: "reopened",
        action_comment: comment ?? null,
        action_at: new Date().toISOString(),
      });
      actionsBySubmission.set(submissionId, actions);
    },

    async listApprovalActions(submissionId) {
      return actionsBySubmission.get(submissionId) ?? [];
    },

    async getDistrictRollups(period) {
      return rollupBy(period, (c) => c.district).map((r) => ({
        district: r.key,
        ...r.stats,
      })) as DistrictRollup[];
    },

    async getRegionRollups(period) {
      return rollupBy(period, (c) => c.region).map((r) => ({
        region: r.key,
        districts_total: new Set(chapters.filter((c) => c.region === r.key).map((c) => c.district)).size,
        ...r.stats,
      })) as RegionRollup[];
    },

    async getNationalRollup(period) {
      const scoped = visibleChapters(session);
      const ids = new Set(scoped.map((c) => c.id));
      const subs = submissions.filter(
        (s) =>
          ids.has(s.chapter_id) &&
          s.term_code === period.termCode &&
          s.reporting_year === period.reportingYear
      );
      const started = subs.filter((s) => s.workflow_status !== "draft");
      const earned = subs.reduce((n, s) => n + s.final_score, 0);
      const possible = subs.reduce((n, s) => n + s.max_score, 0);
      return {
        term_code: period.termCode,
        reporting_year: period.reportingYear,
        chapters_total: scoped.length,
        chapters_started: started.length,
        chapters_finalized: subs.filter((s) => s.workflow_status === "finalized").length,
        pending_executive: subs.filter((s) => s.workflow_status === "pending_executive").length,
        regions_total: new Set(scoped.map((c) => c.region)).size,
        districts_total: new Set(scoped.map((c) => c.district)).size,
        points_earned: earned,
        points_possible: possible,
        avg_score_pct: possible > 0 ? Math.round((earned / possible) * 10000) / 100 : 0,
        completion_rate_pct: scoped.length > 0 ? Math.round((started.length / scoped.length) * 10000) / 100 : 0,
      };
    },

    async getReportingTerms() {
      return [PERIOD, { termCode: "spring" as TermCode, reportingYear: CURRENT_YEAR }];
    },

    async listDocumentTypes() {
      return [...documentTypes].sort((a, b) => a.display_order - b.display_order);
    },

    async listDocuments(params) {
      let list = demoDocuments;
      if (params.category) {
        const codes = new Set(
          documentTypes.filter((d) => d.category === params.category).map((d) => d.code)
        );
        list = list.filter((d) => codes.has(d.document_type_code));
      }
      if (params.chapterId) list = list.filter((d) => d.chapter_id === params.chapterId);
      return list.slice(0, params.limit ?? 100);
    },

    async createDocument(input) {
      const row: DocumentRow = {
        id: `doc-${demoDocuments.length}-${Date.now()}`,
        chapter_id: input.chapterId,
        submission_id: null,
        document_type_code: input.documentTypeCode,
        storage_path: input.storagePath,
        file_name: input.fileName,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        term_code: input.termCode ?? null,
        reporting_year: input.reportingYear ?? null,
        status: "uploaded",
        notes: input.notes ?? null,
        uploaded_by_profile_id: session.profileId,
        created_at: new Date().toISOString(),
      };
      demoDocuments.push(row);
      return row;
    },

    async listProfilesByRole(role) {
      return [
        {
          id: `demo-${role}`,
          full_name: PROFILES[role as RoleCode]?.name ?? role,
          email: PROFILES[role as RoleCode]?.email ?? `${role}@demo`,
          role_code: role as RoleCode,
          district: session.district,
          region: session.region,
          is_active: true,
        },
      ] as Profile[];
    },

    async listOrgUnits(): Promise<OrgUnits> {
      return {
        regions: DEMO_REGIONS,
        districts: DEMO_DISTRICTS as any,
      };
    },
  };
}

// Group visible submissions by a key and compute rollup stats.
function rollupBy(
  period: ReportingPeriod,
  keyFn: (c: Chapter) => string
): { key: string; stats: any }[] {
  const groups = new Map<string, Chapter[]>();
  for (const c of chapters) {
    const k = keyFn(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const out: { key: string; stats: any }[] = [];
  for (const [key, group] of groups) {
    const ids = new Set(group.map((c) => c.id));
    const subs = submissions.filter(
      (s) =>
        ids.has(s.chapter_id) &&
        s.term_code === period.termCode &&
        s.reporting_year === period.reportingYear
    );
    const started = subs.filter((s) => s.workflow_status !== "draft");
    const earned = subs.reduce((n, s) => n + s.final_score, 0);
    const possible = subs.reduce((n, s) => n + s.max_score, 0);
    out.push({
      key,
      stats: {
        term_code: period.termCode,
        reporting_year: period.reportingYear,
        chapters_total: group.length,
        chapters_started: started.length,
        chapters_finalized: subs.filter((s) => s.workflow_status === "finalized").length,
        district_approved: subs.filter((s) => s.district_review_status === "approved").length,
        region_approved: subs.filter((s) => s.regional_review_status === "approved").length,
        points_earned: earned,
        points_possible: possible,
        avg_score_pct: possible > 0 ? Math.round((earned / possible) * 10000) / 100 : 0,
        completion_rate_pct:
          group.length > 0 ? Math.round((started.length / group.length) * 10000) / 100 : 0,
      },
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export const DEMO_REGIONS: Region[] = raw.lookups.regions.map((r: any) => ({
  code: r.code,
  name: r.name,
  sort_order: Number(r.sort_order) || 0,
}));

export const DEMO_DISTRICTS = raw.lookups.districts.map((d: any) => ({
  code: d.code,
  name: d.name,
  region_code: d.region_code,
}));

export { chapters as DEMO_CHAPTERS, documentTypes as DEMO_DOC_TYPES };
