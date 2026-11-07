// The website shell: sign-in, who may use the site, the header, and pages. Owners and admins see
// every page; employees see Customers & machines for their store and their own Custom checklists.
// Platform admins (public.platform_admins) also see Organizations, where new dealers are set up.
// Customer logins use the app. Someone on a temporary password chooses their own first.

import { supabase, signIn, signOut, loadProfile, isPlatformAdmin, chooseOwnPassword, describe } from "./api.js";
import { escape } from "./ui.js";
import { newPasswordProblem } from "./people-model.js";
import { mountChecklist } from "./views/checklist.js";
import { mountOptions } from "./views/options.js";
import { mountPeople } from "./views/people.js";
import { mountCustomers } from "./views/customers.js";
import { mountOrganizations } from "./views/organizations.js";
import { mountSubscriptions } from "./views/subscriptions.js";

const root = document.getElementById("app");

const STAFF = ["owner", "admin", "employee"];
const MANAGERS = ["owner", "admin"];

const PAGES = [
  { id: "checklist", label: "Inspection forms", mount: mountChecklist, roles: STAFF },
  { id: "subscriptions", label: "Subscriptions", mount: mountSubscriptions, roles: MANAGERS },
  { id: "options", label: "Machine options", mount: mountOptions, roles: MANAGERS },
  { id: "people", label: "People & stores", mount: mountPeople, roles: MANAGERS },
  { id: "customers", label: "Customers & machines", mount: mountCustomers, roles: STAFF },
  { id: "organizations", label: "Organizations", mount: mountOrganizations, roles: STAFF, platformOnly: true },
];

const ROLE_LABELS = { owner: "Owner", admin: "Admin", employee: "Employee" };

/** The pages this person may open. */
const pagesFor = (profile) => PAGES.filter((page) => page.roles.includes(profile?.role) && (!page.platformOnly || profile.isPlatformAdmin));

/** The page named in the address (#options) if this person may open it, or their first page (employees: customers). */
function pageFromAddress(profile = current.profile) {
  const allowed = profile ? pagesFor(profile) : PAGES;
  const first = profile?.role === "employee" ? allowed.find((page) => page.id === "customers") : allowed[0];
  return allowed.find((page) => `#${page.id}` === location.hash)?.id ?? first?.id ?? "checklist";
}

let current = { session: null, profile: null, page: null, leaveCheck: null };

function renderSignIn(message = "") {
  root.innerHTML = `
    <main class="signin">
      <div class="signin-card">
        <div class="hero">
          <p class="eyebrow">Field Ready</p>
          <h1>Admin</h1>
          <p>Dealer staff manage customers, machines, checklists, and options here. Sign in with your Field Ready email and password.</p>
        </div>
        <form class="card" data-signin>
          <label>Email <input name="email" type="email" autocomplete="username" required></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
          ${message ? `<p class="form-error" role="alert">${escape(message)}</p>` : ""}
          <button class="primary" type="submit">Sign In</button>
          <p class="hint">Forgot your password or need an account? Ask your Field Ready owner.</p>
          <p class="hint">New here? Read the <a class="guide-link" href="admin-guide.html" target="_blank" rel="noopener">Admin Website Guide</a>.</p>
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

/** A first sign-in with a temporary password: nothing else opens until they choose their own. */
function renderChoosePassword(profile, message = "") {
  root.innerHTML = `
    <main class="signin">
      <div class="signin-card">
        <div class="hero">
          <p class="eyebrow">Field Ready</p>
          <h1>Choose a password</h1>
          <p>You signed in with a temporary password. Choose your own to keep using Field Ready. It works in the app too.</p>
        </div>
        <form class="card" data-choose>
          <input name="username" type="email" autocomplete="username" value="${escape(profile.email)}" hidden>
          <label>New password <input name="password" type="password" autocomplete="new-password" required></label>
          <label>New password again <input name="confirmation" type="password" autocomplete="new-password" required></label>
          ${message ? `<p class="form-error" role="alert">${escape(message)}</p>` : ""}
          <button class="primary" type="submit">Save Password</button>
          <p class="hint">Signed in as ${escape(profile.email)}. <button class="link" type="button" data-signout>Sign Out</button></p>
        </form>
      </div>
    </main>`;
  root.querySelector("[data-signout]").addEventListener("click", signOut);
  const form = root.querySelector("[data-choose]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const problem = newPasswordProblem(form.password.value, form.confirmation.value);
    if (problem) return renderChoosePassword(profile, problem);
    const button = form.querySelector("button.primary");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await chooseOwnPassword(profile.id, form.password.value);
      profile.must_change_password = false;
      current.profile = profile;
      current.page = pageFromAddress(profile);
      renderShell();
    } catch (error) {
      renderChoosePassword(profile, describe(error));
    }
  });
}

function renderShell() {
  const { profile } = current;
  const roleLabel = ROLE_LABELS[profile.role] ?? profile.role;
  const pages = pagesFor(profile);
  root.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="mark" aria-hidden="true"></span><span>Field Ready <strong>Admin</strong></span></div>
      <div class="who">
        <span>${escape(profile.full_name || profile.email)} · ${roleLabel}${profile.organizations?.name ? ` · ${escape(profile.organizations.name)}` : ""}</span>
        <a class="guide-link" href="admin-guide.html" target="_blank" rel="noopener">Guide</a>
        <button class="link" data-signout>Sign Out</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Sections">
      ${pages.map((page) => `<a href="#${page.id}" class="tab${current.page === page.id ? " active" : ""}"${current.page === page.id ? ' aria-current="page"' : ""}>${page.label}</a>`).join("")}
    </nav>
    <main class="page" data-page></main>`;
  root.querySelector("[data-signout]").addEventListener("click", async () => {
    if (current.leaveCheck && !current.leaveCheck()) return;
    await signOut();
  });
  const page = root.querySelector("[data-page]");
  current.leaveCheck = pages.find((p) => p.id === current.page).mount(page, { profile });
}

window.addEventListener("hashchange", () => {
  const next = pageFromAddress();
  if (!current.profile || next === current.page) return;
  if (current.leaveCheck && !current.leaveCheck()) {
    // Stay, and put the address back to the page that's still showing.
    history.replaceState(null, "", `#${current.page}`);
    return;
  }
  current.page = next;
  renderShell();
});

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
    if (!STAFF.includes(profile.role)) {
      renderNoAccess(session.user.email, "The website is for your dealer's staff. Use the Field Ready app to see your equipment and inspections.");
      return;
    }
    profile.isPlatformAdmin = await isPlatformAdmin(profile.id);
    if (profile.must_change_password) {
      renderChoosePassword(profile);
      return;
    }
    current.profile = profile;
    current.page = pageFromAddress(profile);
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
  // Choosing a password (USER_UPDATED) doesn't change who's signed in; that screen carries on itself.
  if (event === "USER_UPDATED") return;
  // Load outside the callback: database calls made inside it can wait on the sign-in lock forever.
  setTimeout(() => show(session), 0);
});

window.addEventListener("beforeunload", (event) => {
  if (current.leaveCheck && !current.leaveCheck(true)) event.preventDefault();
});
