import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./lib/store";
import { getStore, isDemoMode } from "./lib/store";
import { clearSession, readDemoPersona, writeDemoPersona, writeSession } from "./lib/session";
import { ROLE_HOME } from "./lib/format";
import { LoginPage } from "./views/layout";
import { renderBare } from "./lib/render";
import { chapterRoutes } from "./routes/chapter";
import { reviewRoutes } from "./routes/review";
import { adminRoutes } from "./routes/admin";
import { rollupRoutes } from "./routes/rollups";
import { documentsRoutes } from "./routes/documents";

export type Bindings = AppEnv;
export interface Variables {
  session: import("./lib/types").SessionUser;
}
export type App = Hono<{ Bindings: Bindings; Variables: Variables }>;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Static assets (CSS, crest, favicon) from /public/static.
// ---------------------------------------------------------------------------
app.use("/static/*", serveStatic({ root: "./public" }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (c) => c.json({ ok: true, mode: isDemoMode(c.env) ? "demo" : "supabase" }));

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------
app.get("/login", (c) => {
  const demo = isDemoMode(c.env);
  return renderBare(c, <LoginPage demo={demo} />);
});

app.post("/login", async (c) => {
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const store = getStore(c);
  const result = await store.signIn(email, password);
  if (result.error) {
    const demo = isDemoMode(c.env);
    return renderBare(c, <LoginPage error={result.error} demo={demo} />, 401);
  }
  const session = await store.getSession();
  return c.redirect(session ? ROLE_HOME[session.role] : "/");
});

app.post("/logout", async (c) => {
  await getStore(c).signOut();
  clearSession(c);
  return c.redirect("/login");
});

// ---------------------------------------------------------------------------
// Demo mode: persona switcher + passwordless preview entry.
// ---------------------------------------------------------------------------
app.post("/demo/persona", async (c) => {
  const form = await c.req.formData();
  const persona = String(form.get("persona") ?? "admin");
  writeDemoPersona(c, persona);
  const store = getStore(c);
  const session = await store.getSession();
  return c.redirect(session ? ROLE_HOME[session.role] : "/");
});

app.get("/demo/preview", (c) => {
  if (!isDemoMode(c.env)) return c.redirect("/login");
  if (!readDemoPersona(c)) writeDemoPersona(c, "admin");
  return c.redirect("/admin");
});

// ---------------------------------------------------------------------------
// Auth gate + session middleware for everything else.
// ---------------------------------------------------------------------------
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    path === "/login" ||
    path === "/health" ||
    path.startsWith("/static/") ||
    path.startsWith("/demo/")
  ) {
    return next();
  }
  const store = getStore(c);
  const session = await store.getSession();
  if (!session) {
    if (isDemoMode(c.env)) return c.redirect("/demo/preview");
    return c.redirect("/login");
  }
  c.set("session", session);
  await next();
});

// ---------------------------------------------------------------------------
// Root -> role home
// ---------------------------------------------------------------------------
app.get("/", (c) => {
  const session = c.get("session");
  return c.redirect(session ? ROLE_HOME[session.role] : "/login");
});

// ---------------------------------------------------------------------------
// Feature routes
// ---------------------------------------------------------------------------
app.route("/", chapterRoutes);
app.route("/", reviewRoutes);
app.route("/", rollupRoutes);
app.route("/", documentsRoutes);
app.route("/", adminRoutes);

app.notFound((c) => c.text("Not found", 404));

export default app;
