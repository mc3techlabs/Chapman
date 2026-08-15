import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ReportTermCode } from "@/types/database";

type Client = SupabaseClient<Database>;

export interface ReportingPeriod {
  termCode: ReportTermCode;
  reportingYear: number;
}

const VALID_TERM_CODES: ReportTermCode[] = ["fall", "spring"];

/**
 * Resolves the term/year a dashboard should show from a `?period=term:year`
 * query param, falling back to the current reporting period when the param
 * is absent, malformed, or names a term code we don't recognize — used by
 * every dashboard page so the same parsing/validation lives in one place.
 */
export async function resolveRequestedPeriod(
  supabase: Client,
  periodParam: string | undefined
): Promise<ReportingPeriod> {
  if (periodParam && periodParam.includes(":")) {
    const [t, y] = periodParam.split(":");
    const reportingYear = Number(y);
    if (
      VALID_TERM_CODES.includes(t as ReportTermCode) &&
      Number.isInteger(reportingYear)
    ) {
      return { termCode: t as ReportTermCode, reportingYear };
    }
  }
  return getCurrentReportingPeriod(supabase);
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
