import type { Database } from "./database";

export type Chapter = Database["public"]["Tables"]["chapters"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ReviewerAssignment =
  Database["public"]["Tables"]["reviewer_assignments"]["Row"];
export type RubricVersion =
  Database["public"]["Tables"]["rubric_versions"]["Row"];
export type RubricSection =
  Database["public"]["Tables"]["rubric_sections"]["Row"];
export type RubricSubsection =
  Database["public"]["Tables"]["rubric_subsections"]["Row"];
export type RubricItem = Database["public"]["Tables"]["rubric_items"]["Row"];
export type Submission = Database["public"]["Tables"]["submissions"]["Row"];
export type SubmissionItemResponse =
  Database["public"]["Tables"]["submission_item_responses"]["Row"];
export type ApprovalActionRow =
  Database["public"]["Tables"]["approval_actions"]["Row"];

export type SubmissionRollupRow =
  Database["public"]["Views"]["v_submission_rollup"]["Row"];
export type DistrictRollupRow =
  Database["public"]["Views"]["v_district_rollup"]["Row"];
export type RegionRollupRow =
  Database["public"]["Views"]["v_region_rollup"]["Row"];
export type NationalRollupRow =
  Database["public"]["Views"]["v_national_rollup"]["Row"];

/** A rubric item joined with the chapter's saved response, if any — the unit
 * the submission workspace and review queues render per row. */
export interface RubricItemWithResponse extends RubricItem {
  response: SubmissionItemResponse | null;
}

export interface RubricSubsectionWithItems extends RubricSubsection {
  items: RubricItemWithResponse[];
}

export interface RubricSectionWithContent extends RubricSection {
  subsections: RubricSubsectionWithItems[];
}

/** Full rubric tree for one version, used to render the accordion. */
export interface RubricTree {
  version: RubricVersion;
  sections: RubricSectionWithContent[];
}

export interface ChapterIdentity {
  chapterKey: string;
  chapterName: string;
  district: string;
  region: string;
}

/** Submission joined with just enough chapter fields to render a review queue row. */
export interface SubmissionWithChapter extends Submission {
  chapter: Pick<
    Chapter,
    "chapter_key" | "chapter_name" | "district" | "region"
  > | null;
}

/** Reviewer assignment joined with chapter + reviewer display names, for the admin screen. */
export interface AssignmentWithNames extends ReviewerAssignment {
  chapter: Pick<
    Chapter,
    "chapter_key" | "chapter_name" | "district" | "region"
  > | null;
  district_director: Pick<Profile, "full_name" | "email"> | null;
  regional_vice_president: Pick<Profile, "full_name" | "email"> | null;
}

/** Rubric version joined with its section count, for the admin rubric list. */
export interface RubricVersionWithSectionCount extends RubricVersion {
  rubric_sections: { count: number }[];
}
