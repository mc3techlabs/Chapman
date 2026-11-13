import { Hono } from "hono";
import { renderPage } from "../lib/render";
import { getStore, getAdminClient } from "../lib/store";
import { Badge, Callout, Card, Empty, Kpi, PageHead } from "../views/components";
import { fmtBytes, fmtDate } from "../lib/format";
import { validateUpload } from "../lib/session";
import { flattenItems } from "../lib/scoring";

export const documentsRoutes = new Hono<{ Bindings: any; Variables: any }>();

type Category = "tax" | "special_event" | "other";

const CATEGORY_META: Record<
  Category,
  { title: string; base: string; lede: string; intro: string }
> = {
  tax: {
    title: "Tax Documents",
    base: "/admin/documents",
    lede: "Upload and track chapter tax filings — 990s, audits, returns and foundation filings.",
    intro:
      "Documents filed here attach to a chapter and the current reporting period. Formats and size limits come from each document type, so the required format can be re-specified later without a code change. The chapter audit and foundation 990 are Chapter Upload rubric items, so they're uploaded by the chapter itself (My Chapter → Chapman Report) and only show up here once filed — not uploadable from this page.",
  },
  special_event: {
    title: "Special Event Checklists",
    base: "/admin/special-events",
    lede: "Upload and track special event planning and after-action checklists.",
    intro:
      "This is a framework: the checklist format is intentionally not fixed yet. Add or edit document types (and their accepted formats) when the final format is decided — no code change needed.",
  },
  other: {
    title: "Other Documents",
    base: "/admin/other-documents",
    lede: "District, Regional, and General fees payment confirmations.",
    intro:
      "Uploading here against an Admin Upload rubric document type also resolves the matching rubric item to \"Yes\" on the chapter's current report. Chapter Upload document types (bank account verification, GRIP, audit, 990) are deliberately not uploadable here — those must come from the chapter itself, under My Chapter → Chapman Report.",
  },
};

/** Full-access admin only - the upload route uses this. */
async function requireAdmin(c: any) {
  const session = c.get("session");
  if (session.role !== "admin") return c.redirect("/");
  return session;
}

/** Admin or admin_readonly - viewing and downloading use this. */
async function requireAdminView(c: any): Promise<{ session: any; canWrite: boolean } | Response> {
  const session = c.get("session");
  if (session.role !== "admin" && session.role !== "admin_readonly") return c.redirect("/");
  return { session, canWrite: session.role === "admin" };
}

/**
 * Document type codes a Chapter Upload rubric item needs. These must come
 * from the chapter itself — enforced here (not just hidden from the admin
 * upload cards) so a direct POST can't route around it either.
 */
async function chapterUploadOnlyCodes(store: any): Promise<Set<string>> {
  const [collegiateTree, alumniTree] = await Promise.all([
    store.getRubricForType("collegiate"),
    store.getRubricForType("alumni"),
  ]);
  const codes = new Set<string>();
  for (const tree of [collegiateTree, alumniTree]) {
    if (!tree) continue;
    for (const item of flattenItems(tree)) {
      if (item.scoring_type === "chapter_upload" && item.document_type_code) {
        codes.add(item.document_type_code);
      }
    }
  }
  return codes;
}

/** Shared renderer for a document category page (tax / special event). */
async function renderCategory(c: any, category: Category) {
  const ctx = await requireAdminView(c);
  if (ctx instanceof Response) return ctx;
  const { session, canWrite } = ctx;
  const store = getStore(c);
  const meta = CATEGORY_META[category];
  const [types, docs, chapters, chapterUploadCodes] = await Promise.all([
    store.listDocumentTypes(),
    store.listDocuments({ category, limit: 200 }),
    store.listChapters({ limit: 500 }),
    chapterUploadOnlyCodes(store),
  ]);
  const catTypes = types.filter((t) => t.category === category);
  const uploadableCatTypes = catTypes.filter((t) => !chapterUploadCodes.has(t.code));

  const typeByCode = new Map(catTypes.map((t) => [t.code, t]));
  const chapterById = new Map(chapters.rows.map((ch) => [ch.id, ch]));
  const flash = c.req.query("ok");
  const err = c.req.query("err");

  const body = (
    <>
      <PageHead
        title={meta.title}
        lede={meta.lede}
        actions={<a class="btn secondary" href="/admin">Back to admin</a>}
      />

      {flash ? <Callout tone="green">Upload recorded ({flash}).</Callout> : null}
      {err ? <Callout tone="red">{decodeURIComponent(err)}</Callout> : null}

      <div class="grid grid-kpi" style="margin-top:16px;">
        <Kpi label="Document types" value={uploadableCatTypes.length} tone="gold" />
        <Kpi label="Files on record" value={docs.length} tone="blue" />
        <Kpi
          label="Accepted"
          value={docs.filter((d) => d.status === "accepted").length}
          tone="green"
        />
        <Kpi
          label="Awaiting review"
          value={docs.filter((d) => d.status !== "accepted").length}
          tone="amber"
        />
      </div>

      <div style="margin-top:16px;">
        <Callout>{meta.intro}</Callout>
      </div>

      <div class="grid grid-2" style="margin-top:16px;">
        {uploadableCatTypes.map((t) => (
          <Card title={t.label}>
            <p class="muted small">{t.description}</p>
            <div class="row" style="margin:8px 0;gap:8px;">
              <Badge tone={category === "tax" ? "gold" : "blue"}>{t.category}</Badge>
              <span class="pill mono tiny">{t.allowed_extensions.join(", ")}</span>
              <span class="pill tiny">max {t.max_size_mb} MB</span>
            </div>
            {canWrite ? (
              <form
                method="post"
                action="/documents/upload"
                enctype="multipart/form-data"
                class="stack"
              >
                <input type="hidden" name="documentTypeCode" value={t.code} />
                <input type="hidden" name="category" value={category} />
                <label class="field">
                  <span>Chapter</span>
                  <select name="chapterId" required>
                    <option value="">Select a chapter…</option>
                    {chapters.rows.map((ch: any) => (
                      <option value={ch.id}>
                        {ch.chapter_name} ({ch.chapter_key})
                      </option>
                    ))}
                  </select>
                </label>
                <label class="field">
                  <span>File</span>
                  <input
                    type="file"
                    name="file"
                    accept={t.allowed_extensions.map((e) => `.${e}`).join(",")}
                    required
                  />
                </label>
                <label class="field">
                  <span>Notes (optional)</span>
                  <input type="text" name="notes" placeholder="Filing year, reference, etc." />
                </label>
                <button class="btn gold" type="submit">
                  Upload {t.label}
                </button>
              </form>
            ) : (
              <p class="muted small">Read-only access — uploading is limited to full admins.</p>
            )}
          </Card>
        ))}
        {uploadableCatTypes.length === 0 ? (
          <Card title="No document types">
            <Empty>
              {catTypes.length > 0
                ? "Every document type in this category is a Chapter Upload rubric item — uploaded by the chapter itself, not from here."
                : "No document types are configured for this category yet. Add them in the seed data (document_types.csv) when the format is decided."}
            </Empty>
          </Card>
        ) : null}
      </div>

      <div style="margin-top:16px;">
        <Card title={`Files on record (${docs.length})`}>
          {docs.length === 0 ? (
            <Empty>No files uploaded yet.</Empty>
          ) : (
            <div class="table-wrap" style="max-height:520px;">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Chapter</th>
                    <th class="num">Size</th>
                    <th>Uploaded</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d: any) => (
                    <tr>
                      <td>
                        <a href={`/documents/${d.id}/download`}>{d.file_name}</a>
                      </td>
                      <td class="mono tiny">{typeByCode.get(d.document_type_code)?.label ?? d.document_type_code}</td>
                      <td class="small">
                        {chapterById.get(d.chapter_id)?.chapter_name ?? "—"}
                      </td>
                      <td class="num">{fmtBytes(d.size_bytes)}</td>
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

  return renderPage(c, { title: meta.title, session, body });
}

/* ---------------------------------------------------------------------- */
/* Pages                                                                  */
/* ---------------------------------------------------------------------- */
documentsRoutes.get("/admin/documents", (c) => renderCategory(c, "tax"));
documentsRoutes.get("/admin/special-events", (c) => renderCategory(c, "special_event"));
documentsRoutes.get("/admin/other-documents", (c) => renderCategory(c, "other"));

/* ---------------------------------------------------------------------- */
/* Upload handler                                                         */
/* ---------------------------------------------------------------------- */
documentsRoutes.post("/documents/upload", async (c) => {
  const session = await requireAdmin(c);
  if (session instanceof Response) return session;
  const store = getStore(c);
  const form = await c.req.formData();
  const documentTypeCode = String(form.get("documentTypeCode") ?? "");
  const chapterId = String(form.get("chapterId") ?? "");
  const category = (String(form.get("category") ?? "tax") as Category) || "tax";
  const notes = String(form.get("notes") ?? "");
  const base = CATEGORY_META[category]?.base ?? "/admin/documents";

  const types = await store.listDocumentTypes();
  const docType = types.find((t) => t.code === documentTypeCode);
  if (!docType) {
    return c.redirect(`${base}?err=${encodeURIComponent("Unknown document type.")}`);
  }
  if ((await chapterUploadOnlyCodes(store)).has(documentTypeCode)) {
    return c.redirect(
      `${base}?err=${encodeURIComponent("This document must be uploaded by the chapter itself, not by an admin.")}`
    );
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return c.redirect(`${base}?err=${encodeURIComponent("No file provided.")}`);
  }
  const check = validateUpload(
    { name: file.name, size: file.size, type: file.type },
    docType
  );
  if (!check.ok) {
    return c.redirect(`${base}?err=${encodeURIComponent(check.error)}`);
  }
  if (!chapterId) {
    return c.redirect(`${base}?err=${encodeURIComponent("Select a chapter.")}`);
  }

  const chapter = await store.getChapter(chapterId);
  if (!chapter) {
    return c.redirect(`${base}?err=${encodeURIComponent("Chapter not found.")}`);
  }

  const period = await store.getCurrentPeriod();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${chapter.chapter_key}/${documentTypeCode}/${Date.now()}-${safeName}`;

  const admin = getAdminClient((c.env ?? {}) as any);
  const bucket = ((c.env ?? {}) as any).DOCUMENTS_BUCKET || "chapman-documents";

  if (admin) {
    const bytes = await file.arrayBuffer();
    const { error } = await admin.storage.from(bucket).upload(storagePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) {
      return c.redirect(
        `${base}?err=${encodeURIComponent("Storage upload failed: " + error.message)}`
      );
    }
  }
  // In preview/demo mode there is no Storage bucket; the metadata row is still
  // recorded so the workflow and UI are fully exercisable.

  await store.createDocument({
    chapterId,
    documentTypeCode,
    fileName: file.name,
    storagePath,
    contentType: file.type || null,
    sizeBytes: file.size,
    termCode: period.termCode,
    reportingYear: period.reportingYear,
    notes: notes || null,
  });
  // A no-op unless this document type satisfies an Admin Upload rubric item
  // on the chapter's current report — an admin's own upload never resolves
  // a Chapter Upload item, which must come from the chapter itself.
  await store.markUploadReceived(chapterId, documentTypeCode, period, "admin");

  return c.redirect(`${base}?ok=${encodeURIComponent(file.name)}`);
});

/* ---------------------------------------------------------------------- */
/* Download (signed URL in production)                                    */
/* ---------------------------------------------------------------------- */
documentsRoutes.get("/documents/:id/download", async (c) => {
  const ctx = await requireAdminView(c);
  if (ctx instanceof Response) return ctx;
  const id = c.req.param("id");
  const admin = getAdminClient((c.env ?? {}) as any);
  const bucket = ((c.env ?? {}) as any).DOCUMENTS_BUCKET || "chapman-documents";
  if (!admin) {
    return c.text("Downloads are available once storage is configured.", 501);
  }
  // Look up the row's storage path directly (service role), then mint a URL.
  const { data } = await admin.from("documents").select("storage_path").eq("id", id).maybeSingle();
  if (!data?.storage_path) return c.text("Document not found", 404);
  const { data: signed, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(data.storage_path, 300);
  if (error || !signed?.signedUrl) {
    return c.text("Could not create a download link.", 500);
  }
  return c.redirect(signed.signedUrl);
});
