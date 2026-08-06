import type { WorkflowStatus, ReviewStatus } from "@/types/database";

const WORKFLOW_STYLES: Record<WorkflowStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-chapman-blue-soft text-chapman-blue",
  returned: "bg-chapman-red-soft text-chapman-red",
  pending_executive: "bg-chapman-amber-soft text-[#8a6400]",
  finalized: "bg-chapman-green-soft text-chapman-green",
};

const WORKFLOW_LABEL: Record<WorkflowStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  returned: "Returned for Revision",
  pending_executive: "Pending Executive Approval",
  finalized: "Finalized",
};

const REVIEW_STYLES: Record<ReviewStatus, string> = {
  pending: "bg-chapman-amber-soft text-[#8a6400]",
  approved: "bg-chapman-green-soft text-chapman-green",
  returned: "bg-chapman-red-soft text-chapman-red",
};

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  returned: "Returned",
};

function Badge({ className, children }: { className: string; children: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${className}`}
    >
      {children}
    </span>
  );
}

export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  return <Badge className={WORKFLOW_STYLES[status]}>{WORKFLOW_LABEL[status]}</Badge>;
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <Badge className={REVIEW_STYLES[status]}>{REVIEW_LABEL[status]}</Badge>;
}
