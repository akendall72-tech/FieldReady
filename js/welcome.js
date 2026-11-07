// The welcome page invitation and password emails open (welcome.html#token_hash=…&type=recovery).
// On an iPhone or iPad with the Field Ready app, iOS opens the link in the app instead (a Universal
// Link: .well-known/apple-app-site-association names the app), which signs the person in and asks for
// their password. Here, anywhere, they choose the password on the page. The token is used once:
// whichever uses it first, the other then says the link was already used. The page never hands the
// token to the app itself (a fieldready:// link), because another app could claim that address.
//
// This page keeps no sign-in behind (a shared computer stays signed out), and never shows anyone
// else's information.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_DOWNLOAD_URL } from "./config.js";
import { escape } from "./ui.js";
import { linkToken, linkProblem } from "./invite-model.js";
import { newPasswordProblem } from "./people-model.js";

const root = document.getElementById("app");
const link = linkToken(location.hash);
const supabase = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
/** iPhones and iPads (iPads may say they're a Mac, but Macs have no touch screen). */
const onPhone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

function page(title, lead, body) {
  root.innerHTML = `
    <main class="signin">
      <div class="signin-card">
        <div class="hero">
          <p class="eyebrow">Field Ready</p>
          <h1>${escape(title)}</h1>
          ${lead ? `<p>${escape(lead)}</p>` : ""}
        </div>
        ${body}
      </div>
    </main>`;
}

function getTheApp(then = "come back to the email and tap the button again") {
  return APP_DOWNLOAD_URL
    ? `<p class="hint">Don't have the app yet? <a href="${escape(APP_DOWNLOAD_URL)}">Get the Field Ready app</a>, then ${then}.</p>`
    : `<p class="hint">Don't have the app yet? Ask whoever invited you how to get it, then ${then}.</p>`;
}

function renderStart(message = "") {
  if (!link) {
    page("Choose your password", "", `
      <div class="card">
        <p>This page needs the link from your Field Ready email. Open the email and tap <strong>Choose Your Password</strong> again.</p>
        <p class="hint">Already chose a password? Sign in to the Field Ready app with it.</p>
      </div>`);
    return;
  }
  page("Choose your password", "Your Field Ready login is ready. Choose your password to start using it.", `
    ${onPhone ? `
      <div class="card welcome-app">
        <p><strong>Have the Field Ready app?</strong> The email's button opens it on this phone. If it opened this page
          instead, go back to the email, press and hold the button, and choose <strong>Open in “Field Ready”</strong>.</p>
        ${getTheApp()}
      </div>
      <p class="welcome-or">or choose it here</p>` : ""}
    <form class="card" data-choose>
      <label>New password <input name="password" type="password" autocomplete="new-password" required></label>
      <label>New password again <input name="confirmation" type="password" autocomplete="new-password" required></label>
      ${message ? `<p class="form-error" role="alert">${escape(message)}</p>` : ""}
      <button class="primary" type="submit">Save Password</button>
      <p class="hint">At least 10 characters. You'll sign in to the Field Ready app with it.</p>
    </form>`);
  root.querySelector("[data-choose]").addEventListener("submit", choose);
}

async function choose(event) {
  event.preventDefault();
  const form = event.target;
  const problem = newPasswordProblem(form.password.value, form.confirmation.value);
  if (problem) return renderStart(problem);
  const button = form.querySelector("button.primary");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: link.token, type: link.type });
    if (error) throw error;
    const user = data?.user;
    const { error: passwordError } = await supabase.auth.updateUser({ password: form.password.value });
    if (passwordError) throw Object.assign(passwordError, { afterSignIn: true });
    const { data: profile } = await supabase.from("profiles").update({ must_change_password: false })
      .eq("id", user.id).select("role").maybeSingle();
    await supabase.auth.signOut();
    history.replaceState(null, "", location.pathname);
    renderDone(user?.email ?? "", profile?.role);
  } catch (error) {
    await supabase.auth.signOut().catch(() => {});
    if (error?.afterSignIn) return renderStart(error.message);
    renderFailed(linkProblem(error));
  }
}

function renderDone(email, role) {
  const staff = role && role !== "customer";
  page("You're all set", "", `
    <div class="card">
      <p>Your password is saved. Sign in to the Field Ready app${email ? ` with <strong>${escape(email)}</strong>` : ""} and your new password.</p>
      ${staff ? `<p>You can also use the <a href="./">staff website</a> with the same email and password.</p>` : ""}
      ${getTheApp("sign in")}
      <p class="hint">Need help? Read the <a href="guide.html">Field Ready Field Guide</a>.</p>
    </div>`);
}

function renderFailed(message) {
  page("This link didn't work", "", `
    <div class="card">
      <p>${escape(message)}</p>
      <p class="hint">Already chose a password? Sign in to the Field Ready app with it.</p>
    </div>`);
}

if (!globalThis.fieldReadyFramed) renderStart();
