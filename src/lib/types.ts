// Shared domain types for the Chapman Reporting Portal.
// These mirror the Supabase schema (supabase/migrations) but are plain TS so
// the same UI code can run against either the live Supabase database or the
// in-memory demo store.

export type RoleCode =
  | "chapter"
  | "district_director"
  | "rvp"
  | "executive_director"
  | "admin";

export type TermCode = "fall" | "spring";

export type WorkflowStatus =
  | "draft"
  | "submitted"
  | "returned"
  | "pending_executive"
  | "finalized";

export type ReviewStatus = "pending" | "approved" | "returned";

export type AnswerCode = "yes" | "no" | "na";

export type DocumentCategory = "tax" | "special_event" | "other";

export interface ChapterType {
  code: string;
  label: string;
}

export interface ChapterStatus {
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

export interface AppRole {
  code: RoleCode;
  label: string;
  sort_order: number;
}

export interface ReportTerm {
  code: TermCode;
  label: string;
  sort_order: number;
}

export interface Region {
  code: string;
  name: string;
  sort_order: number;
}

export interface District {
  code: string;
  name: string;
  region_code: string;
}

export interface DocumentType {
  code: string;
  label: string;
  category: DocumentCategory;
  description: string | null;
  allowed_extensions: string[];
  max_size_mb: number;
  applies_to_types: string[];
  is_active: boolean;
  display_order: number;
}

export interface Chapter {
  id: string;
  chapter_key: string;
  chapter_name: string;
  chapter_type_code: string;
  university: string | null;
  district: string;
  region: string;
  status_code: string;
  is_dechartered: boolean;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role_code: RoleCode;
  district: string | null;
  region: string | null;
  is_active: boolean;
}

export interface RubricItem {
  id: string;
  rubric_version_id: string;
  rubric_section_id: string;
  rubric_subsection_id: string;
  criterion_code: string;
  criterion_text: string;
  item_type: "activity" | "metric";
  is_required: boolean;
  default_point_value: number;
  mandatory_penalty: number;
  display_order: number;
}

export interface RubricSubsection {
  id: string;
  rubric_section_id: string;
  subsection_code: string;
  subsection_name: string;
  display_order: number;
  items: RubricItem[];
}

export interface RubricSection {
  id: string;
  rubric_version_id: string;
  section_code: string;
  section_name: string;
  display_order: number;
  subsections: RubricSubsection[];
}

export interface RubricVersion {
  id: string;
  version_code: string;
  version_name: string;
  chapter_type_code: string;
  reporting_year: number | null;
  is_active: boolean;
}

export interface RubricTree {
  version: RubricVersion;
  sections: RubricSection[];
  item_count: number;
}

export interface Submission {
  id: string;
  chapter_id: string;
  rubric_version_id: string;
  term_code: TermCode;
  reporting_year: number;
  workflow_status: WorkflowStatus;
  district_review_status: ReviewStatus;
  regional_review_status: ReviewStatus;
  executive_review_status: ReviewStatus;
  submitted_at: string | null;
  final_score: number;
  max_score: number;
}

export interface ItemResponse {
  id: string;
  submission_id: string;
  rubric_item_id: string;
  answer_code: AnswerCode;
  awarded_points: number;
  response_note: string | null;
}

export interface ApprovalAction {
  id: string;
  submission_id: string;
  reviewer_profile_id: string;
  reviewer_role_code: RoleCode;
  action: "approved" | "returned" | "reopened";
  action_comment: string | null;
  action_at: string;
}

/** A submission joined with just enough chapter context for queues/rollups. */
export interface SubmissionWithChapter extends Submission {
  chapter: Chapter;
}

/** Rubric item + the chapter's saved answer, the unit rows render per line. */
export interface RubricItemWithResponse extends RubricItem {
  response: ItemResponse | null;
}

export interface RubricSubsectionWithItems extends RubricSubsection {
  items: RubricItemWithResponse[];
}

export interface RubricSectionWithContent extends RubricSection {
  subsections: RubricSubsectionWithItems[];
}

export interface RubricTreeWithResponses {
  version: RubricVersion;
  sections: RubricSectionWithContent[];
  item_count: number;
}

export interface ScoreSummary {
  earned: number;
  possible: number;
  answered: number;
  total: number;
  percent: number;
}

export interface DocumentRow {
  id: string;
  chapter_id: string | null;
  submission_id: string | null;
  document_type_code: string;
  storage_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  term_code: TermCode | null;
  reporting_year: number | null;
  status: "uploaded" | "under_review" | "accepted" | "rejected";
  notes: string | null;
  uploaded_by_profile_id: string | null;
  created_at: string;
}

export interface DistrictRollup {
  district: string;
  term_code: TermCode;
  reporting_year: number;
  chapters_total: number;
  chapters_started: number;
  chapters_finalized: number;
  district_approved: number;
  points_earned: number;
  points_possible: number;
  avg_score_pct: number;
  completion_rate_pct: number;
}

export interface RegionRollup {
  region: string;
  term_code: TermCode;
  reporting_year: number;
  chapters_total: number;
  chapters_started: number;
  chapters_finalized: number;
  region_approved: number;
  districts_total: number;
  points_earned: number;
  points_possible: number;
  avg_score_pct: number;
  completion_rate_pct: number;
}

export interface NationalRollup {
  term_code: TermCode;
  reporting_year: number;
  chapters_total: number;
  chapters_started: number;
  chapters_finalized: number;
  pending_executive: number;
  regions_total: number;
  districts_total: number;
  points_earned: number;
  points_possible: number;
  avg_score_pct: number;
  completion_rate_pct: number;
}

export interface ReportingPeriod {
  termCode: TermCode;
  reportingYear: number;
}

/** The signed-in identity the UI renders against. */
export interface SessionUser {
  profileId: string;
  email: string;
  fullName: string;
  role: RoleCode;
  district: string | null;
  region: string | null;
  chapterIds: string[];
}

export interface ListChaptersParams {
  search?: string;
  district?: string;
  region?: string;
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ChapterPage {
  rows: Chapter[];
  total: number;
}
