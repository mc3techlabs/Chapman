import { Hono } from "hono";
import { getAdminClient, getAnonClient } from "../lib/store";

export const authRoutes = new Hono<{ Bindings: any; Variables: any }>();

/**
 * Where a reviewer lands after clicking the Supabase invitation email.
 *
 * The default (implicit) email flow puts the session in the URL *fragment*
 * (`#access_token=…&refresh_token=…&type=invite`), which never reaches the
 * server — so a tiny inline script forwards the token to this page's POST
 * handler, which validates it and sets the chosen password with the service
 * role. No password is ever emailed, and the reviewer owns their credential.
 */
function acceptPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Set your password · Chapman Reporting Portal</title>
<link rel="icon" href="/static/favicon.svg" />
<link rel="stylesheet" href="/static/app.css" />
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <img class="crest" src="/static/crest.png" alt="Alpha Phi Alpha crest" />
    <h1>Set your password</h1>
    <p class="sub">Welcome to the Chapman Reporting Portal. Choose a password to activate your reviewer account.</p>

    <p id="msg" class="error" style="display:none;"></p>

    <form id="setpw" method="post" action="/auth/accept" class="stack" style="display:none;">
      <input type="hidden" name="access_token" id="f_access" />
      <label class="field">
        <span>New password</span>
        <input type="password" name="password" id="pw" minlength="8" required autocomplete="new-password" />
      </label>
      <label class="field">
        <span>Confirm password</span>
        <input type="password" name="confirm" id="pw2" minlength="8" required autocomplete="new-password" />
      </label>
      <button class="btn gold block" type="submit">Activate my account</button>
      <p class="tiny muted">At least 8 characters. You'll be taken to the sign-in page afterwards.</p>
    </form>

    <div id="no-token" style="display:none;">
      <p class="small muted">
        This page needs the link from your invitation email. Open that link to set your password.
      </p>
      <p class="small muted">
        Already set a password? <a href="/login">Sign in →</a>
      </p>
    </div>
  </div>
</div>
<script>
(function () {
  var params = new URLSearchParams(location.hash.replace(/^#/, ''));
  var msg = document.getElementById('msg');
  var form = document.getElementById('setpw');
  var noToken = document.getElementById('no-token');

  var err = params.get('error_description') || params.get('error');
  if (err) { msg.textContent = err; msg.style.display = 'block'; noToken.style.display = 'block'; return; }

  var access = params.get('access_token');
  if (!access) { noToken.style.display = 'block'; return; }

  document.getElementById('f_access').value = access;
  form.style.display = 'block';

  form.addEventListener('submit', function (e) {
    var a = document.getElementById('pw').value;
    var b = document.getElementById('pw2').value;
    if (a !== b) { e.preventDefault(); msg.textContent = 'Passwords do not match.'; msg.style.display = 'block'; return; }
    if (a.length < 8) { e.preventDefault(); msg.textContent = 'Password must be at least 8 characters.'; msg.style.display = 'block'; }
  });
})();
</script>
</body>
</html>`;
}

function noticePage(title: string, message: string, status = 400): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Chapman Reporting Portal</title>
<link rel="icon" href="/static/favicon.svg" /><link rel="stylesheet" href="/static/app.css" />
</head><body>
<div class="login-wrap"><div class="login-card" style="text-align:center;">
<img class="crest" src="/static/crest.png" alt="Alpha Phi Alpha crest" />
<h1>${title}</h1>
<p class="sub">${message}</p>
<p class="small muted" style="margin-top:12px;"><a href="/login">Go to sign in →</a></p>
</div></div></body></html>`;
}

authRoutes.get("/auth/accept", (c) => c.html(acceptPage()));

authRoutes.post("/auth/accept", async (c) => {
  const form = await c.req.formData();
  const access = String(form.get("access_token") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (!access) {
    return c.html(
      noticePage("Invitation link needed", "Open the link from your invitation email to set a password."),
      400
    );
  }
  if (password.length < 8) {
    return c.html(noticePage("Password too short", "Choose a password of at least 8 characters."), 400);
  }
  if (password !== confirm) {
    return c.html(noticePage("Passwords do not match", "Please retype the same password in both fields."), 400);
  }

  const env = (c.env ?? {}) as any;
  const admin = getAdminClient(env);
  const anon = getAnonClient(env);
  if (!admin || !anon) {
    return c.html(
      noticePage("Not available", "Account activation is not configured in this environment."),
      503
    );
  }

  // Validate the invitation token and identify the invitee.
  const { data, error } = await anon.auth.getUser(access);
  if (error || !data?.user) {
    return c.html(
      noticePage("Link expired or invalid", "Your invitation link has expired. Ask an administrator to resend it."),
      410
    );
  }

  const { error: upErr } = await admin.auth.admin.updateUserById(data.user.id, { password });
  if (upErr) {
    return c.html(noticePage("Could not set password", upErr.message), 400);
  }

  return c.redirect("/login?ok=" + encodeURIComponent("Password set. You can sign in now."));
});
