// The inspection checklist editor.
//
// Phones use the live (newest published) version. Editing happens in one shared draft: owners can
// change everything and publish it; admins can change only How to Check steps. The database
// enforces both, so this page only hides what someone can't do. Published versions never change.

import * as api from "../api.js";
import { escape, attr, formatDate, notice } from "../ui.js";
import * as model from "../checklist-model.js";

const CHECKLIST_ID = "preseason-general";

export function mountChecklist(root, { profile }) {
  const isOwner = profile.role === "owner";
  const state = {
    rows: [],
    live: null,
    draft: null,
    content: null,
    saved: "",
    options: {},
    selected: { section: 0, item: 0 },
    busy: false,
    loadError: null,
  };

  const canEditAll = () => Boolean(state.draft) && isOwner;
  const canEditSteps = () => Boolean(state.draft);
  const isDirty = () => Boolean(state.content) && JSON.stringify(state.content) !== state.saved;
  // Option values phones understand, for lists the server has (an unloaded list checks nothing).
  const known = () => Object.fromEntries(
    ["guidance_system", "feature", "correction_type"]
      .filter((list) => state.options[list]?.length)
      .map((list) => [list, new Set(state.options[list].map((o) => o.value))]),
  );
  const section = () => state.content?.sections[state.selected.section];
  const item = () => (state.selected.item == null ? null : section()?.items[state.selected.item]);

  // ---------------------------------------------------------------- loading

  /** Reads the checklist versions and option lists from the server into `state`. */
  async function fetchAll() {
    const [rows, options] = await Promise.all([api.loadChecklists(), api.loadOptions()]);
    const ids = [...new Set(rows.map((row) => row.template_id))];
    const id = ids.includes(CHECKLIST_ID) ? CHECKLIST_ID : ids[0];
    state.rows = rows.filter((row) => row.template_id === id);
    state.options = options;
    state.live = model.liveVersion(state.rows);
    state.draft = state.rows.find((row) => row.status === "draft") ?? null;
    const source = state.draft ?? state.live;
    state.content = source ? structuredClone(source.content) : null;
    state.saved = JSON.stringify(state.content);
    state.loadError = null;
    keepSelectionInRange();
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

  function keepSelectionInRange() {
    const sections = state.content?.sections ?? [];
    if (sections.length === 0) {
      state.selected = { section: 0, item: null };
      return;
    }
    const s = Math.min(state.selected.section, sections.length - 1);
    const items = sections[s].items ?? [];
    const i = state.selected.item == null || items.length === 0 ? null : Math.min(state.selected.item, items.length - 1);
    state.selected = { section: s, item: i };
  }

  // ---------------------------------------------------------------- rendering

  function render() {
    if (state.loadError) {
      root.innerHTML = `
        <div data-notice></div>
        <div class="card"><h2>Couldn't load the checklist</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    if (!state.content) {
      root.innerHTML = `
        <div data-notice></div>
        <div class="card"><h2>No checklist yet</h2>
        <p>The server has no published checklist. Run <code>supabase/seed/default_catalog.sql</code> from the app's repository to load the default one.</p></div>`;
      return;
    }
    root.innerHTML = `
      <div data-notice></div>
      ${toolbar()}
      <div data-problems>${problemsPanel()}</div>
      <div class="editor">
        <aside class="outline" aria-label="Sections and checks">${outline()}</aside>
        <section class="detail">${state.selected.item == null ? sectionForm(section()) : itemForm(item())}</section>
      </div>`;
  }

  /** Updates the save state and problems without redrawing, so typing isn't interrupted. */
  function refreshStatus() {
    const dirty = isDirty();
    const status = root.querySelector("[data-dirty]");
    if (status) status.textContent = dirty ? "Unsaved changes" : `Saved ${formatDate(state.draft?.updated_at)}`;
    const save = root.querySelector('[data-action="save"]');
    if (save) save.disabled = !dirty || state.busy;
    const problems = root.querySelector("[data-problems]");
    if (problems) problems.innerHTML = problemsPanel();
  }

  function toolbar() {
    const { live, draft } = state;
    const liveText = live
      ? `Phones use version <strong>${escape(live.version)}</strong>${live.published_at ? `, published ${escape(formatDate(live.published_at))}` : ""}.`
      : "Nothing is published yet.";
    const actions = draft
      ? `<button class="secondary" data-action="save"${attr("disabled", !isDirty() || state.busy)}>Save Draft</button>
         ${isOwner ? `<button class="primary" data-action="publish"${attr("disabled", state.busy)}>Publish ${escape(draft.version)}</button>
         <button class="danger" data-action="discard"${attr("disabled", state.busy)}>Discard Draft</button>` : ""}`
      : `<button class="primary" data-action="start"${attr("disabled", state.busy || !live)}>Start Editing</button>`;
    return `
      <div class="toolbar">
        <div>
          <h1>${escape(state.content.title)}</h1>
          <p class="meta">${liveText}</p>
          ${draft
            ? `<p class="meta"><span class="badge">Draft ${escape(draft.version)}</span> <span data-dirty>${isDirty() ? "Unsaved changes" : `Saved ${escape(formatDate(draft.updated_at))}`}</span></p>`
            : `<p class="meta">You're viewing the live version. Start Editing makes a draft of the next version.</p>`}
        </div>
        <div class="actions">${actions}</div>
      </div>
      ${draft && !isOwner ? `<p class="callout">As an admin you can change How to Check steps. An owner publishes the draft.</p>` : ""}`;
  }

  function problemsPanel() {
    if (!state.draft) return "";
    const found = model.problems(state.content, known());
    if (found.length === 0) return "";
    return `
      <div class="card warning">
        <h2>Fix before publishing</h2>
        <ul>${found.map((problem) => `<li>${escape(problem)}</li>`).join("")}</ul>
      </div>`;
  }

  function outline() {
    const sections = state.content.sections.map((sec, s) => {
      const items = (sec.items ?? []).map((check, i) => {
        const selected = state.selected.section === s && state.selected.item === i;
        return `
          <li>
            <button class="outline-item${selected ? " selected" : ""}" data-action="select-item" data-section="${s}" data-item="${i}"${selected ? ' aria-current="true"' : ""}>
              <span data-nav="${s}-${i}">${escape(check.title || "Untitled check")}</span>
              ${check.required ? "" : '<small>Optional</small>'}
            </button>
          </li>`;
      }).join("");
      const sectionSelected = state.selected.section === s && state.selected.item == null;
      return `
        <li class="outline-section">
          <button class="outline-heading${sectionSelected ? " selected" : ""}" data-action="select-section" data-section="${s}">
            <span data-nav-section="${s}">${escape(sec.title || "Untitled section")}</span>
          </button>
          <ol>${items}</ol>
          ${canEditAll() ? `<button class="add" data-action="add-check" data-section="${s}">+ Add check</button>` : ""}
        </li>`;
    }).join("");
    return `<ol class="outline-list">${sections}</ol>
      ${canEditAll() ? '<button class="add" data-action="add-section">+ Add section</button>' : ""}`;
  }

  const disabledUnless = (allowed) => attr("disabled", !allowed);

  function moveTools(kind, index, count, extra = "") {
    return `
      <span class="tools">
        <button class="icon" data-action="${kind}-up" data-index="${index}"${attr("disabled", index === 0)} aria-label="Move up" title="Move up">↑</button>
        <button class="icon" data-action="${kind}-down" data-index="${index}"${attr("disabled", index === count - 1)} aria-label="Move down" title="Move down">↓</button>
        ${extra}
      </span>`;
  }

  function sectionForm(sec) {
    if (!sec) return `<div class="card"><p>Add a section to start.</p></div>`;
    const all = canEditAll();
    const count = state.content.sections.length;
    return `
      <div class="card">
        <div class="detail-head">
          <h2>Section</h2>
          ${all ? moveTools("section", state.selected.section, count, '<button class="danger" data-action="delete-section">Remove Section</button>') : ""}
        </div>
        <label>Title <input data-field="section.title" value="${escape(sec.title)}"${disabledUnless(all)}></label>
        <label>Summary <textarea data-field="section.summary" rows="2"${disabledUnless(all)}>${escape(sec.summary)}</textarea></label>
        <p class="hint">Key <code>${escape(sec.key)}</code>. ${sec.items?.length ?? 0} check(s).</p>
      </div>`;
  }

  function choices(list, field, selected, title) {
    const chosen = new Set(selected ?? []);
    // Hidden options aren't offered, but stay visible while a check uses them.
    const options = (state.options[list] ?? []).filter((option) => option.active || chosen.has(option.value));
    if (options.length === 0) return `<p class="hint">${escape(title)}: no options on the server yet.</p>`;
    return `
      <div class="choices">
        <span class="choices-title">${escape(title)}</span>
        ${options.map((option) => `
          <label class="check"><input type="checkbox" data-field="${field}" data-value="${escape(option.value)}"${attr("checked", chosen.has(option.value))}${disabledUnless(canEditAll())}> ${escape(option.label)}${option.active ? "" : " <small>(hidden)</small>"}</label>`).join("")}
      </div>`;
  }

  function itemForm(check) {
    if (!check) return `<div class="card"><p>This section has no checks yet.</p></div>`;
    const all = canEditAll();
    const steps = canEditSteps();
    const count = section().items.length;
    const applies = check.appliesTo ?? {};
    const record = check.record ?? [];
    return `
      <div class="card">
        <div class="detail-head">
          <h2 data-detail-title>${escape(check.title || "Untitled check")}</h2>
          ${all ? moveTools("item", state.selected.item, count, '<button class="danger" data-action="delete-item">Remove Check</button>') : ""}
        </div>
        <p class="hint">Key <code>${escape(check.key)}</code>. Keys never change, so answers on draft inspections carry over to new versions.</p>

        <label>Title <input data-field="item.title" value="${escape(check.title)}"${disabledUnless(all)}></label>
        <label>Why it matters <textarea data-field="item.purpose" rows="3"${disabledUnless(all)}>${escape(check.purpose)}</textarea></label>

        <fieldset class="steps">
          <legend>How to Check</legend>
          ${(check.steps ?? []).map((step, k) => `
            <div class="step">
              <span class="step-number">${k + 1}</span>
              <textarea data-field="step" data-index="${k}" rows="2" aria-label="Step ${k + 1}"${disabledUnless(steps)}>${escape(step)}</textarea>
              ${steps ? moveTools("step", k, check.steps.length, `<button class="icon" data-action="remove-step" data-index="${k}" aria-label="Remove step" title="Remove step">✕</button>`) : ""}
            </div>`).join("")}
          ${steps ? '<button class="add" data-action="add-step">+ Add step</button>' : ""}
        </fieldset>

        <label>What good looks like <textarea data-field="item.lookFor" rows="2"${disabledUnless(all)}>${escape(check.lookFor)}</textarea></label>
        <label>Safety note (optional) <textarea data-field="item.safety" rows="2"${disabledUnless(all)}>${escape(check.safety ?? "")}</textarea></label>

        <div class="grid2">
          <label>Machine condition
            <select data-field="item.condition"${disabledUnless(all)}>
              ${model.CONDITIONS.map((c) => `<option value="${c.value}"${attr("selected", check.condition === c.value)}>${escape(c.label)}</option>`).join("")}
            </select>
          </label>
          <label>Photo
            <select data-field="item.evidence"${disabledUnless(all)}>
              ${model.EVIDENCE.map((e) => `<option value="${e.value}"${attr("selected", (check.evidence ?? "") === e.value)}>${escape(e.label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <label class="check"><input type="checkbox" data-field="item.required"${attr("checked", check.required)}${disabledUnless(all)}> Required: must be recorded before the inspection is complete</label>
        <label class="check"><input type="checkbox" data-field="item.panel"${attr("checked", check.panel === "subscriptions")}${disabledUnless(all)}> Show the machine's correction subscriptions in this check</label>

        <fieldset>
          <legend>Applies to</legend>
          <p class="hint">Leave a group empty to include every machine. The check appears only on machines that match every group you fill in.</p>
          ${choices("guidance_system", "applies.systems", applies.systems, "Guidance systems")}
          <label class="check"><input type="checkbox" data-field="applies.requiresAutoSteer"${attr("checked", applies.requiresAutoSteer === true)}${disabledUnless(all)}> Only machines with auto-steer</label>
          ${choices("feature", "applies.features", applies.features, "Features (any marked Installed)")}
          ${choices("correction_type", "applies.corrections", applies.corrections, "Correction types")}
        </fieldset>

        <fieldset>
          <legend>Fields to record</legend>
          ${record.length === 0 ? '<p class="hint">No fields. Add one for anything the technician should write down.</p>' : ""}
          ${record.map((field, j) => `
            <div class="field-row">
              <label>Label <input data-field="record.label" data-index="${j}" value="${escape(field.label)}"${disabledUnless(all)}></label>
              <label>Hint <input data-field="record.hint" data-index="${j}" value="${escape(field.hint ?? "")}" placeholder="Shown in the empty box"${disabledUnless(all)}></label>
              <label>Fill in from the machine
                <select data-field="record.profile" data-index="${j}"${disabledUnless(all)}>
                  ${model.PROFILE_FIELDS.map((p) => `<option value="${p.value}"${attr("selected", (field.profile ?? "") === p.value)}>${escape(p.label)}</option>`).join("")}
                </select>
              </label>
              <div class="field-flags">
                <label class="check"><input type="checkbox" data-field="record.required" data-index="${j}"${attr("checked", field.required === true)}${disabledUnless(all)}> Required</label>
                <label class="check"><input type="checkbox" data-field="record.optionalOnPass" data-index="${j}"${attr("checked", field.optionalOnPass === true)}${disabledUnless(all && field.required === true)}> Not needed when it passes</label>
                ${all ? `<button class="danger" data-action="remove-field" data-index="${j}">Remove</button>` : ""}
              </div>
            </div>`).join("")}
          ${all ? '<button class="add" data-action="add-field">+ Add field</button>' : ""}
        </fieldset>
      </div>`;
  }

  // ---------------------------------------------------------------- editing

  /** Field keys in the live version of this check, which must not change. */
  function liveFieldKeys(check) {
    const liveCheck = (state.live?.content?.sections ?? []).flatMap((s) => s.items ?? []).find((i) => i.key === check.key);
    return new Set((liveCheck?.record ?? []).map((f) => f.key));
  }

  function setOptional(object, key, value) {
    if (value === "" || value === false || value == null) delete object[key];
    else object[key] = value;
  }

  function toggleApplies(check, key, list, value, on) {
    const applies = check.appliesTo ?? {};
    const chosen = new Set(applies[key] ?? []);
    if (on) chosen.add(value);
    else chosen.delete(value);
    // Keep the website's order so the saved checklist doesn't change for no reason.
    const order = (state.options[list] ?? []).map((o) => o.value);
    const values = [...chosen].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (values.length) applies[key] = values;
    else delete applies[key];
    if (Object.keys(applies).length) check.appliesTo = applies;
    else delete check.appliesTo;
  }

  function onInput(event) {
    const element = event.target.closest("[data-field]");
    if (!element || !state.content || !state.draft) return;
    const field = element.dataset.field;
    const index = Number(element.dataset.index);
    const value = element.type === "checkbox" ? element.checked : element.value;
    const sec = section();
    const check = item();
    if (field === "step") {
      if (!canEditSteps() || !check) return;
      check.steps[index] = value;
      refreshStatus();
      return;
    }
    if (!canEditAll()) return;
    switch (field) {
      case "section.title":
        sec.title = value;
        root.querySelector(`[data-nav-section="${state.selected.section}"]`).textContent = value || "Untitled section";
        break;
      case "section.summary": sec.summary = value; break;
      case "item.title":
        check.title = value;
        root.querySelector(`[data-nav="${state.selected.section}-${state.selected.item}"]`).textContent = value || "Untitled check";
        root.querySelector("[data-detail-title]").textContent = value || "Untitled check";
        break;
      case "item.purpose": check.purpose = value; break;
      case "item.lookFor": check.lookFor = value; break;
      case "item.safety": setOptional(check, "safety", value.trim() ? value : ""); break;
      case "item.condition": check.condition = value; break;
      case "item.evidence": setOptional(check, "evidence", value); break;
      case "item.panel": setOptional(check, "panel", value ? "subscriptions" : ""); break;
      case "item.required":
        check.required = value;
        render();
        return;
      case "applies.systems": toggleApplies(check, "systems", "guidance_system", element.dataset.value, value); break;
      case "applies.features": toggleApplies(check, "features", "feature", element.dataset.value, value); break;
      case "applies.corrections": toggleApplies(check, "corrections", "correction_type", element.dataset.value, value); break;
      case "applies.requiresAutoSteer": {
        const applies = check.appliesTo ?? {};
        setOptional(applies, "requiresAutoSteer", value);
        if (Object.keys(applies).length) check.appliesTo = applies;
        else delete check.appliesTo;
        break;
      }
      case "record.label": {
        const recordField = check.record[index];
        recordField.label = value;
        // A field new in this draft takes its key from its label; existing keys never change.
        if (!liveFieldKeys(check).has(recordField.key)) {
          const taken = new Set(check.record.filter((_, j) => j !== index).map((f) => f.key));
          recordField.key = model.uniqueKey(value || "field", taken);
        }
        break;
      }
      case "record.hint": setOptional(check.record[index], "hint", value); break;
      case "record.profile": setOptional(check.record[index], "profile", value); break;
      case "record.required":
        setOptional(check.record[index], "required", value);
        if (!value) delete check.record[index].optionalOnPass;
        render();
        return;
      case "record.optionalOnPass": setOptional(check.record[index], "optionalOnPass", value); break;
      default: return;
    }
    refreshStatus();
  }

  function select(sectionIndex, itemIndex) {
    state.selected = { section: sectionIndex, item: itemIndex };
    render();
  }

  async function onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    const action = element.dataset.action;
    const s = Number(element.dataset.section);
    const i = Number(element.dataset.item);
    const index = Number(element.dataset.index);
    const sections = state.content?.sections;
    const sec = section();
    const check = item();

    switch (action) {
      case "reload": return load();
      case "select-section": return select(s, null);
      case "select-item": return select(s, i);
      case "start": return startEditing();
      case "save": return save();
      case "publish": return publish();
      case "discard": return discard();
    }

    if (action.startsWith("step") || action.endsWith("-step")) {
      if (!canEditSteps() || !check) return;
      if (action === "add-step") check.steps.push("");
      if (action === "remove-step") check.steps.splice(index, 1);
      if (action === "step-up") model.move(check.steps, index, -1);
      if (action === "step-down") model.move(check.steps, index, 1);
      render();
      if (action === "add-step") root.querySelectorAll('[data-field="step"]').item(check.steps.length - 1)?.focus();
      return;
    }

    if (!canEditAll()) return;
    switch (action) {
      case "add-section": {
        sections.push(model.newSection(state.content));
        return select(sections.length - 1, null);
      }
      case "add-check": {
        const target = sections[s];
        target.items.push(model.newCheck(state.content, target));
        return select(s, target.items.length - 1);
      }
      case "section-up":
      case "section-down": {
        const moved = model.move(sections, state.selected.section, action === "section-up" ? -1 : 1);
        return select(moved, null);
      }
      case "item-up":
      case "item-down": {
        const moved = model.move(sec.items, state.selected.item, action === "item-up" ? -1 : 1);
        return select(state.selected.section, moved);
      }
      case "delete-item": {
        if (!confirm(`Remove “${check.title}”?\n\nWhen this version is published, draft inspections lose this check when they're opened, including any answer recorded for it. Finalized inspections keep it.`)) return;
        sec.items.splice(state.selected.item, 1);
        state.selected.item = sec.items.length ? Math.min(state.selected.item, sec.items.length - 1) : null;
        return render();
      }
      case "delete-section": {
        const n = sec.items.length;
        if (!confirm(`Remove the section “${sec.title}”${n ? ` and its ${n} check(s)` : ""}?\n\nWhen this version is published, draft inspections lose these checks when they're opened.`)) return;
        sections.splice(state.selected.section, 1);
        state.selected = { section: Math.max(0, state.selected.section - 1), item: null };
        keepSelectionInRange();
        return render();
      }
      case "add-field": {
        check.record = check.record ?? [];
        const taken = new Set(check.record.map((f) => f.key));
        check.record.push({ key: model.uniqueKey("New field", taken), label: "New field" });
        return render();
      }
      case "remove-field": {
        check.record.splice(index, 1);
        if (check.record.length === 0) delete check.record;
        return render();
      }
    }
  }

  // ---------------------------------------------------------------- drafts

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
        ? `${error.message} Reload the page to see the latest version (copy anything you need first).`
        : api.describe(error);
    }
    state.busy = false;
    render();
    if (message) notice(root, message, kind);
  }

  function startEditing() {
    return run(async () => {
      const live = state.live.version;
      const version = model.nextVersion(live);
      await api.createDraft(state.live, version, model.draftFrom(state.live.content, version));
      await fetchAll();
      return `Draft ${version} started. Phones keep using ${live} until it's published.`;
    });
  }

  function save() {
    return run(async () => {
      state.draft = await api.saveDraft(state.draft, state.content);
      state.saved = JSON.stringify(state.content);
      return "Draft saved.";
    });
  }

  function publish() {
    const found = model.problems(state.content, known());
    if (found.length) {
      notice(root, "Fix the problems listed before publishing.", "error");
      return;
    }
    const version = state.draft.version;
    if (!confirm(`Publish version ${version}?\n\nPhones pick it up at their next sync, and draft inspections switch to it when they're opened. Finalized inspections keep the version they were signed with. A published version can't be changed; edits make the next version.`)) return;
    return run(async () => {
      if (isDirty()) state.draft = await api.saveDraft(state.draft, state.content);
      await api.publishDraft(state.draft);
      await fetchAll();
      return `Version ${version} is live. Phones pick it up at their next sync.`;
    });
  }

  function discard() {
    if (!confirm(`Discard draft ${state.draft.version}? Its changes are deleted. Phones keep using ${state.live?.version ?? "the live version"}.`)) return;
    return run(async () => {
      await api.discardDraft(state.draft);
      await fetchAll();
      return "Draft discarded.";
    });
  }

  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("click", onClick);
  root.innerHTML = `<p class="loading">Loading the checklist…</p>`;
  load();

  /** Whether it's fine to leave: no unsaved changes, or the person agrees to lose them. */
  return (silent = false) => !isDirty() || (!silent && confirm("You have unsaved changes to the draft. Leave without saving?"));
}
