// The Organizations page, only for platform admins (public.platform_admins): every dealer using
// Field Ready, and setting up a new one with its first owner, who runs it from there. Everything
// goes through the `people` server function; the page shows names and counts only, never another
// organization's records.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import * as model from "../organizations-model.js";
import { temporaryPassword } from "../people-model.js";

export function mountOrganizations(root, { profile }) {
  const state = {
    organizations: [],
    adding: false,
    form: model.blankOrganization(),
    /** A temporary password and the message to send, shown until dismissed. */
    handover: null,
    busy: false,
    loadError: null,
  };

  async function load() {
    root.innerHTML = `<p class="loading">Loading organizations…</p>`;
    try {
      state.organizations = (await api.callPeople("listOrganizations", {})).organizations ?? [];
      state.loadError = null;
    } catch (error) {
      state.loadError = api.describe(error);
    }
    render();
  }

  function render() {
    if (state.loadError) {
      root.innerHTML = `
        <div data-notice></div>
        <div class="card"><h2>Couldn't load organizations</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    root.innerHTML = `
      <div data-notice></div>
      <div class="toolbar">
        <div>
          <h1>Organizations</h1>
          <p class="meta">Every dealer using Field Ready. You set up each one and its first owner; the owner runs it from there.</p>
        </div>
        <div class="actions">
          <button class="primary" data-action="add"${attr("disabled", state.adding || state.busy)}>New Organization</button>
        </div>
      </div>
      <p class="callout">Only platform admins see this page. It shows names and counts; you can't open or change another
        organization's stores, people, customers, or checklists.</p>
      ${handoverCard()}
      ${state.adding ? addForm() : ""}
      ${listCard()}`;
  }

  function handoverCard() {
    const handover = state.handover;
    if (!handover) return "";
    const message = model.handoverMessage(handover, location.href);
    return `
      <div class="card handover" role="status">
        <h2>${handover.kind === "reset" ? "New temporary password for" : "Send"} ${escape(handover.ownerName)}${handover.kind === "reset" ? "" : " their sign-in"}</h2>
        <p class="password"><code>${escape(handover.password)}</code>
          <button class="secondary" data-action="copy" data-copy="password">Copy</button></p>
        <label>Message to send them
          <textarea class="handover-message" rows="17" readonly>${escape(message)}</textarea></label>
        <div class="actions">
          <button class="secondary" data-action="copy" data-copy="message">Copy Message</button>
          <button class="link" data-action="dismiss-handover">Done</button>
        </div>
        <p class="hint">Neither is shown again once you close this. They choose their own password at their first sign-in.</p>
      </div>`;
  }

  function addForm() {
    const form = state.form;
    const problems = model.newOrganizationProblems(form, state.organizations);
    const started = Object.values(form).some((value) => value.trim());
    return `
      <form class="card" data-add-form>
        <h2>New organization</h2>
        <div class="grid2">
          <label>Dealer name <input data-new="name" value="${escape(form.name)}" autocomplete="off"></label>
          <label>First store <input data-new="storeName" value="${escape(form.storeName)}" autocomplete="off"></label>
          <label>Owner's name <input data-new="ownerName" value="${escape(form.ownerName)}" autocomplete="off"></label>
          <label>Owner's email <input data-new="ownerEmail" type="email" value="${escape(form.ownerEmail)}" autocomplete="off"></label>
        </div>
        <p class="hint">Create makes the organization, its first store, and the owner's login with a temporary password for you
          to send them. It also loads the default option lists and the Guidance, Planter, and starter Machine checklists.
          The email can't already have a Field Ready login: each login belongs to one organization.</p>
        <p class="form-error" data-new-problems>${started ? escape(problems[0] ?? "") : ""}</p>
        <div class="actions">
          <button class="primary" type="submit" data-submit${attr("disabled", problems.length > 0 || state.busy)}>Create Organization</button>
          <button class="secondary" type="button" data-action="cancel-add">Cancel</button>
        </div>
      </form>`;
  }

  function listCard() {
    return `
      <div class="card">
        <h2>Organizations</h2>
        ${state.organizations.length ? `<ol class="org-list">${state.organizations.map(organizationRow).join("")}</ol>` : '<p class="hint">None yet.</p>'}
      </div>`;
  }

  function organizationRow(organization) {
    const yours = organization.id === profile.organization_id ? " <small>(yours)</small>" : "";
    const stores = organization.stores.map((store) => `${escape(store.name)}${store.active ? "" : " (turned off)"}`).join(", ");
    return `
      <li class="org">
        <div class="org-head">
          <span><strong>${escape(organization.name)}</strong>${yours}</span>
          <span class="hint">${escape(model.summary(organization))}${organization.createdAt ? ` · since ${escape(new Date(organization.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" }))}` : ""}</span>
        </div>
        <p class="hint">Stores: ${stores || "none"}</p>
        <ol class="org-owners">
          ${organization.owners.map((owner) => `
            <li>
              <span class="role role-owner">Owner</span>
              <span><strong>${escape(owner.name || owner.email)}</strong> <span class="hint">${escape(owner.email)}</span></span>
              <span class="${owner.active ? "hint" : "access-off"}">${escape(model.ownerStatus(owner))}</span>
              ${owner.id === profile.id ? "" : `<button class="link" data-action="reset-owner" data-id="${escape(owner.id)}" data-org="${escape(organization.id)}"${attr("disabled", state.busy)}>New Temporary Password</button>`}
            </li>`).join("") || '<li class="hint">No owner yet.</li>'}
        </ol>
      </li>`;
  }

  /** Runs one server action with the buttons held, then redraws and shows what happened. */
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

  function createOrganization() {
    const form = state.form;
    if (model.newOrganizationProblems(form, state.organizations).length) return;
    const details = {
      name: form.name.trim(), storeName: form.storeName.trim(), ownerName: form.ownerName.trim(),
      ownerEmail: form.ownerEmail.trim().toLowerCase(), password: temporaryPassword(),
    };
    return run(async () => {
      await api.callPeople("createOrganization", details);
      state.adding = false;
      state.form = model.blankOrganization();
      state.handover = { kind: "new", organizationName: details.name, ownerName: details.ownerName, email: details.ownerEmail, password: details.password };
      state.organizations = (await api.callPeople("listOrganizations", {})).organizations ?? [];
      return `Created ${details.name} with its default options and checklists.`;
    });
  }

  function resetOwner(ownerId, organizationId) {
    const organization = state.organizations.find((o) => o.id === organizationId);
    const owner = organization?.owners.find((o) => o.id === ownerId);
    if (!owner) return;
    const name = owner.name || owner.email;
    if (!confirm(`Make a new temporary password for ${name} (${organization.name})? Their current password stops working.`)) return;
    const password = temporaryPassword();
    return run(async () => {
      await api.callPeople("resetOwnerPassword", { userId: owner.id, password });
      state.handover = { kind: "reset", organizationName: organization.name, ownerName: name, email: owner.email, password };
      state.organizations = (await api.callPeople("listOrganizations", {})).organizations ?? [];
      return `Reset ${name}'s password.`;
    });
  }

  /** Keeps the form's button and first problem current without redrawing (typing isn't interrupted). */
  function onInput(event) {
    const field = event.target.dataset.new;
    if (!field) return;
    state.form[field] = event.target.value;
    const problems = model.newOrganizationProblems(state.form, state.organizations);
    root.querySelector("[data-new-problems]").textContent = problems[0] ?? "";
    root.querySelector("[data-submit]").disabled = problems.length > 0 || state.busy;
  }

  function onSubmit(event) {
    event.preventDefault();
    if (event.target.closest("[data-add-form]")) return createOrganization();
  }

  async function onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    switch (element.dataset.action) {
      case "reload": return load();
      case "add":
        state.adding = true;
        state.form = model.blankOrganization();
        render();
        root.querySelector('[data-new="name"]')?.focus();
        return;
      case "cancel-add":
        state.adding = false;
        return render();
      case "reset-owner": return resetOwner(element.dataset.id, element.dataset.org);
      case "dismiss-handover":
        state.handover = null;
        return render();
      case "copy": {
        const text = element.dataset.copy === "message"
          ? model.handoverMessage(state.handover, location.href)
          : state.handover.password;
        try {
          await navigator.clipboard.writeText(text);
          element.textContent = "Copied";
        } catch {
          element.textContent = "Select and copy it";
        }
      }
    }
  }

  root.addEventListener("input", onInput);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  load();

  /** Whether it's fine to leave: nothing half-entered and no password still to send, or the person agrees. */
  return (silent = false) => {
    const unfinished = (state.adding && Object.values(state.form).some((value) => value.trim())) || state.handover;
    return !unfinished || (!silent && confirm("You have an unfinished organization or a temporary password you haven't sent. Leave this page?"));
  };
}
