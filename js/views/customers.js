// The Customers & machines page: the customers this person may see, each with their machines and
// (for owners and admins) the logins that let them see their equipment in the Field Ready app.
//
// Everyone on staff adds and edits customers and machines at their own store (owners at every
// store); owners and admins also archive and delete them, and manage customer logins. A machine
// opens on its own page (views/machine.js). The database enforces all of this; the page only hides
// what someone can't do. Logins and password resets go through the `people` server function, like
// Add Person.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import { temporaryPassword } from "../people-model.js";
import * as logins from "../customers-model.js";
import * as model from "../equipment-model.js";
import { mountMachine } from "./machine.js";

export function mountCustomers(root, { profile }) {
  const isOwner = profile.role === "owner";
  const isManager = profile.role === "owner" || profile.role === "admin";
  const viewer = { id: profile.id, role: profile.role, location_id: profile.location_id };
  const state = {
    customers: [],
    machines: [],
    people: [],
    invitations: [],
    stores: [],
    options: [],
    search: "",
    store: "",
    archived: false,
    /** The customer being edited ("new" for one being added), and its details so far. */
    editing: null,
    draft: null,
    /** The customer getting a new login, and its details so far. */
    adding: null,
    login: null,
    handover: null,
    /** While a machine is open: whether it's fine to leave it (from mountMachine). */
    machinePage: null,
    busy: false,
    loadError: null,
  };

  const storeName = (id) => state.stores.find((store) => store.id === id)?.name ?? "Unknown store";
  const customerFor = (id) => state.customers.find((customer) => customer.id === id);
  const machinesOf = (customer) => state.machines.filter((machine) => machine.customer_id === customer.id);
  const typeLabel = (type) => model.labelFor(state.options, "equipment_type", type ?? "tractor");

  // ---------------------------------------------------------------- loading

  async function fetchAll() {
    // Employees can't read logins or invitations, so they aren't asked for.
    const [customers, machines, stores, options, people, invitations] = await Promise.all([
      api.loadCustomers(), api.loadMachines(), api.loadStores(), api.loadOptionRows(),
      isManager ? api.loadPeople() : [], isManager ? api.loadInvitations() : [],
    ]);
    Object.assign(state, { customers, machines, stores, options, people, invitations, loadError: null });
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
        <div class="card"><h2>Couldn't load customers</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    const canAdd = model.storesFor(viewer, state.stores).length > 0;
    root.innerHTML = `
      <div data-notice></div>
      <div class="toolbar">
        <div>
          <h1>Customers &amp; machines</h1>
          <p class="meta">Changes here reach phones at their next sync. Inspections are done in the Field Ready app.</p>
        </div>
        ${canAdd ? `<div class="actions"><button class="primary" data-action="add-customer"${attr("disabled", state.busy || state.editing === "new")}>Add Customer</button></div>` : ""}
      </div>
      ${scopeNote()}
      ${handoverCard()}
      ${state.editing === "new" ? `<div class="card">${customerForm(null)}</div>` : ""}
      <div class="card">
        <div class="filters">
          <label>Search <input data-field="search" value="${escape(state.search)}" placeholder="Customer, email, phone, make, model, or serial" autocomplete="off"></label>
          ${isOwner ? `
            <label>Store
              <select data-field="store">
                <option value="">Every store</option>
                ${state.stores.map((store) => `<option value="${escape(store.id)}"${attr("selected", store.id === state.store)}>${escape(store.name)}</option>`).join("")}
              </select>
            </label>` : ""}
          <label class="check"><input type="checkbox" data-field="archived"${attr("checked", state.archived)}> Show archived</label>
        </div>
        <div data-customer-list>${customerList()}</div>
      </div>`;
  }

  function scopeNote() {
    const store = escape(storeName(profile.location_id));
    if (isOwner) return "";
    if (isManager) return `<p class="callout">You manage customers, machines, and customer app logins at ${store}.</p>`;
    return `<p class="callout">You add and edit customers and machines at ${store}. Owners and admins archive and delete them.</p>`;
  }

  function handoverCard() {
    const handover = state.handover;
    if (!handover) return "";
    return `
      <div class="card handover" role="status">
        <h2>${handover.kind === "reset" ? "New temporary password for" : "Give"} ${escape(handover.name)}${handover.kind === "reset" ? "" : " their temporary password"}</h2>
        <p class="password"><code data-password>${escape(handover.password)}</code>
          <button class="secondary" data-action="copy">Copy</button></p>
        <p>They install Field Ready, sign in with <strong>${escape(handover.email)}</strong> and this password, and then choose
          their own password. It isn't shown again once you close this.</p>
        <button class="link" data-action="dismiss-handover">Done</button>
      </div>`;
  }

  function customerList() {
    const shown = model.findCustomers(state.customers, state.machines, { search: state.search, store: state.store, archived: state.archived });
    if (shown.length === 0) {
      return `<p class="hint">${state.customers.length ? "No customers match." : "No customers yet. Add one here or in the app."}</p>`;
    }
    return `<ol class="customer-list">${shown.map(customerRow).join("")}</ol>`;
  }

  function customerRow(customer) {
    const id = escape(customer.id);
    const edit = model.canEdit(viewer, customer.location_id);
    const manageLogins = logins.canManageCustomer(viewer, customer);
    const theirs = machinesOf(customer);
    const shown = theirs.filter((machine) => state.archived || !machine.archived_at)
      .sort((a, b) => model.machineName(a).localeCompare(model.machineName(b)));
    const hidden = theirs.length - shown.length;
    const details = [storeName(customer.location_id), customer.phone, customer.email].filter(Boolean);
    return `
      <li class="customer${customer.archived_at ? " archived" : ""}">
        ${state.editing === customer.id ? customerForm(customer) : `
          <div class="customer-head">
            <div class="person-main">
              <span><strong>${escape(customer.name)}</strong>${customer.archived_at ? ' <span class="tag">Archived</span>' : ""}</span>
              <span class="hint">${details.map(escape).join(" · ")}</span>
            </div>
            <span class="tools">
              ${edit ? `<button class="link" data-action="edit-customer" data-id="${id}"${attr("disabled", state.busy || state.editing)}>Edit</button>` : ""}
              ${edit && !customer.archived_at ? `<button class="secondary" data-action="add-machine" data-id="${id}"${attr("disabled", state.busy)}>Add Machine</button>` : ""}
            </span>
          </div>`}
        ${shown.length ? `<ul class="machine-list">${shown.map(machineRow).join("")}</ul>` : (hidden ? "" : '<p class="hint">No machines yet.</p>')}
        ${hidden ? `<p class="hint">${hidden} archived ${hidden === 1 ? "machine" : "machines"} not shown. Check Show archived to see ${hidden === 1 ? "it" : "them"}.</p>` : ""}
        ${isManager ? loginSection(customer, manageLogins) : ""}
      </li>`;
  }

  function machineRow(machine) {
    const type = machine.equipment_type ?? "tractor";
    const details = [
      machine.serial_number ? `Serial ${machine.serial_number}` : "",
      machine.model_year ?? "",
      machine.finalized ? `${machine.finalized} finalized ${machine.finalized === 1 ? "inspection" : "inspections"}` : "",
      model.canEdit(viewer, machine.location_id) ? "" : `At ${storeName(machine.location_id)}`,
    ].filter(Boolean);
    return `
      <li>
        <button class="machine${machine.archived_at ? " archived" : ""}" data-action="open-machine" data-id="${escape(machine.id)}"${attr("disabled", state.busy)}>
          <span class="type-tag type-${escape(type)}">${escape(typeLabel(type))}</span>
          <span class="machine-text">
            <strong>${escape(model.machineName(machine))}</strong>${machine.archived_at ? ' <span class="tag">Archived</span>' : ""}${machine.customer_changed ? ' <span class="tag tag-customer">Changed by the customer</span>' : ""}
            <span class="hint">${details.map(escape).join(" · ")}</span>
          </span>
          <span class="chevron" aria-hidden="true">›</span>
        </button>
      </li>`;
  }

  function customerForm(customer) {
    const draft = state.draft;
    const manage = customer && model.canManage(viewer, customer.location_id);
    const deletable = customer && model.canDeleteCustomer(customer, state.machines);
    const stores = model.storesFor(viewer, state.stores, customer?.location_id);
    return `
      <form class="customer-form" data-customer-form>
        <h2>${customer ? `Edit ${escape(customer.name)}` : "New customer"}</h2>
        <div class="grid2">
          <label>Name <input data-draft="name" value="${escape(draft.name)}" autocomplete="off"></label>
          <label>Store
            <select data-draft="location_id">
              ${stores.map((store) => `<option value="${escape(store.id)}"${attr("selected", store.id === draft.location_id)}>${escape(store.name)}${store.active ? "" : " (not in use)"}</option>`).join("")}
            </select>
          </label>
          <label>Phone <input data-draft="phone" type="tel" value="${escape(draft.phone)}" autocomplete="off"></label>
          <label>Email <input data-draft="email" type="email" value="${escape(draft.email)}" autocomplete="off"></label>
        </div>
        <p class="hint">Contact details for the farm. ${isManager ? "App logins are added separately, below the customer's machines." : "Owners and admins add app logins."}</p>
        <p class="form-error" data-customer-problems></p>
        <div class="actions">
          <button class="primary" type="submit"${attr("disabled", state.busy)}>${customer ? "Save" : "Add Customer"}</button>
          <button class="secondary" type="button" data-action="cancel-customer">Cancel</button>
          ${manage ? `
            <span class="spacer"></span>
            <button class="secondary" type="button" data-action="archive-customer" data-id="${escape(customer.id)}"${attr("disabled", state.busy)}>${customer.archived_at ? "Bring Back" : "Archive"}</button>
            ${deletable ? `<button class="danger" type="button" data-action="delete-customer" data-id="${escape(customer.id)}"${attr("disabled", state.busy)}>Delete Customer</button>` : ""}` : ""}
        </div>
        ${manage && !deletable ? '<p class="hint">One of this customer\'s machines has finalized inspections, so the customer can be archived but not deleted.</p>' : ""}
      </form>`;
  }

  function loginSection(customer, manage) {
    const theirs = logins.loginsFor(customer, state.people);
    const waiting = state.invitations.filter((invite) => invite.role === "customer" && invite.customer_id === customer.id);
    return `
      <div class="customer-logins">
        <div class="logins-head">
          <span class="section-label">App logins</span>
          ${manage && state.adding !== customer.id && !customer.archived_at ? `<button class="link" data-action="add-login" data-id="${escape(customer.id)}"${attr("disabled", state.busy)}>+ Add Login</button>` : ""}
        </div>
        ${theirs.length || waiting.length ? `
          <ol class="login-list">
            ${theirs.map((login) => loginRow(login, manage)).join("")}
            ${waiting.map((invite) => `
              <li class="login">
                <span><strong>${escape(invite.full_name || invite.email)}</strong> <span class="hint">${escape(invite.email)} · waiting for a login</span></span>
                ${manage ? `<button class="danger" data-action="cancel-invite" data-email="${escape(invite.email)}"${attr("disabled", state.busy)}>Cancel</button>` : ""}
              </li>`).join("")}
          </ol>` : '<p class="hint">No app login yet.</p>'}
        ${state.adding === customer.id ? addLoginForm(customer) : ""}
      </div>`;
  }

  function loginRow(login, manage) {
    return `
      <li class="login${login.active ? "" : " off"}">
        <span>
          <strong>${escape(login.full_name || login.email)}</strong>
          <span class="hint">${escape(login.email)}${login.must_change_password && login.active ? " · hasn't chosen a password yet" : ""}</span>
          ${login.active ? "" : '<span class="access-off">Access off</span>'}
        </span>
        ${manage ? `
          <span class="tools">
            <button class="link" data-action="toggle" data-id="${escape(login.id)}"${attr("disabled", state.busy)}>${login.active ? "Turn Off" : "Turn On"}</button>
            <button class="link" data-action="reset-password" data-id="${escape(login.id)}"${attr("disabled", state.busy || !login.active)}>Reset Password</button>
          </span>` : ""}
      </li>`;
  }

  function addLoginForm(customer) {
    const login = state.login;
    const problems = logins.newLoginProblems(login, state.people, state.invitations);
    return `
      <form class="login-form" data-add-form data-id="${escape(customer.id)}">
        <div class="grid2">
          <label>Name of the person signing in <input data-login="full_name" value="${escape(login.full_name)}" autocomplete="off"></label>
          <label>Their email <input data-login="email" type="email" value="${escape(login.email)}" autocomplete="off"></label>
        </div>
        <p class="hint">Each person at the farm gets their own login. They'll see ${escape(customer.name)}'s equipment and completed inspections.</p>
        <p class="form-error" data-login-problems>${escape(problems[0] ?? "")}</p>
        <div class="actions">
          <button class="primary" type="submit" data-submit${attr("disabled", problems.length > 0 || state.busy)}>Add Login</button>
          <button class="secondary" type="button" data-action="cancel-add">Cancel</button>
        </div>
      </form>`;
  }

  // ---------------------------------------------------------------- editing

  const blankDraft = (customer) => ({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    location_id: customer?.location_id ?? newCustomerStore(),
  });

  /** A new customer goes in the store being looked at, or the person's own, or the first they may use. */
  function newCustomerStore() {
    const allowed = model.storesFor(viewer, state.stores);
    return allowed.find((store) => store.id === state.store)?.id
      ?? allowed.find((store) => store.id === profile.location_id)?.id
      ?? allowed[0]?.id ?? null;
  }

  function customerDirty() {
    if (!state.editing) return false;
    const saved = blankDraft(state.editing === "new" ? null : customerFor(state.editing));
    return state.editing === "new" ? Boolean(state.draft.name.trim() || state.draft.phone.trim() || state.draft.email.trim())
      : JSON.stringify(saved) !== JSON.stringify(state.draft);
  }

  function refreshList() {
    const list = root.querySelector("[data-customer-list]");
    if (list) list.innerHTML = customerList();
  }

  function refreshAddForm() {
    const problems = logins.newLoginProblems(state.login, state.people, state.invitations);
    const area = root.querySelector("[data-login-problems]");
    if (area) area.textContent = problems[0] ?? "";
    const submit = root.querySelector("[data-submit]");
    if (submit) submit.disabled = problems.length > 0 || state.busy;
  }

  function showCustomerProblems() {
    const problems = model.customerProblems(state.draft);
    const area = root.querySelector("[data-customer-problems]");
    if (area) area.textContent = problems[0] ?? "";
    return problems;
  }

  function onInput(event) {
    if (state.machinePage) return;
    const element = event.target;
    switch (element.dataset.field) {
      case "search":
        state.search = element.value;
        return refreshList();
      case "store":
        state.store = element.value;
        return refreshList();
      case "archived":
        state.archived = element.checked;
        return refreshList();
    }
    if (element.dataset.draft && state.draft) {
      state.draft[element.dataset.draft] = element.value;
      // Once a problem is showing, keep it current as they fix it.
      if (root.querySelector("[data-customer-problems]")?.textContent) showCustomerProblems();
      return;
    }
    if (element.dataset.login && state.login) {
      state.login[element.dataset.login] = element.value;
      refreshAddForm();
    }
  }

  async function onClick(event) {
    if (state.machinePage) return;
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    const customer = customerFor(element.dataset.id);
    const login = state.people.find((person) => person.id === element.dataset.id);
    switch (element.dataset.action) {
      case "reload": return load();
      case "add-customer":
        if (!leaveCustomerForm()) return;
        state.editing = "new";
        state.draft = blankDraft(null);
        render();
        root.querySelector('[data-draft="name"]')?.focus();
        return;
      case "edit-customer":
        if (!leaveCustomerForm()) return;
        state.editing = customer.id;
        state.draft = blankDraft(customer);
        render();
        root.querySelector('[data-draft="name"]')?.focus();
        return;
      case "cancel-customer":
        state.editing = null;
        state.draft = null;
        return render();
      case "archive-customer": return archiveCustomer(customer);
      case "delete-customer": return deleteCustomer(customer);
      case "add-machine": return openMachine(null, customer.id);
      case "open-machine": return openMachine(element.dataset.id);
      case "add-login":
        state.adding = customer.id;
        state.login = logins.newLogin(customer);
        refreshList();
        root.querySelector('[data-login="full_name"]')?.focus();
        return;
      case "cancel-add":
        state.adding = null;
        state.login = null;
        return refreshList();
      case "toggle": return toggleAccess(login);
      case "reset-password": return resetPassword(login);
      case "cancel-invite": return cancelInvitation(element.dataset.email);
      case "dismiss-handover":
        state.handover = null;
        return render();
      case "copy":
        try {
          await navigator.clipboard.writeText(state.handover.password);
          element.textContent = "Copied";
        } catch {
          element.textContent = "Select and copy it";
        }
    }
  }

  function onSubmit(event) {
    if (state.machinePage) return;
    if (event.target.closest("[data-customer-form]")) {
      event.preventDefault();
      return saveCustomer();
    }
    const form = event.target.closest("[data-add-form]");
    if (!form) return;
    event.preventDefault();
    addLogin(customerFor(form.dataset.id));
  }

  /** Whether the customer form can be closed: nothing typed, or the person agrees to lose it. */
  const leaveCustomerForm = () => !customerDirty() || confirm("You have unsaved changes to a customer. Leave without saving?");

  // ---------------------------------------------------------------- machines

  function openMachine(machineId, customerId = null) {
    if (!leaveCustomerForm()) return;
    state.editing = null;
    state.draft = null;
    root.innerHTML = `<div data-machine-page></div>`;
    state.machinePage = mountMachine(root.querySelector("[data-machine-page]"), {
      profile,
      machineId,
      customerId,
      customers: state.customers,
      stores: state.stores,
      options: state.options,
      onClose: closeMachine,
    });
    window.scrollTo(0, 0);
  }

  async function closeMachine(message) {
    state.machinePage = null;
    root.innerHTML = `<p class="loading">Loading customers…</p>`;
    await load();
    if (message) notice(root, message, "success");
  }

  // ---------------------------------------------------------------- saving

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
      message = error instanceof api.SaveConflict ? `${error.message} Reload the page and try again.` : api.describe(error);
    }
    state.busy = false;
    render();
    if (message) notice(root, message, kind);
  }

  function saveCustomer() {
    if (showCustomerProblems().length) return;
    const existing = state.editing === "new" ? null : customerFor(state.editing);
    return run(async () => {
      const saved = await api.saveCustomer(existing ?? { organization_id: profile.organization_id }, model.cleanCustomer(state.draft));
      state.editing = null;
      state.draft = null;
      await fetchAll();
      return existing ? `Saved ${saved.name}.` : `Added ${saved.name}. Use Add Machine to add their equipment.`;
    });
  }

  function archiveCustomer(customer) {
    if (customerDirty()) {
      notice(root, "Save or cancel your changes first.", "error");
      return;
    }
    const archiving = !customer.archived_at;
    if (archiving && !confirm(`Archive ${customer.name}? They and their machines are hidden from lists in the app and here. Their history stays, and you can bring them back.`)) return;
    return run(async () => {
      await api.setArchived("customers", customer, archiving);
      state.editing = null;
      state.draft = null;
      await fetchAll();
      return archiving ? `Archived ${customer.name}. Check Show archived to see them.` : `Brought back ${customer.name}.`;
    });
  }

  function deleteCustomer(customer) {
    const count = machinesOf(customer).length;
    const theirLogins = logins.loginsFor(customer, state.people).length;
    const parts = [
      count ? `their ${count} ${count === 1 ? "machine" : "machines"} (with technology, subscriptions, and draft inspections)` : "",
      theirLogins ? `their ${theirLogins} app ${theirLogins === 1 ? "login" : "logins"}` : "",
    ].filter(Boolean);
    if (!confirm(`Delete ${customer.name}${parts.length ? `, ${parts.join(", and ")}` : ""}? They're removed everywhere, including phones. This can't be undone.`)) return;
    return run(async () => {
      await api.deleteCustomer(customer.id);
      state.editing = null;
      state.draft = null;
      await fetchAll();
      return `Deleted ${customer.name}.`;
    });
  }

  function addLogin(customer) {
    const login = state.login;
    if (!customer || logins.newLoginProblems(login, state.people, state.invitations).length) return;
    const password = temporaryPassword();
    const email = login.email.trim().toLowerCase();
    const name = login.full_name.trim();
    return run(async () => {
      const answer = await api.callPeople("create", { email, fullName: name, role: "customer", customerId: customer.id, password });
      state.adding = null;
      state.login = null;
      await fetchAll();
      if (answer?.status === "existing") return `${email} already had a Field Ready login, so it now sees ${customer.name}'s equipment.`;
      state.handover = { kind: "new", name, email, password };
      return `Added a login for ${customer.name}.`;
    });
  }

  function toggleAccess(login) {
    const name = login.full_name || login.email;
    if (login.active && !confirm(`Turn off ${name}'s access? They can't see anything in the app until it's turned back on.`)) return;
    return run(async () => {
      await api.savePerson(login, { active: !login.active });
      await fetchAll();
      return login.active ? `Turned off ${name}'s access.` : `Turned ${name}'s access back on.`;
    });
  }

  function resetPassword(login) {
    const name = login.full_name || login.email;
    if (!confirm(`Make a new temporary password for ${name}? Their current password stops working.`)) return;
    const password = temporaryPassword();
    return run(async () => {
      await api.callPeople("resetPassword", { userId: login.id, password });
      await fetchAll();
      state.handover = { kind: "reset", name, email: login.email, password };
      return `Reset ${name}'s password.`;
    });
  }

  function cancelInvitation(email) {
    if (!confirm(`Cancel the invitation for ${email}?`)) return;
    return run(async () => {
      await api.cancelInvitation(email);
      await fetchAll();
      return "Invitation cancelled.";
    });
  }

  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  root.innerHTML = `<p class="loading">Loading customers…</p>`;
  load();

  /** Whether it's fine to leave: nothing half-entered (here or on an open machine), or the person agrees to lose it. */
  return (silent = false) => {
    if (state.machinePage) return state.machinePage(silent);
    if (!state.adding && !customerDirty()) return true;
    return !silent && confirm("You haven't finished what you were entering. Leave without saving?");
  };
}
