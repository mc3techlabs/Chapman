import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ChapterTypeCode } from "@/types/database";
import type {
  RubricTree,
  RubricSectionWithContent,
  RubricSubsectionWithItems,
  RubricItemWithResponse,
  SubmissionItemResponse,
} from "@/types/domain";

type Client = SupabaseClient<Database>;

export async function getActiveRubricVersion(
  supabase: Client,
  chapterTypeCode: ChapterTypeCode
) {
  const { data } = await supabase
    .from("rubric_versions")
    .select("*")
    .eq("chapter_type_code", chapterTypeCode)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Builds the full section -> subsection -> item tree for a rubric version,
 * optionally joined with a submission's saved responses so the workspace
 * and review queues can render current answers.
 */
export async function getRubricTree(
  supabase: Client,
  rubricVersionId: string,
  submissionId?: string
): Promise<RubricTree | null> {
  const [{ data: version }, { data: sections }, { data: items }] =
    await Promise.all([
      supabase
        .from("rubric_versions")
        .select("*")
        .eq("id", rubricVersionId)
        .maybeSingle(),
      supabase
        .from("rubric_sections")
        .select("*")
        .eq("rubric_version_id", rubricVersionId)
        .eq("active", true)
        .order("display_order"),
      supabase
        .from("rubric_items")
        .select("*")
        .eq("rubric_version_id", rubricVersionId)
        .eq("active", true)
        .order("display_order"),
    ]);

  if (!version || !sections) return null;

  const subsections =
    sections.length > 0
      ? (
          await supabase
            .from("rubric_subsections")
            .select("*")
            .in(
              "rubric_section_id",
              sections.map((s) => s.id)
            )
            .eq("active", true)
            .order("display_order")
        ).data
      : [];

  let responsesByItemId = new Map<string, SubmissionItemResponse>();
  if (submissionId) {
    const { data: responses } = await supabase
      .from("submission_item_responses")
      .select("*")
      .eq("submission_id", submissionId);
    responsesByItemId = new Map(
      (responses ?? []).map((response) => [response.rubric_item_id, response])
    );
  }

  const itemsWithResponse: RubricItemWithResponse[] = (items ?? []).map(
    (item) => ({ ...item, response: responsesByItemId.get(item.id) ?? null })
  );

  const subsectionTree: RubricSubsectionWithItems[] = (subsections ?? []).map(
    (subsection) => ({
      ...subsection,
      items: itemsWithResponse
        .filter((item) => item.rubric_subsection_id === subsection.id)
        .sort((a, b) => a.display_order - b.display_order),
    })
  );

  const sectionTree: RubricSectionWithContent[] = sections.map((section) => ({
    ...section,
    subsections: subsectionTree
      .filter((subsection) => subsection.rubric_section_id === section.id)
      .sort((a, b) => a.display_order - b.display_order),
  }));

  return { version, sections: sectionTree };
}
