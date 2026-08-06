interface ReviewActionPanelProps {
  approveAction: (formData: FormData) => Promise<void>;
  returnAction: (formData: FormData) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}

export function ReviewActionPanel({
  approveAction,
  returnAction,
  disabled,
  disabledReason,
}: ReviewActionPanelProps) {
  if (disabled) {
    return (
      <div className="rounded-xl border border-chapman-line bg-gray-50 px-4 py-3 text-sm text-chapman-muted">
        {disabledReason ?? "No action available for this submission."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-chapman-line bg-chapman-panel p-4">
      <form action={approveAction}>
        <button
          type="submit"
          className="w-full rounded-lg bg-chapman-green px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
        >
          Approve
        </button>
      </form>

      <form action={returnAction} className="flex flex-col gap-2">
        <label htmlFor="comment" className="text-xs font-semibold text-chapman-muted">
          Reason for return (required)
        </label>
        <textarea
          id="comment"
          name="comment"
          required
          rows={3}
          className="rounded-lg border border-chapman-line px-3 py-2 text-sm outline-none focus:border-chapman-gold"
        />
        <button
          type="submit"
          className="w-full rounded-lg bg-chapman-red px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
        >
          Return for Revision
        </button>
      </form>
    </div>
  );
}
