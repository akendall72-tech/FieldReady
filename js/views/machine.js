// One machine on the website: its details and technology, components, features (a planter's
// Precision Planting products), and correction subscriptions; the same things the app edits.
// Opened from the Customers & machines page, which it returns to when closed.
//
// Everyone on staff edits machines at their own store (owners anywhere); owners and admins also
// archive and delete. The database enforces this; the page only hides what someone can't do.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import * as model from "../equipment-model.js";

const BLANK_COMPONENT = { kind: "display", model_name: "", serial_number: "", firmware_version: "", correction_level: null, verification: "unknown", notes: "" };
const BLANK_SUBSCRIPTION = {
  provider: "", service_name: "", correction_type: "unknown", account_reference: "", expiration_date: null,
  source: "notVerified", checked_on: null, notes: "",
};

/**
 * @param ctx {profile, machineId (null for a new machine), customerId, customers, stores, options, onClose}
 * Returns a function that says whether it's fine to leave (no unsaved changes, or the person agrees).
 */
export function mountMachine(root, ctx) {
  const { profile, options: rows, stores, customers } = ctx;
  const viewer = { id: profile.id, role: profile.role, location_id: profile.location_id };
  const state = {
    machine: null,
    draft: null,
    saved: "",
    /** Unsaved edits to components and subscriptions, by id ("new" for one being added). */
    components: {},
    subscriptions: {},
    busy: false,
    loadError: null,
  };

  const editable = () => model.canEdit(viewer, state.machine?.location_id ?? state.draft.location_id);
  const manageable = () => state.machine?.id && model.canManage(viewer, state.machine.location_id);
  const isPlanter = () => state.draft.equipment_type === "planter";
  const isDirty = () => JSON.stringify(state.draft) !== state.saved
    || Object.keys(state.components).length > 0 || Object.keys(state.subscriptions).length > 0;
  const storeName = (id) => stores.find((s) => s.id === id)?.name ?? "Unknown store";

  function draftFrom(machine) {
    return {
      customer_id: machine.customer_id, location_id: machine.location_id, equipment_type: machine.equipment_type ?? "tractor",
      manufacturer: machine.manufacturer ?? "", model_name: machine.model_name ?? "", model_year: machine.model_year ?? "",
      serial_number: machine.serial_number ?? "", yard_location: machine.yard_location ?? "",
      guidance_system: machine.guidance_system ?? "other", guidance_software: machine.guidance_software ?? "unknown",
      steering: machine.steering ?? "unknown", correction: machine.correction ?? "unknown",
    };
  }

  async function load(id) {
    state.busy = true;
    try {
      state.machine = await api.loadMachine(id);
      state.draft = draftFrom(state.machine);
      state.saved = JSON.stringify(state.draft);
      state.loadError = null;
    } catch (error) {
      state.loadError = api.describe(error);
    }
    state.busy = false;
    render();
  }

  function startNew() {
    const customer = customers.find((c) => c.id === ctx.customerId);
    state.machine = null;
    state.draft = draftFrom({ customer_id: ctx.customerId, location_id: customer?.location_id ?? viewer.location_id });
    state.saved = JSON.stringify(state.draft);
    render();
  }

  // ---------------------------------------------------------------- rendering

  function render() {
    if (state.loadError) {
      root.innerHTML = `
        <div data-notice></div>
        <button class="link" data-action="close">← Customers &amp; machines</button>
        <div class="card"><h2>Couldn't open the machine</h2><p>${escape(state.loadError)}</p></div>`;
      return;
    }
    const machine = state.machine;
    const customer = customers.find((c) => c.id === state.draft.customer_id);
    root.innerHTML = `
      <div data-notice></div>
      <button class="link back" data-action="close">← Customers &amp; machines</button>
      <div class="toolbar">
        <div>
          <h1>${escape(machine ? model.machineName(machine) : "New machine")}</h1>
          <p class="meta">${escape([customer?.name, storeName(state.draft.location_id), machine?.serial_number, machine?.archived_at ? "Archived" : ""].filter(Boolean).join(" · "))}</p>
          ${machine ? `<p class="meta">${machine.finalized} finalized ${machine.finalized === 1 ? "inspection" : "inspections"}. Inspections are done in the app.</p>` : ""}
        </div>
      </div>
      ${editable() ? "" : '<p class="callout">This machine is at another store, so you can look but not change it.</p>'}
      ${detailsCard()}
      ${machine ? featuresCard() + componentsCard() + subscriptionsCard() + manageCard() : ""}`;
  }

  const disabled = () => attr("disabled", !editable() || state.busy);

  function select(field, list, value, extra = {}) {
    return `<select data-field="${field}"${disabled()}>
      ${model.choices(rows, list, { current: value, ...extra }).filter((o) => !extra.hide?.includes(o.value) || o.value === value)
        .map((o) => `<option value="${escape(o.value)}"${attr("selected", o.value === value)}>${escape(o.label)}${o.active === false ? " (hidden)" : ""}</option>`).join("")}
    </select>`;
  }

  function detailsCard() {
    const d = state.draft;
    const factory = model.isFactoryIntegrated(rows, d.guidance_system);
    const storeOptions = model.storesFor(viewer, stores, d.location_id);
    const customerOptions = customers.filter((c) => !c.archived_at || c.id === d.customer_id);
    return `
      <div class="card">
        <h2>Details</h2>
        <div class="grid2">
          <label>Equipment type ${select("equipment_type", "equipment_type", d.equipment_type)}</label>
          <label>Customer
            <select data-field="customer_id"${disabled()}>
              ${customerOptions.map((c) => `<option value="${escape(c.id)}"${attr("selected", c.id === d.customer_id)}>${escape(c.name)}</option>`).join("")}
            </select>
          </label>
          <label>Manufacturer <input data-field="manufacturer" value="${escape(d.manufacturer)}"${disabled()}></label>
          <label>Model <input data-field="model_name" value="${escape(d.model_name)}"${disabled()}></label>
          <label>Model year <input data-field="model_year" inputmode="numeric" value="${escape(d.model_year ?? "")}"${disabled()}></label>
          <label>Serial number <input data-field="serial_number" value="${escape(d.serial_number)}"${disabled()}></label>
          <label>Kept at (yard, shed…) <input data-field="yard_location" value="${escape(d.yard_location)}"${disabled()}></label>
          <label>Store
            <select data-field="location_id"${disabled()}>
              ${storeOptions.map((s) => `<option value="${escape(s.id)}"${attr("selected", s.id === d.location_id)}>${escape(s.name)}${s.active ? "" : " (not in use)"}</option>`).join("")}
            </select>
          </label>
        </div>
        ${isPlanter() ? "" : `
          <h3>Technology</h3>
          <div class="grid2">
            <label>Guidance system ${select("guidance_system", "guidance_system", d.guidance_system)}</label>
            ${factory
              ? `<label>Guidance software <input value="Built into ${escape(model.labelFor(rows, "guidance_system", d.guidance_system))}" disabled></label>`
              : `<label>Guidance software ${select("guidance_software", "guidance_software", d.guidance_software)}</label>`}
            ${factory
              ? `<label>Steering <input value="${escape(model.labelFor(rows, "steering", "factoryIntegrated"))}" disabled></label>`
              : `<label>Steering ${select("steering", "steering", d.steering, { hide: ["factoryIntegrated"] })}</label>`}
            <label>Correction source ${select("correction", "correction_type", d.correction)}</label>
          </div>
          <p class="hint">Choose Unknown rather than guessing. Unknown answers keep the related checks in the inspection.</p>`}
        <p class="form-error" data-problems></p>
        ${editable() ? `
          <div class="actions">
            <button class="primary" data-action="save-details"${attr("disabled", state.busy)}>${state.machine ? "Save Details" : "Add Machine"}</button>
            ${state.machine ? "" : '<button class="secondary" data-action="close">Cancel</button>'}
          </div>` : ""}
      </div>`;
  }

  function featuresCard() {
    const type = state.machine.equipment_type ?? "tractor";
    const existing = state.machine.installed_features ?? [];
    const states = model.featureStates(existing);
    // The type's features, plus any this machine has answered that were since hidden.
    const shown = model.choices(rows, "feature", { equipmentType: type });
    for (const feature of existing) {
      const row = rows.find((r) => r.list === "feature" && r.value === feature.kind);
      if (feature.state !== "unknown" && !shown.some((s) => s.value === feature.kind) && (!row || (row.details?.equipment ?? ["tractor"]).includes(type))) {
        shown.push(row ?? { value: feature.kind, label: feature.kind, details: {} });
      }
    }
    return `
      <div class="card">
        <h2>${type === "planter" ? "Planter technology" : "Optional features"}</h2>
        <p class="hint">The inspection checks a ${type === "planter" ? "product" : "feature"} only when it's marked Installed. Changes save right away.</p>
        <div class="feature-list">
          ${shown.map((feature) => `
            <label class="feature-row">
              <span><strong>${escape(feature.label)}</strong>${feature.details?.examples ? `<span class="hint">${escape(feature.details.examples)}</span>` : ""}</span>
              <select data-feature="${escape(feature.value)}"${disabled()}>
                ${model.FEATURE_STATES.map((s) => `<option value="${s.value}"${attr("selected", (states[feature.value] ?? "unknown") === s.value)}>${s.label}</option>`).join("")}
              </select>
            </label>`).join("")}
        </div>
      </div>`;
  }

  function componentsCard() {
    const type = state.machine.equipment_type ?? "tractor";
    const list = [...(state.machine.technology_components ?? [])].sort((a, b) =>
      model.choices(rows, "component_kind").findIndex((o) => o.value === a.kind) - model.choices(rows, "component_kind").findIndex((o) => o.value === b.kind));
    const adding = state.components.new;
    return `
      <div class="card">
        <h2>Components</h2>
        ${list.length ? list.map((c) => componentRow(state.components[c.id] ?? c, c.id, type)).join("") : '<p class="hint">None recorded yet.</p>'}
        ${adding ? componentRow(adding, "new", type) : editable() ? '<button class="add" data-action="add-component">+ Add component</button>' : ""}
      </div>`;
  }

  function componentRow(c, id, type) {
    const key = escape(id);
    const level = model.hasCorrectionLevel(rows, c.kind);
    const pending = Boolean(state.components[id]);
    return `
      <div class="part-row${id === "new" ? " new" : ""}">
        <div class="part-grid">
          <label>Type
            <select data-component="${key}" data-part-field="kind"${disabled()}>
              ${model.choices(rows, "component_kind", { equipmentType: type, current: c.kind }).map((o) => `<option value="${escape(o.value)}"${attr("selected", o.value === c.kind)}>${escape(o.label)}</option>`).join("")}
            </select>
          </label>
          <label>Model <input data-component="${key}" data-part-field="model_name" value="${escape(c.model_name ?? "")}"${disabled()}></label>
          <label>Serial number <input data-component="${key}" data-part-field="serial_number" value="${escape(c.serial_number ?? "")}"${disabled()}></label>
          <label>Software or firmware <input data-component="${key}" data-part-field="firmware_version" value="${escape(c.firmware_version ?? "")}"${disabled()}></label>
          ${level ? `<label>Correction level
            <select data-component="${key}" data-part-field="correction_level"${disabled()}>
              ${model.choices(rows, "receiver_correction_level", { current: c.correction_level ?? "unknown" }).map((o) => `<option value="${escape(o.value)}"${attr("selected", o.value === (c.correction_level ?? "unknown"))}>${escape(o.label)}</option>`).join("")}
            </select></label>` : ""}
          <label>How sure?
            <select data-component="${key}" data-part-field="verification"${disabled()}>
              ${model.VERIFICATION.map((v) => `<option value="${v.value}"${attr("selected", v.value === (c.verification ?? "unknown"))}>${v.label}</option>`).join("")}
            </select>
          </label>
        </div>
        <label>Notes <input data-component="${key}" data-part-field="notes" value="${escape(c.notes ?? "")}"${disabled()}></label>
        ${partTools("component", id, pending)}
      </div>`;
  }

  /** Save and Cancel (shown once the row has unsaved changes) and Remove, for a component or subscription. */
  function partTools(kind, id, pending) {
    if (!editable()) return "";
    const key = escape(id);
    return `
      <div class="part-tools">
        <span class="tools" data-pending="${kind}-${key}"${attr("hidden", !pending)}>
          <button class="primary" data-action="save-${kind}" data-id="${key}"${attr("disabled", state.busy)}>Save</button>
          <button class="secondary" data-action="cancel-${kind}" data-id="${key}">Cancel</button>
        </span>
        ${id === "new" ? "" : `<button class="danger" data-action="remove-${kind}" data-id="${key}"${attr("disabled", state.busy)}>Remove</button>`}
      </div>`;
  }

  function subscriptionsCard() {
    const list = [...(state.machine.correction_subscriptions ?? [])].sort((a, b) => (a.expiration_date ?? "9999").localeCompare(b.expiration_date ?? "9999"));
    const adding = state.subscriptions.new;
    return `
      <div class="card">
        <h2>Correction subscriptions</h2>
        <p class="hint">Never enter passwords or login details. An expiration date alone doesn't prove a subscription is active.</p>
        ${list.length ? list.map((s) => subscriptionRow(state.subscriptions[s.id] ?? s, s.id)).join("") : '<p class="hint">None recorded yet.</p>'}
        ${adding ? subscriptionRow(adding, "new") : editable() ? '<button class="add" data-action="add-subscription">+ Add subscription</button>' : ""}
      </div>`;
  }

  /** A listed service's picker value: its provider and name (either may hold any character). */
  const serviceKey = (provider, name) => JSON.stringify([provider, name]);

  /** The listed service a subscription matches (its serviceKey), or "custom". */
  function serviceChoice(s) {
    const group = model.serviceGroups(rows, s.correction_type).find((g) => g.provider === (s.provider ?? "") && g.services.includes(s.service_name));
    return group ? serviceKey(group.provider, s.service_name) : "custom";
  }

  function subscriptionRow(s, id) {
    const key = escape(id);
    const groups = model.serviceGroups(rows, s.correction_type);
    const choice = s._choice ?? (id === "new" && groups.length ? "" : serviceChoice(s));
    const pending = Boolean(state.subscriptions[id]);
    return `
      <div class="part-row${id === "new" ? " new" : ""}">
        <div class="part-grid">
          <label>Correction type
            <select data-subscription="${key}" data-part-field="correction_type"${disabled()}>
              ${model.choices(rows, "correction_type", { current: s.correction_type }).map((o) => `<option value="${escape(o.value)}"${attr("selected", o.value === s.correction_type)}>${escape(o.label)}</option>`).join("")}
            </select>
          </label>
          <label>Service
            <select data-subscription="${key}" data-part-field="_choice"${disabled()}>
              ${choice === "" ? '<option value="" selected>Choose a service</option>' : ""}
              ${groups.map((g) => `<optgroup label="${escape(g.title)}">${g.services.map((name) => `<option value="${escape(serviceKey(g.provider, name))}"${attr("selected", choice === serviceKey(g.provider, name))}>${escape(name)}</option>`).join("")}</optgroup>`).join("")}
              <option value="custom"${attr("selected", choice === "custom")}>Custom service</option>
            </select>
          </label>
          ${choice === "custom" ? `
            <label>Provider <input data-subscription="${key}" data-part-field="provider" value="${escape(s.provider ?? "")}"${disabled()}></label>
            <label>Service name <input data-subscription="${key}" data-part-field="service_name" value="${escape(s.service_name ?? "")}"${disabled()}></label>` : ""}
          <label>Account or subscription reference <input data-subscription="${key}" data-part-field="account_reference" value="${escape(s.account_reference ?? "")}" autocomplete="off"${disabled()}></label>
          <label>Expires <input type="date" data-subscription="${key}" data-part-field="expiration_date" value="${escape(s.expiration_date ?? "")}"${disabled()}></label>
          <label>Source
            <select data-subscription="${key}" data-part-field="source"${disabled()}>
              ${model.SUBSCRIPTION_SOURCES.map((o) => `<option value="${o.value}"${attr("selected", o.value === (s.source ?? "notVerified"))}>${o.label}</option>`).join("")}
            </select>
          </label>
          <label>Checked on <input type="date" data-subscription="${key}" data-part-field="checked_on" value="${escape((s.checked_on ?? "").slice(0, 10))}"${disabled()}></label>
        </div>
        <label>Notes <input data-subscription="${key}" data-part-field="notes" value="${escape(s.notes ?? "")}"${disabled()}></label>
        ${partTools("subscription", id, pending)}
      </div>`;
  }

  function manageCard() {
    if (!manageable()) return "";
    const machine = state.machine;
    return `
      <div class="card">
        <h2>Archive or delete</h2>
        <p class="hint">Archived machines are hidden from lists in the app and here, with their history kept.
          ${model.canDeleteMachine(machine) ? "Deleting removes the machine and its technology and draft inspections everywhere." : "This machine has finalized inspections, so it can be archived but not deleted."}</p>
        <div class="actions">
          <button class="secondary" data-action="archive"${attr("disabled", state.busy)}>${machine.archived_at ? "Bring Back" : "Archive"}</button>
          ${model.canDeleteMachine(machine) ? `<button class="danger" data-action="delete"${attr("disabled", state.busy)}>Delete Machine</button>` : ""}
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- editing

  function showProblems() {
    const area = root.querySelector("[data-problems]");
    const problems = model.machineProblems(state.draft);
    if (area) area.textContent = problems[0] ?? "";
    return problems;
  }

  function onInput(event) {
    const element = event.target;
    if (element.dataset.field && state.draft) {
      const field = element.dataset.field;
      state.draft[field] = element.value;
      if (field === "guidance_system") {
        state.draft.steering = model.steeringFor(rows, element.value, state.draft.steering);
        return render();
      }
      if (field === "equipment_type") return render();
      if (field === "customer_id") {
        const customer = customers.find((c) => c.id === element.value);
        if (customer && !state.machine) state.draft.location_id = customer.location_id;
      }
      return;
    }
    for (const [kind, store] of [["component", state.components], ["subscription", state.subscriptions]]) {
      const id = element.dataset[kind];
      if (!id) continue;
      const field = element.dataset.partField;
      const next = { ...(store[id] ?? partFor(kind, id)), [field]: element.value || (element.type === "date" ? null : "") };
      if (kind === "subscription" && field === "_choice" && element.value !== "custom" && element.value) {
        const [provider, service] = JSON.parse(element.value);
        Object.assign(next, { provider, service_name: service });
      }
      if (kind === "subscription" && field === "correction_type") next._choice = undefined;
      store[id] = next;
      // Redraw when the fields shown depend on the change (always a picker, so focus comes back
      // cleanly); otherwise just show Save, so typing isn't interrupted.
      if (["kind", "_choice", "correction_type"].includes(field)) {
        render();
        root.querySelector(`[data-${kind}="${CSS.escape(id)}"][data-part-field="${field}"]`)?.focus();
      } else {
        root.querySelector(`[data-pending="${kind}-${CSS.escape(id)}"]`)?.removeAttribute("hidden");
      }
    }
  }

  const partFor = (kind, id) => (kind === "component" ? state.machine.technology_components : state.machine.correction_subscriptions).find((p) => p.id === id);

  /** Features save as soon as they're picked. Everything else is handled as it's typed (onInput). */
  function onChange(event) {
    const feature = event.target.dataset.feature;
    if (!feature) return;
    const changes = model.featureChanges(state.machine.installed_features ?? [], { [feature]: event.target.value });
    return run(async () => {
      await api.saveFeatures(state.machine.id, changes);
      await reload();
      return "Saved. Phones pick up the change at their next sync.";
    });
  }

  async function onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    const id = element.dataset.id;
    switch (element.dataset.action) {
      case "close": return close();
      case "save-details": return saveDetails();
      case "add-component":
        state.components.new = { ...BLANK_COMPONENT, kind: model.choices(rows, "component_kind", { equipmentType: state.machine.equipment_type ?? "tractor" })[0]?.value ?? "other" };
        return render();
      case "cancel-component":
        delete state.components[id];
        return render();
      case "save-component": return savePart("component", id);
      case "remove-component": return removePart("component", id);
      case "add-subscription":
        state.subscriptions.new = { ...BLANK_SUBSCRIPTION, correction_type: state.machine.correction ?? "unknown" };
        return render();
      case "cancel-subscription":
        delete state.subscriptions[id];
        return render();
      case "save-subscription": return savePart("subscription", id);
      case "remove-subscription": return removePart("subscription", id);
      case "archive": return archive();
      case "delete": return deleteMachine();
    }
  }

  // ---------------------------------------------------------------- saving

  async function run(work) {
    if (state.busy) return;
    state.busy = true;
    root.querySelectorAll("button, select, input").forEach((control) => { control.disabled = true; });
    let message;
    let kind = "success";
    try {
      message = await work();
    } catch (error) {
      kind = "error";
      message = error instanceof api.SaveConflict ? `${error.message} Close and reopen the machine to see the latest.` : api.describe(error);
    }
    state.busy = false;
    render();
    if (message) notice(root, message, kind);
  }

  async function reload() {
    state.machine = await api.loadMachine(state.machine.id);
    state.draft = draftFrom(state.machine);
    state.saved = JSON.stringify(state.draft);
  }

  function saveDetails() {
    if (showProblems().length) return;
    const isNew = !state.machine;
    return run(async () => {
      const saved = await api.saveMachine(state.machine ?? { organization_id: profile.organization_id }, model.cleanMachine(state.draft));
      state.machine = { id: saved.id };
      await reload();
      return isNew ? "Machine added. Add its components, features, and subscriptions below." : "Saved. Phones pick up the change at their next sync.";
    });
  }

  function savePart(kind, id) {
    const store = kind === "component" ? state.components : state.subscriptions;
    const { _choice, ...part } = store[id];
    if (kind === "subscription" && !`${part.provider}${part.service_name}`.trim()) {
      notice(root, "Choose a listed service, or enter a provider or service name.", "error");
      return;
    }
    return run(async () => {
      const save = kind === "component" ? api.saveComponent : api.saveSubscription;
      await save(state.machine.id, { ...part, id: id === "new" ? null : id });
      delete store[id];
      await reload();
      return `${kind === "component" ? "Component" : "Subscription"} saved.`;
    });
  }

  function removePart(kind, id) {
    if (!confirm(`Remove this ${kind}?`)) return;
    return run(async () => {
      await (kind === "component" ? api.deleteComponent(id) : api.deleteSubscription(id));
      delete (kind === "component" ? state.components : state.subscriptions)[id];
      await reload();
      return `${kind === "component" ? "Component" : "Subscription"} removed.`;
    });
  }

  function archive() {
    const archiving = !state.machine.archived_at;
    if (archiving && !confirm("Archive this machine? It's hidden from lists in the app and here; its history stays.")) return;
    return run(async () => {
      await api.setArchived("machines", state.machine, archiving);
      await reload();
      return archiving ? "Archived." : "Brought back.";
    });
  }

  function deleteMachine() {
    if (!confirm(`Delete ${model.machineName(state.machine)}? Its technology, subscriptions, and draft inspections are deleted everywhere. This can't be undone.`)) return;
    return run(async () => {
      await api.deleteMachine(state.machine.id);
      state.saved = JSON.stringify(state.draft);
      ctx.onClose(`Deleted ${model.machineName(state.machine)}.`);
    });
  }

  function close() {
    if (isDirty() && !confirm("You have unsaved changes to this machine. Leave without saving?")) return;
    ctx.onClose();
  }

  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("click", onClick);
  if (ctx.machineId) {
    root.innerHTML = `<p class="loading">Loading the machine…</p>`;
    load(ctx.machineId);
  } else {
    startNew();
  }

  return (silent = false) => !isDirty() || (!silent && confirm("You have unsaved changes to this machine. Leave without saving?"));
}
