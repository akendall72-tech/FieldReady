// The website shell: sign-in, who may use the site (owners and admins), the header, and pages.

import { supabase, signIn, signOut, loadProfile, describe } from "./api.js";
import { escape } from "./ui.js";
import { mountChecklist } from "./views/checklist.js";

const root = document.getElementById("app");

const PAGES = [
  { id: "checklist", label: "Inspection checklist", ready: true },
  { id: "options", label: "Machine options", ready: false, note: "Coming next" },
  { id: "people", label: "People & stores", ready: false, note: "Coming later" },
];

let current = { session: null, profile: null, page: "checklist", leaveCheck: null };

function renderSignIn(message = "") {
  root.innerHTML = `
    <main class="signin">
      <div class="signin-card">
        <div class="hero">
          <p class="eyebrow">Field Ready</p>
          <h1>Admin</h1>
          <p>Owners and admins edit the inspection checklist and machine options here. Sign in with your Field Ready email and password.</p>
        </div>
        <form class="card" data-signin>
          <label>Email <input name="email" type="email" autocomplete="username" required></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
          ${message ? `<p class="form-error" role="alert">${escape(message)}</p>` : ""}
          <button class="primary" type="submit">Sign In</button>
          <p class="hint">Forgot your password or need an account? Ask your Field Ready owner.</p>
        </form>
      </div>
    </main>`;
  const form = root.querySelector("[data-signin]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      await signIn(form.email.value, form.password.value);
    } catch (error) {
      renderSignIn(describe(error));
    }
  });
}

function renderNoAccess(email, reason) {
  root.innerHTML = `
    <main class="signin">
      <div class="card">
        <h2>No website access</h2>
        <p>${escape(reason)}</p>
        <p class="hint">Signed in as ${escape(email)}.</p>
        <button class="secondary" data-signout>Sign Out</button>
      </div>
    </main>`;
  root.querySelector("[data-signout]").addEventListener("click", signOut);
}

function renderShell() {
  const { profile } = current;
  const roleLabel = profile.role === "owner" ? "Owner" : "Admin";
  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="mark" aria-hidden="true"></span><span>Field Ready <strong>Admin</strong></span></div>
      <div class="who">
        <span>${escape(profile.full_name || profile.email)} · ${roleLabel}${profile.organizations?.name ? ` · ${escape(profile.organizations.name)}` : ""}</span>
        <button class="link" data-signout>Sign Out</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Sections">
      ${PAGES.map((page) => page.ready
        ? `<a href="#${page.id}" class="tab${current.page === page.id ? " active" : ""}"${current.page === page.id ? ' aria-current="page"' : ""}>${page.label}</a>`
        : `<span class="tab disabled" title="${escape(page.note)}">${page.label} <small>${escape(page.note)}</small></span>`).join("")}
    </nav>
    <main class="page" data-page></main>`;
  root.querySelector("[data-signout]").addEventListener("click", async () => {
    if (current.leaveCheck && !current.leaveCheck()) return;
    await signOut();
  });
  const page = root.querySelector("[data-page]");
  current.leaveCheck = mountChecklist(page, { profile });
}

async function show(session) {
  current.session = session;
  if (!session) {
    current.profile = null;
    renderSignIn();
    return;
  }
  root.innerHTML = `<p class="loading">Loading…</p>`;
  try {
    const profile = await loadProfile(session.user.id);
    if (!profile || !profile.active) {
      renderNoAccess(session.user.email, "Nobody has given this login access to Field Ready. Ask your Field Ready owner.");
      return;
    }
    if (profile.role !== "owner" && profile.role !== "admin") {
      renderNoAccess(session.user.email, "The website is for owners and admins. Use the Field Ready app for inspections.");
      return;
    }
    current.profile = profile;
    renderShell();
  } catch (error) {
    root.innerHTML = `<main class="signin"><div class="card"><h2>Couldn't load your account</h2><p>${escape(describe(error))}</p><button class="secondary" data-retry>Try Again</button></div></main>`;
    root.querySelector("[data-retry]").addEventListener("click", () => show(session));
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  // Token refreshes (and repeat sign-in notices when the tab regains focus) keep the same person
  // signed in; only redraw when who's signed in changes, so unsaved edits aren't lost.
  if (event !== "SIGNED_OUT" && current.profile && session?.user.id === current.profile.id) return;
  // Load outside the callback: database calls made inside it can wait on the sign-in lock forever.
  setTimeout(() => show(session), 0);
});

window.addEventListener("beforeunload", (event) => {
  if (current.leaveCheck && !current.leaveCheck(true)) event.preventDefault();
});
