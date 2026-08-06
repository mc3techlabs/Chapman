import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ReportTermCode } from "@/types/database";

type Client = SupabaseClient<Database>;

export interface RollupFilter {
  termCode?: ReportTermCode;
  reportingYear?: number;
}

export async function getDistrictRollup(supabase: Client, filter?: RollupFilter) {
  let query = supabase.from("v_district_rollup").select("*");
  if (filter?.termCode) query = query.eq("term_code", filter.termCode);
  if (filter?.reportingYear) query = query.eq("reporting_year", filter.reportingYear);
  const { data } = await query.order("district");
  return data ?? [];
}

export async function getRegionRollup(supabase: Client, filter?: RollupFilter) {
  let query = supabase.from("v_region_rollup").select("*");
  if (filter?.termCode) query = query.eq("term_code", filter.termCode);
  if (filter?.reportingYear) query = query.eq("reporting_year", filter.reportingYear);
  const { data } = await query.order("region");
  return data ?? [];
}

export async function getNationalRollup(supabase: Client, filter?: RollupFilter) {
  let query = supabase.from("v_national_rollup").select("*");
  if (filter?.termCode) query = query.eq("term_code", filter.termCode);
  if (filter?.reportingYear) query = query.eq("reporting_year", filter.reportingYear);
  const { data } = await query.order("reporting_year", { ascending: false });
  return data ?? [];
}

export async function getSubmissionRollupForRegion(
  supabase: Client,
  region: string,
  filter?: RollupFilter
) {
  let query = supabase.from("v_submission_rollup").select("*").eq("region", region);
  if (filter?.termCode) query = query.eq("term_code", filter.termCode);
  if (filter?.reportingYear) query = query.eq("reporting_year", filter.reportingYear);
  const { data } = await query.order("chapter_name");
  return data ?? [];
}

export async function getSubmissionRollupForDistrict(
  supabase: Client,
  district: string,
  filter?: RollupFilter
) {
  let query = supabase
    .from("v_submission_rollup")
    .select("*")
    .eq("district", district);
  if (filter?.termCode) query = query.eq("term_code", filter.termCode);
  if (filter?.reportingYear) query = query.eq("reporting_year", filter.reportingYear);
  const { data } = await query.order("chapter_name");
  return data ?? [];
}
