import type { Child } from "hono/jsx";
import type { Context } from "hono";
import type { SessionUser, TermCode } from "../lib/types";
import { Shell } from "../views/layout";
import { isDemoMode, readDemoPersona } from "./session";
import { getStore, type AppEnv } from "./store";

/**
 * Renders a full HTML document for a signed-in page.
 * Keeps <head>, the demo banner, and the sidebar shell in one place so every
 * route only writes its own page body.
 */
export async function renderPage(
  c: Context,
  opts: { title: string; session: SessionUser; body: Child }
): Promise<Response> {
  const env = (c.env ?? {}) as AppEnv;
  const demo = isDemoMode(env);
  const persona = readDemoPersona(c) ?? "admin";
  let period = { termCode: "fall" as TermCode, reportingYear: new Date().getFullYear() };
  try {
    period = await getStore(c).getCurrentPeriod();
  } catch {
    /* keep default */
  }
  const current = new URL(c.req.url).pathname;

  const page = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{opts.title} · Chapman Reporting Portal</title>
        <link rel="icon" href="/static/favicon.svg" />
        <link rel="stylesheet" href="/static/app.css" />
      </head>
      <body>
        <Shell
          session={opts.session}
          current={current}
          demo={demo}
          persona={persona}
          period={period}
        >
          {opts.body}
        </Shell>
      </body>
    </html>
  );
  return c.html(page);
}

/** Renders a standalone (non-shell) page — used for login and simple notices. */
export async function renderBare(
  c: Context,
  body: Child,
  status: 200 | 401 = 200
): Promise<Response> {
  const page = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Chapman Reporting Portal</title>
        <link rel="icon" href="/static/favicon.svg" />
        <link rel="stylesheet" href="/static/app.css" />
      </head>
      <body>{body}</body>
    </html>
  );
  return await c.html(page, status);
}
