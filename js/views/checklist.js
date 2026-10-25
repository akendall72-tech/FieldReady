// The inspection checklists, by kind: Guidance and Planter (one checklist each), Machine (one or
// more per equipment type), and Custom (each person's own).
//
// Phones use the live (newest published) version of each checklist. Editing happens in one draft:
// owners change everything in the shared checklists and publish them, and admins change only How
// to Check steps. Custom checklists belong to whoever made them (anyone on staff); only they see,
// edit, publish, and use them. The database enforces all of this, so this page only hides what
// someone can't do. Published versions never change; a retired checklist isn't offered for new
// inspections.

import * as api from "../api.js";
import { escape, attr, formatDate, notice } from "../ui.js";
import * as model from "../checklist-model.js";
import { usedOn, optionsIn } from "../options-model.js";
import { canHaveGuidance, hasPlanterTechnology } from "../equipment-model.js";

/** The usual Guidance and Planter checklists, opened first. */
const PREFERRED = { guidance: "preseason-general", planter: "preseason-planter" };

export function mountChecklist(root, { profile }) {
  const isOwner = profile.role === "owner";
  const isAdmin = profile.role === "admin";
  /** Employees see only their own Custom checklists. */
  const kinds = isOwner || isAdmin ? model.KINDS : model.KINDS.filter((kind) => kind.value === "custom");
  const state = {
    /** Every version of every checklist this person can see; `rows` are the open checklist's. */
    allRows: [],
    kind: kinds[0].value,
    /** The open checklist; null shows the kind's list (Machine and Custom). */
    templateId: null,
    showRetired: false,
    /** A new checklist being named: { title, equipment, from (template id to copy, or null) }. */
    creating: null,
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

  const isCustom = () => state.kind === "custom";
  const isShared = () => state.kind === "guidance" || state.kind === "planter";
  /** Making, copying, publishing, retiring, and discarding: owners for shared checklists, anyone for their own. */
  const canManage = () => isCustom() || isOwner;
  const canEditAll = () => Boolean(state.draft) && canManage();
  const canEditSteps = () => Boolean(state.draft) && (canManage() || isAdmin);
  const isDirty = () => Boolean(state.content) && JSON.stringify(state.content) !== state.saved;
  // Option values phones understand, for lists the server has (an unloaded list checks nothing).
  const known = () => Object.fromEntries(
    ["guidance_system", "feature", "correction_type", "equipment_type"]
      .filter((list) => state.options[list]?.length)
      .map((list) => [list, new Set(state.options[list].map((o) => o.value))]),
  );
  const optionRows = () => Object.values(state.options).flat();
  const equipmentTypes = () => state.options.equipment_type ?? [];
  /**
   * The equipment types the open checklist covers: the ones it names, or for Guidance the types
   * that can have guidance, for Planter the planter types, and otherwise every type.
   */
  function types() {
    const named = model.typesOf(state.content);
    if (named.length) return named;
    const all = equipmentTypes().filter((type) => type.active).map((type) => type.value);
    if (state.kind === "guidance") return all.filter((type) => canHaveGuidance(optionRows(), type));
    if (state.kind === "planter") return all.filter((type) => hasPlanterTechnology(optionRows(), type));
    return all;
  }
  const typeLabel = (value) => equipmentTypes().find((type) => type.value === value)?.label ?? value;
  const section = () => state.content?.sections[state.selected.section];
  const item = () => (state.selected.item == null ? null : section()?.items[state.selected.item]);

  // ---------------------------------------------------------------- loading

  /** Reads the checklist versions and option lists from the server into `state`. */
  async function fetchAll() {
    const [rows, options] = await Promise.all([api.loadChecklists(), api.loadOptions()]);
    state.allRows = rows;
    state.options = options;
    if (state.templateId && !checklists(state.kind).some((c) => c.id === state.templateId)) state.templateId = null;
    if (!state.templateId && isShared()) state.templateId = defaultChecklist(state.kind);
    openChecklist();
  }

  /** The checklists of a kind, each with its versions, live version, draft, and newest content. */
  function checklists(kind) {
    const ids = [...new Set(state.allRows.map((row) => row.template_id))];
    return ids.map((id) => {
      const rows = state.allRows.filter((row) => row.template_id === id);
      const live = model.liveVersion(rows);
      const draft = rows.find((row) => row.status === "draft") ?? null;
      const newest = draft ?? live ?? rows.reduce((best, row) => (!best || model.isNewer(row.version, best.version) ? row : best), null);
      return { id, rows, live, draft, content: newest?.content, retired: !live && rows.some((row) => row.status === "retired") };
    })
      .filter((checklist) => model.kindOf(checklist.content) === kind)
      .sort((a, b) => (a.content?.title ?? a.id).localeCompare(b.content?.title ?? b.id));
  }

  function defaultChecklist(kind) {
    const ids = checklists(kind).filter((c) => !c.retired).map((c) => c.id);
    return ids.includes(PREFERRED[kind]) ? PREFERRED[kind] : ids[0] ?? null;
  }

  /** Shows the chosen checklist's draft, or its live version. */
  function openChecklist() {
    state.rows = state.allRows.filter((row) => row.template_id === state.templateId);
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
    if (!state.templateId || !state.content) {
      root.innerHTML = `<div data-notice></div>${kindTabs()}${listView()}`;
      return;
    }
    root.innerHTML = `
      <div data-notice></div>
      ${kindTabs()}
      ${isShared() ? "" : `<button class="link back" data-action="close-checklist">← ${escape(kindInfo().label)} checklists</button>`}
      ${toolbar()}
      ${settingsCard()}
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
    const retire = !isShared() && live && canManage()
      ? `<button class="danger" data-action="retire"${attr("disabled", state.busy)}>Retire</button>` : "";
    const actions = draft
      ? `<button class="secondary" data-action="save"${attr("disabled", !isDirty() || state.busy)}>Save Draft</button>
         ${canManage() ? `<button class="primary" data-action="publish"${attr("disabled", state.busy)}>Publish ${escape(draft.version)}</button>
         <button class="danger" data-action="discard"${attr("disabled", state.busy)}>Discard Draft</button>` : ""}`
      : `<button class="primary" data-action="start"${attr("disabled", state.busy || !live || !(canManage() || isAdmin))}>Start Editing</button>${retire}`;
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
      ${draft && !canManage() ? `<p class="callout">As an admin you can change How to Check steps. An owner publishes the draft.</p>` : ""}
      ${!live && !draft ? `<p class="callout">This checklist is retired, so it isn't offered for new inspections.${canManage() ? " Bring it back from the list." : ""}</p>` : ""}`;
  }

  const kindInfo = () => model.KINDS.find((kind) => kind.value === state.kind);

  /** Guidance / Planter / Machine / Custom. */
  function kindTabs() {
    if (kinds.length < 2) return "";
    return `
      <div class="segmented" role="group" aria-label="Kind of inspection">
        ${kinds.map((kind) => `<button class="segment${kind.value === state.kind ? " active" : ""}" data-action="switch-kind" data-kind="${kind.value}" aria-pressed="${kind.value === state.kind}">${escape(kind.label)}</button>`).join("")}
      </div>`;
  }

  /** The kind's checklists (Machine and Custom), with New, Copy, and Bring Back. */
  function listView() {
    const kind = kindInfo();
    if (isShared()) {
      return `<div class="card"><h2>No ${escape(kind.label)} checklist yet</h2>
        <p>The server has no published ${escape(kind.label)} checklist. Run <code>supabase/seed/default_catalog.sql</code> from the app's repository to load the default one.</p></div>`;
    }
    const all = checklists(state.kind);
    const current = all.filter((c) => !c.retired);
    const retired = all.filter((c) => c.retired);
    const empty = isCustom()
      ? "You haven't made any custom checklists yet. New Checklist starts one; you can also copy a Machine checklist from its list."
      : "No Machine checklists yet.";
    return `
      <div class="toolbar">
        <div>
          <h1>${escape(kind.label)} checklists</h1>
          <p class="meta">${escape(kind.about)}</p>
        </div>
        ${canManage() ? `<div class="actions"><button class="primary" data-action="new-checklist"${attr("disabled", state.busy || state.creating)}>New Checklist</button></div>` : ""}
      </div>
      ${state.creating ? createForm() : ""}
      <div class="card">
        ${current.length ? `<ol class="checklist-list">${current.map(checklistRow).join("")}</ol>` : `<p class="hint">${escape(empty)}</p>`}
        ${retired.length ? `
          <label class="check"><input type="checkbox" data-field="show-retired"${attr("checked", state.showRetired)}> Show retired (${retired.length})</label>
          ${state.showRetired ? `<ol class="checklist-list">${retired.map(checklistRow).join("")}</ol>` : ""}` : ""}
      </div>`;
  }

  function checklistRow(checklist) {
    const named = model.typesOf(checklist.content);
    const status = [
      checklist.retired ? "Retired" : checklist.live ? `Live ${checklist.live.version}` : "Not published yet",
      checklist.draft ? `Draft ${checklist.draft.version}` : "",
      named.length ? named.map(typeLabel).join(", ") : "Any equipment type",
    ].filter(Boolean);
    const id = escape(checklist.id);
    return `
      <li class="checklist-row${checklist.retired ? " retired" : ""}">
        <button class="checklist-open" data-action="open-checklist" data-id="${id}">
          <strong>${escape(checklist.content?.title || checklist.id)}</strong>
          <span class="hint">${status.map(escape).join(" · ")}</span>
        </button>
        <span class="tools">
          ${canManage() || (isOwner || isAdmin) ? `<button class="link" data-action="copy-checklist" data-id="${id}"${attr("disabled", state.busy)}>Copy</button>` : ""}
          ${checklist.retired && canManage() ? `<button class="link" data-action="bring-back" data-id="${id}"${attr("disabled", state.busy)}>Bring Back</button>` : ""}
        </span>
      </li>`;
  }

  /** Naming a new checklist (or a copy) and choosing its equipment types. */
  function createForm() {
    const creating = state.creating;
    const source = creating.from && checklists(model.kindOf(creating.fromContent)).find((c) => c.id === creating.from);
    return `
      <form class="card" data-create>
        <h2>${source ? `Copy “${escape(source.content?.title ?? source.id)}”` : `New ${escape(kindInfo().label)} checklist`}</h2>
        <label>Name <input name="title" value="${escape(creating.title)}" autocomplete="off" placeholder="e.g. Combine preseason"></label>
        ${creating.toKind !== "custom" || !source ? "" : '<p class="hint">The copy is your own Custom checklist: only you see it and use it.</p>'}
        <div class="choices">
          <span class="choices-title">Equipment types${creating.toKind === "custom" ? " (none checked: any machine)" : ""}</span>
          ${equipmentTypes().filter((type) => type.active).map((type) => `
            <label class="check"><input type="checkbox" data-create-type="${escape(type.value)}"${attr("checked", creating.equipment.includes(type.value))}> ${escape(type.label)}</label>`).join("")}
        </div>
        <p class="form-error" data-create-problem></p>
        <div class="actions">
          <button class="primary" type="submit"${attr("disabled", state.busy)}>Create Draft</button>
          <button class="secondary" type="button" data-action="cancel-create">Cancel</button>
        </div>
      </form>`;
  }

  /** Machine and Custom checklists: their name and equipment types, editable in a draft. */
  function settingsCard() {
    if (isShared()) return "";
    const all = canEditAll();
    const named = new Set(model.typesOf(state.content));
    return `
      <div class="card">
        <h2>Checklist</h2>
        <label>Name <input data-field="checklist.title" value="${escape(state.content.title)}"${disabledUnless(all)}></label>
        <div class="choices">
          <span class="choices-title">Equipment types${isCustom() ? " (none checked: any machine)" : " it's offered for (none checked: every type)"}</span>
          ${equipmentTypes().filter((type) => type.active || named.has(type.value)).map((type) => `
            <label class="check"><input type="checkbox" data-field="checklist.equipment" data-value="${escape(type.value)}"${attr("checked", named.has(type.value))}${disabledUnless(all)}> ${escape(type.label)}</label>`).join("")}
        </div>
      </div>`;
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
    // Hidden options and other equipment's options aren't offered, but stay visible while a check uses them.
    const covered = types();
    const fits = (option) => option.active
      && (list !== "feature" || usedOn(option).some((type) => covered.includes(type)))
      && (list !== "equipment_type" || covered.includes(option.value));
    const options = (state.options[list] ?? []).filter((option) => fits(option) || chosen.has(option.value));
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
          ${state.kind === "guidance" || applies.systems ? choices("guidance_system", "applies.systems", applies.systems, "Guidance systems") : ""}
          ${state.kind === "guidance" || applies.requiresAutoSteer ? `<label class="check"><input type="checkbox" data-field="applies.requiresAutoSteer"${attr("checked", applies.requiresAutoSteer === true)}${disabledUnless(all)}> Only machines with auto-steer</label>` : ""}
          ${state.kind !== "machine" && state.kind !== "custom" || applies.features ? choices("feature", "applies.features", applies.features, state.kind === "planter" ? "Products (any marked Installed)" : "Features (any marked Installed)") : ""}
          ${state.kind === "guidance" || applies.corrections ? choices("correction_type", "applies.corrections", applies.corrections, "Correction types") : ""}
          ${types().length > 1 || applies.equipment ? choices("equipment_type", "applies.equipment", applies.equipment, "Equipment types") : ""}
          ${answerGroups(applies)}
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

  /** One group per question the covered types are asked: the check applies only to the answers ticked. */
  function answerGroups(applies) {
    const covered = types();
    const chosen = applies.answers ?? {};
    const questions = (state.options.machine_question ?? [])
      .filter((question) => (question.active && usedOn(question).some((type) => covered.includes(type))) || chosen[question.value]);
    if (!questions.length) return "";
    // Folded away unless in use, or the checklist is for one type (its questions are few).
    const open = Object.keys(chosen).length > 0 || covered.length === 1;
    return `
      <details class="answer-groups"${attr("open", open)}>
        <summary>Machine answers (${questions.length} ${questions.length === 1 ? "question" : "questions"})</summary>
        ${questions.map((question) => {
      const picked = new Set(chosen[question.value] ?? []);
      const answers = optionsIn(optionRows(), "machine_answer", question.value).filter((answer) => answer.active || picked.has(answer.value));
      if (!answers.length) return "";
      return `
        <div class="choices">
          <span class="choices-title">${escape(question.label)} (only these answers; unanswered machines keep the check)</span>
          ${answers.map((answer) => `
            <label class="check"><input type="checkbox" data-field="applies.answers" data-question="${escape(question.value)}" data-value="${escape(answer.value)}"${attr("checked", picked.has(answer.value))}${disabledUnless(canEditAll())}> ${escape(answer.label)}</label>`).join("")}
        </div>`;
        }).join("")}
      </details>`;
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

  function toggleAnswer(check, question, value, on) {
    const applies = check.appliesTo ?? {};
    const answers = applies.answers ?? {};
    const chosen = new Set(answers[question] ?? []);
    if (on) chosen.add(value);
    else chosen.delete(value);
    const order = optionsIn(optionRows(), "machine_answer", question).map((answer) => answer.value);
    if (chosen.size) answers[question] = [...chosen].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    else delete answers[question];
    if (Object.keys(answers).length) applies.answers = answers;
    else delete applies.answers;
    if (Object.keys(applies).length) check.appliesTo = applies;
    else delete check.appliesTo;
  }

  function onInput(event) {
    if (event.target.dataset.createType && state.creating) {
      // Checkboxes send both input and change, so set rather than toggle.
      const type = event.target.dataset.createType;
      const others = state.creating.equipment.filter((value) => value !== type);
      state.creating.equipment = event.target.checked ? [...others, type] : others;
      return;
    }
    if (event.target.name === "title" && event.target.closest("[data-create]") && state.creating) {
      state.creating.title = event.target.value;
      return;
    }
    if (event.target.dataset.field === "show-retired") {
      state.showRetired = event.target.checked;
      return render();
    }
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
      case "checklist.title":
        state.content.title = value;
        root.querySelector(".toolbar h1").textContent = value || "Untitled checklist";
        break;
      case "checklist.equipment": {
        const order = equipmentTypes().map((type) => type.value);
        const named = new Set(model.typesOf(state.content));
        if (value) named.add(element.dataset.value);
        else named.delete(element.dataset.value);
        if (named.size) state.content.equipment = [...named].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        else delete state.content.equipment;
        render();
        return;
      }
      case "applies.answers": toggleAnswer(check, element.dataset.question, element.dataset.value, value); break;
      case "applies.equipment": toggleApplies(check, "equipment", "equipment_type", element.dataset.value, value); break;
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
      case "switch-kind": return switchKind(element.dataset.kind);
      case "open-checklist": return openFromList(element.dataset.id);
      case "close-checklist": return closeChecklist();
      case "new-checklist":
        state.creating = { title: "", equipment: [], from: null, toKind: state.kind };
        render();
        root.querySelector('[data-create] [name="title"]')?.focus();
        return;
      case "copy-checklist": {
        const source = checklists(state.kind).find((c) => c.id === element.dataset.id);
        // Admins can't make shared checklists, so their copy of a Machine checklist is their own Custom one.
        const toKind = isOwner || isCustom() ? state.kind : "custom";
        state.creating = { title: `Copy of ${source?.content?.title ?? ""}`, equipment: model.typesOf(source?.content), from: source?.id, fromContent: source?.content, toKind };
        render();
        root.querySelector('[data-create] [name="title"]')?.select();
        return;
      }
      case "cancel-create":
        state.creating = null;
        return render();
      case "bring-back": return bringBack(element.dataset.id);
      case "retire": return retire();
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

  const leaveDraft = () => !isDirty() || confirm("You have unsaved changes to this draft. Leave without saving?");

  function switchKind(kind) {
    if (kind === state.kind || !leaveDraft()) return;
    state.kind = kind;
    state.creating = null;
    state.templateId = isShared() ? defaultChecklist(kind) : null;
    state.selected = { section: 0, item: 0 };
    openChecklist();
    render();
  }

  function openFromList(id) {
    state.templateId = id;
    state.selected = { section: 0, item: 0 };
    openChecklist();
    render();
  }

  function closeChecklist() {
    if (!leaveDraft()) return;
    state.templateId = null;
    openChecklist();
    render();
  }

  /** Creates the named checklist (new, or a copy) as a draft and opens it. */
  function create(form) {
    const creating = state.creating;
    const title = String(creating?.title ?? "").trim();
    if (!title) {
      root.querySelector("[data-create-problem]").textContent = "Give the checklist a name.";
      return;
    }
    const taken = new Set(state.allRows.map((row) => row.template_id));
    const suffix = creating.toKind === "custom" ? crypto.randomUUID().slice(0, 4) : "";
    const content = creating.from
      ? model.copyChecklist(creating.fromContent, { title, kind: creating.toKind, taken, suffix })
      : model.newChecklist({ kind: creating.toKind, title, equipment: creating.equipment, taken, suffix });
    if (creating.equipment.length) content.equipment = [...creating.equipment];
    else delete content.equipment;
    return run(async () => {
      await api.createChecklist(profile.organization_id, content);
      state.creating = null;
      state.kind = creating.toKind;
      state.templateId = content.id;
      state.selected = { section: 0, item: 0 };
      await fetchAll();
      return `Draft of “${title}” started. Fill in its checks, then publish it.`;
    });
  }

  function retire() {
    const title = state.content.title;
    if (!confirm(`Retire “${title}”?\n\nPhones stop offering it for new inspections at their next sync. Inspections already started or finished with it keep it. You can bring it back from the list.`)) return;
    return run(async () => {
      await api.setChecklistStatus(state.templateId, "published", "retired");
      state.templateId = null;
      await fetchAll();
      return `Retired “${title}”.`;
    });
  }

  function bringBack(id) {
    return run(async () => {
      await api.setChecklistStatus(id, "retired", "published");
      await fetchAll();
      return "Brought back. Phones offer it again after their next sync.";
    });
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

  function onSubmit(event) {
    const form = event.target.closest("[data-create]");
    if (!form) return;
    event.preventDefault();
    create(form);
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
  root.addEventListener("submit", onSubmit);
  root.innerHTML = `<p class="loading">Loading the checklists…</p>`;
  load();

  /** Whether it's fine to leave: no unsaved changes, or the person agrees to lose them. */
  return (silent = false) => !isDirty() || (!silent && confirm("You have unsaved changes to the draft. Leave without saving?"));
}
