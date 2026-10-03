import type { FC, Child } from "hono/jsx";
import type { SessionUser } from "../lib/types";
import { ROLE_LABELS, initials, periodLabel, TERM_LABELS } from "../lib/format";
import type { TermCode } from "../lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

function navFor(role: SessionUser["role"]): { group: string; items: NavItem[] }[] {
  const common: NavItem[] = [];
  if (role === "admin") {
    return [
      {
        group: "Administration",
        items: [
          { href: "/admin", label: "Overview", icon: "▦" },
          { href: "/admin/reviewers", label: "Reviewers", icon: "☰" },
          { href: "/admin/rubrics", label: "Rubrics", icon: "❏" },
        ],
      },
      {
        group: "Roster",
        items: [
          { href: "/admin/chapters", label: "Chapters & Import", icon: "▤" },
          { href: "/admin/documents", label: "Tax Documents", icon: "§" },
          { href: "/admin/special-events", label: "Special Event Checklists", icon: "◇" },
        ],
      },
      {
        group: "Reporting",
        items: [
          { href: "/admin/rollups", label: "National Rollups", icon: "◔" },
          { href: "/admin/windows", label: "Reporting Windows", icon: "◷" },
        ],
      },
    ];
  }
  if (role === "chapter") {
    return [
      {
        group: "My Chapter",
        items: [
          { href: "/chapter", label: "Dashboard", icon: "▦" },
          { href: "/chapter/submission", label: "Chapman Report", icon: "❏" },
          { href: "/chapter/documents", label: "My Documents", icon: "§" },
        ],
      },
    ];
  }
  if (role === "district_director") {
    return [
      {
        group: "District Review",
        items: [
          { href: "/district", label: "District Dashboard", icon: "▦" },
          { href: "/district/review", label: "Review Queue", icon: "☰" },
        ],
      },
    ];
  }
  if (role === "rvp") {
    return [
      {
        group: "Regional Review",
        items: [
          { href: "/region", label: "Regional Dashboard", icon: "▦" },
          { href: "/region/review", label: "Review Queue", icon: "☰" },
        ],
      },
    ];
  }
  // executive_director
  return [
    {
      group: "National",
      items: [
        { href: "/national", label: "Executive Dashboard", icon: "▦" },
        { href: "/national/approvals", label: "Final Approvals", icon: "✔" },
        { href: "/national/rollups", label: "National Rollups", icon: "◔" },
      ],
    },
  ];
}

export const Sidebar: FC<{
  session: SessionUser;
  current: string;
}> = ({ session, current }) => {
  const groups = navFor(session.role);
  return (
    <aside class="sidebar">
      <div class="brand">
        <img src="/static/crest.png" alt="Alpha Phi Alpha crest" />
        <div>
          <div class="brand-name">Alpha Phi Alpha</div>
          <div class="brand-sub">Chapman Reporting Portal</div>
        </div>
      </div>
      <nav class="nav">
        {groups.map((g) => (
          <div class="nav-group">
            <div class="nav-group-label">{g.group}</div>
            {g.items.map((it) => (
              <a
                href={it.href}
                class={current === it.href || current.startsWith(it.href + "/") ? "active" : ""}
              >
                <span class="icon">{it.icon}</span>
                {it.label}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div class="sidebar-foot">
        <div class="who">{session.fullName || session.email}</div>
        <div class="role">{ROLE_LABELS[session.role]}</div>
        {session.district ? <div class="small">{session.district} District</div> : null}
        {session.region ? <div class="small">{session.region} Region</div> : null}
        <form method="post" action="/logout" style="margin-top:10px;">
          <button class="btn secondary small" type="submit">Sign out</button>
        </form>
      </div>
    </aside>
  );
};

export const DemoBanner: FC<{
  enabled: boolean;
  persona: string;
  period: { termCode: TermCode; reportingYear: number };
}> = ({ enabled, persona, period }) => {
  if (!enabled) return null;
  return (
    <div class="demo-banner">
      <span class="tag">PREVIEW</span>
      <span>
        Demo data — no Supabase attached yet. Role:{" "}
        <strong>{persona || "admin"}</strong> · {periodLabel(period.termCode, period.reportingYear)}
      </span>
      <form method="post" action="/demo/persona" class="row" style="gap:6px;">
        <select name="persona" onchange="this.form.submit()">
          <option value="admin" selected={persona === "admin" || !persona}>Admin</option>
          <option value="executive_director" selected={persona === "executive_director"}>
            Executive Director
          </option>
          <option value="rvp:Southern" selected={persona === "rvp:Southern"}>
            RVP — Southern
          </option>
          <option value="district_director:Alabama" selected={persona === "district_director:Alabama"}>
            District Director — Alabama
          </option>
          <option value="chapter:1" selected={persona === "chapter:1"}>
            Chapter Login — Alpha (1)
          </option>
          <option value="chapter:23" selected={persona === "chapter:23"}>
            Chapter Login — Alpha Alpha (23)
          </option>
        </select>
      </form>
    </div>
  );
};

export const Shell: FC<{
  session: SessionUser;
  current: string;
  demo: boolean;
  persona: string;
  period: { termCode: TermCode; reportingYear: number };
  children: Child;
}> = ({ session, current, demo, persona, period, children }) => (
  <>
    <DemoBanner enabled={demo} persona={persona} period={period} />
    <div class="shell">
      <Sidebar session={session} current={current} />
      <main class="content">{children}</main>
    </div>
  </>
);

export const LoginPage: FC<{ error?: string; demo: boolean }> = ({ error, demo }) => (
  <div class="login-wrap">
    <div class="login-card">
      <img class="crest" src="/static/crest.png" alt="Alpha Phi Alpha crest" />
      <h1>Chapman Reporting Portal</h1>
      <p class="sub">Alpha Phi Alpha Fraternity, Inc. — Chapter Management Reporting</p>
      {error ? <p class="error" style="text-align:center;">{error}</p> : null}
      <form method="post" action="/login" class="stack">
        <label class="field">
          <span>Email</span>
          <input type="email" name="email" required autocomplete="username" />
        </label>
        <label class="field">
          <span>Password</span>
          <input type="password" name="password" required autocomplete="current-password" />
        </label>
        <button class="btn gold block" type="submit">Sign in</button>
      </form>
      {demo ? (
        <p class="small muted" style="text-align:center;margin-top:16px;">
          Preview mode is on —{" "}
          <a href="/demo/preview">continue without signing in →</a>
        </p>
      ) : (
        <p class="tiny muted" style="text-align:center;margin-top:16px;">
          Chapters use one shared login issued by the General Office.
          <br />
          Single sign-on via AlphaMX is planned.
        </p>
      )}
    </div>
  </div>
);

/** Small inline avatar chip. */
export const Avatar: FC<{ name: string | null }> = ({ name }) => (
  <span
    style="display:inline-flex;width:28px;height:28px;border-radius:50%;background:var(--gold-soft);color:var(--gold-deep);font-weight:800;align-items:center;justify-content:center;font-size:0.74rem;"
    title={name ?? ""}
  >
    {initials(name)}
  </span>
);

export { TERM_LABELS };
