import type { FC, Child } from "hono/jsx";
import type { Tone } from "../lib/format";

export const Badge: FC<{ tone?: Tone; children: Child }> = ({
  tone = "gray",
  children,
}) => <span class={`badge ${tone}`}>{children}</span>;

export const Kpi: FC<{
  label: string;
  value: Child;
  note?: Child;
  tone?: "gold" | "green" | "amber" | "red" | "blue" | "";
}> = ({ label, value, note, tone = "" }) => (
  <div class={`kpi ${tone}`}>
    <div class="kpi-label">{label}</div>
    <div class="kpi-value">{value}</div>
    {note ? <div class="kpi-note">{note}</div> : null}
  </div>
);

export const Progress: FC<{ percent: number; variant?: "gold" | "blue" | "green" }> = ({
  percent,
  variant = "gold",
}) => (
  <div class={`progress ${variant === "gold" ? "" : variant}`}>
    <span style={`width:${Math.max(0, Math.min(100, percent))}%`} />
  </div>
);

export const Card: FC<{
  title?: Child;
  action?: Child;
  children: Child;
  class?: string;
}> = ({ title, action, children, class: cls = "" }) => (
  <section class={`card ${cls}`}>
    {title || action ? (
      <div class="card-title">
        {title ? <h3>{title}</h3> : <span />}
        {action ? <div class="row">{action}</div> : null}
      </div>
    ) : null}
    {children}
  </section>
);

export const Empty: FC<{ children: Child }> = ({ children }) => (
  <div class="empty">{children}</div>
);

export const Callout: FC<{ tone?: "gold" | "blue" | "green" | "red"; children: Child }> = ({
  tone = "gold",
  children,
}) => <div class={`callout ${tone === "gold" ? "" : tone}`}>{children}</div>;

/** Compact bar used in rollup tables; rendered inline in a table cell. */
export const MiniBar: FC<{ percent: number; variant?: "gold" | "blue" | "green" }> = ({
  percent,
  variant = "gold",
}) => (
  <div class="row" style="gap:8px;min-width:130px;">
    <div class={`progress ${variant === "gold" ? "" : variant}`} style="flex:1;">
      <span style={`width:${Math.max(0, Math.min(100, percent))}%`} />
    </div>
    <span class="tiny mono" style="width:44px;text-align:right;">
      {Math.round(percent * 10) / 10}%
    </span>
  </div>
);

/** Renders a form that POSTs then redirects (progressive-enhancement friendly). */
export const ActionButton: FC<{
  action: string;
  hidden?: Record<string, string>;
  label: Child;
  variant?: "" | "gold" | "secondary" | "green" | "red";
  small?: boolean;
  confirm?: string;
  disabled?: boolean;
}> = ({ action, hidden = {}, label, variant = "", small = false, confirm, disabled }) => (
  <form method="post" action={action} style="display:inline;">
    {Object.entries(hidden).map(([k, v]) => (
      <input type="hidden" name={k} value={v} />
    ))}
    <button
      type="submit"
      class={`btn ${variant} ${small ? "small" : ""}`}
      disabled={disabled}
      onclick={confirm ? `return confirm(${JSON.stringify(confirm)})` : undefined}
    >
      {label}
    </button>
  </form>
);

export const PageHead: FC<{
  title: string;
  lede?: Child;
  actions?: Child;
}> = ({ title, lede, actions }) => (
  <header class="page-head">
    <div>
      <h1>{title}</h1>
      {lede ? <p class="lede">{lede}</p> : null}
    </div>
    {actions ? <div class="actions">{actions}</div> : null}
  </header>
);
