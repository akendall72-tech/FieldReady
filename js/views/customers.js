// The Customers page: which customers can sign in to the Field Ready app, and with which logins.
//
// A customer login sees only that customer's equipment, finalized inspections, and subscriptions,
// and who to contact at their store. A farm can have several logins. Owners manage every
// customer's logins; admins those of customers at their own store. Logins and password resets go
// through the `people` server function, like Add Person.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import { temporaryPassword } from "../people-model.js";
import * as model from "../customers-model.js";

export function mountCustomers(root, { profile }) {
  const isOwner = profile.role === "owner";
  const viewer = { id: profile.id, role: profile.role, location_id: profile.location_id };
  const state = {
    customers: [],
    people: [],
    invitations: [],
    stores: [],
    search: "",
    store: "",
    archived: false,
    /** The customer getting a new login, and its details so far. */
    adding: null,
    login: null,
    handover: null,
    busy: false,
    loadError: null,
  };

  const storeName = (id) => state.stores.find((store) => store.id === id)?.name ?? "Unknown store";
  const customerFor = (id) => state.customers.find((customer) => customer.id === id);

  // ---------------------------------------------------------------- loading

  async function fetchAll() {
    const [customers, people, invitations, stores] = await Promise.all([
      api.loadCustomers(), api.loadPeople(), api.loadInvitations(), api.loadStores(),
    ]);
    state.customers = customers;
    state.people = people;
    state.invitations = invitations;
    state.stores = stores;
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
        <div class="card"><h2>Couldn't load customers</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    root.innerHTML = `
      <div data-notice></div>
      <div class="toolbar">
        <div>
          <h1>Customers</h1>
          <p class="meta">Customers with a login see their own equipment, completed inspections, and subscriptions in the
            Field Ready app, and who to contact at their store. They can't change anything.</p>
        </div>
      </div>
      ${isOwner ? "" : `<p class="callout">You manage app logins for customers at ${escape(storeName(profile.location_id))}.</p>`}
      ${handoverCard()}
      <div class="card">
        <div class="filters">
          <label>Search <input data-field="search" value="${escape(state.search)}" placeholder="Name, email, or phone" autocomplete="off"></label>
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
    const shown = model.filterCustomers(state.customers, { search: state.search, store: state.store, archived: state.archived });
    if (shown.length === 0) {
      return `<p class="hint">${state.customers.length ? "No customers match." : "No customers yet. Technicians add them in the app."}</p>`;
    }
    return `<ol class="customer-list">${shown.map(customerRow).join("")}</ol>`;
  }

  function customerRow(customer) {
    const manage = model.canManageCustomer(viewer, customer);
    const logins = model.loginsFor(customer, state.people);
    const waiting = state.invitations.filter((invite) => invite.role === "customer" && invite.customer_id === customer.id);
    const machines = customer.machines?.[0]?.count ?? 0;
    const details = [
      storeName(customer.location_id),
      `${machines} ${machines === 1 ? "machine" : "machines"}`,
      customer.email, customer.phone,
      customer.archived_at ? "Archived" : "",
    ].filter(Boolean);
    return `
      <li class="customer">
        <div class="customer-head">
          <div class="person-main">
            <strong>${escape(customer.name)}</strong>
            <span class="hint">${details.map(escape).join(" · ")}</span>
          </div>
          ${manage && state.adding !== customer.id ? `<button class="secondary" data-action="add-login" data-id="${escape(customer.id)}"${attr("disabled", state.busy)}>Add Login</button>` : ""}
        </div>
        ${logins.length || waiting.length ? `
          <ol class="login-list">
            ${logins.map((login) => loginRow(login, manage)).join("")}
            ${waiting.map((invite) => `
              <li class="login">
                <span><strong>${escape(invite.full_name || invite.email)}</strong> <span class="hint">${escape(invite.email)} · waiting for a login</span></span>
                ${manage ? `<button class="danger" data-action="cancel-invite" data-email="${escape(invite.email)}"${attr("disabled", state.busy)}>Cancel</button>` : ""}
              </li>`).join("")}
          </ol>` : '<p class="hint">No app login yet.</p>'}
        ${state.adding === customer.id ? addForm(customer) : ""}
      </li>`;
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

  function addForm(customer) {
    const login = state.login;
    const problems = model.newLoginProblems(login, state.people, state.invitations);
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

  function refreshList() {
    const list = root.querySelector("[data-customer-list]");
    if (list) list.innerHTML = customerList();
  }

  function refreshAddForm() {
    const problems = model.newLoginProblems(state.login, state.people, state.invitations);
    const area = root.querySelector("[data-login-problems]");
    if (area) area.textContent = problems[0] ?? "";
    const submit = root.querySelector("[data-submit]");
    if (submit) submit.disabled = problems.length > 0 || state.busy;
  }

  function onInput(event) {
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
    if (element.dataset.login && state.login) {
      state.login[element.dataset.login] = element.value;
      refreshAddForm();
    }
  }

  async function onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    const login = state.people.find((person) => person.id === element.dataset.id);
    switch (element.dataset.action) {
      case "reload": return load();
      case "add-login": {
        const customer = customerFor(element.dataset.id);
        state.adding = customer.id;
        state.login = model.newLogin(customer);
        refreshList();
        root.querySelector('[data-login="full_name"]')?.focus();
        return;
      }
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
    const form = event.target.closest("[data-add-form]");
    if (!form) return;
    event.preventDefault();
    addLogin(customerFor(form.dataset.id));
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

  function addLogin(customer) {
    const login = state.login;
    if (!customer || model.newLoginProblems(login, state.people, state.invitations).length) return;
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

  /** Whether it's fine to leave: no half-entered login, or the person agrees to lose it. */
  return (silent = false) => !state.adding || (!silent && confirm("You haven't finished adding a login. Leave without saving?"));
}
