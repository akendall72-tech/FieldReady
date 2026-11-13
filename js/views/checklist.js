// The inspection forms, by kind: Guidance (one form per guidance system, picked from a dropdown),
// Precision Planting (one form), Machine (one form per equipment type, picked from a dropdown), and
// Custom (each person's own checklists).
//
// Phones use the live (newest published) version of each form. A form is editable as soon as it's
// open: the first change starts a draft of the next version, and changes save to it on their own.
// Publish to Phones sends the draft out; Discard Changes goes back to what phones have. Owners, and
// staff an owner lets edit forms and options (People & stores), change everything in the shared
// forms and publish them; other admins look at the published forms. Custom checklists belong to
// whoever made them (anyone on staff); only they see, edit, publish, and use them. The database
// enforces all of this, so this page only hides what someone can't do. Published versions never
// change; a retired checklist isn't offered for new inspections.

import * as api from "../api.js";
import { escape, attr, formatDate, notice } from "../ui.js";
import * as model from "../checklist-model.js";
import { usedOn, optionsIn } from "../options-model.js";
import { canHaveGuidance, hasPlanterTechnology } from "../equipment-model.js";
import { canEditSetup } from "../people-model.js";

/** The usual Precision Planting form, opened first. */
const PREFERRED_PLANTER = "preseason-planter";
/** How long after the last change a draft saves. */
const SAVE_DELAY = 700;

export function mountChecklist(root, { profile }) {
  const isOwner = profile.role === "owner";
  const isAdmin = profile.role === "admin";
  /** Owners, and staff an owner lets edit forms and options. */
  const isEditor = canEditSetup(profile);
  /** Other employees see only their own Custom checklists; other admins look at the shared forms too. */
  const kinds = isEditor || isAdmin ? model.KINDS : model.KINDS.filter((kind) => kind.value === "custom");
  const state = {
    /** Every version of every checklist this person can see; `rows` are the open checklist's. */
    allRows: [],
    kind: kinds[0].value,
    /** The dropdown choice on the Guidance and Machine tabs: a form key or an equipment type. */
    choice: { guidance: null, machine: null },
    /** The open checklist; null shows the Custom list, or a Guidance or Machine choice with no form. */
    templateId: null,
    showRetired: false,
    /** A new Custom checklist being named: { title, equipment, from (template id to copy, or "") }. */
    creating: null,
    /** Machine tab: the form a new one starts from ("" for blank). */
    startFrom: "",
    rows: [],
    live: null,
    draft: null,
    content: null,
    saved: "",
    options: {},
    selected: { section: 0, item: 0 },
    /** Whether a check's More options is open (it stays open from check to check). */
    moreOpen: false,
    busy: false,
    loadError: null,
    /** Owners: whether customer logins can do inspections with these forms (null until loaded). */
    customerInspections: null,
    /** The reviewer's name while Mark as Reviewed is open; null otherwise. */
    reviewing: null,
    /** The open form without its review mark, when the mark was loaded or set (model.reviewedBody). */
    reviewedBody: "",
  };
  /** Saving the draft a moment after each change. */
  const saving = { timer: null, running: null, error: null };

  const isCustom = () => state.kind === "custom";
  /** Changing, making, publishing, retiring, and discarding: editors for shared forms, anyone for their own. */
  const canManage = () => isCustom() || isEditor;
  /** A form with a live version or a draft can be edited; a retired one can't. */
  const editable = () => Boolean(state.draft || state.live);
  const canEditAll = () => editable() && canManage();
  const canEditSteps = () => editable() && canManage();
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
   * The equipment types the open form covers: the ones it names, or for Guidance the types that
   * can have guidance, for Precision Planting the planter types, and otherwise every type.
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
    const [rows, options, customerInspections] = await Promise.all([
      api.loadChecklists(), api.loadOptions(),
      isOwner ? api.loadCustomerInspections(profile.organization_id).catch(() => null) : null,
    ]);
    state.allRows = rows;
    state.options = options;
    state.customerInspections = customerInspections;
    if (isCustom() && state.templateId && !checklists("custom").some((c) => c.id === state.templateId)) state.templateId = null;
    if (!isCustom()) state.templateId = chosenTemplate();
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
      return { id, rows, live, draft, content: newest?.content, retired: !live && !draft && rows.some((row) => row.status === "retired") };
    })
      .filter((checklist) => model.kindOf(checklist.content) === kind)
      .sort((a, b) => (a.content?.title ?? a.id).localeCompare(b.content?.title ?? b.id));
  }

  /** The Form dropdown's entries on the Guidance tab. */
  const guidanceEntries = () => model.guidanceForms(state.options.guidance_system ?? [], checklists("guidance"));

  /** The Machine type dropdown's entries: types in use, plus any type that has a form. */
  function machineEntries() {
    const forms = checklists("machine");
    return equipmentTypes()
      .map((type) => ({ key: type.value, label: type.label, active: type.active, form: model.machineFormFor(type.value, forms) }))
      .filter((entry) => entry.active || entry.form);
  }

  const entries = () => (state.kind === "guidance" ? guidanceEntries() : state.kind === "machine" ? machineEntries() : []);

  /** The chosen dropdown entry (the first when nothing's chosen yet). */
  function currentEntry() {
    const all = entries();
    return all.find((entry) => entry.key === state.choice[state.kind]) ?? all[0] ?? null;
  }

  /** The checklist the current tab and dropdown choice open. */
  function chosenTemplate() {
    if (state.kind === "planter") {
      const ids = checklists("planter").filter((c) => !c.retired).map((c) => c.id);
      return ids.includes(PREFERRED_PLANTER) ? PREFERRED_PLANTER : ids[0] ?? null;
    }
    return currentEntry()?.form?.id ?? null;
  }

  /** Shows the chosen checklist's draft, or its live version. */
  function openChecklist() {
    state.rows = state.allRows.filter((row) => row.template_id === state.templateId);
    state.live = model.liveVersion(state.rows);
    state.draft = state.rows.find((row) => row.status === "draft") ?? null;
    const source = state.draft ?? state.live ?? newestRow(state.rows);
    state.content = source ? structuredClone(source.content) : null;
    state.saved = JSON.stringify(state.content);
    state.reviewedBody = state.content ? model.reviewedBody(state.content) : "";
    state.reviewing = null;
    saving.error = null;
    state.loadError = null;
    keepSelectionInRange();
  }

  const newestRow = (rows) => rows.reduce((best, row) => (!best || model.isNewer(row.version, best.version) ? row : best), null);

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
        <div class="card"><h2>Couldn't load the forms</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    const open = state.templateId && state.content;
    let body;
    if (isCustom() && !open) body = listView();
    else if (!open) body = state.kind === "planter" ? missingPlanter() : missingForm(currentEntry());
    else body = editor();
    root.innerHTML = `
      <div data-notice></div>
      ${kindTabs()}
      ${customerSwitch()}
      ${picker()}
      ${body}`;
  }

  /** Owners: the organization's switch for customer logins doing inspections in the app. */
  function customerSwitch() {
    if (!isOwner || state.customerInspections === null || isCustom()) return "";
    return `
      <div class="card customer-switch">
        <label class="check"><input type="checkbox" data-field="customer-inspections"${state.customerInspections ? " checked" : ""}>
          <strong>Customers can do inspections in the app</strong></label>
        <p class="hint">Customer logins inspect their own machines with these published forms (not Custom checklists). Their
          drafts are theirs alone; you see each one, marked as done by the customer, once they finalize it.</p>
      </div>`;
  }

  async function saveCustomerSwitch(on) {
    const before = state.customerInspections;
    state.customerInspections = on;
    try {
      await api.saveCustomerInspections(profile.organization_id, on);
      notice(root, on ? "Customers can do inspections in the app." : "Customers can't start new inspections. Ones they already started can still be finished.", "success");
    } catch (error) {
      state.customerInspections = before;
      render();
      notice(root, api.describe(error), "error");
    }
  }

  function editor() {
    return `
      ${isCustom() ? `<button class="link back" data-action="close-checklist">← Custom checklists</button>` : ""}
      <div data-toolbar>${toolbar()}</div>
      <div data-review>${reviewPanel()}</div>
      ${isCustom() ? settingsCard() : ""}
      <div data-problems>${problemsPanel()}</div>
      <div class="editor">
        <aside class="outline" aria-label="Sections and checks">${outline()}</aside>
        <section class="detail">${state.selected.item == null ? sectionForm(section()) : itemForm(item())}</section>
      </div>`;
  }

  /** Updates the save state and problems without redrawing, so typing isn't interrupted. */
  function refreshStatus() {
    const bar = root.querySelector("[data-toolbar]");
    if (bar) bar.innerHTML = toolbar();
    const review = root.querySelector("[data-review]");
    if (review && state.reviewing == null) review.innerHTML = reviewPanel();
    const problems = root.querySelector("[data-problems]");
    if (problems) problems.innerHTML = problemsPanel();
  }

  /** Where the open form stands, in a few words. */
  function saveStatus() {
    if (saving.error) return `<span class="save-error">Couldn't save: ${escape(saving.error)}</span> <button class="link" data-action="reload">Reload</button>`;
    if (saving.running || saving.timer || isDirty()) return "Saving…";
    if (state.draft) return `${state.live ? "Changes saved" : "Saved"} ${escape(formatDate(state.draft.updated_at))}${state.live ? ". Not on phones yet." : "."}`;
    if (!editable()) return "Retired: not offered for new inspections.";
    if (!canEditSteps()) return "";
    return "Changes you make save on their own as a draft. Phones keep this version until you publish.";
  }

  function toolbar() {
    const { live, draft } = state;
    const liveText = live
      ? `On phones${live.published_at ? ` since ${escape(new Date(live.published_at).toLocaleDateString(undefined, { dateStyle: "medium" }))}` : ""}.`
      : "Not on phones yet.";
    const actions = [];
    if (canManage() && (draft || isDirty())) {
      actions.push(`<button class="primary" data-action="publish"${attr("disabled", state.busy || Boolean(saving.error))}>Publish to Phones</button>`);
      actions.push(`<button class="danger" data-action="discard"${attr("disabled", state.busy)}>Discard Changes</button>`);
    } else if (isCustom() && live && canManage()) {
      actions.push(`<button class="danger" data-action="retire"${attr("disabled", state.busy)}>Retire</button>`);
    }
    const named = model.typesOf(state.content);
    const alsoFor = state.kind === "machine" && named.length > 1
      ? named.filter((type) => type !== currentEntry()?.key).map(typeLabel) : [];
    return `
      <div class="toolbar">
        <div>
          <h1>${escape(state.content.title)}</h1>
          <p class="meta">${liveText} <span data-save-status>${saveStatus()}</span></p>
        </div>
        <div class="actions">${actions.join("")}</div>
      </div>
      ${alsoFor.length ? `<p class="callout">This form is also used for ${escape(alsoFor.join(", "))}. Changes apply to all of them.</p>` : ""}
      ${!canManage() ? `<p class="callout">Only owners, and people an owner lets edit forms and options, change these forms. You can look at them here.</p>` : ""}
      ${!editable() && isCustom() && canManage() ? `<p class="callout">This checklist is retired, so it isn't offered for new inspections. Bring it back from the list.</p>` : ""}`;
  }

  /**
   * Whether someone reviewed this form, and Mark as Reviewed. Inspections and reports say a form
   * hasn't been reviewed until it's marked; any other change to it takes the mark off. Custom
   * checklists are their maker's own, so they have none.
   */
  function reviewPanel() {
    if (isCustom() || !state.content) return "";
    if (state.reviewing != null) {
      return `
        <form class="card review-form" data-review-form>
          <h2>Mark as Reviewed</h2>
          <p class="hint">Mark it once someone qualified has gone through every check and its How to Check steps against
            the manufacturer's procedures. Inspections and reports then name them; any later change to the form takes the
            mark off.</p>
          <label>Reviewed by <input name="reviewer" data-field="reviewer" value="${escape(state.reviewing)}" maxlength="80" autocomplete="off" required></label>
          <div class="actions">
            <button class="primary" type="submit">Mark as Reviewed</button>
            <button class="secondary" type="button" data-action="cancel-review">Cancel</button>
          </div>
        </form>`;
    }
    const reviewed = model.isReviewed(state.content) && !model.changedSinceReview(state.content, state.reviewedBody);
    if (reviewed) {
      return `<p class="meta review-status">✓ ${escape(model.reviewWords(state.content))}${canEditAll() ? " Any change to the form takes the mark off." : ""}</p>`;
    }
    const changed = model.isReviewed(state.content);
    return `
      <p class="callout review-status">${changed ? "Changed since its review, so it's no longer marked reviewed." : "Not reviewed."}
        Inspections and reports say this form hasn't been reviewed.
        ${canEditAll() ? `<button class="link" data-action="start-review"${attr("disabled", state.busy)}>Mark as Reviewed</button>` : ""}</p>`;
  }

  function startReview() {
    if (!canEditAll()) return;
    state.reviewing = profile.full_name ?? "";
    render();
    root.querySelector('[data-review-form] [name="reviewer"]')?.focus();
  }

  function finishReview() {
    const name = (state.reviewing ?? "").trim();
    if (!name || !canEditAll()) return;
    model.markReviewed(state.content, name);
    state.reviewedBody = model.reviewedBody(state.content);
    state.reviewing = null;
    changed({ redraw: true });
    notice(root, `Marked reviewed by ${name}. Publish to Phones to send it out.`, "success");
  }

  /** Guidance / Precision Planting / Machine / Custom. */
  function kindTabs() {
    if (kinds.length < 2) return "";
    return `
      <div class="segmented" role="group" aria-label="Kind of inspection">
        ${kinds.map((kind) => `<button class="segment${kind.value === state.kind ? " active" : ""}" data-action="switch-kind" data-kind="${kind.value}" aria-pressed="${kind.value === state.kind}">${escape(kind.label)}</button>`).join("")}
      </div>`;
  }

  /** The Form dropdown (Guidance) or Machine type dropdown (Machine). */
  function picker() {
    if (state.kind !== "guidance" && state.kind !== "machine") return "";
    const all = entries();
    if (all.length === 0) return "";
    const chosen = currentEntry();
    const label = (entry) => {
      if (state.kind === "machine") return entry.form ? entry.label : `${entry.label} (no form yet)`;
      if (entry.key === model.FACTORY && entry.covers.length) return `${entry.label} (${entry.covers.join(", ")})`;
      if (entry.key === model.OTHER_SYSTEM) return `${entry.label} (${entry.covers.join(", ")})`;
      return entry.form || entry.key === "shared" ? entry.label : `${entry.label} (uses Other)`;
    };
    return `
      <div class="form-picker">
        <label>${state.kind === "guidance" ? "Guidance system" : "Machine type"}
          <select data-field="choice">
            ${all.map((entry) => `<option value="${escape(entry.key)}"${attr("selected", entry.key === chosen?.key)}>${escape(label(entry))}</option>`).join("")}
          </select>
        </label>
        <p class="hint">${escape(model.KINDS.find((kind) => kind.value === state.kind).about)}</p>
      </div>
      ${chosen?.key === "shared" ? `<p class="callout">Your organization still has one shared Guidance checklist. Ask Prime Theory Labs to run the guidance forms update, which gives each system its own form.</p>` : ""}`;
  }

  /** A Guidance system or equipment type without a form of its own. */
  function missingForm(entry) {
    if (!entry) {
      return `<div class="card"><h2>No ${state.kind === "guidance" ? "Guidance forms" : "equipment types"} yet</h2>
        <p>Ask Prime Theory Labs to load your organization's default forms.</p></div>`;
    }
    if (state.kind === "guidance") {
      const other = guidanceEntries().find((e) => e.key === model.OTHER_SYSTEM)?.form;
      return `
        <div class="card">
          <h2>${escape(entry.label)} uses the Other form</h2>
          <p>Machines with ${escape(entry.label)} guidance get the <strong>Other</strong> form until ${escape(entry.label)} has its own.</p>
          ${isEditor && other ? `<button class="primary" data-action="create-guidance"${attr("disabled", state.busy)}>Create a Form for ${escape(entry.label)}</button>
            <p class="hint">It starts as a copy of the Other form. Publish it to phones when it's ready.</p>` : ""}
        </div>`;
    }
    const forms = checklists("machine").filter((form) => !form.retired);
    return `
      <div class="card">
        <h2>No form for ${escape(entry.label)} yet</h2>
        <p>Machines of this type have no Machine inspection until it has a form.</p>
        ${isEditor ? `
          <div class="grid2">
            <label>Start from
              <select data-field="start-from">
                <option value="">A blank form</option>
                ${forms.map((form) => `<option value="${escape(form.id)}"${attr("selected", state.startFrom === form.id)}>A copy of ${escape(form.content?.title ?? form.id)}</option>`).join("")}
              </select>
            </label>
          </div>
          <button class="primary" data-action="create-machine"${attr("disabled", state.busy)}>Create Form</button>` : ""}
      </div>`;
  }

  function missingPlanter() {
    return `<div class="card"><h2>No Precision Planting form yet</h2>
      <p>Ask Prime Theory Labs to load your organization's default forms.</p></div>`;
  }

  /** Your Custom checklists, with New and Bring Back. */
  function listView() {
    const all = checklists("custom");
    const current = all.filter((c) => !c.retired);
    const retired = all.filter((c) => c.retired);
    return `
      <div class="toolbar">
        <div>
          <h1>Custom checklists</h1>
          <p class="meta">${escape(model.KINDS.find((kind) => kind.value === "custom").about)}</p>
        </div>
        <div class="actions"><button class="primary" data-action="new-checklist"${attr("disabled", state.busy || state.creating)}>New Checklist</button></div>
      </div>
      ${state.creating ? createForm() : ""}
      <div class="card">
        ${current.length ? `<ol class="checklist-list">${current.map(checklistRow).join("")}</ol>` : '<p class="hint">You haven\'t made any custom checklists yet. New Checklist starts one, blank or as a copy of a form.</p>'}
        ${retired.length ? `
          <label class="check"><input type="checkbox" data-field="show-retired"${attr("checked", state.showRetired)}> Show retired (${retired.length})</label>
          ${state.showRetired ? `<ol class="checklist-list">${retired.map(checklistRow).join("")}</ol>` : ""}` : ""}
      </div>`;
  }

  function checklistRow(checklist) {
    const named = model.typesOf(checklist.content);
    const status = [
      checklist.retired ? "Retired" : checklist.live ? "On phones" : "Not published yet",
      checklist.draft && checklist.live ? "Unpublished changes" : "",
      named.length ? named.map(typeLabel).join(", ") : "Any machine",
    ].filter(Boolean);
    const id = escape(checklist.id);
    return `
      <li class="checklist-row${checklist.retired ? " retired" : ""}">
        <button class="checklist-open" data-action="open-checklist" data-id="${id}">
          <strong>${escape(checklist.content?.title || checklist.id)}</strong>
          <span class="hint">${status.map(escape).join(" · ")}</span>
        </button>
        <span class="tools">
          ${checklist.retired ? `<button class="link" data-action="bring-back" data-id="${id}"${attr("disabled", state.busy)}>Bring Back</button>` : ""}
        </span>
      </li>`;
  }

  /** Forms a new Custom checklist can start from: your own, and the shared forms you can see. */
  function startingPoints() {
    return ["custom", "guidance", "planter", "machine"]
      .flatMap((kind) => (kinds.some((k) => k.value === kind) ? checklists(kind) : []))
      .filter((form) => !form.retired && form.content?.sections);
  }

  /** Naming a new Custom checklist, where it starts from, and its equipment types. */
  function createForm() {
    const creating = state.creating;
    return `
      <form class="card" data-create>
        <h2>New Custom checklist</h2>
        <label>Name <input name="title" value="${escape(creating.title)}" autocomplete="off" placeholder="e.g. Hitch check"></label>
        <label>Start from
          <select data-field="create-from">
            <option value="">A blank checklist</option>
            ${startingPoints().map((form) => `<option value="${escape(form.id)}"${attr("selected", creating.from === form.id)}>A copy of ${escape(form.content?.title ?? form.id)}</option>`).join("")}
          </select>
        </label>
        <div class="choices">
          <span class="choices-title">Equipment types (none checked: any machine)</span>
          ${equipmentTypes().filter((type) => type.active).map((type) => `
            <label class="check"><input type="checkbox" data-create-type="${escape(type.value)}"${attr("checked", creating.equipment.includes(type.value))}> ${escape(type.label)}</label>`).join("")}
        </div>
        <p class="hint">Only you see it and use it in the app.</p>
        <p class="form-error" data-create-problem></p>
        <div class="actions">
          <button class="primary" type="submit"${attr("disabled", state.busy)}>Create Checklist</button>
          <button class="secondary" type="button" data-action="cancel-create">Cancel</button>
        </div>
      </form>`;
  }

  /** Custom checklists: their name and equipment types. */
  function settingsCard() {
    const all = canEditAll();
    const named = new Set(model.typesOf(state.content));
    return `
      <div class="card">
        <h2>Checklist</h2>
        <label>Name <input data-field="checklist.title" value="${escape(state.content.title)}"${disabledUnless(all)}></label>
        <div class="choices">
          <span class="choices-title">Equipment types (none checked: any machine)</span>
          ${equipmentTypes().filter((type) => type.active || named.has(type.value)).map((type) => `
            <label class="check"><input type="checkbox" data-field="checklist.equipment" data-value="${escape(type.value)}"${attr("checked", named.has(type.value))}${disabledUnless(all)}> ${escape(type.label)}</label>`).join("")}
        </div>
      </div>`;
  }

  function problemsPanel() {
    if (!state.draft && !isDirty()) return "";
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
    const checks = sec.items?.length ?? 0;
    return `
      <div class="card">
        <div class="detail-head">
          <h2>Section</h2>
          ${all ? moveTools("section", state.selected.section, count, '<button class="danger" data-action="delete-section">Remove Section</button>') : ""}
        </div>
        <label>Title <input data-field="section.title" value="${escape(sec.title)}"${disabledUnless(all)}></label>
        <label>Summary <textarea data-field="section.summary" rows="2"${disabledUnless(all)}>${escape(sec.summary)}</textarea></label>
        <p class="hint">${checks} ${checks === 1 ? "check" : "checks"}.</p>
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
    if (options.length === 0) return "";
    return `
      <div class="choices">
        <span class="choices-title">${escape(title)}</span>
        ${options.map((option) => `
          <label class="check"><input type="checkbox" data-field="${field}" data-value="${escape(option.value)}"${attr("checked", chosen.has(option.value))}${disabledUnless(canEditAll())}> ${escape(option.label)}${option.active ? "" : " <small>(hidden)</small>"}</label>`).join("")}
      </div>`;
  }

  /** What's set under More options, for its summary line. */
  function extrasSet(check) {
    const applies = check.appliesTo ?? {};
    const set = [];
    if (check.safety) set.push("safety note");
    if (check.record?.length) set.push(`${check.record.length} ${check.record.length === 1 ? "field" : "fields"} to record`);
    if (applies.features || applies.corrections || applies.requiresAutoSteer || applies.answers || applies.equipment) set.push("only on some machines");
    if (check.panel === "subscriptions") set.push("shows subscriptions");
    return set;
  }

  function itemForm(check) {
    if (!check) return `<div class="card"><p>This section has no checks yet.</p></div>`;
    const all = canEditAll();
    const steps = canEditSteps();
    const count = section().items.length;
    const extras = extrasSet(check);
    return `
      <div class="card">
        <div class="detail-head">
          <h2 data-detail-title>${escape(check.title || "Untitled check")}</h2>
          ${all ? moveTools("item", state.selected.item, count, '<button class="danger" data-action="delete-item">Remove Check</button>') : ""}
        </div>

        <label>Title <input data-field="item.title" value="${escape(check.title)}"${disabledUnless(all)}></label>

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
        <div class="grid2">
          <label>Photo
            <select data-field="item.evidence"${disabledUnless(all)}>
              ${model.EVIDENCE.map((e) => `<option value="${e.value}"${attr("selected", (check.evidence ?? "") === e.value)}>${escape(e.label)}</option>`).join("")}
            </select>
          </label>
          <label class="check required-check"><input type="checkbox" data-field="item.required"${attr("checked", check.required)}${disabledUnless(all)}> Required: must be recorded to finish</label>
        </div>

        <details class="more-options" data-more${attr("open", state.moreOpen)}>
          <summary>More options${extras.length ? ` <span class="hint">(${escape(extras.join(", "))})</span>` : ""}</summary>
          ${moreOptions(check)}
        </details>
      </div>`;
  }

  /** The settings most checks never need. */
  function moreOptions(check) {
    const all = canEditAll();
    const applies = check.appliesTo ?? {};
    const record = check.record ?? [];
    const featureTitle = state.kind === "planter" ? "Only when one of these products is installed" : "Only when one of these features is installed";
    const appliesGroups = [
      state.kind === "guidance" || state.kind === "planter" || applies.features ? choices("feature", "applies.features", applies.features, featureTitle) : "",
      state.kind === "guidance" || applies.corrections ? choices("correction_type", "applies.corrections", applies.corrections, "Only these correction types (unknown keeps the check)") : "",
      state.kind === "guidance" || applies.requiresAutoSteer ? `<label class="check"><input type="checkbox" data-field="applies.requiresAutoSteer"${attr("checked", applies.requiresAutoSteer === true)}${disabledUnless(all)}> Only machines with auto-steer</label>` : "",
      isCustom() && (types().length > 1 || applies.equipment) ? choices("equipment_type", "applies.equipment", applies.equipment, "Only these equipment types") : "",
      answerGroups(applies),
    ].filter(Boolean).join("");
    return `
      <label>Why it matters <textarea data-field="item.purpose" rows="3"${disabledUnless(all)}>${escape(check.purpose)}</textarea></label>
      <label>Safety note <textarea data-field="item.safety" rows="2"${disabledUnless(all)}>${escape(check.safety ?? "")}</textarea></label>
      <div class="grid2">
        <label>Machine condition
          <select data-field="item.condition"${disabledUnless(all)}>
            ${model.CONDITIONS.map((c) => `<option value="${c.value}"${attr("selected", check.condition === c.value)}>${escape(c.label)}</option>`).join("")}
          </select>
        </label>
      </div>
      ${state.kind === "guidance" || check.panel ? `<label class="check"><input type="checkbox" data-field="item.panel"${attr("checked", check.panel === "subscriptions")}${disabledUnless(all)}> Show the machine's correction subscriptions in this check</label>` : ""}

      ${appliesGroups ? `
        <fieldset>
          <legend>When it applies</legend>
          <p class="hint">Leave these empty to include the check on every machine that uses this form.</p>
          ${appliesGroups}
        </fieldset>` : ""}

      <fieldset>
        <legend>Fields to record</legend>
        ${record.length === 0 ? '<p class="hint">None. Add one for anything the technician should write down.</p>' : ""}
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
      </fieldset>`;
  }

  /** One group per question the covered types are asked: the check applies only to the answers ticked. */
  function answerGroups(applies) {
    if (state.kind === "guidance" || state.kind === "planter") {
      if (!applies.answers) return "";
    }
    const covered = types();
    const chosen = applies.answers ?? {};
    const questions = (state.options.machine_question ?? [])
      .filter((question) => (question.active && usedOn(question).some((type) => covered.includes(type))) || chosen[question.value]);
    if (!questions.length) return "";
    return questions.map((question) => {
      const picked = new Set(chosen[question.value] ?? []);
      const answers = optionsIn(optionRows(), "machine_answer", question.value).filter((answer) => answer.active || picked.has(answer.value));
      if (!answers.length) return "";
      return `
        <div class="choices">
          <span class="choices-title">${escape(question.label)}: only these answers (unanswered machines keep the check)</span>
          ${answers.map((answer) => `
            <label class="check"><input type="checkbox" data-field="applies.answers" data-question="${escape(question.value)}" data-value="${escape(answer.value)}"${attr("checked", picked.has(answer.value))}${disabledUnless(canEditAll())}> ${escape(answer.label)}</label>`).join("")}
        </div>`;
    }).join("");
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

  /** After a change to the form: show it, and save it shortly. */
  function changed({ redraw = false } = {}) {
    scheduleSave();
    if (redraw) render();
    else refreshStatus();
  }

  async function onInput(event) {
    const target = event.target;
    if (target.dataset.createType && state.creating) {
      // Checkboxes send both input and change, so set rather than toggle.
      const type = target.dataset.createType;
      const others = state.creating.equipment.filter((value) => value !== type);
      state.creating.equipment = target.checked ? [...others, type] : others;
      return;
    }
    if (target.name === "title" && target.closest("[data-create]") && state.creating) {
      state.creating.title = target.value;
      return;
    }
    switch (target.dataset.field) {
      case "reviewer":
        state.reviewing = target.value;
        return;
      case "customer-inspections":
        if (event.type === "change") await saveCustomerSwitch(target.checked);
        return;
      case "show-retired":
        state.showRetired = target.checked;
        return render();
      case "choice":
        if (event.type === "change") await choose(target.value);
        return;
      case "start-from":
        state.startFrom = target.value;
        return;
      case "create-from":
        if (state.creating) state.creating.from = target.value;
        return;
    }
    const element = target.closest("[data-field]");
    if (!element || !state.content || !editable()) return;
    const field = element.dataset.field;
    const index = Number(element.dataset.index);
    const value = element.type === "checkbox" ? element.checked : element.value;
    const sec = section();
    const check = item();
    if (field === "step") {
      if (!canEditSteps() || !check || check.steps[index] === value) return;
      check.steps[index] = value;
      return changed();
    }
    if (!canEditAll()) return;
    switch (field) {
      case "checklist.title":
        state.content.title = value;
        break;
      case "checklist.equipment": {
        const order = equipmentTypes().map((type) => type.value);
        const named = new Set(model.typesOf(state.content));
        if (value) named.add(element.dataset.value);
        else named.delete(element.dataset.value);
        if (named.size) state.content.equipment = [...named].sort((a, b) => order.indexOf(a) - order.indexOf(b));
        else delete state.content.equipment;
        return changed({ redraw: true });
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
        if (check.required === value) return;
        check.required = value;
        return changed({ redraw: true });
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
        return changed({ redraw: true });
      case "record.optionalOnPass": setOptional(check.record[index], "optionalOnPass", value); break;
      default: return;
    }
    // Checkboxes send both input and change; only save when something changed.
    if (isDirty()) changed();
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
        state.creating = { title: "", equipment: [], from: "" };
        render();
        root.querySelector('[data-create] [name="title"]')?.focus();
        return;
      case "cancel-create":
        state.creating = null;
        return render();
      case "create-guidance": return createGuidanceForm();
      case "create-machine": return createMachineForm();
      case "bring-back": return bringBack(element.dataset.id);
      case "retire": return retire();
      case "select-section": return select(s, null);
      case "select-item": return select(s, i);
      case "publish": return publish();
      case "discard": return discard();
      case "start-review": return startReview();
      case "cancel-review":
        state.reviewing = null;
        return render();
    }

    if (action.startsWith("step") || action.endsWith("-step")) {
      if (!canEditSteps() || !check) return;
      if (action === "add-step") check.steps.push("");
      if (action === "remove-step") check.steps.splice(index, 1);
      if (action === "step-up") model.move(check.steps, index, -1);
      if (action === "step-down") model.move(check.steps, index, 1);
      changed({ redraw: true });
      if (action === "add-step") root.querySelectorAll('[data-field="step"]').item(check.steps.length - 1)?.focus();
      return;
    }

    if (!canEditAll()) return;
    switch (action) {
      case "add-section": {
        sections.push(model.newSection(state.content));
        scheduleSave();
        return select(sections.length - 1, null);
      }
      case "add-check": {
        const target = sections[s];
        target.items.push(model.newCheck(state.content, target));
        scheduleSave();
        return select(s, target.items.length - 1);
      }
      case "section-up":
      case "section-down": {
        const moved = model.move(sections, state.selected.section, action === "section-up" ? -1 : 1);
        scheduleSave();
        return select(moved, null);
      }
      case "item-up":
      case "item-down": {
        const moved = model.move(sec.items, state.selected.item, action === "item-up" ? -1 : 1);
        scheduleSave();
        return select(state.selected.section, moved);
      }
      case "delete-item": {
        if (!confirm(`Remove “${check.title}”?\n\nWhen this is published, draft inspections lose this check when they're opened, including any answer recorded for it. Finalized inspections keep it.`)) return;
        sec.items.splice(state.selected.item, 1);
        state.selected.item = sec.items.length ? Math.min(state.selected.item, sec.items.length - 1) : null;
        return changed({ redraw: true });
      }
      case "delete-section": {
        const n = sec.items.length;
        if (!confirm(`Remove the section “${sec.title}”${n ? ` and its ${n} check(s)` : ""}?\n\nWhen this is published, draft inspections lose these checks when they're opened.`)) return;
        sections.splice(state.selected.section, 1);
        state.selected = { section: Math.max(0, state.selected.section - 1), item: null };
        keepSelectionInRange();
        return changed({ redraw: true });
      }
      case "add-field": {
        check.record = check.record ?? [];
        const taken = new Set(check.record.map((f) => f.key));
        check.record.push({ key: model.uniqueKey("New field", taken), label: "New field" });
        return changed({ redraw: true });
      }
      case "remove-field": {
        check.record.splice(index, 1);
        if (check.record.length === 0) delete check.record;
        return changed({ redraw: true });
      }
    }
  }

  /** Saves what's waiting, then whether it's fine to move on (a failed save asks first). */
  async function settle() {
    await flush();
    return !isDirty() || confirm("Your latest changes couldn't be saved. Leave without them?");
  }

  async function switchKind(kind) {
    if (kind === state.kind || !(await settle())) return;
    state.kind = kind;
    state.creating = null;
    state.templateId = isCustom() ? null : chosenTemplate();
    state.selected = { section: 0, item: 0 };
    openChecklist();
    render();
  }

  /** A different choice in the Form or Machine type dropdown. */
  async function choose(key) {
    if (!(await settle())) {
      render();
      return;
    }
    state.choice[state.kind] = key;
    state.templateId = chosenTemplate();
    state.selected = { section: 0, item: 0 };
    state.startFrom = "";
    openChecklist();
    render();
  }

  function openFromList(id) {
    state.templateId = id;
    state.selected = { section: 0, item: 0 };
    openChecklist();
    render();
  }

  async function closeChecklist() {
    if (!(await settle())) return;
    state.templateId = null;
    openChecklist();
    render();
  }

  /** Creates a new Custom checklist (blank, or a copy of a form) as a draft and opens it. */
  function create() {
    const creating = state.creating;
    const title = String(creating?.title ?? "").trim();
    if (!title) {
      root.querySelector("[data-create-problem]").textContent = "Give the checklist a name.";
      return;
    }
    const taken = new Set(state.allRows.map((row) => row.template_id));
    const suffix = crypto.randomUUID().slice(0, 4);
    const source = creating.from ? startingPoints().find((form) => form.id === creating.from) : null;
    const content = source
      ? model.copyChecklist(source.content, { title, kind: "custom", taken, suffix })
      : model.newChecklist({ kind: "custom", title, taken, suffix });
    delete content.system;
    if (creating.equipment.length) content.equipment = [...creating.equipment];
    else delete content.equipment;
    return run(async () => {
      await api.createChecklist(profile.organization_id, content);
      state.creating = null;
      state.templateId = content.id;
      state.selected = { section: 0, item: 0 };
      await fetchAll();
      return `Started “${title}”. Fill in its checks, then publish it.`;
    });
  }

  /** A guidance system's own form, as a copy of the Other form. */
  function createGuidanceForm() {
    const entry = currentEntry();
    const other = guidanceEntries().find((e) => e.key === model.OTHER_SYSTEM)?.form;
    if (!entry || !other) return;
    const title = `${entry.label} guidance inspection`;
    const taken = new Set(state.allRows.map((row) => row.template_id));
    const content = model.guidanceFormFrom(other.content, { system: entry.key, title, taken });
    return run(async () => {
      await api.createChecklist(profile.organization_id, content);
      await fetchAll();
      return `Created the ${entry.label} form as a copy of Other. Change what you need, then Publish to Phones.`;
    });
  }

  /** A Machine form for the chosen type: blank, or a copy of another type's form. */
  function createMachineForm() {
    const entry = currentEntry();
    if (!entry) return;
    const source = state.startFrom ? checklists("machine").find((form) => form.id === state.startFrom)?.content : null;
    const title = `${entry.label} machine inspection`;
    const taken = new Set(state.allRows.map((row) => row.template_id));
    const content = model.machineFormFrom(source, { type: entry.key, title, taken });
    return run(async () => {
      await api.createChecklist(profile.organization_id, content);
      state.startFrom = "";
      await fetchAll();
      return `Created the ${entry.label} form. Fill in its checks, then Publish to Phones.`;
    });
  }

  function retire() {
    const title = state.content.title;
    if (!confirm(`Retire “${title}”?\n\nYour phone stops offering it for new inspections at its next sync. Inspections already started or finished with it keep it. You can bring it back from the list.`)) return;
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
      return "Brought back. Your phone offers it again after its next sync.";
    });
  }

  // ---------------------------------------------------------------- saving and publishing

  /** Saves the draft a moment after the last change. */
  function scheduleSave() {
    clearTimeout(saving.timer);
    saving.timer = setTimeout(() => { saveNow(); }, SAVE_DELAY);
  }

  /**
   * Saves the open form's changes: the first change starts a draft of the next version (a copy of
   * the live one with the change), later ones update it. One save at a time; changes made while
   * one runs are saved after it.
   */
  function saveNow() {
    clearTimeout(saving.timer);
    saving.timer = null;
    if (saving.running) return saving.running;
    if (!isDirty() || saving.error || !editable()) return Promise.resolve();
    if (model.changedSinceReview(state.content, state.reviewedBody)) {
      model.clearReview(state.content);
      state.reviewedBody = model.reviewedBody(state.content);
    }
    const templateId = state.templateId;
    const { draft, live } = state;
    const content = structuredClone(state.content);
    saving.running = (async () => {
      try {
        if (!draft) content.version = model.nextVersion(live.version);
        const row = draft ? await api.saveDraft(draft, content) : await api.createDraft(live, content.version, content);
        // Keep the page's copy of the rows current, so switching away and back shows the draft.
        state.allRows = [...state.allRows.filter((r) => r.id !== row.id), row];
        if (state.templateId === templateId) {
          state.draft = row;
          state.content.version = content.version;
          state.saved = JSON.stringify(content);
        }
      } catch (error) {
        if (state.templateId === templateId) {
          saving.error = error instanceof api.SaveConflict
            ? `${error.message} Reload to see the latest version (copy anything you need first).`
            : api.describe(error);
        }
      }
      saving.running = null;
      if (state.templateId !== templateId) return;
      if (isDirty() && !saving.error) scheduleSave();
      refreshStatus();
    })();
    refreshStatus();
    return saving.running;
  }

  /** Saves anything waiting, including changes made during a save already running. */
  async function flush() {
    while (saving.running || (saving.timer != null) || (isDirty() && !saving.error && editable())) {
      if (saving.running) await saving.running;
      else await saveNow();
      if (saving.error) return;
    }
  }

  /** Runs one server action with the buttons held, then redraws and shows what happened. */
  async function run(work) {
    if (state.busy) return;
    state.busy = true;
    root.querySelectorAll(".toolbar button, .card > button").forEach((button) => { button.disabled = true; });
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
    if (event.target.closest("[data-review-form]")) {
      event.preventDefault();
      return finishReview();
    }
    const form = event.target.closest("[data-create]");
    if (!form) return;
    event.preventDefault();
    create();
  }

  async function publish() {
    await flush();
    if (saving.error) {
      notice(root, "Your changes couldn't be saved, so they can't be published yet.", "error");
      return;
    }
    const found = model.problems(state.content, known());
    if (found.length) {
      notice(root, "Fix the problems listed before publishing.", "error");
      return;
    }
    if (!state.draft) return;
    const review = isCustom() ? ""
      : model.isReviewed(state.content) ? `\n\n${model.reviewWords(state.content)}`
      : "\n\nIt isn't marked reviewed, so inspections and reports will say it hasn't been reviewed.";
    if (!confirm(`Publish “${state.content.title}” to phones?\n\nPhones pick it up at their next sync, and draft inspections switch to it when they're opened. Finalized inspections keep the version they were signed with.${review}`)) return;
    return run(async () => {
      await api.publishDraft(state.draft);
      await fetchAll();
      return "Published. Phones pick it up at their next sync.";
    });
  }

  async function discard() {
    if (!confirm("Discard your changes? Phones keep the version they have.")) return;
    clearTimeout(saving.timer);
    saving.timer = null;
    if (saving.running) await saving.running;
    return run(async () => {
      if (state.draft) await api.discardDraft(state.draft);
      await fetchAll();
      return "Changes discarded.";
    });
  }

  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  // More options stays open (or closed) from check to check. toggle doesn't bubble, so listen on the way down.
  root.addEventListener("toggle", (event) => {
    if (event.target.matches?.("[data-more]")) state.moreOpen = event.target.open;
  }, true);
  root.innerHTML = `<p class="loading">Loading the forms…</p>`;
  load();

  /** Whether it's fine to leave: everything saved, or the person agrees to lose what isn't. */
  return (silent = false) => {
    if (!isDirty() && !saving.running) return true;
    saveNow();
    return !silent && confirm("Your latest changes are still saving. Leave anyway?");
  };
}
