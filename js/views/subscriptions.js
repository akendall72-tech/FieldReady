// The Subscriptions page: the correction services technicians pick from when they record a
// machine's subscription, grouped by provider. Owners add providers and services, rename them, add
// notes, and choose whether each is offered in the app; admins look only (the database enforces
// this too). A change saves as soon as you leave the field or tick the box.
//
// Services are options (catalog_options, list correction_service) under their correction type.
// Their values never change once saved, because subscriptions store them; a service that's no
// longer offered stays readable on the subscriptions that use it.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import * as model from "../subscriptions-model.js";
import { baseline, changes, problems, optionsIn } from "../options-model.js";

export function mountSubscriptions(root, { profile }) {
  const isOwner = profile.role === "owner";
  const state = {
    rows: [],
    saved: new Map(),
    /** Providers added on this page that have no services yet. */
    extraProviders: [],
    /** The service being added: { provider (group name), label, type, note }. */
    adding: null,
    busy: false,
    loadError: null,
  };
  /** Saves run one after another, so each starts from the last one's save times. */
  const saving = { queue: Promise.resolve(), pending: 0, error: null };

  const types = () => optionsIn(state.rows, "correction_type");
  const typeLabel = (value) => types().find((type) => type.value === value)?.label ?? value;
  const groups = () => model.providerGroups(state.rows, state.extraProviders);
  const rowFor = (id) => state.rows.find((row) => row.id === id);

  async function fetchAll() {
    state.rows = await api.loadOptionRows();
    state.saved = baseline(state.rows);
    state.loadError = null;
  }

  async function load() {
    state.busy = true;
    try {
      await fetchAll();
    } catch (error) {
      state.loadError = api.describe(error);
    }
    state.busy = false;
    render();
  }

  // ---------------------------------------------------------------- rendering

  function render() {
    if (state.loadError) {
      root.innerHTML = `
        <div data-notice></div>
        <div class="card"><h2>Couldn't load the subscriptions</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    root.innerHTML = `
      <div data-notice></div>
      <div class="toolbar">
        <div>
          <h1>Subscriptions</h1>
          <p class="meta">The correction services technicians pick from when they record a machine's subscription, by provider.
            Anything not listed can still be typed in.</p>
          <p class="meta" data-save-status>${saveStatus()}</p>
        </div>
      </div>
      ${isOwner ? "" : '<p class="callout">Only owners change these.</p>'}
      ${groups().map(providerCard).join("")}
      ${isOwner ? `
        <form class="card add-provider" data-add-provider>
          <label>Add a provider <input name="provider" placeholder="e.g. Hemisphere" autocomplete="off"></label>
          <button class="secondary" type="submit"${attr("disabled", state.busy)}>Add Provider</button>
          <p class="form-error" data-provider-problem></p>
        </form>` : ""}`;
  }

  function saveStatus() {
    if (saving.error) return `<span class="save-error">Couldn't save: ${escape(saving.error)}</span> <button class="link" data-action="reload">Reload</button>`;
    if (saving.pending) return "Saving…";
    return isOwner ? "Changes save as you make them. Phones pick them up at their next sync." : "";
  }

  function refreshStatus() {
    const status = root.querySelector("[data-save-status]");
    if (status) status.innerHTML = saveStatus();
  }

  function providerCard(group) {
    const canAdd = isOwner && group.name !== model.NO_PROVIDER;
    const adding = state.adding?.provider === group.name;
    return `
      <div class="card">
        <h2>${escape(group.name)}</h2>
        ${group.services.length ? `<ol class="service-list">${group.services.map(serviceRow).join("")}</ol>` : '<p class="hint">No services yet.</p>'}
        ${adding ? addServiceForm(group) : canAdd ? `<button class="add" data-action="add-service" data-provider="${escape(group.name)}"${attr("disabled", state.busy)}>+ Add service</button>` : ""}
      </div>`;
  }

  function serviceRow(row) {
    const id = escape(row.id);
    return `
      <li class="service${row.active ? "" : " off"}">
        <label>Name <input data-service="label" data-id="${id}" value="${escape(row.label)}"${attr("disabled", !isOwner)}></label>
        <label>Note <input data-service="note" data-id="${id}" value="${escape(row.details?.note ?? "")}" placeholder="Optional"${attr("disabled", !isOwner)}></label>
        <span class="service-type">${escape(typeLabel(row.parent_value))}</span>
        <label class="check"><input type="checkbox" data-service="active" data-id="${id}"${attr("checked", row.active)}${attr("disabled", !isOwner)}> Offered in the app</label>
      </li>`;
  }

  function addServiceForm(group) {
    const adding = state.adding;
    return `
      <form class="service-add" data-add-service>
        <div class="grid2">
          <label>Service name <input data-new="label" value="${escape(adding.label)}" autocomplete="off"></label>
          <label>Correction type
            <select data-new="type">
              <option value="">Choose…</option>
              ${types().filter((type) => type.active).map((type) => `<option value="${escape(type.value)}"${attr("selected", adding.type === type.value)}>${escape(type.label)}</option>`).join("")}
            </select>
          </label>
          <label>Note <input data-new="note" value="${escape(adding.note)}" placeholder="Optional, e.g. needs a yearly subscription" autocomplete="off"></label>
        </div>
        <p class="hint">Technicians see it under ${escape(group.name)} when they record a subscription of that correction type.</p>
        <p class="form-error" data-service-problem></p>
        <div class="actions">
          <button class="primary" type="submit"${attr("disabled", state.busy)}>Add Service</button>
          <button class="secondary" type="button" data-action="cancel-service">Cancel</button>
        </div>
      </form>`;
  }

  // ---------------------------------------------------------------- changes

  /** Saves every changed service, after any save already running. */
  function saveChanges() {
    const found = problems(state.rows.filter((row) => row.list === "correction_service"));
    if (found.length) {
      notice(root, found[0], "error");
      return;
    }
    const { added, updated } = changes(state.rows, state.saved);
    if (added.length + updated.length === 0) return;
    saving.pending += 1;
    refreshStatus();
    saving.queue = saving.queue.then(async () => {
      try {
        await api.saveOptions(added, updated);
        // What was sent is saved now; later changes to the same rows save next time.
        for (const [id, saved] of baseline(updated)) state.saved.set(id, saved);
        saving.error = null;
      } catch (error) {
        saving.error = error instanceof api.SaveConflict ? `${error.message} Reload to see the latest.` : api.describe(error);
      }
      saving.pending -= 1;
      refreshStatus();
    });
  }

  function onChange(event) {
    const element = event.target;
    if (element.dataset.new && state.adding) {
      state.adding[element.dataset.new] = element.value;
      return;
    }
    const field = element.dataset.service;
    const row = field && rowFor(element.dataset.id);
    if (!row || !isOwner) return;
    if (field === "label") {
      if (!element.value.trim()) {
        element.value = row.label;
        notice(root, "A service needs a name. To stop offering it, untick Offered in the app.", "error");
        return;
      }
      row.label = element.value.trim();
    }
    if (field === "note") {
      const note = element.value.trim();
      row.details = { ...row.details };
      if (note) row.details.note = note;
      else delete row.details.note;
    }
    if (field === "active") {
      row.active = element.checked;
      element.closest(".service")?.classList.toggle("off", !row.active);
    }
    saveChanges();
  }

  function onInput(event) {
    if (event.target.dataset.new && state.adding) state.adding[event.target.dataset.new] = event.target.value;
  }

  function onSubmit(event) {
    event.preventDefault();
    if (event.target.closest("[data-add-provider]")) return addProvider(event.target);
    if (event.target.closest("[data-add-service]")) return addService();
  }

  function addProvider(form) {
    const name = form.provider.value.trim();
    const problem = model.newProviderProblem(name, groups());
    if (problem) {
      form.querySelector("[data-provider-problem]").textContent = problem;
      return;
    }
    state.extraProviders.push(name);
    state.adding = { provider: name, label: "", type: "", note: "" };
    render();
    root.querySelector('[data-new="label"]')?.focus();
  }

  function addService() {
    const adding = state.adding;
    const found = model.newServiceProblems(adding, state.rows);
    if (found.length) {
      root.querySelector("[data-service-problem]").textContent = found[0];
      return;
    }
    const group = groups().find((g) => g.name === adding.provider);
    const row = model.newService(state.rows, {
      label: adding.label, type: adding.type, note: adding.note,
      heading: { name: group.name, field: group.field }, organizationId: profile.organization_id,
    });
    return run(async () => {
      await saving.queue;
      await api.saveOptions([row], []);
      state.adding = null;
      state.extraProviders = state.extraProviders.filter((name) => name !== group.name);
      await fetchAll();
      return `Added ${row.label}. Phones offer it at their next sync.`;
    });
  }

  async function onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    switch (element.dataset.action) {
      case "reload":
        saving.error = null;
        return load();
      case "add-service":
        state.adding = { provider: element.dataset.provider, label: "", type: "", note: "" };
        render();
        root.querySelector('[data-new="label"]')?.focus();
        return;
      case "cancel-service":
        state.adding = null;
        return render();
    }
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

  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  root.innerHTML = `<p class="loading">Loading the subscriptions…</p>`;
  load();

  /** Whether it's fine to leave: nothing still saving or half-added, or the person agrees. */
  return (silent = false) => {
    const unfinished = saving.pending > 0 || (state.adding && state.adding.label.trim());
    return !unfinished || (!silent && confirm("A change is still saving, or a service isn't added yet. Leave anyway?"));
  };
}
