// The machine options editor: the choices technicians pick from when they describe a machine's
// technology (guidance systems, steering, correction services, features…).
//
// Owners rename, reorder, hide, and add options and change the settings the app reads. Values never
// change once saved, because machines and inspections store them; hidden options stay readable on
// records that use them. Admins can look but not change anything (the database enforces this too).

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import * as model from "../options-model.js";

export function mountOptions(root, { profile }) {
  const isOwner = profile.role === "owner";
  const state = {
    rows: [],
    saved: new Map(),
    list: model.LISTS[0].id,
    /** The correction type whose services are shown. */
    parent: null,
    /** For lists with "used on": the equipment type shown, or "" for all. */
    equipment: "",
    busy: false,
    loadError: null,
    nextKey: 1,
  };

  const info = () => model.listInfo(state.list);
  const keyOf = (row) => row.id ?? row._key;
  const rowFor = (key) => state.rows.find((row) => keyOf(row) === key);
  const isDirty = () => {
    const { added, updated } = model.changes(state.rows, state.saved);
    return added.length + updated.length > 0;
  };
  const visibleRows = () => model.optionsIn(state.rows, state.list, info().parentList ? state.parent : null)
    .filter((row) => !state.equipment || !model.hasUsedOn(state.list) || model.usedOn(row).includes(state.equipment));
  const correctionTypes = () => model.optionsIn(state.rows, "correction_type");
  const equipmentTypes = () => model.optionsIn(state.rows, "equipment_type");

  // ---------------------------------------------------------------- loading

  async function fetchAll() {
    state.rows = await api.loadOptionRows();
    state.saved = model.baseline(state.rows);
    state.loadError = null;
    const types = correctionTypes().map((row) => row.value);
    if (!types.includes(state.parent)) {
      state.parent = types.find((type) => model.optionsIn(state.rows, "correction_service", type).length) ?? types[0] ?? null;
    }
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
        <div class="card"><h2>Couldn't load the options</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    root.innerHTML = `
      <div data-notice></div>
      ${toolbar()}
      <div data-problems>${problemsPanel()}</div>
      <div class="editor">
        <aside class="outline" aria-label="Option lists">${outline()}</aside>
        <section class="detail">${listCard()}</section>
      </div>`;
  }

  function refreshStatus() {
    const dirty = isDirty();
    const status = root.querySelector("[data-dirty]");
    if (status) status.textContent = dirty ? "Unsaved changes" : "All changes saved";
    root.querySelectorAll('[data-action="save"], [data-action="discard"]').forEach((button) => {
      button.disabled = !dirty || state.busy;
    });
    const problems = root.querySelector("[data-problems]");
    if (problems) problems.innerHTML = problemsPanel();
  }

  function toolbar() {
    const dirty = isDirty();
    return `
      <div class="toolbar">
        <div>
          <h1>Machine options</h1>
          <p class="meta">The choices technicians pick from when they describe a machine. Phones pick up saved changes at their next sync.</p>
          ${isOwner ? `<p class="meta" data-dirty>${dirty ? "Unsaved changes" : "All changes saved"}</p>` : ""}
        </div>
        ${isOwner ? `
          <div class="actions">
            <button class="secondary" data-action="discard"${attr("disabled", !dirty || state.busy)}>Discard Changes</button>
            <button class="primary" data-action="save"${attr("disabled", !dirty || state.busy)}>Save Changes</button>
          </div>` : ""}
      </div>
      ${isOwner ? "" : '<p class="callout">Only owners can change options. You can look at them here.</p>'}`;
  }

  function problemsPanel() {
    if (!isOwner) return "";
    const found = model.problems(state.rows);
    if (found.length === 0) return "";
    return `
      <div class="card warning">
        <h2>Fix before saving</h2>
        <ul>${found.map((problem) => `<li>${escape(problem)}</li>`).join("")}</ul>
      </div>`;
  }

  function outline() {
    return `<ol class="outline-list">${model.LISTS.map((list) => {
      const count = state.rows.filter((row) => row.list === list.id && row.active).length;
      const selected = state.list === list.id;
      return `
        <li>
          <button class="outline-item${selected ? " selected" : ""}" data-action="select-list" data-list="${list.id}"${selected ? ' aria-current="true"' : ""}>
            <span>${escape(list.title)}</span><small>${count}</small>
          </button>
        </li>`;
    }).join("")}</ol>`;
  }

  function listCard() {
    const list = info();
    const rows = visibleRows();
    const parentPicker = list.parentList ? `
      <label>Correction type
        <select data-field="parent">
          ${correctionTypes().map((type) => `<option value="${escape(type.value)}"${attr("selected", type.value === state.parent)}>${escape(type.label)}${type.active ? "" : " (hidden)"}</option>`).join("")}
        </select>
      </label>` : "";
    const equipmentPicker = model.hasUsedOn(list.id) ? `
      <label>Show options used on
        <select data-field="equipment-filter">
          <option value=""${attr("selected", !state.equipment)}>All equipment</option>
          ${equipmentTypes().map((type) => `<option value="${escape(type.value)}"${attr("selected", type.value === state.equipment)}>${escape(type.label)}</option>`).join("")}
        </select>
      </label>` : "";
    const empty = list.parentList
      ? "No services listed for this correction type. Technicians type the service in."
      : "No options in this list yet.";
    return `
      <div class="card">
        <h2>${escape(list.title)}</h2>
        <p class="hint">${escape(list.about)}</p>
        ${parentPicker}
        ${equipmentPicker}
        ${rows.length ? `<ol class="option-list">${rows.map((row, index) => optionRow(row, index, rows.length)).join("")}</ol>` : `<p class="hint">${escape(empty)}</p>`}
        ${isOwner && list.canAdd !== false && (!list.parentList || state.parent) ? `
          <form class="add-option" data-add>
            <label>Add an option <input name="label" placeholder="Name people will see" autocomplete="off"></label>
            <button class="secondary" type="submit">Add</button>
          </form>` : ""}
      </div>`;
  }

  function optionRow(row, index, count) {
    const key = escape(keyOf(row));
    const canHide = model.canHide(row);
    const disabled = attr("disabled", !isOwner);
    const settings = (info().settings ?? []).map((setting) => settingInput(row, setting)).join("");
    const manual = row.details?.manual ? `Cites ${escape(row.details.manual)}${row.details.page ? `, p. ${escape(row.details.page)}` : ""}. ` : "";
    return `
      <li class="option${row.active ? "" : " hidden-option"}" data-row="${key}">
        <div class="option-head">
          <label class="option-name">Name <input data-field="label" data-key="${key}" value="${escape(row.label)}"${disabled}></label>
          ${isOwner ? `
            <span class="tools">
              <button class="icon" data-action="up" data-key="${key}"${attr("disabled", index === 0)} aria-label="Move up" title="Move up">↑</button>
              <button class="icon" data-action="down" data-key="${key}"${attr("disabled", index === count - 1)} aria-label="Move down" title="Move down">↓</button>
              ${row.id ? "" : `<button class="danger" data-action="remove" data-key="${key}">Remove</button>`}
            </span>` : ""}
        </div>
        ${settings ? `<div class="option-settings">${settings}</div>` : ""}
        <div class="option-foot">
          <label class="check"><input type="checkbox" data-field="active" data-key="${key}"${attr("checked", row.active)}${attr("disabled", !isOwner || (!canHide && row.active))}> Offered in the app</label>
          <span class="hint">${manual}${row.id ? `Saved as <code>${escape(row.value)}</code>` : `Will be saved as <code>${escape(row.value)}</code>`}${canHide ? "" : ". The app relies on this one, so it can be renamed but not hidden"}.</span>
        </div>
      </li>`;
  }

  function settingInput(row, setting) {
    const key = escape(keyOf(row));
    const value = row.details?.[setting.key];
    const disabled = attr("disabled", !isOwner);
    const data = `data-field="setting" data-setting="${setting.key}" data-type="${setting.type}" data-key="${key}"`;
    switch (setting.type) {
      case "bool":
        return `<label class="check"><input type="checkbox" ${data}${attr("checked", value === true)}${disabled}> ${escape(setting.label)}</label>`;
      case "tristate": {
        const current = value === true ? "yes" : value === false ? "no" : "";
        return `
          <label>${escape(setting.label)}
            <select ${data}${disabled}>
              <option value="yes"${attr("selected", current === "yes")}>Yes: steering checks apply</option>
              <option value="no"${attr("selected", current === "no")}>No: skip steering checks</option>
              <option value=""${attr("selected", current === "")}>Not known: keep steering checks</option>
            </select>
          </label>`;
      }
      case "equipment": {
        const chosen = model.usedOn(row);
        return `
          <div class="choices">
            <span class="choices-title">${escape(setting.label)}</span>
            ${equipmentTypes().map((type) => `
              <label class="check"><input type="checkbox" ${data} data-value="${escape(type.value)}"${attr("checked", chosen.includes(type.value))}${disabled}> ${escape(type.label)}</label>`).join("")}
          </div>`;
      }
      case "symbol": {
        const known = model.SYMBOLS.some((symbol) => symbol.value === value);
        return `
          <label>${escape(setting.label)}
            <select ${data}${disabled}>
              ${known || !value ? "" : `<option value="${escape(value)}" selected>${escape(value)}</option>`}
              ${model.SYMBOLS.map((symbol) => `<option value="${symbol.value}"${attr("selected", symbol.value === (value ?? "shippingbox"))}>${escape(symbol.label)}</option>`).join("")}
            </select>
          </label>`;
      }
      default:
        return `<label>${escape(setting.label)} <input ${data} value="${escape(value ?? "")}"${setting.hint ? ` placeholder="${escape(setting.hint)}"` : ""}${disabled}></label>`;
    }
  }

  // ---------------------------------------------------------------- editing

  function onInput(event) {
    const element = event.target.closest("[data-field]");
    if (!element) return;
    const field = element.dataset.field;
    if (field === "parent") {
      state.parent = element.value;
      return render();
    }
    if (field === "equipment-filter") {
      state.equipment = element.value;
      return render();
    }
    if (!isOwner) return;
    const row = rowFor(element.dataset.key);
    if (!row) return;
    switch (field) {
      case "label":
        row.label = element.value;
        break;
      case "active":
        row.active = element.checked;
        element.closest("[data-row]")?.classList.toggle("hidden-option", !row.active);
        break;
      case "setting": {
        const details = { ...(row.details ?? {}) };
        const name = element.dataset.setting;
        if (element.dataset.type === "bool") details[name] = element.checked;
        else if (element.dataset.type === "equipment") {
          // Keep the equipment types' own order so saved rows don't change for no reason.
          const chosen = new Set(model.usedOn(row));
          if (element.checked) chosen.add(element.dataset.value);
          else chosen.delete(element.dataset.value);
          details[name] = equipmentTypes().map((type) => type.value).filter((value) => chosen.has(value));
        }
        else if (element.dataset.type === "tristate") details[name] = element.value === "" ? null : element.value === "yes";
        else details[name] = element.value;
        row.details = details;
        break;
      }
      default:
        return;
    }
    refreshStatus();
  }

  function onSubmit(event) {
    const form = event.target.closest("[data-add]");
    if (!form) return;
    event.preventDefault();
    const label = form.label.value.trim();
    if (!label || !isOwner) return;
    const parent = info().parentList ? state.parent : null;
    const equipment = model.hasUsedOn(state.list) ? state.equipment || null : null;
    const row = model.newOption(state.rows, state.list, label, { organizationId: profile.organization_id, parent, equipment });
    row._key = `new-${state.nextKey++}`;
    state.rows.push(row);
    render();
    root.querySelector(`[data-field="label"][data-key="${row._key}"]`)?.focus();
  }

  async function onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    const action = element.dataset.action;
    switch (action) {
      case "reload": return load();
      case "select-list":
        state.list = element.dataset.list;
        return render();
      case "save": return save();
      case "discard": return discard();
    }
    if (!isOwner) return;
    const row = rowFor(element.dataset.key);
    if (!row) return;
    switch (action) {
      case "up":
      case "down":
        model.moveOption(state.rows, row, action === "up" ? -1 : 1);
        render();
        root.querySelector(`[data-action="${action}"][data-key="${escape(keyOf(row))}"]:not(:disabled)`)?.focus();
        return;
      case "remove":
        state.rows = state.rows.filter((other) => other !== row);
        return render();
    }
  }

  // ---------------------------------------------------------------- saving

  /** Runs one server action with the buttons held, then redraws and shows what happened. */
  async function run(work) {
    if (state.busy) return;
    state.busy = true;
    root.querySelectorAll(".toolbar button").forEach((button) => { button.disabled = true; });
    let message;
    let kind = "success";
    try {
      message = await work();
    } catch (error) {
      kind = "error";
      message = error instanceof api.SaveConflict
        ? `${error.message} Reload the page to see the latest options, then make the change again.`
        : api.describe(error);
    }
    state.busy = false;
    render();
    if (message) notice(root, message, kind);
  }

  function save() {
    const found = model.problems(state.rows);
    if (found.length) {
      notice(root, "Fix the problems listed before saving.", "error");
      return;
    }
    return run(async () => {
      const { added, updated } = model.changes(state.rows, state.saved);
      await api.saveOptions(added, updated);
      await fetchAll();
      const count = added.length + updated.length;
      return `Saved ${count} ${count === 1 ? "option" : "options"}. Phones pick up the change at their next sync.`;
    });
  }

  function discard() {
    if (!confirm("Discard your unsaved changes to the options?")) return;
    return run(async () => {
      await fetchAll();
      return "Changes discarded.";
    });
  }

  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  root.innerHTML = `<p class="loading">Loading the options…</p>`;
  load();

  /** Whether it's fine to leave: no unsaved changes, or the person agrees to lose them. */
  return (silent = false) => !isDirty() || (!silent && confirm("You have unsaved changes to the options. Leave without saving?"));
}
