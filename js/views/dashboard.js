// Dashboard (owners, admins, and customer logins): the page they open on. Finished inspections and
// what each found, when each machine was last inspected, and a tracker of correction subscriptions by
// renewal date. Everything comes from the database's dashboard functions, which run as the signed-in
// person: a customer sees their farm, an admin their store, an owner every store (or one they pick).
// Numbers are counted on the server (dashboard_summary); lists are read a page at a time.

import * as api from "../api.js";
import { escape, notice } from "../ui.js";
import * as model from "../dashboard-model.js";
import { labelFor, receiverSummary } from "../equipment-model.js";

const STAFF_PAGE = 6;
const MORE = 10;

const ICONS = {
  check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>',
  cross: '<path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"/>',
  dash: '<path d="M4 8h8"/>',
  note: '<path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z"/>',
  alert: '<path d="M8 3.5v5.5M8 12v.5"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.4"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  refresh: '<path d="M12.5 5.5A5 5 0 1 0 13 9"/><path d="M13 2.5v3h-3"/>',
};
const icon = (name) => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONS[name] ?? ""}</svg>`;

/** A filled result or state badge: icon and words, never color alone. */
const badge = ({ label, tone, icon: name }) => `<span class="state tone-${escape(tone)}">${icon(name)}<span>${escape(label)}</span></span>`;

const SUB_ICONS = { expired: "cross", soon: "clock", expiring: "clock", current: "check", noDate: "dash" };

export function mountDashboard(root, { profile }) {
  const isCustomer = profile.role === "customer";
  const isOwner = profile.role === "owner";
  const state = {
    today: model.localDay(),
    store: "",
    stores: [],
    options: [],
    summary: null,
    loading: true,
    refreshing: false,
    loadError: null,
    loadedAt: 0,
    details: new Map(),
    expanded: new Set(),
    // Staff lists, each read a page at a time.
    lists: {
      followUp: { rows: [], done: false, loading: false },
      staff: { rows: [], done: false, loading: false },
      customer: { rows: [], done: false, loading: false },
    },
    // Customers: everything on their farm (a few machines and inspections).
    machines: [],
    inspections: [],
    historyShown: 8,
    // Subscriptions: "renew" (expired or due within 90 days) or "all" (where a customer starts: they have few).
    subs: { view: profile.role === "customer" ? "all" : "renew", rows: [], done: false, loading: false },
  };
  const stores = () => (state.store ? [state.store] : []);
  const typeLabel = (type) => labelFor(state.options, "equipment_type", type ?? "tractor");
  const listFilters = {
    followUp: { latestOnly: true, notReady: true },
    staff: { byCustomer: false },
    customer: { byCustomer: true },
  };

  // ---------------------------------------------------------------- loading

  const blankList = () => ({ rows: [], done: false, loading: false });

  /** The next `count` rows of a staff list, with what each found. */
  async function readPage(list, key, count, details) {
    const from = list.rows.length;
    const rows = await api.loadDashboardInspections({ stores: stores(), ...listFilters[key] }, from, from + count - 1);
    await readDetails(rows, details);
    list.rows.push(...rows);
    list.done = rows.length < count;
  }

  async function readDetails(rows, details) {
    const missing = rows.map((row) => row.id).filter((id) => !details.has(id));
    if (!missing.length) return;
    for (const [id, found] of await api.loadInspectionDetails(missing)) details.set(id, found);
  }

  const subscriptionFilter = (view) => ({ stores: stores(), until: view === "renew" ? model.addDays(state.today, 90) : null });

  /** Subscriptions for a view: every one for a customer, else the next `count`. */
  async function readSubscriptions(subs, count) {
    if (isCustomer) {
      subs.rows = await api.loadAllDashboardSubscriptions(subscriptionFilter(subs.view));
      subs.done = true;
      return;
    }
    const from = subs.rows.length;
    const rows = await api.loadDashboardSubscriptions(subscriptionFilter(subs.view), from, from + count - 1);
    subs.rows.push(...rows);
    subs.done = rows.length < count;
  }

  /**
   * Everything, read fresh. The page keeps showing what it had (dimmed) until the new answers are
   * all in; a newer load (another store chosen meanwhile) wins.
   */
  async function load() {
    const ticket = (state.ticket = (state.ticket ?? 0) + 1);
    state.today = model.localDay();
    state.loading = !state.loadedAt;
    state.refreshing = Boolean(state.loadedAt);
    render();
    try {
      if (!state.loadedAt) {
        const [storeRows, options] = await Promise.all([api.loadStores(), api.loadOptionRows()]);
        Object.assign(state, { stores: storeRows, options });
      }
      const details = new Map();
      const lists = { followUp: blankList(), staff: blankList(), customer: blankList() };
      const subs = { view: state.subs.view, rows: [], done: false, loading: false };
      const summary = await api.loadDashboardSummary(stores(), state.today);
      let machines = [];
      let inspections = [];
      if (isCustomer) {
        [machines, inspections] = await Promise.all([api.loadMachines(), api.loadAllDashboardInspections({}), readSubscriptions(subs)]);
        await readDetails(inspections, details);
      } else {
        lists.followUp.done = !summary?.not_ready;
        await Promise.all([
          summary?.not_ready ? readPage(lists.followUp, "followUp", 5, details) : null,
          readPage(lists.staff, "staff", STAFF_PAGE, details),
          readPage(lists.customer, "customer", STAFF_PAGE, details),
          readSubscriptions(subs, MORE),
        ]);
      }
      if (ticket !== state.ticket) return;
      Object.assign(state, { summary, details, lists, subs, machines, inspections, loadError: null, loadedAt: Date.now() });
      // A customer sees what their newest inspection found without opening it.
      if (isCustomer && !state.expanded.size && inspections[0]) state.expanded.add(`history-${inspections[0].id}`);
    } catch (error) {
      if (ticket !== state.ticket) return;
      state.loadError = api.describe(error);
    }
    state.loading = false;
    state.refreshing = false;
    render();
  }

  /** Runs one "Show more" (or a change of view) while its button says Loading…. */
  async function busy(holder, work) {
    if (holder.loading) return;
    holder.loading = true;
    render();
    try {
      await work();
    } catch (error) {
      notice(root, api.describe(error), "error");
    }
    holder.loading = false;
    render();
  }

  const more = (key) => busy(state.lists[key], () => readPage(state.lists[key], key, MORE, state.details));
  const moreSubscriptions = () => busy(state.subs, () => readSubscriptions(state.subs, MORE * 2));

  function showSubscriptions(view) {
    if (state.subs.view === view) return;
    state.subs = { view, rows: [], done: false, loading: false };
    return busy(state.subs, () => readSubscriptions(state.subs, MORE));
  }

  async function downloadReport(button) {
    const row = findInspection(button.dataset.id);
    const details = state.details.get(button.dataset.id);
    if (!row || !details?.report_path) return;
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = "Downloading…";
    try {
      const blob = await api.downloadReport(details.report_path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = model.reportFileName(row);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      notice(root, `The report couldn't be downloaded. ${api.describe(error)}`, "error");
    }
    button.disabled = false;
    button.innerHTML = label;
  }

  function findInspection(id) {
    if (isCustomer) return state.inspections.find((row) => row.id === id);
    for (const list of Object.values(state.lists)) {
      const row = list.rows.find((r) => r.id === id);
      if (row) return row;
    }
    return null;
  }

  // ---------------------------------------------------------------- pieces

  function scopeWords() {
    if (isCustomer) return profile.customers?.name || "Your farm";
    if (isOwner) return state.store ? state.stores.find((s) => s.id === state.store)?.name ?? "One store" : "Every store";
    return state.stores.find((s) => s.id === profile.location_id)?.name ?? "Your store";
  }

  function updatedWords() {
    if (!state.loadedAt) return "";
    return `Updated ${new Date(state.loadedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }

  function tilesBlock() {
    return `
      <section class="kpis" aria-label="At a glance">
        ${model.tiles(state.summary, profile.role).map((tile) => `
          <div class="kpi">
            <span class="kpi-label">${tile.tone !== "neutral" ? `<span class="kpi-dot tone-${escape(tile.tone)}" aria-hidden="true"></span>` : ""}${escape(tile.label)}</span>
            <span class="kpi-value">${escape(model.countWords(tile.value))}</span>
            <span class="kpi-caption">${escape(tile.caption)}</span>
          </div>`).join("")}
      </section>`;
  }

  function issueLine(issue) {
    const kind = model.ISSUE_RESULTS[issue.result] ?? model.ISSUE_RESULTS.fail;
    const severity = model.severityLabel(issue.severity);
    const text = issue.result === "needsDiagnosis" ? issue.recommendation || issue.notes : issue.notes || issue.recommendation;
    return `
      <li class="issue">
        <span class="issue-mark tone-${escape(kind.tone)}" aria-hidden="true">${icon(kind.icon)}</span>
        <div>
          <p class="issue-title"><strong>${escape(issue.title || "Check")}</strong>${issue.section ? ` <span class="meta">· ${escape(issue.section)}</span>` : ""}</p>
          <p class="meta">${escape(kind.label)}${severity ? ` · ${escape(severity)}` : ""}${text ? ` — ${escape(text)}` : ""}</p>
        </div>
      </li>`;
  }

  /** One inspection in a list (`list` names it: an inspection can be in two lists, each opened on its own). */
  function inspectionRow(row, list) {
    const details = state.details.get(row.id);
    const result = model.resultFor(details?.result);
    const day = model.localDay(row.finalized_at);
    const key = `${list}-${row.id}`;
    const open = state.expanded.has(key);
    const isNew = model.daysBetween(day, state.today) <= 7;
    const where = [!isCustomer ? row.customer_name : null, !isCustomer && isOwner && !state.store ? row.store_name : null].filter(Boolean).join(" · ");
    const issues = details?.issues ?? [];
    return `
      <li class="insp${open ? " open" : ""}" id="insp-${escape(key)}">
        <button class="insp-head" data-action="toggle" data-key="${escape(key)}" aria-expanded="${open}">
          <span class="insp-main">
            <strong>${escape(model.machineName(row))}${isNew ? ' <span class="tag tag-new">New</span>' : ""}</strong>
            ${where ? `<span class="meta">${escape(where)}</span>` : ""}
            <span class="insp-result">${badge(result)}<span class="meta">${escape(model.findingsWords(details))}</span></span>
          </span>
          <span class="insp-when"><time datetime="${escape(day)}">${escape(model.dayWords(day))}</time><span class="meta">${escape(model.agoWords(day, state.today))}</span></span>
        </button>
        ${open ? `
          <div class="insp-body">
            <p class="meta">${escape([model.checklistWords(row, details), model.whoDid(row, profile.role), row.work_order ? `Work order ${row.work_order}` : "", row.machine_archived ? "Machine archived" : ""].filter(Boolean).join(" · "))}</p>
            ${issues.length ? `<ul class="issues">${issues.map(issueLine).join("")}</ul>`
              : `<p class="all-clear">${icon(details?.result === "incomplete" ? "dash" : "check")} ${escape(details?.result === "incomplete" ? "Some required checks weren't recorded or tested. The report lists them." : "No failed checks or recommendations.")}</p>`}
            <div class="insp-actions">
              ${details?.report_path
                ? `<button class="secondary" data-action="report" data-id="${escape(row.id)}">${icon("download")} Download Report</button>`
                : '<span class="hint">The report appears here once the app has uploaded it.</span>'}
            </div>
          </div>` : ""}
      </li>`;
  }

  function staffListCard(key, title, intro, empty) {
    const list = state.lists[key];
    return `
      <section class="card dash-card">
        <div class="card-head">
          <div><h2>${escape(title)}</h2><p class="meta">${escape(intro)}</p></div>
        </div>
        ${list.rows.length ? `<ul class="insp-list">${list.rows.map((row) => inspectionRow(row, key)).join("")}</ul>` : `<p class="empty">${escape(empty)}</p>`}
        ${!list.done && list.rows.length ? `<button class="link more" data-action="more" data-list="${key}"${list.loading ? " disabled" : ""}>${list.loading ? "Loading…" : "Show more"}</button>` : ""}
      </section>`;
  }

  function timelineCard() {
    const timelines = model.machineTimelines(state.machines, state.inspections, state.details, state.today);
    const rows = timelines.rows;
    return `
      <section class="card dash-card">
        <div class="card-head">
          <div><h2>Your machines</h2><p class="meta">Each dot is a finished inspection over the last ${model.TIMELINE_YEARS} years. Tap one to see it below.</p></div>
        </div>
        ${rows.length ? `<ul class="machine-lines">${rows.map((row) => `
          <li class="machine-line">
            <div class="ml-head">
              <div class="ml-name">
                <strong>${escape(model.machineName(row.machine))}</strong>
                <span class="meta">${escape([typeLabel(row.machine.equipment_type), row.machine.model_year].filter(Boolean).join(" · "))}</span>
              </div>
              <div class="ml-status">
                ${row.lastResult ? badge(model.resultFor(row.lastResult)) : ""}
                ${row.due ? `<span class="state tone-warning">${icon("clock")}<span>Due for inspection</span></span>` : ""}
              </div>
            </div>
            <p class="meta ml-last">${escape(model.lastInspectedWords(row, state.today))}${row.earlier ? ` · ${escape(`${row.earlier} earlier not shown`)}` : ""}</p>
            <div class="timeline" role="group" aria-label="${escape(`Inspections of ${model.machineName(row.machine)} since ${model.dayWords(timelines.start)}`)}">
              <span class="tl-track" aria-hidden="true"></span>
              ${timelines.ticks.map((tick) => `<span class="tl-tick" data-left="${tick.left.toFixed(2)}" aria-hidden="true"><span>${escape(tick.label)}</span></span>`).join("")}
              ${row.points.map((point) => {
                const result = model.resultFor(point.result);
                const words = `${model.dayWords(point.day)} · ${result.label}`;
                return `<button class="tl-point tone-${escape(result.tone)}" data-left="${point.left.toFixed(2)}" data-action="jump" data-id="${escape(point.id)}" data-tip="${escape(words)}" aria-label="${escape(words)}">${icon(result.icon)}</button>`;
              }).join("")}
              <span class="tl-end" aria-hidden="true">Today</span>
            </div>
          </li>`).join("")}</ul>` : '<p class="empty">No machines yet. Add them on My equipment.</p>'}
      </section>`;
  }

  function historyCard() {
    const rows = state.inspections.slice(0, state.historyShown);
    return `
      <section class="card dash-card">
        <div class="card-head">
          <div><h2>Inspections</h2><p class="meta">Every finished inspection on your machines, newest first. Open one to see what it found and download its report.</p></div>
        </div>
        ${rows.length ? `<ul class="insp-list">${rows.map((row) => inspectionRow(row, "history")).join("")}</ul>`
          : '<p class="empty">No finished inspections yet. Each one appears here as soon as it\'s finalized and synced.</p>'}
        ${state.inspections.length > rows.length ? `<button class="link more" data-action="history">Show all ${state.inspections.length}</button>` : ""}
      </section>`;
  }

  function subscriptionsCard() {
    const { total, parts } = model.subscriptionParts(state.summary);
    const renew = model.toRenew(state.summary);
    const subs = state.subs;
    const segments = parts.filter((part) => part.count);
    return `
      <section class="card dash-card subs-card">
        <div class="card-head">
          <div><h2>Subscription tracker</h2><p class="meta">${escape(total ? `${total} correction ${total === 1 ? "subscription" : "subscriptions"} on ${isCustomer ? "your" : "active"} machines` : "No correction subscriptions on record yet")}</p></div>
        </div>
        ${total ? `
          <div class="seg-bar" role="img" aria-label="${escape(parts.map((part) => `${part.label}: ${part.count}`).join(", "))}">
            ${segments.map((part) => `<span class="seg tone-${escape(part.tone)}" tabindex="0" data-grow="${part.count}" data-tip="${escape(`${part.label} · ${part.count} · ${model.shareWords(part.count, total)}`)}"></span>`).join("")}
          </div>
          <ul class="seg-legend">
            ${parts.map((part) => `<li><span class="swatch tone-${escape(part.tone)}" aria-hidden="true"></span><span>${escape(part.label)}</span><strong>${escape(model.countWords(part.count))}</strong></li>`).join("")}
          </ul>
          <div class="segmented sub-views" role="group" aria-label="Which subscriptions">
            <button class="segment${subs.view === "renew" ? " active" : ""}" data-action="subs" data-view="renew" aria-pressed="${subs.view === "renew"}">To renew (${escape(model.countWords(renew))})</button>
            <button class="segment${subs.view === "all" ? " active" : ""}" data-action="subs" data-view="all" aria-pressed="${subs.view === "all"}">All (${escape(model.countWords(total))})</button>
          </div>
          ${subs.rows.length ? `<ul class="renewals">${subs.rows.map(renewalRow).join("")}</ul>`
            : `<p class="empty">${subs.loading ? "Loading…" : subs.view === "renew" ? "Nothing to renew in the next 90 days." : "No subscriptions."}</p>`}
          ${!subs.done && subs.rows.length ? `<button class="link more" data-action="more-subs"${subs.loading ? " disabled" : ""}>${subs.loading ? "Loading…" : "Show more"}</button>` : ""}`
        : `<p class="empty">${isCustomer ? "Add your RTK, satellite, and other correction subscriptions to your machines on My equipment, with their expiration dates, and they're tracked here." : "Subscriptions added to machines, with their expiration dates, are tracked here."}</p>`}
      </section>`;
  }

  function renewalRow(row) {
    const sub = model.subscriptionState(row.expiration_date, state.today);
    const where = [model.machineName(row), !isCustomer ? row.customer_name : null, !isCustomer && isOwner && !state.store ? row.store_name : null].filter(Boolean).join(" · ");
    return `
      <li class="renewal">
        ${badge({ label: sub.label, tone: sub.tone, icon: SUB_ICONS[sub.key] })}
        <span class="renewal-main">
          <strong>${escape(row.service_name || row.provider || "Correction subscription")}</strong>
          <span class="meta">${escape([row.service_name && row.provider ? row.provider : "", where].filter(Boolean).join(" · "))}</span>
          ${row.component_id ? `<span class="meta">${escape(`Receiver ${receiverSummary(state.options, { model_name: row.receiver_model, serial_number: row.receiver_serial, correction_level: row.receiver_correction_level })}`)}</span>` : ""}
        </span>
        <span class="renewal-date">${escape(model.subscriptionDateWords(row.expiration_date, state.today))}</span>
      </li>`;
  }

  function header() {
    const refresh = `<button class="secondary refresh" data-action="refresh"${state.refreshing ? " disabled" : ""}>${icon("refresh")} ${state.refreshing ? "Refreshing…" : "Refresh"}</button>`;
    if (isCustomer) {
      return `
        <div class="hero dash-hero">
          <div>
            <p class="eyebrow">${escape(profile.organizations?.name ? `${profile.organizations.name} · Field Ready` : "Field Ready")}</p>
            <h1>${escape(scopeWords())}</h1>
            <p>Your machines' inspections and subscriptions at a glance. ${escape(updatedWords())}</p>
          </div>
          ${refresh}
        </div>`;
    }
    const active = state.stores.filter((store) => store.active !== false);
    return `
      <div class="toolbar">
        <div>
          <h1>Dashboard</h1>
          <p class="meta">${escape([scopeWords(), updatedWords()].filter(Boolean).join(" · "))}</p>
        </div>
        <div class="actions">
          ${isOwner ? `<label class="inline">Store
            <select data-store>
              <option value="">Every store</option>
              ${active.map((store) => `<option value="${escape(store.id)}"${store.id === state.store ? " selected" : ""}>${escape(store.name)}</option>`).join("")}
            </select></label>` : ""}
          ${refresh}
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- page

  function render() {
    const body = state.loading ? '<p class="loading">Loading…</p>'
      : state.loadError && !state.loadedAt ? `<div class="card"><p class="form-error">${escape(state.loadError)}</p><button class="secondary" data-action="refresh">Try Again</button></div>`
      : `
        ${state.loadError ? `<div class="notice notice-error" role="alert">${escape(state.loadError)} Showing what was loaded before.</div>` : ""}
        <div class="dash${state.refreshing ? " is-refreshing" : ""}" aria-busy="${state.refreshing}">
          ${tilesBlock()}
          ${isCustomer ? `
            ${timelineCard()}
            ${historyCard()}
            ${subscriptionsCard()}`
          : `
            ${state.lists.followUp.rows.length ? staffListCard("followUp", "Needs follow-up", "Machines whose newest inspection failed a check, newest first.", "") : ""}
            <div class="dash-columns">
              ${staffListCard("staff", "Recent inspections", "Finished by your technicians on customers' machines.", "No finished inspections yet.")}
              ${staffListCard("customer", "Customer inspections", "Done by customers themselves in the app.", "No customer inspections yet.")}
            </div>
            ${subscriptionsCard()}`}
        </div>`;
    root.innerHTML = `<div data-notice></div>${header()}${body}<div class="dash-tip" role="tooltip" hidden></div>`;
    layout();
  }

  /** Places timeline dots and bar segments (the page's security policy allows no inline styles). */
  function layout() {
    for (const element of root.querySelectorAll("[data-left]")) element.style.left = `${element.dataset.left}%`;
    for (const element of root.querySelectorAll("[data-grow]")) element.style.flexGrow = element.dataset.grow;
  }

  // ---------------------------------------------------------------- tooltip

  function showTip(target) {
    const tip = root.querySelector(".dash-tip");
    if (!tip) return;
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    const width = tip.offsetWidth;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, box.left + box.width / 2 - width / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, box.top - tip.offsetHeight - 8)}px`;
  }
  const hideTip = () => { const tip = root.querySelector(".dash-tip"); if (tip) tip.hidden = true; };
  root.addEventListener("pointerover", (event) => { const target = event.target.closest("[data-tip]"); if (target) showTip(target); });
  root.addEventListener("pointerout", (event) => { if (event.target.closest("[data-tip]")) hideTip(); });
  root.addEventListener("focusin", (event) => { const target = event.target.closest("[data-tip]"); if (target) showTip(target); });
  root.addEventListener("focusout", hideTip);
  window.addEventListener("scroll", hideTip, { passive: true });

  // ---------------------------------------------------------------- actions

  root.addEventListener("click", (event) => {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    const id = element.dataset.id;
    switch (element.dataset.action) {
      case "refresh": return load();
      case "toggle": {
        const key = element.dataset.key;
        if (state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key);
        render();
        return root.querySelector(`#insp-${CSS.escape(key)} .insp-head`)?.focus();
      }
      case "jump": {
        const index = state.inspections.findIndex((row) => row.id === id);
        if (index >= state.historyShown) state.historyShown = index + 1;
        state.expanded.add(`history-${id}`);
        render();
        const target = root.querySelector(`#insp-${CSS.escape(`history-${id}`)}`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        return target?.querySelector(".insp-head")?.focus({ preventScroll: true });
      }
      case "history": state.historyShown = state.inspections.length; return render();
      case "more": return more(element.dataset.list);
      case "more-subs": return moreSubscriptions();
      case "subs": return showSubscriptions(element.dataset.view);
      case "report": return downloadReport(element);
    }
  });

  root.addEventListener("change", (event) => {
    if (!event.target.matches("[data-store]")) return;
    state.store = event.target.value;
    state.expanded.clear();
    load();
  });

  // Coming back to the tab after a while brings in inspections finished meanwhile.
  const onVisible = () => {
    if (!root.isConnected) return document.removeEventListener("visibilitychange", onVisible);
    if (document.visibilityState === "visible" && state.loadedAt && Date.now() - state.loadedAt > 120000 && !state.refreshing) load();
  };
  document.addEventListener("visibilitychange", onVisible);

  render();
  load();
  return () => true;
}
