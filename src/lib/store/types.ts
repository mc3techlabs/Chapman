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
  Profile,
  RegionRollup,
  ReportingPeriod,
  ReviewStatus,
  RubricTree,
  RubricTreeWithResponses,
  SessionUser,
  Submission,
  SubmissionWithChapter,
  TermCode,
  WorkflowStatus,
} from "../types";

/**
 * The single data contract the whole app renders against.
 *
 * Two implementations satisfy it:
 *   - supabase.ts  → queries the live Supabase Postgres (RLS does the scoping)
 *   - demo.ts      → an in-memory store seeded from the real seed CSVs, so the
 *                    UI is fully explorable before a Supabase project exists.
 *
 * Every method that returns potentially-large collections takes pagination or
 * a filter, so nothing loads an 800-row table unbounded.
 */
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface Store {
  /** Who is signed in, or null. */
  getSession(): Promise<SessionUser | null>;
  /**
   * Attempts sign-in. On success returns the Supabase tokens, which the caller
   * MUST persist (httpOnly cookie) — the Supabase client is stateless
   * (persistSession: false), so nothing is authenticated until the token is
   * sent back on the next request.
   */
  signIn(email: string, password: string): Promise<{ error?: string; tokens?: AuthTokens }>;
  signOut(): Promise<void>;

  /** Current (or requested) reporting period. */
  getCurrentPeriod(): Promise<ReportingPeriod>;

  // -- Chapters ------------------------------------------------------------
  /** Paginated + filtered roster. For chapters, scoped to the caller. */
  listChapters(params: ListChaptersParams): Promise<ChapterPage>;
  getChapter(id: string): Promise<Chapter | null>;
  getChaptersByIds(ids: string[]): Promise<Chapter[]>;
  upsertChapters(rows: Partial<Chapter>[]): Promise<{ inserted: number; updated: number; errors: string[] }>;

  // -- Rubric --------------------------------------------------------------
  /** Rubric tree for a chapter type (college vs alumni), no responses. */
  getRubricForType(chapterTypeCode: string): Promise<RubricTree | null>;

  // -- Submissions ---------------------------------------------------------
  /** The caller chapter's submission for a period (creating a draft on demand). */
  getOrCreateSubmission(chapterId: string, period: ReportingPeriod): Promise<Submission>;
  getSubmission(id: string): Promise<Submission | null>;
  /** Submission + responses + rubric overlay for the workspace / review view. */
  getSubmissionDetail(id: string): Promise<
    { submission: SubmissionWithChapter; rubric: RubricTreeWithResponses } | null
  >;
  /** A chapter's submissions across periods (for the status tracker). */
  listSubmissionsForChapter(chapterId: string): Promise<Submission[]>;

  setResponse(
    submissionId: string,
    rubricItemId: string,
    answer: AnswerCode
  ): Promise<void>;
  submitReport(submissionId: string): Promise<void>;

  // -- Review queues -------------------------------------------------------
  /** Submissions in a reviewer's lane for a period. */
  listReviewQueue(
    role: "district_director" | "rvp" | "executive_director",
    period: ReportingPeriod
  ): Promise<SubmissionWithChapter[]>;
  /** Every submission the caller can see for a period (dashboard tables). */
  listVisibleSubmissions(period: ReportingPeriod): Promise<SubmissionWithChapter[]>;

  approve(
    submissionId: string,
    role: "district_director" | "rvp" | "executive_director",
    comment?: string
  ): Promise<void>;
  returnSubmission(
    submissionId: string,
    role: "district_director" | "rvp",
    comment: string
  ): Promise<void>;
  reopenSubmission(submissionId: string, comment?: string): Promise<void>;

  listApprovalActions(submissionId: string): Promise<ApprovalAction[]>;

  // -- Rollups -------------------------------------------------------------
  getDistrictRollups(period: ReportingPeriod): Promise<DistrictRollup[]>;
  getRegionRollups(period: ReportingPeriod): Promise<RegionRollup[]>;
  getNationalRollup(period: ReportingPeriod): Promise<NationalRollup | null>;
  getReportingTerms(): Promise<ReportingPeriod[]>;

  // -- Documents (admin upload framework) ----------------------------------
  listDocumentTypes(): Promise<DocumentType[]>;
  listDocuments(params: {
    category?: "tax" | "special_event" | "other";
    chapterId?: string;
    limit?: number;
  }): Promise<DocumentRow[]>;
  /** Records an uploaded file (bytes already stored in Supabase Storage). */
  createDocument(input: {
    chapterId: string;
    documentTypeCode: string;
    fileName: string;
    storagePath: string;
    contentType: string | null;
    sizeBytes: number;
    termCode?: TermCode | null;
    reportingYear?: number | null;
    notes?: string | null;
  }): Promise<DocumentRow>;

  // -- Admin ---------------------------------------------------------------
  listProfilesByRole(role: string): Promise<Profile[]>;
}

export type {
  WorkflowStatus,
  ReviewStatus,
  TermCode,
  AnswerCode,
};
