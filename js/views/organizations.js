// The Organizations page, only for platform admins (public.platform_admins): every dealer using
// Field Ready, and setting up a new one with its first owner, who runs it from there. Everything
// goes through the `people` server function; the page shows names and counts only, never another
// organization's records.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import * as model from "../organizations-model.js";
import { inviteResult } from "../invite-model.js";
import { verifiedFactor } from "../two-step-model.js";

export function mountOrganizations(root, { profile }) {
  const state = {
    organizations: [],
    adding: false,
    form: model.blankOrganization(),
    /** What happened to the last invitation or password link (and the link to send by hand), shown until dismissed. */
    handover: null,
    busy: false,
    loadError: null,
  };

  async function load() {
    root.innerHTML = `<p class="loading">Loading organizations…</p>`;
    try {
      // Platform actions need two-step sign-in (the server refuses them without it).
      if (!verifiedFactor(await api.listFactors())) {
        root.innerHTML = `
          <div class="card">
            <h2>Set up two-step sign-in first</h2>
            <p>Managing organizations needs two-step sign-in, so a stolen password can't reach every dealer.
              Turn it on on the <a href="#account">Account</a> page, then come back.</p>
          </div>`;
        return;
      }
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
    const reset = handover.kind === "reset";
    if (handover.emailed) {
      return `
        <div class="card handover" role="status">
          <h2>${reset ? "Password link sent to" : "Invitation sent to"} ${escape(handover.name)}</h2>
          <p>Field Ready emailed <strong>${escape(handover.email)}</strong> a link to choose ${reset ? "a new" : "their"} password${reset ? "" : `,
            then set up ${escape(handover.organizationName)} on the website`}. The link works once; if it expires, use
            <strong>New Password Link</strong>.</p>
          <button class="link" data-action="dismiss-handover">Done</button>
        </div>`;
    }
    const message = handover.link ? model.handoverMessage(handover, location.href) : "";
    return `
      <div class="card handover warning" role="status">
        <h2>Couldn't email ${escape(handover.name)}</h2>
        <p>${escape(handover.problem)}</p>
        ${handover.link ? `
          <label>Send them this message yourself
            <textarea class="handover-message" rows="14" readonly>${escape(message)}</textarea></label>
          <div class="actions">
            <button class="secondary" data-action="copy" data-copy="message">Copy Message</button>
            <button class="secondary" data-action="copy" data-copy="link">Copy Link</button>
            <button class="link" data-action="dismiss-handover">Done</button>
          </div>
          <p class="hint">The link works once and isn't shown again once you close this.</p>` : `
          <p>${reset ? "" : "The organization and login are ready. "}Try <strong>New Password Link</strong> in a moment.</p>
          <button class="link" data-action="dismiss-handover">Done</button>`}
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
        <p class="hint">Create makes the organization, its first store, and the owner's login, and emails the owner a link to
          choose their password. It also loads the default option lists, the Guidance forms, and the Precision Planting and
          starter Machine forms.
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
              ${owner.id === profile.id ? "" : `<button class="link" data-action="reset-owner" data-id="${escape(owner.id)}" data-org="${escape(organization.id)}"${attr("disabled", state.busy)}>New Password Link</button>
                <button class="link" data-action="reset-two-step" data-id="${escape(owner.id)}" data-name="${escape(owner.name || owner.email)}"${attr("disabled", state.busy)}>Reset Two-Step</button>`}
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
      ownerEmail: form.ownerEmail.trim().toLowerCase(),
    };
    return run(async () => {
      const answer = await api.callPeople("createOrganization", details);
      state.adding = false;
      state.form = model.blankOrganization();
      state.handover = {
        ...inviteResult(answer, { kind: "new", name: details.ownerName, email: details.ownerEmail }),
        organizationName: details.name, ownerName: details.ownerName,
      };
      state.organizations = (await api.callPeople("listOrganizations", {})).organizations ?? [];
      return `Created ${details.name} with its default options and forms.${state.handover.emailed ? ` Emailed ${details.ownerName}.` : ""}`;
    });
  }

  function resetOwner(ownerId, organizationId) {
    const organization = state.organizations.find((o) => o.id === organizationId);
    const owner = organization?.owners.find((o) => o.id === ownerId);
    if (!owner) return;
    const name = owner.name || owner.email;
    if (!confirm(`Email ${name} (${organization.name}) a link to choose a new password? Their current password keeps working until they do.`)) return;
    return run(async () => {
      const answer = await api.callPeople("resetOwnerPassword", { userId: owner.id });
      state.handover = {
        ...inviteResult(answer, { kind: "reset", name, email: owner.email }),
        organizationName: organization.name, ownerName: name,
      };
      state.organizations = (await api.callPeople("listOrganizations", {})).organizations ?? [];
      return state.handover.emailed ? `Emailed ${name} a password link.` : `Couldn't email ${name}.`;
    });
  }

  /** An owner lost their authenticator: remove it so they can sign in with their password and set it up again. */
  function resetTwoStep(userId, name) {
    if (!confirm(`Reset ${name}'s two-step sign-in? Use this only when they've lost their authenticator and you're sure it's them asking. They can then sign in with just their password and set it up again.`)) return;
    return run(async () => {
      const answer = await api.callPeople("resetTwoStep", { userId });
      return answer?.removed ? `Turned off two-step sign-in for ${name}. They can set it up again on the Account page.` : `${name} didn't have two-step sign-in.`;
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
      case "reset-two-step": return resetTwoStep(element.dataset.id, element.dataset.name);
      case "dismiss-handover":
        state.handover = null;
        return render();
      case "copy": {
        const text = element.dataset.copy === "message"
          ? model.handoverMessage(state.handover, location.href)
          : state.handover.link;
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

  /** Whether it's fine to leave: nothing half-entered and no link still to send, or the person agrees. */
  return (silent = false) => {
    const unfinished = (state.adding && Object.values(state.form).some((value) => value.trim())) || state.handover?.link;
    return !unfinished || (!silent && confirm("You have an unfinished organization or a sign-in link you haven't sent. Leave this page?"));
  };
}
