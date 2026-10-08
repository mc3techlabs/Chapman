import { Hono } from "hono";
import { renderPage } from "../lib/render";
import { getStore, getAdminClient } from "../lib/store";
import { Badge, Callout, Card, Empty, Kpi, PageHead } from "../views/components";
import { csvResponse, toCsv } from "../lib/csv";
import { fmtNumber } from "../lib/format";
import type { Chapter } from "../lib/types";
import {
  CHAPTER_EMAIL_DOMAIN,
  chapterEmail,
  createAdminAccount,
  createReviewerAccount,
  listAllAuthUsers,
  provisionChapterLogin,
  provisionChapterLogins,
  resendInvite,
  resetChapterLogin,
  resetReviewerPassword,
  setAccountActive,
  setProfileScope,
  syncReviewerAssignments,
  type ProvisionResult,
} from "../lib/provisioning";

export const accessRoutes = new Hono<{ Bindings: any; Variables: any }>();

const SCOPE_LABEL = "Chapter logins are one shared account per chapter.";

/** Admin guard + service-role client. Returns a Response when it should bail. */
/** Full-access admin only - every mutation route uses this. */
async function requireAdmin(c: any): Promise<{ session: any; admin: any } | Response> {
  const session = c.get("session");
  if (!session || session.role !== "admin") {
    return c.redirect("/");
  }
  return { session, admin: getAdminClient((c.env ?? {}) as any) };
}

/**
 * Admin or admin_readonly - every view (GET) route uses this. canWrite tells
 * the page whether to render invite forms / reset / deactivate / provision
 * controls at all; every POST route is still gated by requireAdmin above
 * regardless of what the page renders, so a read-only admin can't reach a
 * mutation by posting directly even if the UI were somehow bypassed.
 */
async function requireAdminView(
  c: any
): Promise<{ session: any; admin: any; canWrite: boolean } | Response> {
  const session = c.get("session");
  if (!session || (session.role !== "admin" && session.role !== "admin_readonly")) {
    return c.redirect("/");
  }
  return {
    session,
    admin: getAdminClient((c.env ?? {}) as any),
    canWrite: session.role === "admin",
  };
}

function b64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Every chapter in a scope (region / district / status), excluding dechartered. */
async function scopeChapters(
  store: any,
  scope: { region?: string; district?: string; status?: string }
): Promise<Chapter[]> {
  const out: Chapter[] = [];
  let offset = 0;
  const limit = 500;
  for (;;) {
    const page = await store.listChapters({
      region: scope.region || undefined,
      district: scope.district || undefined,
      limit,
      offset,
    });
    out.push(...page.rows);
    offset += page.rows.length;
    if (page.rows.length === 0 || offset >= page.total || offset > 5000) break;
  }
  return out.filter(
    (ch: Chapter) => !ch.is_dechartered && (!scope.status || ch.status_code === scope.status)
  );
}

function credsCsv(rows: ProvisionResult[]): string {
  return toCsv(
    rows.map((r) => ({
      chapter_key: r.chapter_key,
      chapter_name: r.chapter_name,
      username: r.email,
      temp_password: r.password ?? "",
      status: r.status,
      note: r.message ?? "",
    })),
    ["chapter_key", "chapter_name", "username", "temp_password", "status", "note"]
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * One-time credentials page for a SINGLE chapter (create or reset). Passwords
 * are generated at provisioning time and never stored, so this is the only
 * moment they are visible — mirror the bulk flow's warning + CSV download.
 */
async function renderSingleCreds(
  c: any,
  opts: { session: any; res: ProvisionResult; heading: string }
): Promise<Response> {
  const { session, res, heading } = opts;
  const csvB64 = b64(credsCsv(res.password ? [res] : []));
  const body = (
    <>
      <PageHead
        title={`${heading} — ${res.chapter_name}`}
        lede={<span class="mono">{res.email}</span>}
        actions={
          <a class="btn secondary" href="/admin/access/chapters">
            Back to chapters
          </a>
        }
      />

      {res.password ? (
        <Callout tone="gold">
          <strong>Copy this password now — it is shown only once.</strong> It is not stored anywhere
          and cannot be retrieved later. If you lose it, use <em>Reset password</em> on the chapter
          row to issue a new one.
          <div style="margin-top:10px;">
            <a
              class="btn gold"
              download={`chapman-chapter-login-${res.chapter_key}-${today()}.csv`}
              href={`data:text/csv;charset=utf-8;base64,${csvB64}`}
            >
              Download credentials (.csv)
            </a>
          </div>
        </Callout>
      ) : (
        <Callout tone={res.status === "error" ? "red" : "blue"}>
          {res.status === "exists"
            ? "That chapter already had a login, so no new password was created. Use Reset password to issue a fresh one."
            : res.message || "Nothing to do."}
        </Callout>
      )}

      <div style="margin-top:16px;">
        <Card title="Credentials">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Chapter</th>
                  <th>Username</th>
                  <th>Password</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="mono tiny">{res.chapter_key}</td>
                  <td>{res.chapter_name}</td>
                  <td class="mono tiny">{res.email}</td>
                  <td class="mono">{res.password ?? "—"}</td>
                  <td>
                    <Badge tone={res.status === "created" ? "green" : res.status === "error" ? "red" : "amber"}>
                      {res.status}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
  return renderPage(c, { title: "Chapter login", session, body });
}

/* ======================================================================== */
/* Overview                                                                 */
/* ======================================================================== */
accessRoutes.get("/admin/access", async (c) => {
  const ctx = await requireAdminView(c);
  if (ctx instanceof Response) return ctx;
  const { session, admin, canWrite } = ctx;
  const store = getStore(c);

  const [dds, rvps, admins, viewers] = await Promise.all([
    store.listProfilesByRole("district_director"),
    store.listProfilesByRole("rvp"),
    store.listProfilesByRole("admin"),
    store.listProfilesByRole("admin_readonly"),
  ]);
  const chapterCount = (await scopeChapters(store, {})).length;

  let provisioned = 0;
  if (admin) {
    const users = await listAllAuthUsers(admin);
    provisioned = users.filter((u: any) =>
      (u.email ?? "").toLowerCase().endsWith(`@${CHAPTER_EMAIL_DOMAIN}`)
    ).length;
  }

  const body = (
    <>
      <PageHead
        title="Access & Logins"
        lede="Issue and manage logins for chapters, District Directors and Regional Vice Presidents."
      />
      {!canWrite ? (
        <Callout tone="blue">
          You have read-only access. You can see everything here, but inviting, resetting, and
          deactivating accounts is limited to full admins.
        </Callout>
      ) : null}
      {!admin ? (
        <Callout tone="red">
          Provisioning needs the live database. <span class="mono">SUPABASE_SERVICE_ROLE_KEY</span>{" "}
          is not configured in this environment, so accounts cannot be created here.
        </Callout>
      ) : null}

      <div class="grid grid-kpi" style="margin-top:16px;">
        <Kpi label="Chapters in roster" value={fmtNumber(chapterCount)} tone="gold" />
        <Kpi label="Chapter logins issued" value={fmtNumber(provisioned)} tone="green" />
        <Kpi label="District Directors" value={fmtNumber(dds.length)} tone="blue" />
        <Kpi label="Regional VPs" value={fmtNumber(rvps.length)} tone="blue" />
        <Kpi label="Admins" value={fmtNumber(admins.length + viewers.length)} tone="blue" />
      </div>

      <div class="grid grid-3" style="margin-top:16px;">
        <Card
          title="Chapter logins"
          action={
            <a class="btn gold" href="/admin/access/chapters">
              Manage
            </a>
          }
        >
          <p class="muted small">
            One shared login per chapter, named <span class="mono">chapter_key@{CHAPTER_EMAIL_DOMAIN}</span>.
            Passwords are generated and delivered as a one-time credentials sheet to distribute.
          </p>
          <p class="tiny muted" style="margin-top:8px;">{SCOPE_LABEL}</p>
        </Card>

        <Card
          title="Reviewers"
          action={
            <a class="btn gold" href="/admin/access/reviewers">
              Manage
            </a>
          }
        >
          <p class="muted small">
            District Directors and RVPs are named individuals. They receive an email invite and set
            their own password; their whole review scope is assigned automatically.
          </p>
        </Card>

        <Card
          title="Admins"
          action={
            <a class="btn gold" href="/admin/access/admins">
              Manage
            </a>
          }
        >
          <p class="muted small">
            Full access to every chapter, reviewer, rubric and reporting tool. They receive an email
            invite and set their own password, same as a reviewer.
          </p>
        </Card>
      </div>
    </>
  );
  return renderPage(c, { title: "Access & Logins", session, body });
});

/* ======================================================================== */
/* Chapter logins                                                           */
/* ======================================================================== */
accessRoutes.get("/admin/access/chapters", async (c) => {
  const ctx = await requireAdminView(c);
  if (ctx instanceof Response) return ctx;
  const { session, admin, canWrite } = ctx;
  const store = getStore(c);
  const { regions, districts } = await store.listOrgUnits();

  const region = c.req.query("region") ?? "";
  const district = c.req.query("district") ?? "";
  const scope = await scopeChapters(store, { region, district });

  let existing = new Set<string>();
  if (admin) {
    const users = await listAllAuthUsers(admin);
    existing = new Set(users.map((u: any) => (u.email ?? "").toLowerCase()));
  }
  const withLogin = scope.filter((ch) => existing.has(chapterEmail(ch.chapter_key))).length;
  const remaining = scope.length - withLogin;

  const body = (
    <>
      <PageHead
        title="Chapter Logins"
        lede={`One shared login per chapter — chapter_key@${CHAPTER_EMAIL_DOMAIN}.`}
        actions={
          <a class="btn secondary" href="/admin/access">
            Back
          </a>
        }
      />

      {c.req.query("ok") ? <Callout tone="green">{decodeURIComponent(c.req.query("ok")!)}</Callout> : null}

      <div class="grid grid-kpi" style="margin-top:16px;">
        <Kpi label="In scope" value={fmtNumber(scope.length)} tone="gold" />
        <Kpi label="Logins issued" value={fmtNumber(withLogin)} tone="green" />
        <Kpi label="Remaining" value={fmtNumber(remaining)} tone={remaining ? "amber" : "green"} />
      </div>

      <Card title="Choose a scope" >
        <form method="get" action="/admin/access/chapters" class="grid grid-3">
          <label class="field">
            <span>Region</span>
            <select name="region">
              <option value="">All regions</option>
              {regions.map((r: any) => (
                <option value={r.code} selected={r.code === region}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>District</span>
            <select name="district">
              <option value="">All districts</option>
              {districts.map((d: any) => (
                <option value={d.code} selected={d.code === district}>
                  {d.name}
                  {d.region_code ? ` (${d.region_code})` : ""}
                </option>
              ))}
            </select>
          </label>
          <div class="row" style="align-items:flex-end;">
            <button class="btn secondary" type="submit">
              Apply
            </button>
          </div>
        </form>
      </Card>

      <div class="grid grid-2" style="margin-top:16px;">
        <Card title="Bulk provision">
          {canWrite ? (
            <>
              <p class="muted small">
                Creates logins for chapters in the scope above that don't have one yet. Existing logins
                are skipped, so running it again continues where it left off.
              </p>
              <Callout tone="blue">
                Supabase limits how much work one request can do, so logins are created in batches.
                After each batch you'll get a credentials sheet and a button for the next batch.
              </Callout>
              <form method="post" action="/admin/access/chapters/provision" class="stack" style="margin-top:12px;">
                <input type="hidden" name="region" value={region} />
                <input type="hidden" name="district" value={district} />
                <label class="field">
                  <span>Batch size (chapters per run)</span>
                  <input type="number" name="batch" value={admin ? "100" : "0"} min="1" max="300" />
                </label>
                <button class="btn gold" type="submit" disabled={!admin || remaining === 0}>
                  {remaining === 0 ? "All chapters have logins" : `Provision up to batch size (${remaining} remaining)`}
                </button>
              </form>
              {!admin ? <p class="tiny muted">Connect the live database to enable provisioning.</p> : null}
            </>
          ) : (
            <p class="muted small">Read-only access — provisioning is limited to full admins.</p>
          )}
        </Card>

        <Card title="Import from a sheet">
          <p class="muted small">
            Prefer to supply your own usernames/passwords? Download the template, fill it, and upload
            it on the Chapters page. Useful when a chapter already has a preferred inbox.
          </p>
          <a class="btn secondary" href="/admin/access/chapters/template">
            Download username template
          </a>
        </Card>
      </div>

      <div style="margin-top:16px;">
        <Card title={`Chapters in scope (${scope.length})`}>
          {scope.length === 0 ? (
            <Empty>No chapters match this scope.</Empty>
          ) : (
            <div class="table-wrap" style="max-height:520px;">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Chapter</th>
                    <th>District</th>
                    <th>Login</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {scope.slice(0, 300).map((ch) => {
                    const has = existing.has(chapterEmail(ch.chapter_key));
                    return (
                      <tr>
                        <td class="mono tiny">{ch.chapter_key}</td>
                        <td>{ch.chapter_name}</td>
                        <td class="small">{ch.district}</td>
                        <td class="mono tiny">{chapterEmail(ch.chapter_key)}</td>
                        <td>
                          <Badge tone={has ? "green" : "amber"}>{has ? "issued" : "missing"}</Badge>
                        </td>
                        <td>
                          {canWrite && admin ? (
                            has ? (
                              <form
                                method="post"
                                action={`/admin/access/chapters/${ch.id}/reset`}
                                onsubmit="return confirm('Issue a new password for this chapter? The old password stops working immediately.')"
                              >
                                <button class="btn secondary small" type="submit">
                                  Reset password
                                </button>
                              </form>
                            ) : (
                              <form method="post" action={`/admin/access/chapters/${ch.id}/login`}>
                                <input type="hidden" name="region" value={region} />
                                <input type="hidden" name="district" value={district} />
                                <button class="btn secondary small" type="submit">
                                  Create login
                                </button>
                              </form>
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {scope.length > 300 ? (
                <p class="tiny muted" style="padding:8px;">
                  Showing first 300 of {scope.length}. Use bulk provision or narrow the scope.
                </p>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </>
  );
  return renderPage(c, { title: "Chapter Logins", session, body });
});

accessRoutes.get("/admin/access/chapters/template", async (c) => {
  const ctx = await requireAdminView(c);
  if (ctx instanceof Response) return ctx;
  const store = getStore(c);
  const scope = await scopeChapters(store, {});
  const csv = toCsv(
    scope.map((ch) => ({
      chapter_key: ch.chapter_key,
      chapter_name: ch.chapter_name,
      username: chapterEmail(ch.chapter_key),
      password: "",
    })),
    ["chapter_key", "chapter_name", "username", "password"]
  );
  return csvResponse("chapman-chapter-login-template.csv", csv);
});

/** Bulk provision a batch. Existing logins are skipped, so re-running continues. */
accessRoutes.post("/admin/access/chapters/provision", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { session, admin } = ctx;
  if (!admin) return c.text("Service role not configured.", 400);
  const store = getStore(c);
  const form = await c.req.formData();
  const region = String(form.get("region") ?? "");
  const district = String(form.get("district") ?? "");
  const batch = Math.min(Math.max(Number(form.get("batch")) || 100, 1), 300);

  const scope = await scopeChapters(store, { region, district });
  const users = await listAllAuthUsers(admin);
  const existing = new Set(users.map((u: any) => (u.email ?? "").toLowerCase()));
  const remaining = scope.filter((ch) => !existing.has(chapterEmail(ch.chapter_key)));
  const todo = remaining.slice(0, batch);

  const results: ProvisionResult[] = todo.length
    ? await provisionChapterLogins(admin, todo as any, { skipExisting: false })
    : [];

  const created = results.filter((r) => r.status === "created");
  const errored = results.filter((r) => r.status === "error");
  const stillRemaining = remaining.length - created.length;
  const csvB64 = b64(credsCsv(results.filter((r) => r.password)));

  const body = (
    <>
      <PageHead
        title="Provision results"
        actions={<a class="btn secondary" href="/admin/access/chapters">Back</a>}
      />
      <div class="grid grid-kpi" style="margin-top:16px;">
        <Kpi label="Created this batch" value={fmtNumber(created.length)} tone="green" />
        <Kpi label="Already existed" value={fmtNumber(results.length - created.length - errored.length)} tone="blue" />
        <Kpi label="Errors" value={fmtNumber(errored.length)} tone={errored.length ? "red" : "green"} />
        <Kpi label="Still remaining" value={fmtNumber(Math.max(stillRemaining, 0))} tone="amber" />
      </div>

      {created.length ? (
        <Callout tone="gold">
          <strong>Download the credentials sheet now.</strong> Passwords are shown only once — they
          are not stored anywhere and cannot be retrieved later.
          <div style="margin-top:10px;">
            <a
              class="btn gold"
              download={`chapman-chapter-logins-${today()}.csv`}
              href={`data:text/csv;charset=utf-8;base64,${csvB64}`}
            >
              Download credentials sheet ({created.length})
            </a>
          </div>
        </Callout>
      ) : null}

      {stillRemaining > 0 ? (
        <Card title="Continue">
          <p class="muted small">
            {fmtNumber(stillRemaining)} chapter(s) in this scope still need a login.
          </p>
          <form method="post" action="/admin/access/chapters/provision" class="row" style="gap:8px;">
            <input type="hidden" name="region" value={region} />
            <input type="hidden" name="district" value={district} />
            <input type="hidden" name="batch" value={String(batch)} />
            <button class="btn gold" type="submit">
              Provision next {Math.min(batch, stillRemaining)}
            </button>
          </form>
        </Card>
      ) : (
        <Callout tone="green">Every chapter in this scope now has a login.</Callout>
      )}

      <div style="margin-top:16px;">
        <Card title={`This batch (${results.length})`}>
          <div class="table-wrap" style="max-height:420px;">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Chapter</th>
                  <th>Login</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr>
                    <td class="mono tiny">{r.chapter_key}</td>
                    <td>{r.chapter_name}</td>
                    <td class="mono tiny">{r.email}</td>
                    <td>
                      <Badge tone={r.status === "created" ? "green" : r.status === "error" ? "red" : "blue"}>
                        {r.status}
                      </Badge>
                      {r.message ? <span class="tiny muted"> {r.message}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
  return renderPage(c, { title: "Provision results", session, body });
});

/** Single chapter login, from the roster row action. Shows the one-time password. */
accessRoutes.post("/admin/access/chapters/:id/login", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { session, admin } = ctx;
  if (!admin) return c.text("Service role not configured.", 400);
  const store = getStore(c);
  const ch = await store.getChapter(c.req.param("id"));
  if (!ch) return c.redirect("/admin/access/chapters?err=notfound");
  const res = await provisionChapterLogin(admin, ch as any, { email: chapterEmail(ch.chapter_key) });
  return renderSingleCreds(c, { session, res, heading: "Chapter login" });
});

/** Reissue a password for an EXISTING chapter login (recovery path). */
accessRoutes.post("/admin/access/chapters/:id/reset", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { session, admin } = ctx;
  if (!admin) return c.text("Service role not configured.", 400);
  const store = getStore(c);
  const ch = await store.getChapter(c.req.param("id"));
  if (!ch) return c.redirect("/admin/access/chapters?err=notfound");
  const res = await resetChapterLogin(admin, ch as any);
  return renderSingleCreds(c, { session, res, heading: "Password reset" });
});

/* ======================================================================== */
/* Reviewers                                                                */
/* ======================================================================== */
accessRoutes.get("/admin/access/reviewers", async (c) => {
  const ctx = await requireAdminView(c);
  if (ctx instanceof Response) return ctx;
  const { session, admin, canWrite } = ctx;
  const store = getStore(c);
  const [dds, rvps, units] = await Promise.all([
    store.listProfilesByRole("district_director"),
    store.listProfilesByRole("rvp"),
    store.listOrgUnits(),
  ]);

  // Invites that were sent but never completed (e.g. the link expired)
  // show as "pending" with a resend action instead of "Reset password",
  // which only makes sense once the invitee has actually set a password.
  //
  // Separately: an invited auth user can end up with NO profile row at all
  // (the on_auth_user_created trigger only fires on a genuine INSERT into
  // auth.users - re-inviting an address that already has an unconfirmed
  // auth user just re-sends the token without inserting a new row, so the
  // trigger never runs). Those accounts are invisible in the tables below
  // since they're built from listProfilesByRole, not auth.users - surface
  // them separately so they aren't just missing.
  let pendingEmails = new Set<string>();
  let orphaned: any[] = [];
  if (admin) {
    const users = await listAllAuthUsers(admin);
    pendingEmails = new Set(
      users.filter((u: any) => !u.email_confirmed_at).map((u: any) => (u.email ?? "").toLowerCase())
    );
    const profileIds = new Set([...dds, ...rvps].map((p: any) => p.id));
    orphaned = users.filter((u: any) => {
      const rc = u.user_metadata?.role_code;
      return (rc === "district_director" || rc === "rvp") && !profileIds.has(u.id);
    });
  }

  const rowsFor = (list: any[], roleLabel: string) => (
    <Card title={`${roleLabel} (${list.length})`}>
      {list.length === 0 ? (
        <Empty>None yet.</Empty>
      ) : (
        <div class="table-wrap" style="max-height:420px;">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Scope</th>
                <th>Invite</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p: any) => {
                const pending = pendingEmails.has((p.email ?? "").toLowerCase());
                return (
                  <tr>
                    <td>{p.full_name || "—"}</td>
                    <td class="mono tiny">{p.email}</td>
                    <td class="small">{p.district ?? p.region ?? "—"}</td>
                    <td>
                      <Badge tone={pending ? "amber" : "green"}>{pending ? "pending" : "confirmed"}</Badge>
                    </td>
                    <td>
                      <Badge tone={p.is_active ? "green" : "gray"}>{p.is_active ? "active" : "off"}</Badge>
                    </td>
                    <td class="row" style="gap:6px;">
                      {canWrite ? (
                        <>
                          {pending ? (
                            <form
                              method="post"
                              action={`/admin/access/reviewers/${p.id}/resend`}
                              onsubmit="return confirm('Resend the invite email to this reviewer?')"
                            >
                              <button class="btn secondary small" type="submit">
                                Resend invite
                              </button>
                            </form>
                          ) : (
                            <form
                              method="post"
                              action={`/admin/access/reviewers/${p.id}/reset`}
                              onsubmit="return confirm('Send this reviewer a password reset email?')"
                            >
                              <button class="btn secondary small" type="submit">
                                Reset password
                              </button>
                            </form>
                          )}
                          <form method="post" action={`/admin/access/reviewers/${p.id}/active`}>
                            <input type="hidden" name="active" value={p.is_active ? "0" : "1"} />
                            <button class="btn secondary small" type="submit">
                              {p.is_active ? "Deactivate" : "Reactivate"}
                            </button>
                          </form>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  const ok = c.req.query("ok");
  const err = c.req.query("err");

  const body = (
    <>
      <PageHead
        title="Reviewers"
        lede="District Directors and RVPs who review chapter submissions in parallel."
        actions={
          <a class="btn secondary" href="/admin/access">
            Back
          </a>
        }
      />
      {ok ? <Callout tone="green">{decodeURIComponent(ok)}</Callout> : null}
      {err ? <Callout tone="red">{decodeURIComponent(err)}</Callout> : null}
      {!canWrite ? (
        <Callout tone="blue">
          You have read-only access. Inviting, resetting, and deactivating reviewers is limited to
          full admins.
        </Callout>
      ) : null}
      {canWrite && !admin ? (
        <Callout tone="red">
          Inviting reviewers needs the live database (service-role key not configured here).
        </Callout>
      ) : null}

      {canWrite ? (
        <Card title="Invite a reviewer">
          <p class="muted small">
            Supabase emails an invitation; the reviewer sets their own password. Their review scope is
            assigned automatically — a District Director is linked to every chapter in their district,
            an RVP to every chapter in their region.
          </p>
          <form method="post" action="/admin/access/reviewers/invite" class="grid grid-3" style="margin-top:12px;">
            <label class="field">
              <span>Full name</span>
              <input type="text" name="full_name" required />
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
              <span>District (District Director)</span>
              <select name="district">
                <option value="">—</option>
                {units.districts.map((d: any) => (
                  <option value={d.name}>{d.name}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>Region (RVP)</span>
              <select name="region">
                <option value="">—</option>
                {units.regions.map((r: any) => (
                  <option value={r.name}>{r.name}</option>
                ))}
              </select>
            </label>
            <div class="row" style="align-items:flex-end;">
              <button class="btn gold" type="submit" disabled={!admin}>
                Send invite
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {orphaned.length ? (
        <div style="margin-top:16px;">
          <Card title={`Needs repair (${orphaned.length})`}>
            <Callout tone="gold">
              These were invited but never got a profile row, so they don't appear below — a known
              gap when an invite is re-sent to an address that already has an unconfirmed account.
              Repairing creates the missing profile and reassigns their review scope.
            </Callout>
            <div class="table-wrap" style="margin-top:12px;">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Scope</th>
                    {canWrite ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {orphaned.map((u: any) => (
                    <tr>
                      <td class="mono tiny">{u.email}</td>
                      <td class="small">
                        {u.user_metadata?.role_code === "rvp" ? "RVP" : "District Director"}
                      </td>
                      <td class="small">{u.user_metadata?.district ?? u.user_metadata?.region ?? "—"}</td>
                      {canWrite ? (
                        <td>
                          <form method="post" action={`/admin/access/reviewers/${u.id}/repair`}>
                            <button class="btn gold small" type="submit">
                              Repair
                            </button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      <div style="margin-top:16px;">{rowsFor(dds, "District Directors")}</div>
      <div style="margin-top:16px;">{rowsFor(rvps, "Regional Vice Presidents")}</div>
    </>
  );
  return renderPage(c, { title: "Reviewers", session, body });
});

accessRoutes.post("/admin/access/reviewers/invite", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/reviewers?err=Service%20role%20not%20configured");
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").trim();
  const role = (String(form.get("role") ?? "district_director") as "district_director" | "rvp");
  const fullName = String(form.get("full_name") ?? "").trim();
  const district = String(form.get("district") ?? "").trim() || null;
  const region = String(form.get("region") ?? "").trim() || null;
  const origin = new URL(c.req.url).origin;

  const res = await createReviewerAccount(admin, { email, fullName, role, district, region, origin });
  if (!res.ok) {
    return c.redirect(`/admin/access/reviewers?err=${encodeURIComponent(res.message ?? "Invite failed")}`);
  }
  const scopeNote = role === "district_director" ? district ?? "—" : region ?? "—";
  return c.redirect(
    `/admin/access/reviewers?ok=${encodeURIComponent(
      `Invite sent to ${email} (${role.replace(/_/g, " ")}, ${scopeNote}) — scope assigned.`
    )}`
  );
});

accessRoutes.post("/admin/access/reviewers/:id/reset", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/reviewers?err=Service%20role%20not%20configured");
  const id = c.req.param("id");
  const origin = new URL(c.req.url).origin;

  // Resolve the email server-side from the profile id rather than trusting
  // a client-submitted value, so this can only ever target the account the
  // admin is actually looking at in the reviewers table.
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data?.user?.email) {
    return c.redirect("/admin/access/reviewers?err=Reviewer%20not%20found");
  }

  const res = await resetReviewerPassword(admin, data.user.email, origin);
  if (!res.ok) {
    return c.redirect(`/admin/access/reviewers?err=${encodeURIComponent(res.message ?? "Reset failed")}`);
  }
  return c.redirect(
    `/admin/access/reviewers?ok=${encodeURIComponent(`Password reset email sent to ${data.user.email}.`)}`
  );
});

accessRoutes.post("/admin/access/reviewers/:id/resend", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/reviewers?err=Service%20role%20not%20configured");
  const id = c.req.param("id");
  const origin = new URL(c.req.url).origin;

  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data?.user?.email) {
    return c.redirect("/admin/access/reviewers?err=Reviewer%20not%20found");
  }

  const res = await resendInvite(admin, data.user.email, origin);
  if (!res.ok) {
    return c.redirect(`/admin/access/reviewers?err=${encodeURIComponent(res.message ?? "Resend failed")}`);
  }
  return c.redirect(`/admin/access/reviewers?ok=${encodeURIComponent(`Invite resent to ${data.user.email}.`)}`);
});

/** Creates the profile row an invited reviewer never got (see the "Needs repair" card). */
accessRoutes.post("/admin/access/reviewers/:id/repair", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/reviewers?err=Service%20role%20not%20configured");
  const id = c.req.param("id");

  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data?.user?.email) {
    return c.redirect("/admin/access/reviewers?err=Account%20not%20found");
  }
  const meta = data.user.user_metadata ?? {};
  const role = meta.role_code === "rvp" ? "rvp" : "district_director";
  const district = meta.district ?? null;
  const region = meta.region ?? null;

  const res = await setProfileScope(admin, id, {
    role,
    email: data.user.email,
    fullName: meta.full_name ?? "",
    district: role === "district_director" ? district : null,
    region: role === "rvp" ? region : null,
  });
  if (!res.ok) {
    return c.redirect(`/admin/access/reviewers?err=${encodeURIComponent(res.message ?? "Repair failed")}`);
  }
  await syncReviewerAssignments(admin, id, role, { district, region });
  return c.redirect(`/admin/access/reviewers?ok=${encodeURIComponent(`Profile created for ${data.user.email}.`)}`);
});

accessRoutes.post("/admin/access/reviewers/:id/active", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/reviewers?err=Service%20role%20not%20configured");
  const form = await c.req.formData();
  const active = String(form.get("active") ?? "0") === "1";
  const id = c.req.param("id");
  await setAccountActive(admin, id, active);
  return c.redirect(
    `/admin/access/reviewers?ok=${encodeURIComponent(active ? "Account reactivated." : "Account deactivated.")}`
  );
});

/* ======================================================================== */
/* Admins                                                                   */
/* ======================================================================== */
accessRoutes.get("/admin/access/admins", async (c) => {
  const ctx = await requireAdminView(c);
  if (ctx instanceof Response) return ctx;
  const { session, admin, canWrite } = ctx;
  const store = getStore(c);
  const [fullAdmins, readonlyAdmins] = await Promise.all([
    store.listProfilesByRole("admin"),
    store.listProfilesByRole("admin_readonly"),
  ]);
  const admins = [...fullAdmins, ...readonlyAdmins].sort((a: any, b: any) =>
    (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "")
  );

  // Same pending/confirmed distinction as the reviewers page — an admin
  // whose invite link expired before they finished sign-up needs a resend,
  // not a password reset. Same orphaned-invite gap too: an auth user with
  // no matching profile row is invisible in `admins` (built from
  // listProfilesByRole), so surface it separately instead of it just
  // disappearing.
  let pendingEmails = new Set<string>();
  let orphaned: any[] = [];
  if (admin) {
    const users = await listAllAuthUsers(admin);
    pendingEmails = new Set(
      users.filter((u: any) => !u.email_confirmed_at).map((u: any) => (u.email ?? "").toLowerCase())
    );
    const profileIds = new Set(admins.map((p: any) => p.id));
    orphaned = users.filter((u: any) => {
      const rc = u.user_metadata?.role_code;
      return (rc === "admin" || rc === "admin_readonly") && !profileIds.has(u.id);
    });
  }

  const ok = c.req.query("ok");
  const err = c.req.query("err");

  const body = (
    <>
      <PageHead
        title="Admins"
        lede="Full access to every chapter, reviewer, rubric and reporting tool."
        actions={
          <a class="btn secondary" href="/admin/access">
            Back
          </a>
        }
      />
      {ok ? <Callout tone="green">{decodeURIComponent(ok)}</Callout> : null}
      {err ? <Callout tone="red">{decodeURIComponent(err)}</Callout> : null}
      {!canWrite ? (
        <Callout tone="blue">
          You have read-only access. Inviting, resetting, and deactivating admins is limited to
          full admins.
        </Callout>
      ) : null}
      {canWrite && !admin ? (
        <Callout tone="red">
          Inviting admins needs the live database (service-role key not configured here).
        </Callout>
      ) : null}

      {canWrite ? (
        <Card title="Invite an admin">
          <p class="muted small">
            Supabase emails an invitation; the new admin sets their own password. <strong>Full
            access</strong> can manage every chapter, reviewer, and other admin account.{" "}
            <strong>Read-only</strong> can view everything here but change nothing — invite, reset,
            deactivate, provisioning, imports and uploads are all unavailable to them.
          </p>
          <form method="post" action="/admin/access/admins/invite" class="grid grid-3" style="margin-top:12px;">
            <label class="field">
              <span>Full name</span>
              <input type="text" name="full_name" required />
            </label>
            <label class="field">
              <span>Email</span>
              <input type="email" name="email" required />
            </label>
            <label class="field">
              <span>Access level</span>
              <select name="role">
                <option value="admin">Full access</option>
                <option value="admin_readonly">Read-only</option>
              </select>
            </label>
            <div class="row" style="align-items:flex-end;">
              <button class="btn gold" type="submit" disabled={!admin}>
                Send invite
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {orphaned.length ? (
        <div style="margin-top:16px;">
          <Card title={`Needs repair (${orphaned.length})`}>
            <Callout tone="gold">
              These were invited but never got a profile row, so they don't appear below — a known
              gap when an invite is re-sent to an address that already has an unconfirmed account.
              Repairing creates the missing profile.
            </Callout>
            <div class="table-wrap" style="margin-top:12px;">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Access level</th>
                    {canWrite ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {orphaned.map((u: any) => (
                    <tr>
                      <td class="mono tiny">{u.email}</td>
                      <td class="small">
                        {u.user_metadata?.role_code === "admin_readonly" ? "Read-only" : "Full access"}
                      </td>
                      {canWrite ? (
                        <td>
                          <form method="post" action={`/admin/access/admins/${u.id}/repair`}>
                            <button class="btn gold small" type="submit">
                              Repair
                            </button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      <div style="margin-top:16px;">
        <Card title={`Admins (${admins.length})`}>
          {admins.length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <div class="table-wrap" style="max-height:420px;">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Access level</th>
                    <th>Invite</th>
                    <th>Active</th>
                    {canWrite ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {admins.map((p: any) => {
                    const isSelf = p.id === session.profileId;
                    const isReadonly = p.role_code === "admin_readonly";
                    const pending = pendingEmails.has((p.email ?? "").toLowerCase());
                    return (
                      <tr>
                        <td>
                          {p.full_name || "—"}
                          {isSelf ? <span class="tiny muted"> (you)</span> : null}
                        </td>
                        <td class="mono tiny">{p.email}</td>
                        <td>
                          <Badge tone={isReadonly ? "blue" : "gold"}>
                            {isReadonly ? "Read-only" : "Full access"}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={pending ? "amber" : "green"}>{pending ? "pending" : "confirmed"}</Badge>
                        </td>
                        <td>
                          <Badge tone={p.is_active ? "green" : "gray"}>{p.is_active ? "active" : "off"}</Badge>
                        </td>
                        {canWrite ? (
                          <td class="row" style="gap:6px;">
                            {pending ? (
                              <form
                                method="post"
                                action={`/admin/access/admins/${p.id}/resend`}
                                onsubmit="return confirm('Resend the invite email to this admin?')"
                              >
                                <button class="btn secondary small" type="submit">
                                  Resend invite
                                </button>
                              </form>
                            ) : (
                              <form
                                method="post"
                                action={`/admin/access/admins/${p.id}/reset`}
                                onsubmit="return confirm('Send this admin a password reset email?')"
                              >
                                <button class="btn secondary small" type="submit">
                                  Reset password
                                </button>
                              </form>
                            )}
                            {!isSelf ? (
                              <form
                                method="post"
                                action={`/admin/access/admins/${p.id}/active`}
                                onsubmit={
                                  p.is_active
                                    ? "return confirm('Remove admin access for this person?')"
                                    : undefined
                                }
                              >
                                <input type="hidden" name="active" value={p.is_active ? "0" : "1"} />
                                <button class="btn secondary small" type="submit">
                                  {p.is_active ? "Deactivate" : "Reactivate"}
                                </button>
                              </form>
                            ) : (
                              <span class="tiny muted">Can't deactivate your own account</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
  return renderPage(c, { title: "Admins", session, body });
});

accessRoutes.post("/admin/access/admins/invite", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/admins?err=Service%20role%20not%20configured");
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").trim();
  const fullName = String(form.get("full_name") ?? "").trim();
  const roleInput = String(form.get("role") ?? "admin");
  const role = roleInput === "admin_readonly" ? "admin_readonly" : "admin";
  const origin = new URL(c.req.url).origin;

  const res = await createAdminAccount(admin, { email, fullName, origin, role });
  if (!res.ok) {
    return c.redirect(`/admin/access/admins?err=${encodeURIComponent(res.message ?? "Invite failed")}`);
  }
  const levelNote = role === "admin_readonly" ? " (read-only)" : " (full access)";
  return c.redirect(`/admin/access/admins?ok=${encodeURIComponent(`Invite sent to ${email}${levelNote}.`)}`);
});

accessRoutes.post("/admin/access/admins/:id/reset", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/admins?err=Service%20role%20not%20configured");
  const id = c.req.param("id");
  const origin = new URL(c.req.url).origin;

  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data?.user?.email) {
    return c.redirect("/admin/access/admins?err=Admin%20not%20found");
  }

  const res = await resetReviewerPassword(admin, data.user.email, origin);
  if (!res.ok) {
    return c.redirect(`/admin/access/admins?err=${encodeURIComponent(res.message ?? "Reset failed")}`);
  }
  return c.redirect(
    `/admin/access/admins?ok=${encodeURIComponent(`Password reset email sent to ${data.user.email}.`)}`
  );
});

accessRoutes.post("/admin/access/admins/:id/resend", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/admins?err=Service%20role%20not%20configured");
  const id = c.req.param("id");
  const origin = new URL(c.req.url).origin;

  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data?.user?.email) {
    return c.redirect("/admin/access/admins?err=Admin%20not%20found");
  }

  const res = await resendInvite(admin, data.user.email, origin);
  if (!res.ok) {
    return c.redirect(`/admin/access/admins?err=${encodeURIComponent(res.message ?? "Resend failed")}`);
  }
  return c.redirect(`/admin/access/admins?ok=${encodeURIComponent(`Invite resent to ${data.user.email}.`)}`);
});

/** Creates the profile row an invited admin never got (see the "Needs repair" card). */
accessRoutes.post("/admin/access/admins/:id/repair", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { admin } = ctx;
  if (!admin) return c.redirect("/admin/access/admins?err=Service%20role%20not%20configured");
  const id = c.req.param("id");

  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data?.user?.email) {
    return c.redirect("/admin/access/admins?err=Account%20not%20found");
  }
  const meta = data.user.user_metadata ?? {};
  const role = meta.role_code === "admin_readonly" ? "admin_readonly" : "admin";

  const res = await setProfileScope(admin, id, { role, email: data.user.email, fullName: meta.full_name ?? "" });
  if (!res.ok) {
    return c.redirect(`/admin/access/admins?err=${encodeURIComponent(res.message ?? "Repair failed")}`);
  }
  return c.redirect(`/admin/access/admins?ok=${encodeURIComponent(`Profile created for ${data.user.email}.`)}`);
});

accessRoutes.post("/admin/access/admins/:id/active", async (c) => {
  const ctx = await requireAdmin(c);
  if (ctx instanceof Response) return ctx;
  const { session, admin } = ctx;
  if (!admin) return c.redirect("/admin/access/admins?err=Service%20role%20not%20configured");
  const id = c.req.param("id");

  // Server-side guard, not just UI: never let an admin remove their own
  // access this way - a mis-click or a crafted request could otherwise
  // lock out the only admin signed in to undo it.
  if (id === session.profileId) {
    return c.redirect("/admin/access/admins?err=You%20can't%20deactivate%20your%20own%20account");
  }

  const form = await c.req.formData();
  const active = String(form.get("active") ?? "0") === "1";
  await setAccountActive(admin, id, active);
  return c.redirect(
    `/admin/access/admins?ok=${encodeURIComponent(active ? "Admin reactivated." : "Admin deactivated.")}`
  );
});
