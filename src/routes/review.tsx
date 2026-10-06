import { Hono } from "hono";
import { renderPage } from "../lib/render";
import { getStore } from "../lib/store";
import { Badge, Callout, Card, Empty, Kpi, PageHead, ActionButton } from "../views/components";
import {
  chapterIdentity,
  fmtDate,
  fmtDateTime,
  fmtPercent,
  periodLabel,
  reviewLabel,
  reviewTone,
  workflowLabel,
  workflowTone,
} from "../lib/format";
import { summarize, ANSWER_LABELS, isEligibleForExecutive } from "../lib/scoring";
import { answerTone } from "../lib/format";

export const reviewRoutes = new Hono<{ Bindings: any; Variables: any }>();

type ReviewerRole = "district_director" | "rvp" | "executive_director";

const LANE: Record<
  ReviewerRole,
  { base: string; title: string; scopeLabel: string; approveLabel: string }
> = {
  district_director: {
    base: "/district",
    title: "District Review",
    scopeLabel: "District",
    approveLabel: "Approve (District)",
  },
  rvp: {
    base: "/region",
    title: "Regional Review",
    scopeLabel: "Region",
    approveLabel: "Approve (Regional)",
  },
  executive_director: {
    base: "/national",
    title: "Executive Final Approval",
    scopeLabel: "National",
    approveLabel: "Final Approval",
  },
};

/* ---------------------------------------------------------------------- */
/* Shared: reviewer dashboard                                             */
/* ---------------------------------------------------------------------- */
async function renderReviewerDashboard(c: any, role: ReviewerRole) {
  const session = c.get("session");
  if (session.role !== role) return c.redirect("/");
  const store = getStore(c);
  const period = await store.getCurrentPeriod();
  const queue = await store.listReviewQueue(role, period);
  const all = await store.listVisibleSubmissions(period);
  const lane = LANE[role];

  const scopeName =
    role === "district_director" ? session.district : role === "rvp" ? session.region : "All Regions";

  const awaiting = queue.filter((s) => s.workflow_status !== "finalized");
  const finalized = all.filter((s) => s.workflow_status === "finalized");
  const returned = all.filter((s) => s.workflow_status === "returned");

  // Full chapter roster for the lane's scope (district_director/rvp only -
  // executive_director's scope is the whole national roster, already served
  // by /national/rollups and /national/approvals). listVisibleSubmissions
  // only returns chapters that have started a submission this period, so a
  // chapter with none yet wouldn't appear there - the roster fills in those
  // as "Not started" instead of silently omitting them.
  const roster =
    role === "district_director" && session.district
      ? (await store.listChapters({ district: session.district, limit: 1000 })).rows
      : role === "rvp" && session.region
      ? (await store.listChapters({ region: session.region, limit: 1000 })).rows
      : [];
  const submissionByChapter = new Map(all.map((s) => [s.chapter.id, s]));

  const body = (
    <>
      <PageHead
        title={`${lane.title} — ${scopeName}`}
        lede={
          role === "executive_director"
            ? "Submissions become eligible for national sign-off only after BOTH district and regional reviews approve."
            : `${lane.scopeLabel} oversight of chapter completion and compliance for ${periodLabel(
                period.termCode,
                period.reportingYear
              )}.`
        }
        actions={
          <>
            <Badge tone="gold">{periodLabel(period.termCode, period.reportingYear)}</Badge>
            <a class="btn gold" href={`${lane.base}/${role === "executive_director" ? "approvals" : "review"}`}>
              {role === "executive_director" ? "Open approval queue" : "Open review queue"}
            </a>
          </>
        }
      />

      <div class="grid grid-kpi">
        <Kpi label="Chapters in scope" value={all.length} tone="gold" />
        <Kpi
          label={role === "executive_director" ? "Awaiting final approval" : "Awaiting your review"}
          value={awaiting.length}
          tone={awaiting.length ? "amber" : "green"}
        />
        <Kpi label="Finalized" value={finalized.length} tone="green" />
        <Kpi label="Returned for revision" value={returned.length} tone="red" />
      </div>

      <div class="grid grid-2" style="margin-top:16px;">
        <Card title="Queue">
          {awaiting.length === 0 ? (
            <Empty>Nothing awaiting your review right now.</Empty>
          ) : (
            awaiting.slice(0, 12).map((s) => (
              <div class="queue-item">
                <div>
                  <div class="who">{s.chapter.chapter_name}</div>
                  <div class="meta">
                    {s.chapter.chapter_key} · {s.chapter.district} / {s.chapter.region} · score{" "}
                    {s.final_score}/{s.max_score}
                  </div>
                  <div class="row" style="margin-top:6px;gap:6px;">
                    <Badge tone={reviewTone(s.district_review_status)}>
                      DD {reviewLabel(s.district_review_status)}
                    </Badge>
                    <Badge tone={reviewTone(s.regional_review_status)}>
                      RVP {reviewLabel(s.regional_review_status)}
                    </Badge>
                    <Badge tone={workflowTone(s.workflow_status)}>
                      {workflowLabel(s.workflow_status)}
                    </Badge>
                  </div>
                </div>
                <a
                  class="btn gold small"
                  href={`${lane.base}/${role === "executive_director" ? "approvals" : "review"}/${s.id}`}
                >
                  Review
                </a>
              </div>
            ))
          )}
        </Card>

        <Card title="How this lane works">
          <Callout tone={role === "executive_director" ? "blue" : "gold"}>
            {role === "district_director" &&
              "You and the Regional Vice President review the SAME submission at the same time. Either of you can approve or return it for revision. Reviewers never edit the chapter's answers."}
            {role === "rvp" &&
              "You and the District Director review the SAME submission in parallel. Approve independently; the Executive Director is unlocked only once both lanes approve."}
            {role === "executive_director" &&
              "Only submissions with BOTH district and regional approvals appear here. Your approval finalizes the chapter's report for the period."}
          </Callout>
          <div class="flow" style="margin-top:14px;">
            <div class="step">
              <span class="n">1</span>
              <strong>Chapter submits</strong>
            </div>
            <div class="step parallel">
              <span class="n">2</span>
              <strong>DD + RVP (parallel)</strong>
            </div>
            <div class="step">
              <span class="n">3</span>
              <strong>Executive final</strong>
            </div>
          </div>
        </Card>
      </div>

      {roster.length > 0 ? (
        <div style="margin-top:16px;">
          <Card title={`Chapters in ${scopeName} (${roster.length})`}>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Chapter</th>
                    <th class="num">Score</th>
                    <th>Status</th>
                    <th>Lanes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((ch) => {
                    const s = submissionByChapter.get(ch.id);
                    return (
                      <tr>
                        <td>
                          <strong>{ch.chapter_name}</strong>
                          <div class="tiny muted">Key {ch.chapter_key}</div>
                        </td>
                        <td class="num">{s ? `${s.final_score} / ${s.max_score}` : "—"}</td>
                        <td>
                          {s ? (
                            <Badge tone={workflowTone(s.workflow_status)}>
                              {workflowLabel(s.workflow_status)}
                            </Badge>
                          ) : (
                            <Badge tone="gray">Not started</Badge>
                          )}
                        </td>
                        <td>
                          {s ? (
                            <div class="row" style="gap:6px;">
                              <Badge tone={reviewTone(s.district_review_status)}>
                                DD {reviewLabel(s.district_review_status)}
                              </Badge>
                              <Badge tone={reviewTone(s.regional_review_status)}>
                                RVP {reviewLabel(s.regional_review_status)}
                              </Badge>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {s ? (
                            <a class="btn secondary small" href={`${lane.base}/review/${s.id}`}>
                              {s.workflow_status === "finalized" ? "View" : "Review"}
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );

  return renderPage(c, { title: lane.title, session, body });
}

/* ---------------------------------------------------------------------- */
/* Review queue page (district / region)                                  */
/* ---------------------------------------------------------------------- */
async function renderReviewQueue(c: any, role: ReviewerRole) {
  const session = c.get("session");
  if (session.role !== role) return c.redirect("/");
  const store = getStore(c);
  const period = await store.getCurrentPeriod();
  const queue = await store.listReviewQueue(role, period);
  const lane = LANE[role];

  const body = (
    <>
      <PageHead
        title="Review queue"
        lede={`Submissions currently in your lane. Approve or return each for revision.`}
        actions={<a class="btn secondary" href={lane.base}>Back to dashboard</a>}
      />
      <Card>
        {queue.length === 0 ? (
          <Empty>No submissions awaiting review.</Empty>
        ) : (
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Chapter</th>
                  <th>District / Region</th>
                  <th class="num">Score</th>
                  <th>Lanes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((s) => (
                  <tr>
                    <td>
                      <strong>{s.chapter.chapter_name}</strong>
                      <div class="tiny muted">Key {s.chapter.chapter_key}</div>
                    </td>
                    <td class="small">
                      {s.chapter.district}
                      <div class="tiny muted">{s.chapter.region}</div>
                    </td>
                    <td class="num">
                      {s.final_score} / {s.max_score}
                    </td>
                    <td>
                      <div class="row" style="gap:6px;">
                        <Badge tone={reviewTone(s.district_review_status)}>
                          DD {reviewLabel(s.district_review_status)}
                        </Badge>
                        <Badge tone={reviewTone(s.regional_review_status)}>
                          RVP {reviewLabel(s.regional_review_status)}
                        </Badge>
                      </div>
                    </td>
                    <td>
                      <a class="btn gold small" href={`${lane.base}/review/${s.id}`}>
                        Review
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
  return renderPage(c, { title: "Review queue", session, body });
}

/* ---------------------------------------------------------------------- */
/* Single submission review                                               */
/* ---------------------------------------------------------------------- */
async function renderReviewDetail(c: any, role: ReviewerRole, submissionId: string) {
  const session = c.get("session");
  if (session.role !== role) return c.redirect("/");
  const store = getStore(c);
  const detail = await store.getSubmissionDetail(submissionId);
  if (!detail) return c.text("Submission not found", 404);
  const { submission, rubric } = detail;
  const allItems = rubric.sections.flatMap((s) => s.subsections.flatMap((ss) => ss.items));
  const summary = summarize(allItems);
  const actions = await store.listApprovalActions(submissionId);
  const lane = LANE[role];
  const backHref = role === "executive_director" ? "/national/approvals" : `${lane.base}/review`;

  const bothApproved = isEligibleForExecutive(submission);
  const canApprove =
    role === "executive_director"
      ? bothApproved && submission.workflow_status !== "finalized"
      : submission.workflow_status !== "finalized";

  const body = (
    <>
      <PageHead
        title={submission.chapter.chapter_name}
        lede={
          <>
            {chapterIdentity(submission.chapter)} ·{" "}
            {periodLabel(submission.term_code, submission.reporting_year)} ·{" "}
            {rubric.version.version_name}
          </>
        }
        actions={
          <>
            <Badge tone={workflowTone(submission.workflow_status)}>
              {workflowLabel(submission.workflow_status)}
            </Badge>
            <a class="btn secondary" href={backHref}>Back to queue</a>
          </>
        }
      />

      <div class="grid grid-kpi">
        <Kpi label="Score" value={`${summary.earned} / ${summary.possible}`} tone="gold" />
        <Kpi label="Completion" value={fmtPercent(summary.percent)} tone="blue" />
        <Kpi
          label="District lane"
          value={reviewLabel(submission.district_review_status)}
          tone={submission.district_review_status === "approved" ? "green" : "amber"}
        />
        <Kpi
          label="Regional lane"
          value={reviewLabel(submission.regional_review_status)}
          tone={submission.regional_review_status === "approved" ? "green" : "amber"}
        />
      </div>

      <div class="grid grid-2" style="margin-top:16px;">
        <Card title="Your decision">
          {role === "executive_director" && !bothApproved ? (
            <Callout tone="red">
              This submission is not yet eligible — both the District Director and the Regional Vice
              President must approve before final sign-off.
            </Callout>
          ) : (
            <form method="post" action={`${lane.base}/review/${submissionId}/decision`} class="stack">
              <label class="field">
                <span>Comment (required when returning)</span>
                <textarea name="comment" rows={3} placeholder="Notes visible to the chapter and the audit trail" />
              </label>
              <div class="row">
                <button class="btn green" type="submit" name="decision" value="approve" disabled={!canApprove}>
                  {lane.approveLabel}
                </button>
                {role !== "executive_director" ? (
                  <button class="btn red" type="submit" name="decision" value="return">
                    Return for revision
                  </button>
                ) : null}
              </div>
            </form>
          )}
          {role === "executive_director" && submission.workflow_status === "finalized" ? (
            <Callout tone="green">This submission is finalized. National sign-off recorded.</Callout>
          ) : null}
        </Card>

        <Card title="Approval trail">
          {actions.length === 0 ? (
            <Empty>No actions recorded yet.</Empty>
          ) : (
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Action</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a: any) => (
                    <tr>
                      <td>{a.reviewer_role_code.replace(/_/g, " ")}</td>
                      <td>
                        <Badge tone={a.action === "approved" ? "green" : a.action === "returned" ? "red" : "gray"}>
                          {a.action}
                        </Badge>
                        {a.action_comment ? <div class="tiny muted">{a.action_comment}</div> : null}
                      </td>
                      <td class="small">{fmtDateTime(a.action_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div style="margin-top:16px;">
        <Callout>
          Reviewers approve or return — they do not edit the chapter's answers. The chapter's
          submission is a frozen snapshot of the rubric version and responses at submit time.
        </Callout>
      </div>

      {rubric.sections.map((section) => (
        <>
          <div class="section-band">{section.section_name}</div>
          {section.subsections.map((ss) => (
            <div class="card" style="margin-bottom:10px;">
              <div class="subsection-head">{ss.subsection_name}</div>
              {ss.items.map((item) => (
                <div class="criterion">
                  <div>
                    <span class="code">{item.criterion_code}</span>
                    {item.is_required ? <span class="req">Required</span> : null}
                    <div>{item.criterion_text}</div>
                  </div>
                  <span class={`badge ${answerTone(item.response?.answer_code)}`}>
                    {item.response ? ANSWER_LABELS[item.response.answer_code] : "Not answered"}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </>
      ))}
    </>
  );

  return renderPage(c, { title: "Review submission", session, body });
}

/* ---------------------------------------------------------------------- */
/* Decision handler                                                       */
/* ---------------------------------------------------------------------- */
async function handleDecision(c: any, role: ReviewerRole, submissionId: string) {
  const session = c.get("session");
  if (session.role !== role) return c.redirect("/");
  const form = await c.req.formData();
  const decision = String(form.get("decision") ?? "");
  const comment = String(form.get("comment") ?? "");
  const store = getStore(c);
  if (decision === "approve") {
    if (role === "executive_director") {
      const sub = await store.getSubmission(submissionId);
      if (sub && !isEligibleForExecutive(sub)) {
        return c.redirect(`/national/approvals/${submissionId}`);
      }
    }
    await store.approve(submissionId, role, comment || undefined);
  } else if (decision === "return") {
    if (role === "district_director" || role === "rvp") {
      await store.returnSubmission(submissionId, role, comment || "Returned for revision");
    }
  }
  return c.redirect(role === "executive_director" ? "/national/approvals" : `${LANE[role].base}/review`);
}

/* ---------------------------------------------------------------------- */
/* Route registrations                                                    */
/* ---------------------------------------------------------------------- */
reviewRoutes.get("/district", (c) => renderReviewerDashboard(c, "district_director"));
reviewRoutes.get("/district/review", (c) => renderReviewQueue(c, "district_director"));
reviewRoutes.get("/district/review/:id", (c) => renderReviewDetail(c, "district_director", c.req.param("id")));
reviewRoutes.post("/district/review/:id/decision", (c) => handleDecision(c, "district_director", c.req.param("id")));

reviewRoutes.get("/region", (c) => renderReviewerDashboard(c, "rvp"));
reviewRoutes.get("/region/review", (c) => renderReviewQueue(c, "rvp"));
reviewRoutes.get("/region/review/:id", (c) => renderReviewDetail(c, "rvp", c.req.param("id")));
reviewRoutes.post("/region/review/:id/decision", (c) => handleDecision(c, "rvp", c.req.param("id")));

reviewRoutes.get("/national", (c) => renderReviewerDashboard(c, "executive_director"));
reviewRoutes.get("/national/approvals", (c) => renderReviewQueue(c, "executive_director"));
reviewRoutes.get("/national/approvals/:id", (c) =>
  renderReviewDetail(c, "executive_director", c.req.param("id"))
);
reviewRoutes.post("/national/approvals/:id/decision", (c) =>
  handleDecision(c, "executive_director", c.req.param("id"))
);
