import { Hono } from "hono";
import type { App } from "../index";
import { renderPage } from "../lib/render";
import { getStore } from "../lib/store";
import { Badge, Callout, Card, Empty, Kpi, PageHead, Progress, ActionButton } from "../views/components";
import {
  answerTone,
  fmtDate,
  fmtPercent,
  periodLabel,
  reviewLabel,
  reviewTone,
  workflowLabel,
  workflowTone,
} from "../lib/format";
import { attachResponses, ANSWER_LABELS, isEligibleForExecutive, summarize } from "../lib/scoring";
import type { AnswerCode } from "../lib/types";

export const chapterRoutes = new Hono<{ Bindings: any; Variables: any }>();

async function requireChapter(c: any): Promise<{ session: any; chapter: any } | Response> {
  const session = c.get("session");
  if (session.role !== "chapter") return c.redirect("/");
  const store = getStore(c);
  const chapterId = session.chapterIds[0];
  const chapter = chapterId ? await store.getChapter(chapterId) : null;
  if (!chapter) {
    return c.html(
      "<p>No chapter is linked to this login. Ask the General Office to assign one.</p>",
      400
    );
  }
  return { session, chapter };
}

/* ---------------------------------------------------------------------- */
/* Chapter dashboard                                                      */
/* ---------------------------------------------------------------------- */
chapterRoutes.get("/chapter", async (c) => {
  const ctx = await requireChapter(c);
  if (ctx instanceof Response) return ctx;
  const { session, chapter } = ctx;
  const store = getStore(c);
  const period = await store.getCurrentPeriod();
  const submission = await store.getOrCreateSubmission(chapter.id, period);
  const history = await store.listSubmissionsForChapter(chapter.id);
  const detail = await store.getSubmissionDetail(submission.id);
  const reviewers = await store.getReviewerAssignment(chapter.id);
  const summary = detail
    ? summarize(
        detail.rubric.sections.flatMap((s) => s.subsections.flatMap((ss) => ss.items))
      )
    : { earned: 0, possible: 0, answered: 0, total: 0, percent: 0 };

  const body = (
    <>
      <PageHead
        title={chapter.chapter_name}
        lede={
          <>
            {chapter.chapter_type_code === "collegiate" ? "Collegiate" : "Alumni"} chapter ·{" "}
            {chapter.district} District · {chapter.region} Region · Key {chapter.chapter_key}
          </>
        }
        actions={
          <>
            <Badge tone={workflowTone(submission.workflow_status)}>
              {workflowLabel(submission.workflow_status)}
            </Badge>
            <a class="btn gold" href="/chapter/submission">
              Open Chapman Report
            </a>
          </>
        }
      />

      <div class="grid grid-kpi">
        <Kpi label="Current period" value={periodLabel(period.termCode, period.reportingYear)} tone="gold" />
        <Kpi
          label="Draft score"
          value={`${summary.earned} / ${summary.possible}`}
          note={`${summary.answered} of ${summary.total} items answered`}
          tone="blue"
        />
        <Kpi label="Completion" value={fmtPercent(summary.percent)} note="of scorable items answered" />
        <Kpi
          label="Review status"
          value={
            <span class="row" style="gap:6px;">
              <Badge tone={reviewTone(submission.district_review_status)}>
                DD {reviewLabel(submission.district_review_status)}
              </Badge>
              <Badge tone={reviewTone(submission.regional_review_status)}>
                RVP {reviewLabel(submission.regional_review_status)}
              </Badge>
            </span>
          }
        />
      </div>

      <div style="margin-top:16px;">
        <Card title="Your district, region &amp; reviewers">
          <div class="grid grid-2">
            <div>
              <div class="muted tiny">District</div>
              <div style="font-size:1.1rem;font-weight:700;">{chapter.district}</div>
            </div>
            <div>
              <div class="muted tiny">Region</div>
              <div style="font-size:1.1rem;font-weight:700;">{chapter.region}</div>
            </div>
            <div>
              <div class="muted tiny">District Director</div>
              <div style="font-size:1.1rem;font-weight:700;">
                {reviewers.districtDirector?.full_name || reviewers.districtDirector?.email || "Not yet assigned"}
              </div>
            </div>
            <div>
              <div class="muted tiny">Regional Vice President</div>
              <div style="font-size:1.1rem;font-weight:700;">
                {reviewers.regionalVp?.full_name || reviewers.regionalVp?.email || "Not yet assigned"}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div class="grid grid-2" style="margin-top:16px;">
        <Card title="Submission status tracker">
          <p class="muted small">
            Your submission moves to the District Director and the Regional Vice President at the
            same time. The Executive Director signs off last.
          </p>
          <div class="flow" style="margin-top:12px;">
            <div class="step">
              <span class="n">1</span>
              <strong>Chapter</strong>
              <div class="muted small">Complete &amp; submit</div>
            </div>
            <div class="step parallel">
              <span class="n">2</span>
              <strong>District + Regional</strong>
              <div class="muted small">Reviewed in parallel</div>
            </div>
            <div class="step">
              <span class="n">3</span>
              <strong>Executive</strong>
              <div class="muted small">Final approval</div>
            </div>
          </div>
          <p class="small muted" style="margin-top:12px;">
            Submitted: {fmtDate(submission.submitted_at)} · Max possible score:{" "}
            {submission.max_score}
          </p>
        </Card>

        <Card title="Submission history">
          <div class="table-wrap" style="max-height:320px;">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th class="num">Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((s: any) => (
                  <tr>
                    <td>{periodLabel(s.term_code, s.reporting_year)}</td>
                    <td class="num">
                      {s.final_score} / {s.max_score}
                    </td>
                    <td>
                      <Badge tone={workflowTone(s.workflow_status)}>
                        {workflowLabel(s.workflow_status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <Empty>No submissions yet.</Empty>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div style="margin-top:16px;">
        <Callout>
          <strong>Scoring:</strong> Yes = 1 point · No = 0 · N/A = baseline point for
          non-applicable items. Mandatory-item penalties are a planned future rule.
        </Callout>
      </div>
    </>
  );

  return renderPage(c, { title: chapter.chapter_name, session, body });
});

/* ---------------------------------------------------------------------- */
/* Chapter submission workspace                                           */
/* ---------------------------------------------------------------------- */
chapterRoutes.get("/chapter/submission", async (c) => {
  const ctx = await requireChapter(c);
  if (ctx instanceof Response) return ctx;
  const { session, chapter } = ctx;
  const store = getStore(c);
  const period = await store.getCurrentPeriod();
  const submission = await store.getOrCreateSubmission(chapter.id, period);
  const detail = await store.getSubmissionDetail(submission.id);
  if (!detail) return c.text("Rubric unavailable for this chapter type.", 500);

  const { rubric } = detail;
  const allItems = rubric.sections.flatMap((s) => s.subsections.flatMap((ss) => ss.items));
  const summary = summarize(allItems);
  const editable = ["draft", "returned"].includes(submission.workflow_status);
  const canWithdraw =
    submission.workflow_status === "submitted" &&
    submission.district_review_status === "pending" &&
    submission.regional_review_status === "pending";

  const body = (
    <>
      <PageHead
        title="Chapman Report"
        lede={
          <>
            {chapter.chapter_name} ({chapter.chapter_key}) ·{" "}
            {periodLabel(period.termCode, period.reportingYear)} ·{" "}
            {rubric.version.version_name}
          </>
        }
        actions={
          <>
            <Badge tone={workflowTone(submission.workflow_status)}>
              {workflowLabel(submission.workflow_status)}
            </Badge>
            <a class="btn secondary" href="/chapter">Back to dashboard</a>
          </>
        }
      />

      <Card>
        <div class="row">
          <div style="min-width:240px;">
            <div class="muted tiny">Draft score</div>
            <div style="font-size:1.6rem;font-weight:800;">
              {summary.earned} / {summary.possible}
            </div>
            <Progress percent={summary.percent} />
            <div class="tiny muted" style="margin-top:4px;">
              {summary.answered} of {summary.total} items answered · {fmtPercent(summary.percent)}
            </div>
          </div>
          <div class="spacer" />
          {editable ? (
            <ActionButton
              action="/chapter/submission/submit"
              hidden={{ submissionId: submission.id }}
              label="Submit for review"
              variant="gold"
              confirm="Submit this report for District and Regional review? You won't be able to edit until it's reviewed."
            />
          ) : canWithdraw ? (
            <div class="row" style="gap:10px;align-items:center;">
              <Badge tone="blue">Submitted — awaiting a reviewer</Badge>
              <ActionButton
                action="/chapter/submission/withdraw"
                hidden={{ submissionId: submission.id }}
                label="Withdraw submission"
                variant="secondary"
                confirm="Pull this report back to draft so you can edit it? You'll need to submit it again when you're done."
              />
            </div>
          ) : (
            <Badge tone="blue">
              Locked — {reviewLabel(submission.district_review_status)} by reviewers
            </Badge>
          )}
        </div>
        {canWithdraw ? (
          <p class="tiny muted" style="margin-top:10px;">
            No reviewer has acted on this yet, so you can still pull it back and make changes.
            Once a District Director or RVP responds, this option goes away.
          </p>
        ) : null}
        <div style="margin-top:12px;">
          <Callout>
            <strong>Yes = 1</strong> · <strong>No = 0</strong> ·{" "}
            <strong>N/A = baseline 1</strong> (non-applicable items are not held against your
            chapter). Marked <span style="color:var(--red);font-weight:700;">Required</span> items
            may carry a penalty in a future phase.
          </Callout>
        </div>
      </Card>

      {rubric.sections.map((section) => (
        <>
          <div class="section-band">{section.section_name}</div>
          {section.subsections.map((ss) => (
            <>
              <div class="subsection-head">{ss.subsection_name}</div>
              <div class="card" style="padding:4px 8px;">
                {ss.items.map((item) => {
                  const ans = item.response?.answer_code;
                  return (
                    <div class="criterion">
                      <div>
                        <span class="code">{item.criterion_code}</span>
                        {item.is_required ? <span class="req">Required</span> : null}
                        <div>{item.criterion_text}</div>
                        <div class="type">
                          {item.item_type === "metric" ? "Reporting item" : "Activity item"}
                        </div>
                      </div>
                      {editable ? (
                        <div class="answer-set">
                          {(["yes", "no", "na"] as AnswerCode[]).map((code) => (
                            <form method="post" action="/chapter/submission/answer">
                              <input type="hidden" name="submissionId" value={submission.id} />
                              <input type="hidden" name="itemId" value={item.id} />
                              <input type="hidden" name="answer" value={code} />
                              <button
                                class={`answer-btn ${code} ${ans === code ? "on" : ""}`}
                                type="submit"
                              >
                                {ANSWER_LABELS[code]}
                              </button>
                            </form>
                          ))}
                        </div>
                      ) : (
                        <span class={`badge ${answerTone(ans)}`}>
                          {ans ? ANSWER_LABELS[ans] : "Not answered"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ))}
        </>
      ))}
    </>
  );

  return renderPage(c, { title: "Chapman Report", session, body });
});

chapterRoutes.post("/chapter/submission/answer", async (c) => {
  const ctx = await requireChapter(c);
  if (ctx instanceof Response) return ctx;
  const form = await c.req.formData();
  const submissionId = String(form.get("submissionId"));
  const itemId = String(form.get("itemId"));
  const answer = String(form.get("answer")) as AnswerCode;
  const store = getStore(c);
  const submission = await store.getSubmission(submissionId);
  if (submission && ["draft", "returned"].includes(submission.workflow_status)) {
    await store.setResponse(submissionId, itemId, answer);
  }
  return c.redirect("/chapter/submission");
});

chapterRoutes.post("/chapter/submission/submit", async (c) => {
  const ctx = await requireChapter(c);
  if (ctx instanceof Response) return ctx;
  const form = await c.req.formData();
  const submissionId = String(form.get("submissionId"));
  const store = getStore(c);
  const submission = await store.getSubmission(submissionId);
  if (submission && ["draft", "returned"].includes(submission.workflow_status)) {
    await store.submitReport(submissionId);
  }
  return c.redirect("/chapter");
});

/**
 * Lets a chapter pull its own report back to draft after submitting it,
 * but only while neither reviewer has acted yet - the UI already hides
 * this once either lane leaves "pending" (app/chapter dashboards' isEditable-
 * style gating), but this is the real guard, matching what RLS + the
 * enforce_submission_transition trigger (0007) now enforce server-side.
 */
chapterRoutes.post("/chapter/submission/withdraw", async (c) => {
  const ctx = await requireChapter(c);
  if (ctx instanceof Response) return ctx;
  const form = await c.req.formData();
  const submissionId = String(form.get("submissionId"));
  const store = getStore(c);
  const submission = await store.getSubmission(submissionId);
  if (
    submission &&
    submission.workflow_status === "submitted" &&
    submission.district_review_status === "pending" &&
    submission.regional_review_status === "pending"
  ) {
    await store.withdrawSubmission(submissionId);
  }
  return c.redirect("/chapter/submission");
});

/* ---------------------------------------------------------------------- */
/* Chapter's own uploaded documents                                       */
/* ---------------------------------------------------------------------- */
chapterRoutes.get("/chapter/documents", async (c) => {
  const ctx = await requireChapter(c);
  if (ctx instanceof Response) return ctx;
  const { session, chapter } = ctx;
  const store = getStore(c);
  const types = await store.listDocumentTypes();
  const docs = await store.listDocuments({ chapterId: chapter.id, limit: 200 });

  const body = (
    <>
      <PageHead
        title="My Documents"
        lede="Uploads filed against your chapter — tax documents and special event checklists."
        actions={<a class="btn secondary" href="/chapter">Back to dashboard</a>}
      />
      <Card title="Document types">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Category</th>
                <th>Accepted formats</th>
                <th class="num">Max size</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr>
                  <td>
                    <strong>{t.label}</strong>
                    {t.description ? <div class="tiny muted">{t.description}</div> : null}
                  </td>
                  <td>
                    <Badge tone={t.category === "tax" ? "gold" : "blue"}>{t.category}</Badge>
                  </td>
                  <td class="mono tiny">{t.allowed_extensions.join(", ")}</td>
                  <td class="num">{t.max_size_mb} MB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div style="margin-top:16px;">
        <Card title={`Uploaded documents (${docs.length})`}>
          {docs.length === 0 ? (
            <Empty>No documents uploaded yet.</Empty>
          ) : (
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Uploaded</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d: any) => (
                    <tr>
                      <td>{d.file_name}</td>
                      <td class="mono tiny">{d.document_type_code}</td>
                      <td>{fmtDate(d.created_at)}</td>
                      <td>
                        <Badge tone={d.status === "accepted" ? "green" : "amber"}>
                          {d.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );

  return renderPage(c, { title: "My Documents", session, body });
});
