import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ReportTermCode } from "@/types/database";

type Client = SupabaseClient<Database>;

export interface ReportingPeriod {
  termCode: ReportTermCode;
  reportingYear: number;
}

/**
 * Resolves the term/year a chapter should be submitting for right now.
 * Prefers an active row in `reporting_windows`; falls back to a calendar
 * default (Jan-Jun -> spring, Jul-Dec -> fall) so the app is usable before
 * an admin has configured windows.
 */
export async function getCurrentReportingPeriod(
  supabase: Client
): Promise<ReportingPeriod> {
  const { data: window } = await supabase
    .from("reporting_windows")
    .select("term_code, reporting_year")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (window?.reporting_year) {
    return { termCode: window.term_code, reportingYear: window.reporting_year };
  }

  const now = new Date();
  const termCode: ReportTermCode = now.getMonth() < 6 ? "spring" : "fall";
  return { termCode, reportingYear: now.getFullYear() };
}
