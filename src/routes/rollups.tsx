import { Hono } from "hono";
import { renderPage } from "../lib/render";
import { getStore } from "../lib/store";
import { Badge, Card, Empty, Kpi, MiniBar, PageHead } from "../views/components";
import { fmtNumber, fmtPercent, periodLabel } from "../lib/format";
import { toCsv, csvResponse } from "../lib/csv";

export const rollupRoutes = new Hono<{ Bindings: any; Variables: any }>();

/* ---------------------------------------------------------------------- */
/* District / regional / national rollups                                 */
/* ---------------------------------------------------------------------- */
async function renderRollups(c: any, view: "admin" | "executive") {
  const session = c.get("session");
  if (view === "admin" && session.role !== "admin") return c.redirect("/");
  if (view === "executive" && session.role !== "executive_director") return c.redirect("/");

  const store = getStore(c);
  const period = await store.getCurrentPeriod();
  const [district, region, national] = await Promise.all([
    store.getDistrictRollups(period),
    store.getRegionRollups(period),
    store.getNationalRollup(period),
  ]);

  const back = view === "admin" ? "/admin" : "/national";

  const body = (
    <>
      <PageHead
        title={view === "admin" ? "National rollups" : "National rollups"}
        lede={`Completion, approvals and scores across every level — ${periodLabel(
          period.termCode,
          period.reportingYear
        )}.`}
        actions={
          <>
            <a class="btn secondary" href={`/rollups/export?view=${view}`}>Export CSV</a>
            <a class="btn secondary" href={back}>Back</a>
          </>
        }
      />

      {national ? (
        <div class="grid grid-kpi">
          <Kpi
            label="National completion"
            value={fmtPercent(national.completion_rate_pct)}
            note={`${national.chapters_started} of ${national.chapters_total} chapters started`}
            tone="gold"
          />
          <Kpi
            label="Finalized"
            value={fmtNumber(national.chapters_finalized)}
            note={`${fmtNumber(national.pending_executive)} awaiting executive`}
            tone="green"
          />
          <Kpi
            label="Average score"
            value={fmtPercent(national.avg_score_pct)}
            note={`${fmtNumber(national.points_earned)} / ${fmtNumber(national.points_possible)} points`}
            tone="blue"
          />
          <Kpi
            label="Coverage"
            value={`${national.regions_total} regions`}
            note={`${national.districts_total} districts`}
          />
        </div>
      ) : (
        <Empty>No national rollup available for this period.</Empty>
      )}

      <div style="margin-top:16px;">
        <Card title="Regional rollups">
          {region.length === 0 ? (
            <Empty>No regional data.</Empty>
          ) : (
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Region</th>
                    <th class="num">Chapters</th>
                    <th class="num">Started</th>
                    <th class="num">Finalized</th>
                    <th>Completion</th>
                    <th class="num">Avg score</th>
                  </tr>
                </thead>
                <tbody>
                  {region.map((r: any) => (
                    <tr>
                      <td>
                        <strong>{r.region}</strong>
                      </td>
                      <td class="num">{r.chapters_total}</td>
                      <td class="num">{r.chapters_started}</td>
                      <td class="num">{r.chapters_finalized}</td>
                      <td>
                        <MiniBar percent={r.completion_rate_pct} variant="blue" />
                      </td>
                      <td class="num">{fmtPercent(r.avg_score_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div style="margin-top:16px;">
        <Card title="District rollups">
          {district.length === 0 ? (
            <Empty>No district data.</Empty>
          ) : (
            <div class="table-wrap" style="max-height:560px;">
              <table>
                <thead>
                  <tr>
                    <th>District</th>
                    <th class="num">Chapters</th>
                    <th class="num">Started</th>
                    <th class="num">DD approved</th>
                    <th class="num">Finalized</th>
                    <th>Completion</th>
                    <th class="num">Avg score</th>
                  </tr>
                </thead>
                <tbody>
                  {district.map((d: any) => (
                    <tr>
                      <td>
                        <strong>{d.district}</strong>
                      </td>
                      <td class="num">{d.chapters_total}</td>
                      <td class="num">{d.chapters_started}</td>
                      <td class="num">{d.district_approved}</td>
                      <td class="num">{d.chapters_finalized}</td>
                      <td>
                        <MiniBar percent={d.completion_rate_pct} />
                      </td>
                      <td class="num">{fmtPercent(d.avg_score_pct)}</td>
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

  return renderPage(c, { title: "National rollups", session, body });
}

/* ---------------------------------------------------------------------- */
/* CSV export                                                             */
/* ---------------------------------------------------------------------- */
rollupRoutes.get("/rollups/export", async (c) => {
  const session = c.get("session");
  const view = c.req.query("view") ?? "admin";
  if (view === "admin" && session.role !== "admin") return c.redirect("/");
  if (view === "executive" && session.role !== "executive_director") return c.redirect("/");

  const store = getStore(c);
  const period = await store.getCurrentPeriod();
  const district = await store.getDistrictRollups(period);
  const rows = district.map((d: any) => ({
    term: d.term_code,
    year: d.reporting_year,
    district: d.district,
    chapters_total: d.chapters_total,
    chapters_started: d.chapters_started,
    chapters_finalized: d.chapters_finalized,
    district_approved: d.district_approved,
    points_earned: d.points_earned,
    points_possible: d.points_possible,
    avg_score_pct: d.avg_score_pct,
    completion_rate_pct: d.completion_rate_pct,
  }));
  const csv = toCsv(rows, [
    "term",
    "year",
    "district",
    "chapters_total",
    "chapters_started",
    "chapters_finalized",
    "district_approved",
    "points_earned",
    "points_possible",
    "avg_score_pct",
    "completion_rate_pct",
  ]);
  return csvResponse(`chapman-rollups-${period.termCode}-${period.reportingYear}.csv`, csv);
});

/* ---------------------------------------------------------------------- */
/* Route registration                                                     */
/* ---------------------------------------------------------------------- */
rollupRoutes.get("/admin/rollups", (c) => renderRollups(c, "admin"));
rollupRoutes.get("/national/rollups", (c) => renderRollups(c, "executive"));
