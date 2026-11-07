// The Account page: who's signed in, and two-step sign-in (an authenticator app's 6-digit codes).
// Turning it on: scan a QR code (or type the key) into an authenticator app, then enter a code to
// confirm. From then on the website and the app ask for a code after the password, and the database
// shows nothing without it. Platform admins must have it on to manage organizations.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import { cleanCode, verifiedFactor, unfinishedFactors, WRONG_CODE, NOT_A_CODE } from "../two-step-model.js";

export function mountAccount(root, { profile }) {
  const state = {
    factors: null,
    /** A set-up in progress: { id, qr, secret }. */
    enrolling: null,
    busy: false,
    loadError: null,
  };

  async function load() {
    try {
      state.factors = await api.listFactors();
      state.loadError = null;
    } catch (error) {
      state.loadError = api.describe(error);
    }
    render();
  }

  function render() {
    const factor = verifiedFactor(state.factors);
    root.innerHTML = `
      <div data-notice></div>
      <div class="toolbar">
        <div>
          <h1>Account</h1>
          <p class="meta">${escape(profile.full_name || profile.email)} · ${escape(profile.email)}</p>
        </div>
      </div>
      <div class="card">
        <h2>Two-step sign-in ${state.factors ? `<span class="role${factor ? " role-owner" : ""}">${factor ? "On" : "Off"}</span>` : ""}</h2>
        <p>After your password, Field Ready asks for a 6-digit code from an authenticator app on your phone (such as
          Apple Passwords, Google Authenticator, or Microsoft Authenticator). Someone who learns your password still can't
          get in. The app asks for the code too.</p>
        ${profile.isPlatformAdmin && !factor ? '<p class="callout">You need two-step sign-in to manage organizations.</p>' : ""}
        ${state.loadError ? `<p class="form-error">${escape(state.loadError)}</p>` : ""}
        ${!state.factors && !state.loadError ? '<p class="loading">Checking…</p>' : ""}
        ${state.factors && !factor && !state.enrolling ? `<button class="primary" data-action="enroll"${attr("disabled", state.busy)}>Set Up Two-Step Sign-In</button>` : ""}
        ${state.enrolling ? enrollForm() : ""}
        ${factor ? `
          <p class="hint">On since ${escape(new Date(factor.created_at).toLocaleDateString(undefined, { dateStyle: "medium" }))}.
            ${profile.role === "customer" ? "Lost your phone? Ask your dealer to reset it." : "Lost your phone? Another owner can reset it from People &amp; stores."}</p>
          <button class="danger" data-action="turn-off" data-id="${escape(factor.id)}"${attr("disabled", state.busy)}>Turn Off</button>` : ""}
      </div>`;
  }

  function enrollForm() {
    const { qr, secret } = state.enrolling;
    return `
      <form class="two-step-setup" data-confirm>
        <ol>
          <li>In your authenticator app, add an account and scan this code:
            <img class="two-step-qr" src="${escape(qr)}" alt="QR code for your authenticator app" width="180" height="180"></li>
          <li>Can't scan? Enter this key instead: <code class="two-step-secret">${escape(secret)}</code></li>
          <li>Enter the 6-digit code the app shows for Field Ready.</li>
        </ol>
        <label>6-digit code <input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
        <p class="form-error" data-confirm-problem></p>
        <div class="actions">
          <button class="primary" type="submit"${attr("disabled", state.busy)}>Turn On</button>
          <button class="secondary" type="button" data-action="cancel-enroll">Cancel</button>
        </div>
      </form>`;
  }

  /** Runs one action with the buttons held, then redraws and shows what happened. */
  async function run(work) {
    if (state.busy) return;
    state.busy = true;
    root.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    let message;
    let kind = "success";
    try {
      message = await work();
    } catch (error) {
      kind = "error";
      message = api.describe(error);
    }
    state.busy = false;
    render();
    if (message) notice(root, message, kind);
  }

  function enroll() {
    return run(async () => {
      // A set-up that was started and never confirmed would block a new one.
      for (const unfinished of unfinishedFactors(state.factors)) await api.removeAuthenticator(unfinished.id);
      const started = await api.enrollAuthenticator();
      state.enrolling = { id: started.id, qr: started.totp.qr_code, secret: started.totp.secret };
      return "";
    });
  }

  async function confirm(form) {
    const code = cleanCode(form.code.value);
    const problem = form.querySelector("[data-confirm-problem]");
    if (!code) {
      problem.textContent = NOT_A_CODE;
      return;
    }
    if (state.busy) return;
    state.busy = true;
    form.querySelector("button.primary").disabled = true;
    try {
      await api.verifyCode(state.enrolling.id, code);
    } catch {
      state.busy = false;
      form.querySelector("button.primary").disabled = false;
      problem.textContent = WRONG_CODE;
      return;
    }
    state.busy = false;
    state.enrolling = null;
    await load();
    notice(root, "Two-step sign-in is on. Next time you sign in, the website and the app ask for a code.", "success");
  }

  function turnOff(factorId) {
    if (!window.confirm("Turn off two-step sign-in? Your password alone will be enough to sign in again.")) return;
    return run(async () => {
      await api.removeAuthenticator(factorId);
      state.factors = await api.listFactors();
      return "Two-step sign-in is off.";
    });
  }

  async function cancelEnroll() {
    const started = state.enrolling;
    state.enrolling = null;
    render();
    if (started) await api.removeAuthenticator(started.id).catch(() => {});
    state.factors = await api.listFactors().catch(() => state.factors);
  }

  function onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    switch (element.dataset.action) {
      case "enroll": return enroll();
      case "cancel-enroll": return cancelEnroll();
      case "turn-off": return turnOff(element.dataset.id);
    }
  }

  function onSubmit(event) {
    const form = event.target.closest("[data-confirm]");
    if (!form) return;
    event.preventDefault();
    confirm(form);
  }

  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  render();
  load();

  /** Leaving mid-set-up drops the unfinished set-up (it's removed before the next one starts). */
  return () => true;
}
