// Hand-written to match supabase/migrations/0001_schema.sql - 0003_reporting_views.sql.
// Regenerate with `npx supabase gen types typescript` once a live project exists,
// then reconcile against the domain unions below (kept separately in types/domain.ts).
//
// `Relationships: []` on every table/view is intentional — we aren't modeling
// FK-based embedded-resource typing here, so joined selects (e.g.
// `chapters(*)`) come back untyped rather than fully inferred. supabase-js's
// GenericTable/GenericSchema types require the field to exist regardless.

export type AppRoleCode =
  | "chapter"
  | "district_director"
  | "rvp"
  | "executive_director"
  | "admin";

export type ChapterTypeCode = "collegiate" | "alumni";

export type ChapterStatusCode =
  | "Active"
  | "Inactive"
  | "Suspended"
  | "Dechartered"
  | "Cease and Desist"
  | "Provisional/Alumni"
  | "Provisional/College"
  | "Probation"
  | "Dormant";

export type ReportTermCode = "fall" | "spring";

export type WorkflowStatus =
  | "draft"
  | "submitted"
  | "returned"
  | "pending_executive"
  | "finalized";

export type ReviewStatus = "pending" | "approved" | "returned";

export type RubricItemType = "activity" | "metric";

export type ApprovalAction = "approved" | "returned" | "reopened";

export interface Database {
  public: {
    Tables: {
      chapter_types: {
        Row: { code: string; label: string };
        Insert: { code: string; label: string };
        Update: Partial<{ code: string; label: string }>;
        Relationships: [];
      };
      chapter_statuses: {
        Row: {
          code: string;
          label: string;
          sort_order: number;
          is_active: boolean;
        };
        Insert: {
          code: string;
          label: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: Partial<{
          code: string;
          label: string;
          sort_order: number;
          is_active: boolean;
        }>;
        Relationships: [];
      };
      app_roles: {
        Row: { code: string; label: string; sort_order: number };
        Insert: { code: string; label: string; sort_order?: number };
        Update: Partial<{ code: string; label: string; sort_order: number }>;
        Relationships: [];
      };
      report_terms: {
        Row: { code: string; label: string; sort_order: number };
        Insert: { code: string; label: string; sort_order?: number };
        Update: Partial<{ code: string; label: string; sort_order: number }>;
        Relationships: [];
      };
      system_contacts: {
        Row: {
          id: string;
          contact_key: string;
          full_name: string;
          email: string;
          role_label: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_key: string;
          full_name: string;
          email: string;
          role_label: string;
          is_active?: boolean;
        };
        Update: Partial<{
          contact_key: string;
          full_name: string;
          email: string;
          role_label: string;
          is_active: boolean;
        }>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          role_code: AppRoleCode;
          district: string | null;
          region: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          email?: string | null;
          role_code: AppRoleCode;
          district?: string | null;
          region?: string | null;
          is_active?: boolean;
        };
        Update: Partial<{
          full_name: string | null;
          email: string | null;
          role_code: AppRoleCode;
          district: string | null;
          region: string | null;
          is_active: boolean;
        }>;
        Relationships: [];
      };
      chapters: {
        Row: {
          id: string;
          chapter_key: string;
          chapter_name: string;
          chapter_type_code: ChapterTypeCode;
          university: string | null;
          district: string;
          region: string;
          status_code: ChapterStatusCode;
          is_dechartered: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          chapter_key: string;
          chapter_name: string;
          chapter_type_code: ChapterTypeCode;
          university?: string | null;
          district: string;
          region: string;
          status_code: ChapterStatusCode;
          is_dechartered?: boolean;
        };
        Update: Partial<{
          chapter_key: string;
          chapter_name: string;
          chapter_type_code: ChapterTypeCode;
          university: string | null;
          district: string;
          region: string;
          status_code: ChapterStatusCode;
          is_dechartered: boolean;
        }>;
        Relationships: [];
      };
      chapter_user_links: {
        Row: {
          id: string;
          chapter_id: string;
          profile_id: string;
          is_primary: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          chapter_id: string;
          profile_id: string;
          is_primary?: boolean;
          is_active?: boolean;
        };
        Update: Partial<{
          chapter_id: string;
          profile_id: string;
          is_primary: boolean;
          is_active: boolean;
        }>;
        Relationships: [];
      };
      reviewer_assignments: {
        Row: {
          id: string;
          chapter_id: string;
          district_director_profile_id: string | null;
          regional_vice_president_profile_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          chapter_id: string;
          district_director_profile_id?: string | null;
          regional_vice_president_profile_id?: string | null;
        };
        Update: Partial<{
          district_director_profile_id: string | null;
          regional_vice_president_profile_id: string | null;
        }>;
        Relationships: [];
      };
      reporting_windows: {
        Row: {
          id: string;
          window_code: string;
          term_code: ReportTermCode;
          reporting_year: number | null;
          opens_on: string | null;
          closes_on: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          window_code: string;
          term_code: ReportTermCode;
          reporting_year?: number | null;
          opens_on?: string | null;
          closes_on?: string | null;
          is_active?: boolean;
        };
        Update: Partial<{
          window_code: string;
          term_code: ReportTermCode;
          reporting_year: number | null;
          opens_on: string | null;
          closes_on: string | null;
          is_active: boolean;
        }>;
        Relationships: [];
      };
      rubric_versions: {
        Row: {
          id: string;
          version_code: string;
          version_name: string;
          chapter_type_code: ChapterTypeCode;
          reporting_year: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          version_code: string;
          version_name: string;
          chapter_type_code: ChapterTypeCode;
          reporting_year?: number | null;
          is_active?: boolean;
        };
        Update: Partial<{
          version_code: string;
          version_name: string;
          chapter_type_code: ChapterTypeCode;
          reporting_year: number | null;
          is_active: boolean;
        }>;
        Relationships: [];
      };
      rubric_sections: {
        Row: {
          id: string;
          rubric_version_id: string;
          section_code: string;
          section_name: string;
          display_order: number;
          active: boolean;
        };
        Insert: {
          id?: string;
          rubric_version_id: string;
          section_code: string;
          section_name: string;
          display_order?: number;
          active?: boolean;
        };
        Update: Partial<{
          section_code: string;
          section_name: string;
          display_order: number;
          active: boolean;
        }>;
        Relationships: [];
      };
      rubric_subsections: {
        Row: {
          id: string;
          rubric_section_id: string;
          subsection_code: string;
          subsection_name: string;
          display_order: number;
          active: boolean;
        };
        Insert: {
          id?: string;
          rubric_section_id: string;
          subsection_code: string;
          subsection_name: string;
          display_order?: number;
          active?: boolean;
        };
        Update: Partial<{
          subsection_code: string;
          subsection_name: string;
          display_order: number;
          active: boolean;
        }>;
        Relationships: [];
      };
      rubric_items: {
        Row: {
          id: string;
          rubric_version_id: string;
          rubric_section_id: string;
          rubric_subsection_id: string;
          criterion_code: string;
          criterion_text: string;
          item_type: RubricItemType;
          is_required: boolean;
          default_point_value: number;
          display_order: number;
          active: boolean;
        };
        Insert: {
          id?: string;
          rubric_version_id: string;
          rubric_section_id: string;
          rubric_subsection_id: string;
          criterion_code: string;
          criterion_text: string;
          item_type: RubricItemType;
          is_required?: boolean;
          default_point_value?: number;
          display_order?: number;
          active?: boolean;
        };
        Update: Partial<{
          criterion_code: string;
          criterion_text: string;
          item_type: RubricItemType;
          is_required: boolean;
          default_point_value: number;
          display_order: number;
          active: boolean;
        }>;
        Relationships: [];
      };
      submissions: {
        Row: {
          id: string;
          chapter_id: string;
          rubric_version_id: string;
          term_code: ReportTermCode;
          reporting_year: number;
          workflow_status: WorkflowStatus;
          district_review_status: ReviewStatus;
          regional_review_status: ReviewStatus;
          executive_review_status: ReviewStatus;
          submitted_by_profile_id: string | null;
          submitted_at: string | null;
          final_score: number;
          max_score: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          chapter_id: string;
          rubric_version_id: string;
          term_code: ReportTermCode;
          reporting_year: number;
          workflow_status?: WorkflowStatus;
          district_review_status?: ReviewStatus;
          regional_review_status?: ReviewStatus;
          executive_review_status?: ReviewStatus;
          submitted_by_profile_id?: string | null;
          submitted_at?: string | null;
          final_score?: number;
          max_score?: number;
        };
        Update: Partial<{
          workflow_status: WorkflowStatus;
          district_review_status: ReviewStatus;
          regional_review_status: ReviewStatus;
          executive_review_status: ReviewStatus;
          submitted_by_profile_id: string | null;
          submitted_at: string | null;
          final_score: number;
          max_score: number;
        }>;
        Relationships: [];
      };
      submission_item_responses: {
        Row: {
          id: string;
          submission_id: string;
          rubric_item_id: string;
          answer_yes: boolean;
          awarded_points: number;
          response_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          submission_id: string;
          rubric_item_id: string;
          answer_yes: boolean;
          awarded_points?: number;
          response_note?: string | null;
        };
        Update: Partial<{
          answer_yes: boolean;
          awarded_points: number;
          response_note: string | null;
        }>;
        Relationships: [];
      };
      approval_actions: {
        Row: {
          id: string;
          submission_id: string;
          reviewer_profile_id: string;
          reviewer_role_code: AppRoleCode;
          action: ApprovalAction;
          action_comment: string | null;
          action_at: string;
        };
        Insert: {
          id?: string;
          submission_id: string;
          reviewer_profile_id: string;
          reviewer_role_code: AppRoleCode;
          action: ApprovalAction;
          action_comment?: string | null;
        };
        Update: Partial<{
          action: ApprovalAction;
          action_comment: string | null;
        }>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          actor_profile_id: string | null;
          entity_type: string;
          entity_id: string | null;
          action: string;
          metadata_json: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_profile_id?: string | null;
          entity_type: string;
          entity_id?: string | null;
          action: string;
          metadata_json?: Record<string, unknown>;
        };
        Update: Partial<{
          entity_type: string;
          entity_id: string | null;
          action: string;
          metadata_json: Record<string, unknown>;
        }>;
        Relationships: [];
      };
    };
    Views: {
      v_submission_rollup: {
        Row: {
          chapter_id: string;
          chapter_key: string;
          chapter_name: string;
          chapter_type_code: ChapterTypeCode;
          district: string;
          region: string;
          status_code: ChapterStatusCode;
          submission_id: string | null;
          term_code: ReportTermCode | null;
          reporting_year: number | null;
          workflow_status: WorkflowStatus | null;
          district_review_status: ReviewStatus | null;
          regional_review_status: ReviewStatus | null;
          executive_review_status: ReviewStatus | null;
          final_score: number | null;
          max_score: number | null;
          pct_score: number | null;
        };
        Relationships: [];
      };
      v_district_rollup: {
        Row: {
          district: string;
          region: string;
          term_code: ReportTermCode;
          reporting_year: number;
          submission_count: number;
          total_points: number;
          total_possible_points: number;
          pct_score: number;
        };
        Relationships: [];
      };
      v_region_rollup: {
        Row: {
          region: string;
          term_code: ReportTermCode;
          reporting_year: number;
          submission_count: number;
          total_points: number;
          total_possible_points: number;
          pct_score: number;
        };
        Relationships: [];
      };
      v_national_rollup: {
        Row: {
          term_code: ReportTermCode;
          reporting_year: number;
          submission_count: number;
          total_points: number;
          total_possible_points: number;
          pct_score: number;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
  };
}
