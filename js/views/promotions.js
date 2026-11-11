// Promotions: offers for customers whose machines meet conditions, and the leads they bring.
// Owners and promotions managers (staff an owner gave the permission) write, publish, and stop
// offers; everyone on staff sees them and works leads (other staff only their store's). A published
// offer can't be changed, only stopped or copied. The database decides who an offer reaches when
// customers open the app (my_offers), so the count here is who it would reach today.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import { choices } from "../equipment-model.js";
import * as model from "../promotions-model.js";

const today = () => new Date().toLocaleDateString("en-CA");
/** See who lists at most this many machines; the count above it is always the whole. */
const WHO_LIMIT = 500;

export function mountPromotions(root, { profile }) {
  const canManage = profile.role === "owner" || profile.can_manage_promotions === true;
  const state = {
    tab: "offers",
    offers: [],
    /** Each offer's counts (offer_results). */
    results: [],
    leads: [],
    stores: [],
    options: [],
    /** Customers to choose from and to name in conditions (offer_customers). */
    customers: [],
    /** What's typed in each customer condition's search box, by condition. */
    customerQuery: {},
    /** The offer open in the editor or viewer ("new" while adding one), and its working copy. */
    open: null,
    draft: null,
    saved: "",
    /** summary: { customers, machines } today; rows: the first machines, loaded for See who. */
    audience: { summary: null, rows: null, loading: false, error: null, showWho: false },
    leadFilter: "open",
    busy: false,
    loadError: null,
  };
  let audienceTimer = null;

  async function load() {
    try {
      const [offers, results, leads, stores, options, customers] = await Promise.all([
        api.loadPromotions(), api.loadOfferResults(), api.loadLeads(), api.loadStores(), api.loadOptionRows(),
        // Offers still open without it (until the database has offer_customers, chosen customers aren't named).
        api.offerCustomers().catch(() => []),
      ]);
      Object.assign(state, { offers, results, leads, stores: stores.filter((s) => s.active), options, customers, loadError: null });
    } catch (error) {
      state.loadError = api.describe(error);
    }
    render();
  }

  const isDraft = () => !state.draft?.id || state.draft.status === "draft";
  const editable = () => canManage && isDraft();
  const isDirty = () => state.draft && JSON.stringify(state.draft) !== state.saved;

  // ---------------------------------------------------------------- rendering

  function render() {
    if (state.loadError) {
      root.innerHTML = `<div data-notice></div><div class="card"><h2>Couldn't load promotions</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    const newLeads = state.leads.filter((lead) => (lead.lead_status ?? "new") === "new").length;
    root.innerHTML = `
      <div data-notice></div>
      <div class="toolbar">
        <div>
          <h1>Promotions</h1>
          <p class="meta">Offers for customers whose machines fit them. Customers see them in the app and tap I'm interested; you get the lead.</p>
        </div>
        ${canManage && state.tab === "offers" && !state.draft ? '<button class="primary" data-action="new">New Offer</button>' : ""}
      </div>
      <div class="segmented" role="group" aria-label="Show">
        <button class="segment${state.tab === "offers" ? " active" : ""}" data-tab="offers">Offers</button>
        <button class="segment${state.tab === "leads" ? " active" : ""}" data-tab="leads">Leads${newLeads ? ` (${newLeads} new)` : ""}</button>
      </div>
      ${state.tab === "leads" ? leadsView() : state.draft ? editor() : offerList()}`;
  }

  function offerList() {
    if (!state.offers.length) {
      return `<div class="card"><p class="meta">No offers yet.${canManage ? " Tap New Offer to write one." : " Owners and promotions managers write them."}</p></div>`;
    }
    const groups = [["running", "Running"], ["scheduled", "Starting later"], ["draft", "Drafts"], ["ended", "Ended or stopped"]];
    return groups.map(([key, heading]) => {
      const offers = state.offers.filter((offer) => model.offerState(offer, today()).key === key);
      if (!offers.length) return "";
      return `<div class="card"><h2>${heading}</h2><ul class="offer-list">${offers.map(offerRow).join("")}</ul></div>`;
    }).join("");
  }

  function offerRow(offer) {
    const r = model.resultsFor(state.results, offer.id);
    const status = model.offerState(offer, today());
    const conditions = offer.rules.length ? offer.rules.map((c) => model.describeCondition(c, state.options, state.customers)).join(" · ") : "Every customer machine";
    return `
      <li>
        <button class="list-row" data-action="open" data-id="${escape(offer.id)}">
          <span><strong>${escape(offer.title)}</strong>${offer.deal ? ` · ${escape(offer.deal)}` : ""} <span class="tag">${escape(status.label)}</span></span>
          <span class="meta">${escape(offer.starts_on)} to ${escape(offer.ends_on)} · ${escape(model.storesWords(offer, state.stores))}</span>
          <span class="meta">${escape(conditions)}</span>
          ${offer.status === "draft" ? "" : `<span class="meta">${r.seen} saw it · ${r.interested} interested · ${r.notNow} not now · ${r.sold} sold</span>`}
        </button>
      </li>`;
  }

  function editor() {
    const d = state.draft;
    const can = editable();
    const off = attr("disabled", !can || state.busy);
    const r = d.id ? model.resultsFor(state.results, d.id) : null;
    const status = d.id ? model.offerState(d, today()) : { label: "New" };
    return `
      <button class="link back" data-action="close">← Offers</button>
      <div class="card">
        <h2>${escape(d.title || "New offer")} <span class="tag">${escape(status.label)}</span></h2>
        ${!can && canManage ? '<p class="callout">Published offers can\'t be changed. Stop it, or make a copy to change it.</p>' : ""}
        ${r ? `<p class="meta">${r.seen} saw it · ${r.interested} interested · ${r.notNow} not now · ${r.sold} sold</p>` : ""}
        <div class="grid2">
          <label>Title <input data-offer="title" maxlength="80" value="${escape(d.title)}" placeholder="Renew your RTX early"${off}></label>
          <label>The deal <input data-offer="deal" maxlength="80" value="${escape(d.deal)}" placeholder="10% off a year"${off}></label>
          <label>Starts <input type="date" data-offer="starts_on" value="${escape(d.starts_on)}"${off}></label>
          <label>Ends <input type="date" data-offer="ends_on" value="${escape(d.ends_on)}"${off}></label>
          <label>Code (optional) <input data-offer="code" maxlength="40" value="${escape(d.code)}"${off}></label>
        </div>
        <label>Description <textarea data-offer="description" rows="3" maxlength="600" placeholder="What the customer gets, and anything they should know."${off}>${escape(d.description)}</textarea></label>
        <h3>Stores</h3>
        <div class="field-flags">
          <label class="check"><input type="checkbox" data-store="all"${attr("checked", !d.store_ids.length)}${off}> Every store</label>
          ${state.stores.map((s) => `<label class="check"><input type="checkbox" data-store="${escape(s.id)}"${attr("checked", d.store_ids.includes(s.id))}${off}> ${escape(s.name)}</label>`).join("")}
        </div>
        <h3>Who sees it</h3>
        <p class="hint">Customers whose machines meet every condition. No conditions: every customer machine.</p>
        <ol class="condition-list">${d.rules.map((c, i) => conditionRow(c, i, can)).join("")}</ol>
        ${can ? '<button class="secondary" data-action="add-condition">+ Add condition</button>' : ""}
        ${audienceBlock()}
        <p class="form-error" data-problems></p>
        <div class="actions">${actions()}</div>
      </div>`;
  }

  function conditionRow(condition, index, can) {
    const off = attr("disabled", !can || state.busy);
    const info = model.conditionInfo(condition.field);
    return `
      <li class="condition">
        <select data-cond="${index}" data-part="field"${off}>
          ${model.CONDITIONS.map((c) => `<option value="${c.field}"${attr("selected", c.field === condition.field)}>${escape(c.label)}</option>`).join("")}
        </select>
        <select data-cond="${index}" data-part="op"${off}>
          ${info.ops.map((o) => `<option value="${o.op}"${attr("selected", o.op === condition.op)}>${escape(o.label)}</option>`).join("")}
        </select>
        ${valueControl(condition, index, off)}
        ${can ? `<button class="link" data-action="remove-condition" data-index="${index}">Remove</button>` : ""}
        <p class="hint condition-words">${escape(model.describeCondition(condition, state.options, state.customers))}</p>
      </li>`;
  }

  function valueControl(condition, index, off) {
    const kind = model.valueKind(condition);
    const v = condition.value;
    switch (kind.type) {
      case "customers": {
        const chosen = Array.isArray(v) ? v : [];
        return `<div class="customer-picker">
          ${chosen.length ? `<span class="chips">${chosen.map((id) => {
            const name = model.customerName(state.customers, id) ?? "Another customer";
            return `<span class="chip">${escape(name)}${off ? "" : ` <button class="link" data-action="unpick-customer" data-index="${index}" data-id="${escape(id)}" aria-label="Remove ${escape(name)}">✕</button>`}</span>`;
          }).join("")}</span>` : ""}
          ${off ? "" : `<input type="search" data-cond="${index}" data-part="customer-search" placeholder="Find a customer by name" value="${escape(state.customerQuery[index] ?? "")}" aria-label="Find a customer">
          <ul class="customer-results" data-results="${index}">${customerResults(index, chosen)}</ul>`}
        </div>`;
      }
      case "list":
        return `<span class="condition-choices">${choices(state.options, kind.list).map((o) => `
          <label class="check"><input type="checkbox" data-cond="${index}" data-part="pick" value="${escape(o.value)}"${attr("checked", (v ?? []).includes(o.value))}${off}> ${escape(o.label)}</label>`).join("")}</span>`;
      case "one":
        return `<select data-cond="${index}" data-part="value"${off}><option value="">Choose…</option>
          ${choices(state.options, kind.list).map((o) => `<option value="${escape(o.value)}"${attr("selected", o.value === v)}>${escape(o.label)}</option>`).join("")}</select>`;
      case "text":
        return `<input data-cond="${index}" data-part="value" value="${escape(v ?? "")}" placeholder="${escape(kind.placeholder ?? "")}"${off}>`;
      case "range":
        return `<input class="year" data-cond="${index}" data-part="from" inputmode="numeric" placeholder="From" value="${escape(v?.from ?? "")}"${off}>
          <input class="year" data-cond="${index}" data-part="to" inputmode="numeric" placeholder="To" value="${escape(v?.to ?? "")}"${off}>`;
      case "number":
        return `<input class="year" data-cond="${index}" data-part="number" inputmode="numeric" value="${escape(v ?? "")}"${off}> ${escape(kind.unit)}`;
      case "component":
        return `<select data-cond="${index}" data-part="kind"${off}>
          ${choices(state.options, kind.list).map((o) => `<option value="${escape(o.value)}"${attr("selected", o.value === v?.kind)}>${escape(o.label)}</option>`).join("")}</select>
          <input data-cond="${index}" data-part="model" value="${escape(v?.model ?? "")}" placeholder="Model contains (optional)"${off}>`;
      default:
        return "";
    }
  }

  /** Matches for what's typed in a customer condition's search box. */
  function customerResults(index, chosen) {
    const query = String(state.customerQuery[index] ?? "").trim();
    if (!query) return "";
    const found = model.findCustomers(state.customers, query, chosen);
    if (!found.length) return `<li class="meta">No customer with a machine matches “${escape(query)}”.</li>`;
    return found.map((c) => `<li><button class="link" data-action="pick-customer" data-index="${index}" data-id="${escape(c.id)}">${escape(c.name)}</button>${c.store_name ? ` <span class="meta">${escape(c.store_name)}</span>` : ""}</li>`).join("");
  }

  function audienceBlock() {
    if (!canManage) return "";
    const a = state.audience;
    const words = a.error ? escape(a.error) : a.summary ? escape(model.audienceWords(a.summary)) : a.loading ? "Counting…" : "";
    return `
      <div class="audience">
        <p><strong data-audience>${words}</strong> today${a.summary?.machines ? ` · <button class="link" data-action="who">${a.showWho ? "Hide" : "See who"}</button>` : ""}</p>
        ${a.showWho && a.summary ? whoList(a) : ""}
      </div>`;
  }

  /** The machines conditions reach, up to WHO_LIMIT of them (the count above is always the whole). */
  function whoList(a) {
    if (a.whoError) return `<p class="form-error">${escape(a.whoError)}</p>`;
    if (!a.rows) return '<p class="loading">Loading…</p>';
    const more = a.summary.machines > a.rows.length
      ? `<p class="hint">Showing the first ${a.rows.length} of ${a.summary.machines} machines.</p>` : "";
    return `<ul class="who-list">${a.rows.map((row) => `<li>${escape(row.customer_name)} · ${escape(row.machine_name ?? "Unnamed machine")} · ${escape(row.store_name ?? "")}</li>`).join("")}</ul>${more}`;
  }

  /** Loads the machines for See who, for the conditions as they are now. */
  async function loadWho() {
    const draft = state.draft;
    if (!draft) return;
    try {
      const rows = await api.offerAudience(draft.rules, draft.store_ids, WHO_LIMIT);
      if (state.draft === draft) state.audience = { ...state.audience, rows, whoError: null };
    } catch (error) {
      if (state.draft === draft) state.audience = { ...state.audience, rows: null, whoError: api.describe(error) };
    }
    if (state.draft === draft) {
      const block = root.querySelector(".audience");
      if (block) block.outerHTML = audienceBlock();
    }
  }

  function actions() {
    const d = state.draft;
    if (!canManage) return '<button class="secondary" data-action="close">Close</button>';
    if (isDraft()) {
      return `
        <button class="primary" data-action="publish"${attr("disabled", state.busy)}>Publish</button>
        <button class="secondary" data-action="save"${attr("disabled", state.busy)}>Save Draft</button>
        ${d.id ? `<button class="danger" data-action="delete"${attr("disabled", state.busy)}>Delete Draft</button>` : ""}
        <button class="link" data-action="close">Cancel</button>`;
    }
    return `
      ${d.status === "live" ? `<button class="danger" data-action="stop"${attr("disabled", state.busy)}>Stop Offer</button>` : ""}
      <button class="secondary" data-action="copy"${attr("disabled", state.busy)}>Make a Copy</button>
      <button class="link" data-action="close">Close</button>`;
  }

  function leadsView() {
    const filters = [["open", "Open"], ["sold", "Sold"], ["notInterested", "Not interested"], ["all", "All"]];
    const shown = state.leads.filter((lead) => state.leadFilter === "all" ? true
      : state.leadFilter === "open" ? model.isOpenLead(lead) : lead.lead_status === state.leadFilter);
    return `
      <div class="card">
        <p class="hint">Customers who tapped I'm interested. The store's Sales contact got an email for each; reply to it, or call, then mark how it went.
          ${canManage ? "You see every store's." : "You see your store's."}</p>
        <div class="segmented" role="group" aria-label="Leads">
          ${filters.map(([value, label]) => `<button class="segment${state.leadFilter === value ? " active" : ""}" data-lead-filter="${value}">${label}</button>`).join("")}
        </div>
        ${shown.length ? `<ol class="lead-list">${shown.map(leadRow).join("")}</ol>` : '<p class="meta">No leads here.</p>'}
      </div>`;
  }

  function leadRow(lead) {
    const when = new Date(lead.interested_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const reach = [lead.login_email, lead.customer_phone, lead.customer_email && lead.customer_email !== lead.login_email ? lead.customer_email : ""].filter(Boolean);
    return `
      <li class="lead">
        <div>
          <strong>${escape(lead.customer_name)}</strong> · ${escape(lead.machine_name ?? "Unnamed machine")}${lead.store_name ? ` · ${escape(lead.store_name)}` : ""}
          <p class="meta">${escape(lead.offer_title)}${lead.offer_deal ? ` (${escape(lead.offer_deal)})` : ""} · ${escape(when)}</p>
          <p class="meta">${reach.map(escape).join(" · ")}</p>
          ${lead.handled_by_name ? `<p class="hint">Last updated by ${escape(lead.handled_by_name)}</p>` : ""}
        </div>
        <div class="lead-work">
          <select data-lead="${escape(lead.id)}" data-lead-part="status"${attr("disabled", state.busy)}>
            ${model.LEAD_STATUSES.map((s) => `<option value="${s.value}"${attr("selected", (lead.lead_status ?? "new") === s.value)}>${s.label}</option>`).join("")}
          </select>
          <textarea data-lead="${escape(lead.id)}" data-lead-part="note" rows="2" placeholder="Note (quote, follow-up date…)"${attr("disabled", state.busy)}>${escape(lead.lead_note ?? "")}</textarea>
        </div>
      </li>`;
  }

  // ---------------------------------------------------------------- the audience count

  function refreshAudience() {
    if (!canManage || !state.draft) return;
    clearTimeout(audienceTimer);
    state.audience.loading = true;
    audienceTimer = setTimeout(async () => {
      const draft = state.draft;
      if (!draft) return;
      if (draft.rules.some((c) => model.conditionProblem(c))) {
        state.audience = { ...state.audience, summary: null, rows: null, loading: false, error: "Finish the conditions to see who they reach." };
      } else {
        try {
          const summary = await api.offerAudienceSummary(draft.rules, draft.store_ids);
          state.audience = { ...state.audience, summary, rows: null, whoError: null, loading: false, error: null };
          if (state.audience.showWho && summary.machines) loadWho();
        } catch (error) {
          state.audience = { ...state.audience, summary: null, rows: null, loading: false, error: api.describe(error) };
        }
      }
      if (state.draft === draft) {
        const block = root.querySelector(".audience");
        if (block) block.outerHTML = audienceBlock();
      }
    }, 400);
  }

  // ---------------------------------------------------------------- editing

  function openOffer(offer) {
    state.open = offer?.id ?? "new";
    state.draft = offer ? structuredClone(offer) : model.blankOffer(today());
    state.saved = JSON.stringify(state.draft);
    state.audience = { summary: null, rows: null, loading: false, error: null, showWho: false };
    render();
    refreshAudience();
  }

  function close() {
    if (isDirty() && editable() && !confirm("You have unsaved changes to this offer. Leave without saving?")) return;
    state.open = null;
    state.draft = null;
    render();
  }

  function onInput(event) {
    const element = event.target;
    const d = state.draft;
    if (element.dataset.offer && d) {
      d[element.dataset.offer] = element.value;
      return;
    }
    if (element.dataset.store && d && event.type === "change") {
      if (element.dataset.store === "all") d.store_ids = [];
      else d.store_ids = element.checked ? [...d.store_ids, element.dataset.store] : d.store_ids.filter((id) => id !== element.dataset.store);
      render();
      return refreshAudience();
    }
    if (element.dataset.cond !== undefined && d) {
      const index = Number(element.dataset.cond);
      const condition = d.rules[index];
      const part = element.dataset.part;
      if (part === "customer-search") {
        // Only the matches change, so typing keeps its place in the box. Not on "change": that fires
        // as the box loses focus to a click on a match, and redrawing then would swallow the click.
        if (event.type !== "input") return;
        state.customerQuery[index] = element.value;
        const results = root.querySelector(`[data-results="${index}"]`);
        if (results) results.innerHTML = customerResults(index, condition.value ?? []);
        return;
      }
      const number = (text) => (String(text).trim() === "" ? null : Number(text));
      if (part === "field" && event.type === "change") {
        d.rules[index] = model.blankCondition(element.value);
        state.customerQuery = {};
      }
      else if (part === "op" && event.type === "change") d.rules[index] = model.withOp(condition, element.value);
      else if (part === "pick" && event.type === "change") {
        const values = new Set(condition.value ?? []);
        if (element.checked) values.add(element.value); else values.delete(element.value);
        condition.value = [...values];
      } else if (part === "value") condition.value = element.value;
      else if (part === "from" || part === "to") condition.value = { ...(condition.value ?? {}), [part]: number(element.value) };
      else if (part === "number") condition.value = number(element.value);
      else if (part === "kind") condition.value = { ...(condition.value ?? {}), kind: element.value };
      else if (part === "model") condition.value = { ...(condition.value ?? {}), model: element.value };
      else return;
      if (event.type === "change") render();
      else {
        const words = element.closest(".condition")?.querySelector(".condition-words");
        if (words) words.textContent = model.describeCondition(d.rules[index], state.options, state.customers);
      }
      refreshAudience();
    }
  }

  async function onLeadChange(element) {
    const lead = state.leads.find((l) => l.id === element.dataset.lead);
    if (!lead) return;
    const changes = element.dataset.leadPart === "status" ? { lead_status: element.value } : { lead_note: element.value.trim() };
    if (changes.lead_note !== undefined && changes.lead_note === (lead.lead_note ?? "")) return;
    try {
      await api.saveLead(lead.id, changes);
      Object.assign(lead, changes);
      if (changes.lead_status) {
        state.leads = await api.loadLeads();
        render();
      }
      notice(root, "Saved.", "success");
    } catch (error) {
      notice(root, api.describe(error), "error");
    }
  }

  async function run(work) {
    if (state.busy) return;
    state.busy = true;
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

  function showProblems() {
    const problems = model.offerProblems(state.draft);
    const area = root.querySelector("[data-problems]");
    if (area) area.textContent = problems[0] ?? "";
    return problems;
  }

  async function saveDraft() {
    const saved = await api.savePromotion(profile.organization_id, state.draft, model.cleanOffer(state.draft));
    state.draft = structuredClone(saved);
    state.saved = JSON.stringify(state.draft);
    state.open = saved.id;
    state.offers = await api.loadPromotions();
    return saved;
  }

  async function onClick(event) {
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      if (state.draft && isDirty() && editable() && !confirm("You have unsaved changes to this offer. Leave without saving?")) return;
      state.tab = tab.dataset.tab;
      state.draft = null;
      state.open = null;
      return render();
    }
    const filter = event.target.closest("[data-lead-filter]");
    if (filter) {
      state.leadFilter = filter.dataset.leadFilter;
      return render();
    }
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    switch (element.dataset.action) {
      case "reload": return load();
      case "new": return openOffer(null);
      case "open": return openOffer(state.offers.find((o) => o.id === element.dataset.id));
      case "close": return close();
      case "who":
        state.audience.showWho = !state.audience.showWho;
        root.querySelector(".audience").outerHTML = audienceBlock();
        if (state.audience.showWho && !state.audience.rows) loadWho();
        return;
      case "add-condition":
        state.draft.rules.push(model.blankCondition());
        render();
        return refreshAudience();
      case "remove-condition":
        state.draft.rules.splice(Number(element.dataset.index), 1);
        state.customerQuery = {};
        render();
        return refreshAudience();
      case "pick-customer":
      case "unpick-customer": {
        const index = Number(element.dataset.index);
        const condition = state.draft.rules[index];
        const chosen = (condition.value ?? []).filter((id) => id !== element.dataset.id);
        condition.value = element.dataset.action === "pick-customer" ? [...chosen, element.dataset.id] : chosen;
        state.customerQuery[index] = "";
        render();
        root.querySelector(`[data-cond="${index}"][data-part="customer-search"]`)?.focus();
        return refreshAudience();
      }
      case "save":
        if (showProblems().length) return;
        return run(async () => { await saveDraft(); return "Draft saved. Customers don't see it until you publish it."; });
      case "publish":
        if (showProblems().length) return;
        if (!confirm(`Publish "${state.draft.title.trim()}"? Customers whose machines fit see it in the app from ${state.draft.starts_on} to ${state.draft.ends_on}. After publishing, it can be stopped but not changed.`)) return;
        return run(async () => {
          const saved = await saveDraft();
          await api.setPromotionStatus(saved.id, "live");
          state.offers = await api.loadPromotions();
          state.draft = null;
          state.open = null;
          return "Published.";
        });
      case "stop":
        if (!confirm("Stop this offer? Customers stop seeing it at once. Leads it brought stay.")) return;
        return run(async () => {
          await api.setPromotionStatus(state.draft.id, "stopped");
          state.offers = await api.loadPromotions();
          state.draft = null;
          state.open = null;
          return "Stopped.";
        });
      case "copy": {
        const copy = { ...model.blankOffer(today()), ...model.cleanOffer(state.draft), title: `${state.draft.title} (copy)`.slice(0, 80) };
        copy.starts_on = today();
        if (copy.ends_on < copy.starts_on) copy.ends_on = model.addDays(copy.starts_on, 30);
        openOffer(null);
        state.draft = { ...copy, id: null, status: "draft" };
        state.saved = "";
        render();
        return refreshAudience();
      }
      case "delete":
        if (!confirm("Delete this draft?")) return;
        return run(async () => {
          await api.deletePromotion(state.draft.id);
          state.offers = await api.loadPromotions();
          state.draft = null;
          state.open = null;
          return "Draft deleted.";
        });
    }
  }

  root.addEventListener("input", onInput);
  root.addEventListener("change", (event) => {
    if (event.target.dataset.lead) return onLeadChange(event.target);
    onInput(event);
  });
  root.addEventListener("click", onClick);
  root.innerHTML = '<p class="loading">Loading…</p>';
  load();

  return (silent = false) => !(isDirty() && editable()) || (!silent && confirm("You have unsaved changes to this offer. Leave without saving?"));
}
