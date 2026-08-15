import type { ReportingTermRow } from "@/types/domain";

/**
 * Plain GET form (no client JS needed) — picks a term/year and resubmits
 * the current page with ?period=<term>:<year>.
 */
export function TermYearFilter({
  terms,
  currentTerm,
  currentYear,
}: {
  terms: ReportingTermRow[];
  currentTerm: string;
  currentYear: number;
}) {
  const currentValue = `${currentTerm}:${currentYear}`;
  const options = terms.some(
    (t) => t.term_code === currentTerm && t.reporting_year === currentYear
  )
    ? terms
    : [{ term_code: currentTerm, reporting_year: currentYear }, ...terms];

  return (
    <form method="get" className="flex items-center gap-2">
      <label className="text-xs font-semibold text-chapman-muted">
        Period
      </label>
      <select
        name="period"
        defaultValue={currentValue}
        className="rounded-lg border border-chapman-line px-3 py-2 text-sm capitalize"
      >
        {options.map((t) => {
          const value = `${t.term_code}:${t.reporting_year}`;
          return (
            <option key={value} value={value} className="capitalize">
              {t.term_code} {t.reporting_year}
            </option>
          );
        })}
      </select>
      <button
        type="submit"
        className="rounded-lg bg-chapman-gold px-3 py-2 text-sm font-bold text-white transition hover:brightness-95"
      >
        Apply
      </button>
    </form>
  );
}
