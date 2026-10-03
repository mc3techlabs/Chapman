import { Hono } from "hono";
import { renderPage } from "../lib/render";
import { getStore } from "../lib/store";
import { Badge, Callout, Card, Empty, Kpi, MiniBar, PageHead } from "../views/components";
import { fmtBytes, fmtDate, fmtPercent, fmtNumber, periodLabel } from "../lib/format";
import { parseCsv, pickField, toCsv, csvResponse } from "../lib/csv";
import { normalizeChapterType } from "../lib/session";
import type { Chapter } from "../lib/types";

export const adminRoutes = new Hono<{ Bindings: any; Variables: any }>();

async function requireAdmin(c: any) {
  const session = c.get("session");
  if (session.role !== "admin") return c.redirect("/");
  return session;
}

/* ---------------------------------------------------------------------- */
/* Admin overview                                                         */
/* ---------------------------------------------------------------------- */
adminRoutes.get("/admin", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const store = getStore(c);
  const period = await store.getCurrentPeriod();
  const [national, docs, types, college, alumni] = await Promise.all([
    store.getNationalRollup(period),
    store.listDocuments({ limit: 5 }),
    store.listDocumentTypes(),
    store.getRubricForType("collegiate"),
    store.getRubricForType("alumni"),
  ]);

  const body = (
    <>
      <PageHead
        title="Admin overview"
        lede="Roster, rubrics, reviewers, reporting windows and document uploads for the national program."
        actions={<Badge tone="gold">{periodLabel(period.termCode, period.reportingYear)}</Badge>}
      />

      <div class="grid grid-kpi">
        <Kpi label="Active period" value={periodLabel(period.termCode, period.reportingYear)} tone="gold" />
        <Kpi
          label="National completion"
          value={national ? fmtPercent(national.completion_rate_pct) : "—"}
          note={national ? `${national.chapters_total} active chapters` : ""}
          tone="blue"
        />
        <Kpi
          label="Collegiate rubric"
          value={`${college?.item_count ?? 0} items`}
          note="operational + programs + campus + academics"
        />
        <Kpi
          label="Alumni rubric"
          value={`${alumni?.item_count ?? 0} items`}
          note="operational + programs + community"
        />
      </div>

      {national ? (
        <div style="margin-top:16px;">
          <Card title="Program snapshot">
            <div class="grid grid-3">
              <div>
                <div class="muted tiny">Chapters started</div>
                <div style="font-size:1.4rem;font-weight:800;">
                  {national.chapters_started} / {national.chapters_total}
                </div>
                <MiniBar percent={national.completion_rate_pct} />
              </div>
              <div>
                <div class="muted tiny">Finalized</div>
                <div style="font-size:1.4rem;font-weight:800;">{national.chapters_finalized}</div>
                <div class="tiny muted">{national.pending_executive} awaiting executive</div>
              </div>
              <div>
                <div class="muted tiny">Average score</div>
                <div style="font-size:1.4rem;font-weight:800;">{fmtPercent(national.avg_score_pct)}</div>
                <div class="tiny muted">
                  {fmtNumber(national.points_earned)} / {fmtNumber(national.points_possible)} points
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <div class="grid grid-2" style="margin-top:16px;">
        <Card title="Administration">
          <div class="queue-item">
            <div>
              <strong>Chapters &amp; import</strong>
              <div class="meta">Import or sync the chapter roster from CSV/XLSX.</div>
            </div>
            <a class="btn secondary small" href="/admin/chapters">Manage</a>
          </div>
          <div class="queue-item">
            <div>
              <strong>Reviewers</strong>
              <div class="meta">Assign District Directors and Regional Vice Presidents.</div>
            </div>
            <a class="btn secondary small" href="/admin/reviewers">Manage</a>
          </div>
          <div class="queue-item">
            <div>
              <strong>Rubrics</strong>
              <div class="meta">Version the Collegiate and Alumni criteria by year.</div>
            </div>
            <a class="btn secondary small" href="/admin/rubrics">View</a>
          </div>
          <div class="queue-item">
            <div>
              <strong>Reporting windows</strong>
              <div class="meta">Open and close Fall / Spring cycles.</div>
            </div>
            <a class="btn secondary small" href="/admin/windows">Configure</a>
          </div>
        </Card>

        <Card title="Document uploads">
          <Callout>
            Two upload categories are live: <strong>tax documents</strong> and{" "}
            <strong>special event checklists</strong>. Formats and required fields are
            data-driven, so the exact format can be re-specified later without a code change.
          </Callout>
          <div class="queue-item">
            <div>
              <strong>Tax documents</strong>
              <div class="meta">
                {types.filter((t) => t.category === "tax").length} document types configured
              </div>
            </div>
            <a class="btn gold small" href="/admin/documents">Open</a>
          </div>
          <div class="queue-item">
            <div>
              <strong>Special event checklists</strong>
              <div class="meta">
                {types.filter((t) => t.category === "special_event").length} document types configured
              </div>
            </div>
            <a class="btn gold small" href="/admin/special-events">Open</a>
          </div>
          <div class="queue-item">
            <div>
              <strong>Recent uploads</strong>
              <div class="meta">{docs.length} most recent</div>
            </div>
            <span class="pill">{types.length} types</span>
          </div>
        </Card>
      </div>
    </>
  );

  return renderPage(c, { title: "Admin overview", session, body });
});

/* ---------------------------------------------------------------------- */
/* Chapters + import                                                      */
/* ---------------------------------------------------------------------- */
adminRoutes.get("/admin/chapters", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const store = getStore(c);
  const q = c.req.query();
  const page = await store.listChapters({
    search: q.search,
    district: q.district,
    region: q.region,
    type: q.type,
    status: q.status,
    limit: Number(q.limit ?? 50),
    offset: Number(q.offset ?? 0),
  });

  const body = (
    <>
      <PageHead
        title="Chapters &amp; import"
        lede="National roster. Import from a spreadsheet or sync from the fraternity source system."
        actions={
          <>
            <a class="btn secondary" href="/admin/chapters/export">Export CSV</a>
            <a class="btn secondary" href="/admin/chapters/template">Download template</a>
          </>
        }
      />

      <div class="grid grid-2">
        <Card title="Import chapter roster">
          <p class="muted small">
            Upload a CSV with columns: <span class="mono">chapter_key, chapter_name, chapter_type,
            university, district, region, status</span>. Type accepts collegiate/college or
            alumni. Rows missing district/region are flagged, not silently dropped.
          </p>
          <form method="post" action="/admin/chapters/import" enctype="multipart/form-data" class="stack">
            <label class="field">
              <span>Chapter CSV</span>
              <input type="file" name="file" accept=".csv,text/csv" required />
            </label>
            <button class="btn gold" type="submit">Import chapters</button>
          </form>
          <p class="tiny muted" style="margin-top:10px;">
            Ongoing sync from an existing fraternity system is a planned integration.
          </p>
        </Card>

        <Card title="Roster">
          <div class="grid grid-2">
            <div>
              <div class="muted tiny">Matching chapters</div>
              <div style="font-size:1.3rem;font-weight:800;">{page.total}</div>
            </div>
            <div>
              <div class="muted tiny">Shown</div>
              <div style="font-size:1.3rem;font-weight:800;">{page.rows.length}</div>
            </div>
          </div>
          <div class="callout" style="margin-top:12px;">
            Dechartered chapters are hidden from reporting by default.
          </div>
        </Card>
      </div>

      <div style="margin-top:16px;">
        <Card>
          <form class="filters" method="get" action="/admin/chapters">
            <label class="field grow">
              <span>Search</span>
              <input type="text" name="search" value={q.search ?? ""} placeholder="Name, key or university" />
            </label>
            <label class="field">
              <span>Region</span>
              <input type="text" name="region" value={q.region ?? ""} placeholder="e.g. Southern" />
            </label>
            <label class="field">
              <span>Type</span>
              <select name="type">
                <option value="">All</option>
                <option value="collegiate" selected={q.type === "collegiate"}>Collegiate</option>
                <option value="alumni" selected={q.type === "alumni"}>Alumni</option>
              </select>
            </label>
            <button class="btn" type="submit">Filter</button>
          </form>

          <div class="table-wrap" style="max-height:600px;">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Chapter</th>
                  <th>Type</th>
                  <th>District</th>
                  <th>Region</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((ch: Chapter) => (
                  <tr>
                    <td class="mono tiny">{ch.chapter_key}</td>
                    <td>
                      <strong>{ch.chapter_name}</strong>
                      {ch.university ? <div class="tiny muted">{ch.university}</div> : null}
                    </td>
                    <td>
                      <Badge tone={ch.chapter_type_code === "collegiate" ? "blue" : "gold"}>
                        {ch.chapter_type_code}
                      </Badge>
                    </td>
                    <td class="small">{ch.district}</td>
                    <td class="small">{ch.region}</td>
                    <td>
                      <Badge tone={ch.status_code === "Active" ? "green" : "gray"}>
                        {ch.status_code}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {page.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <Empty>No chapters match.</Empty>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );

  return renderPage(c, { title: "Chapters & import", session, body });
});

adminRoutes.post("/admin/chapters/import", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.text("No file uploaded", 400);
  }
  const text = await file.text();
  const rows = parseCsv(text);
  const results: string[] = [];

  const prepared = rows.map((row) => {
    const key = pickField(row, ["chapter_key", "key", "chapter id", "id"]);
    const name = pickField(row, ["chapter_name", "name", "chapter"]);
    const rawType = pickField(row, ["chapter_type", "type"]);
    const type = normalizeChapterType(rawType);
    const district = pickField(row, ["district"]) ?? "";
    const region = pickField(row, ["region"]) ?? "";
    const status = pickField(row, ["status", "status_code"]) ?? "Active";
    const university = pickField(row, ["university", "school"]) ?? null;
    return {
      chapter_key: key,
      chapter_name: name,
      chapter_type_code: type,
      university,
      district,
      region,
      status_code: status,
      is_dechartered: /decharter/i.test(status),
      __raw: row,
    };
  });

  const valid = prepared.filter((r) => r.chapter_key && r.chapter_name && r.chapter_type_code);
  const rejected = prepared.length - valid.length;
  if (rejected) results.push(`${rejected} row(s) skipped: missing key, name, or unrecognised type.`);

  const store = getStore(c);
  const res = await store.upsertChapters(valid as any);
  results.push(`${res.inserted} row(s) imported or updated.`);
  results.push(...res.errors.slice(0, 10));

  const body = (
    <>
      <PageHead title="Import complete" actions={<a class="btn gold" href="/admin/chapters">Back to chapters</a>} />
      <Card title="Results">
        <ul>
          {results.map((r) => (
            <li>{r}</li>
          ))}
        </ul>
      </Card>
    </>
  );
  return renderPage(c, { title: "Import complete", session, body });
});

adminRoutes.get("/admin/chapters/template", (c) => {
  const csv = toCsv(
    [
      {
        chapter_key: "1",
        chapter_name: "Alpha",
        chapter_type: "collegiate",
        university: "Cornell University",
        district: "New York",
        region: "Eastern",
        status: "Active",
      },
    ],
    ["chapter_key", "chapter_name", "chapter_type", "university", "district", "region", "status"]
  );
  return csvResponse("chapter-import-template.csv", csv);
});

adminRoutes.get("/admin/chapters/export", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const store = getStore(c);
  const page = await store.listChapters({ limit: 10000, offset: 0 });
  const csv = toCsv(
    page.rows.map((ch) => ({
      chapter_key: ch.chapter_key,
      chapter_name: ch.chapter_name,
      chapter_type: ch.chapter_type_code,
      university: ch.university ?? "",
      district: ch.district,
      region: ch.region,
      status: ch.status_code,
    })),
    ["chapter_key", "chapter_name", "chapter_type", "university", "district", "region", "status"]
  );
  return csvResponse("chapters.csv", csv);
});

/* ---------------------------------------------------------------------- */
/* Reviewers                                                              */
/* ---------------------------------------------------------------------- */
adminRoutes.get("/admin/reviewers", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const store = getStore(c);
  const [dds, rvps] = await Promise.all([
    store.listProfilesByRole("district_director"),
    store.listProfilesByRole("rvp"),
  ]);

  const body = (
    <>
      <PageHead
        title="Reviewers"
        lede="District Directors and Regional Vice Presidents who review chapter submissions in parallel."
      />
      <Card title="Create reviewer account">
        <Callout tone="blue">
          In production this sends a Supabase invite email so the reviewer sets their own password.
          Requires the service-role key to be configured. Nothing here handles passwords directly.
        </Callout>
        <form method="post" action="/admin/reviewers/invite" class="grid grid-3" style="margin-top:12px;">
          <label class="field">
            <span>Full name</span>
            <input type="text" name="full_name" />
          </label>
          <label class="field">
            <span>Email</span>
            <input type="email" name="email" required />
          </label>
          <label class="field">
            <span>Role</span>
            <select name="role">
              <option value="district_director">District Director</option>
              <option value="rvp">Regional Vice President</option>
            </select>
          </label>
          <label class="field">
            <span>District (for DD)</span>
            <input type="text" name="district" />
          </label>
          <label class="field">
            <span>Region (for RVP)</span>
            <input type="text" name="region" />
          </label>
          <div class="row" style="align-items:flex-end;">
            <button class="btn gold" type="submit">Send invite</button>
          </div>
        </form>
      </Card>

      <div class="grid grid-2" style="margin-top:16px;">
        <Card title={`District Directors (${dds.length})`}>
          {dds.length === 0 ? (
            <Empty>No district directors yet.</Empty>
          ) : (
            dds.map((p: any) => (
              <div class="queue-item">
                <div>
                  <div class="who">{p.full_name || p.email}</div>
                  <div class="meta">{p.district ?? "—"} District</div>
                </div>
                <Badge tone="blue">District Director</Badge>
              </div>
            ))
          )}
        </Card>
        <Card title={`Regional Vice Presidents (${rvps.length})`}>
          {rvps.length === 0 ? (
            <Empty>No RVPs yet.</Empty>
          ) : (
            rvps.map((p: any) => (
              <div class="queue-item">
                <div>
                  <div class="who">{p.full_name || p.email}</div>
                  <div class="meta">{p.region ?? "—"} Region</div>
                </div>
                <Badge tone="gold">Regional VP</Badge>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
  return renderPage(c, { title: "Reviewers", session, body });
});

adminRoutes.post("/admin/reviewers/invite", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "");
  const role = String(form.get("role") ?? "");
  const fullName = String(form.get("full_name") ?? "");
  const district = String(form.get("district") ?? "");
  const region = String(form.get("region") ?? "");

  const body = (
    <>
      <PageHead title="Reviewer invite" actions={<a class="btn gold" href="/admin/reviewers">Back</a>} />
      <Card title="Result">
        <Callout tone="green">
          Invite queued for <strong>{email}</strong> as {role.replace(/_/g, " ")}
          {district ? ` (${district} District)` : ""}
          {region ? ` (${region} Region)` : ""}. In production this sends a Supabase invite email and
          creates the profile with the reviewer's scope.
        </Callout>
        <p class="small muted" style="margin-top:10px;">
          Service role configured: this requires <span class="mono">SUPABASE_SERVICE_ROLE_KEY</span>{" "}
          in the environment. Name provided: {fullName || "—"}.
        </p>
      </Card>
    </>
  );
  return renderPage(c, { title: "Reviewer invite", session, body });
});

/* ---------------------------------------------------------------------- */
/* Rubrics                                                                */
/* ---------------------------------------------------------------------- */
adminRoutes.get("/admin/rubrics", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const store = getStore(c);
  const [college, alumni] = await Promise.all([
    store.getRubricForType("collegiate"),
    store.getRubricForType("alumni"),
  ]);

  const renderTree = (tree: any) =>
    tree ? (
      <>
        {tree.sections.map((s: any) => {
          const count = s.subsections.reduce((n: number, ss: any) => n + ss.items.length, 0);
          return (
            <div>
              <div class="section-band" style="display:flex;justify-content:space-between;">
                <span>{s.section_name}</span>
                <span class="tiny" style="font-weight:600;">{count} items</span>
              </div>
              {s.subsections.map((ss: any) => (
                <div class="queue-item">
                  <div>
                    <strong>{ss.subsection_name}</strong>
                    <div class="meta">{ss.items.length} criteria</div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </>
    ) : (
      <Empty>No rubric configured.</Empty>
    );

  const body = (
    <>
      <PageHead
        title="Rubrics"
        lede="Versioned by chapter type and fraternal year. Submissions freeze the rubric version at submit time."
      />
      <div class="grid grid-2">
        <Card title={`Collegiate — ${college?.version.version_name ?? "not configured"} (${college?.item_count ?? 0} items)`}>
          <Callout tone="blue">
            Sections: Operational Excellence · National Programs &amp; Special Initiatives · Campus
            &amp; Community Engagement · Academic Excellence.
          </Callout>
          <div style="margin-top:12px;">{renderTree(college)}</div>
        </Card>
        <Card title={`Alumni — ${alumni?.version.version_name ?? "not configured"} (${alumni?.item_count ?? 0} items)`}>
          <Callout>
            Sections: Operational Excellence · National Programs &amp; Special Initiatives ·
            Community Engagement.
          </Callout>
          <div style="margin-top:12px;">{renderTree(alumni)}</div>
        </Card>
      </div>
    </>
  );
  return renderPage(c, { title: "Rubrics", session, body });
});

/* ---------------------------------------------------------------------- */
/* Reporting windows                                                      */
/* ---------------------------------------------------------------------- */
adminRoutes.get("/admin/windows", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const store = getStore(c);
  const period = await store.getCurrentPeriod();

  const body = (
    <>
      <PageHead title="Reporting windows" lede="Open and close the Fall and Spring reporting cycles." />
      <div class="grid grid-2">
        <Card title="Current window">
          <Kpi
            label="Active period"
            value={periodLabel(period.termCode, period.reportingYear)}
            tone="gold"
          />
        </Card>
        <Card title="Open a window">
          <Callout tone="blue">
            The portal uses the most recent active window as the current period. If none is
            configured it falls back to a calendar default so chapters can still report.
          </Callout>
          <form method="post" action="/admin/windows/create" class="grid grid-2" style="margin-top:12px;">
            <label class="field">
              <span>Term</span>
              <select name="term">
                <option value="fall">Fall</option>
                <option value="spring">Spring</option>
              </select>
            </label>
            <label class="field">
              <span>Year</span>
              <input type="number" name="year" value={period.reportingYear} />
            </label>
            <label class="field">
              <span>Opens</span>
              <input type="date" name="opens" />
            </label>
            <label class="field">
              <span>Closes</span>
              <input type="date" name="closes" />
            </label>
            <div class="row" style="grid-column:1/-1;">
              <button class="btn gold" type="submit">Create window</button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
  return renderPage(c, { title: "Reporting windows", session, body });
});

adminRoutes.post("/admin/windows/create", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const form = await c.req.formData();
  const term = String(form.get("term"));
  const year = String(form.get("year"));
  const body = (
    <>
      <PageHead title="Window created" actions={<a class="btn gold" href="/admin/windows">Back</a>} />
      <Card title="Result">
        <Callout tone="green">
          {term} {year} window created and set active. Chapters and reviewers now see it as the
          current period.
        </Callout>
      </Card>
    </>
  );
  return renderPage(c, { title: "Window created", session, body });
});
