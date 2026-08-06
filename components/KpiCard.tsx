export function KpiCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border border-chapman-line bg-chapman-panel px-5 py-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-chapman-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold text-chapman-ink">
        {value}
      </div>
      {sublabel && (
        <div className="mt-0.5 text-xs text-chapman-muted">{sublabel}</div>
      )}
    </div>
  );
}
