// The People & stores page: who can sign in to Field Ready, with what role, at which store; the
// stores themselves; and each store's contacts for customers. Customer logins are on the
// Customers page.
//
// Owners manage everyone and every store. Admins manage the employees at their own store. New logins
// and password resets go through the `people` server function (they need Supabase's secret key);
// everything else goes straight to the database, whose access rules have the final say.

import * as api from "../api.js";
import { escape, attr, notice } from "../ui.js";
import * as model from "../people-model.js";
import { canEditContacts, contactGroups, contactProblems } from "../customers-model.js";

export function mountPeople(root, { profile }) {
  const isOwner = profile.role === "owner";
  const viewer = { id: profile.id, role: profile.role, location_id: profile.location_id };
  const blankPerson = () => ({ full_name: "", email: "", role: "employee", location_id: isOwner ? "" : profile.location_id });
  const state = {
    /** Staff only; `everyone` and `allInvitations` include customer logins, so no email is used twice. */
    people: [],
    everyone: [],
    invitations: [],
    allInvitations: [],
    stores: [],
    contacts: [],
    /** The store whose contacts are open (owners pick one; admins see their own). */
    contactsStore: isOwner ? null : profile.location_id,
    /** A contact being added: its store, role, and details so far. */
    newContact: null,
    /** Owners: the store whose people are shown, or "" for everyone. */
    filter: "",
    /** The person being edited, and the edits so far. */
    editing: null,
    edits: null,
    adding: false,
    newPerson: blankPerson(),
    /** A temporary password to give someone, shown until dismissed. */
    handover: null,
    busy: false,
    loadError: null,
  };

  const storeName = (id) => state.stores.find((store) => store.id === id)?.name ?? (id ? "Unknown store" : "Every store");
  const activeStores = () => state.stores.filter((store) => store.active);
  const personFor = (id) => state.people.find((person) => person.id === id);
  const permissionsFor = (person) => model.permissions(viewer, person, state.people);
  const canChange = (person) => Object.values(permissionsFor(person)).some(Boolean);

  // ---------------------------------------------------------------- loading

  async function fetchAll() {
    const [people, invitations, stores, contacts] = await Promise.all([
      api.loadPeople(), api.loadInvitations(), api.loadStores(), api.loadContacts(),
    ]);
    state.everyone = people;
    state.people = model.sortPeople(people.filter((person) => person.role !== "customer"));
    state.allInvitations = invitations;
    state.invitations = invitations.filter((invite) => invite.role !== "customer");
    state.stores = stores;
    state.contacts = contacts;
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
        <div class="card"><h2>Couldn't load people and stores</h2><p>${escape(state.loadError)}</p>
        <button class="secondary" data-action="reload">Try Again</button></div>`;
      return;
    }
    root.innerHTML = `
      <div data-notice></div>
      <div class="toolbar">
        <div>
          <h1>People &amp; stores</h1>
          <p class="meta">Who can sign in to Field Ready, with what role, and at which store.</p>
        </div>
        <div class="actions">
          <button class="primary" data-action="add"${attr("disabled", state.adding || state.busy)}>Add Person</button>
        </div>
      </div>
      ${isOwner ? "" : `<p class="callout">As an admin you add and manage the employees at ${escape(storeName(profile.location_id))}. Owners manage everyone else and the stores.</p>`}
      ${handoverCard()}
      ${state.adding ? addForm() : ""}
      ${peopleCard()}
      ${waitingCard()}
      ${isOwner ? storesCard() : ""}
      ${!isOwner && canEditContacts(viewer, profile.location_id) ? `
        <div class="card">
          <h2>Contacts for customers</h2>
          <p class="hint">Customers of ${escape(storeName(profile.location_id))} see these people on their app's Home screen.</p>
          ${contactsPanel(profile.location_id)}
        </div>` : ""}`;
  }

  // ---------------------------------------------------------------- store contacts

  function contactsPanel(storeId) {
    const editable = canEditContacts(viewer, storeId);
    return `
      <div class="contacts">
        ${contactGroups(state.contacts, storeId).map((group) => `
          <fieldset>
            <legend>${escape(group.label)}</legend>
            ${group.contacts.length ? group.contacts.map((contact) => contactRow(contact, editable)).join("") : '<p class="hint">Nobody yet.</p>'}
            ${state.newContact?.location_id === storeId && state.newContact.role === group.value
              ? newContactRow()
              : editable ? `<button class="add" data-action="add-contact" data-store="${escape(storeId)}" data-role="${group.value}"${attr("disabled", state.busy)}>+ Add ${escape(group.label)}</button>` : ""}
          </fieldset>`).join("")}
      </div>`;
  }

  function contactRow(contact, editable) {
    const id = escape(contact.id);
    const disabled = attr("disabled", !editable || state.busy);
    return `
      <div class="contact-row">
        <label>Name <input data-contact="${id}" data-contact-field="name" value="${escape(contact.name)}"${disabled}></label>
        <label>Phone <input data-contact="${id}" data-contact-field="phone" type="tel" value="${escape(contact.phone)}"${disabled}></label>
        <label>Email <input data-contact="${id}" data-contact-field="email" type="email" value="${escape(contact.email)}"${disabled}></label>
        ${editable ? `<button class="danger" data-action="remove-contact" data-id="${id}"${attr("disabled", state.busy)}>Remove</button>` : ""}
      </div>`;
  }

  function newContactRow() {
    const contact = state.newContact;
    return `
      <div class="contact-row new">
        <label>Name <input data-new-contact="name" value="${escape(contact.name)}" autocomplete="off"></label>
        <label>Phone <input data-new-contact="phone" type="tel" value="${escape(contact.phone)}" autocomplete="off"></label>
        <label>Email <input data-new-contact="email" type="email" value="${escape(contact.email)}" autocomplete="off"></label>
        <span class="tools">
          <button class="primary" data-action="save-new-contact"${attr("disabled", state.busy)}>Save</button>
          <button class="secondary" data-action="cancel-contact">Cancel</button>
        </span>
      </div>`;
  }

  function saveContactField(id, field, value) {
    const contact = state.contacts.find((c) => c.id === id);
    if (!contact || contact[field] === value.trim()) return;
    const changed = { ...contact, [field]: value };
    const problems = contactProblems(changed);
    if (problems.length) {
      notice(root, problems[0], "error");
      return;
    }
    return run(async () => {
      await api.saveContact(changed);
      await fetchAll();
      return `Saved ${changed.name.trim()}. Customers see the change at their next sync.`;
    });
  }

  function saveNewContact() {
    const contact = state.newContact;
    const problems = contactProblems(contact);
    if (problems.length) {
      notice(root, problems[0], "error");
      return;
    }
    const sameGroup = state.contacts.filter((c) => c.location_id === contact.location_id && c.role === contact.role);
    return run(async () => {
      await api.saveContact({ ...contact, organization_id: profile.organization_id, sort_order: sameGroup.length });
      state.newContact = null;
      await fetchAll();
      return `Added ${contact.name.trim()}. Customers see them at their next sync.`;
    });
  }

  function removeContact(id) {
    const contact = state.contacts.find((c) => c.id === id);
    if (!contact || !confirm(`Remove ${contact.name} from ${storeName(contact.location_id)}'s contacts?`)) return;
    return run(async () => {
      await api.deleteContact(id);
      await fetchAll();
      return `Removed ${contact.name}.`;
    });
  }

  function handoverCard() {
    const handover = state.handover;
    if (!handover) return "";
    return `
      <div class="card handover" role="status">
        <h2>${handover.kind === "reset" ? "New temporary password for" : "Give"} ${escape(handover.name)}${handover.kind === "reset" ? "" : " their temporary password"}</h2>
        <p class="password"><code data-password>${escape(handover.password)}</code>
          <button class="secondary" data-action="copy">Copy</button></p>
        <p>They sign in to the Field Ready app with <strong>${escape(handover.email)}</strong> and this password, then change it
          in Settings › Change Password. It isn't shown again once you close this.</p>
        <button class="link" data-action="dismiss-handover">Done</button>
      </div>`;
  }

  function roleOptions(selected, allowed) {
    return model.ROLES.filter((role) => allowed.includes(role.value))
      .map((role) => `<option value="${role.value}"${attr("selected", role.value === selected)}>${escape(role.label)}: ${escape(role.about)}</option>`)
      .join("");
  }

  function storeOptions(selected, { includeInactive = false } = {}) {
    const stores = includeInactive ? state.stores : state.stores.filter((store) => store.active || store.id === selected);
    return `<option value=""${attr("selected", !selected)}>Choose a store</option>`
      + stores.map((store) => `<option value="${escape(store.id)}"${attr("selected", store.id === selected)}>${escape(store.name)}${store.active ? "" : " (turned off)"}</option>`).join("");
  }

  function addForm() {
    const person = state.newPerson;
    const problems = model.newPersonProblems(person, viewer, state.everyone, state.allInvitations);
    const isNewOwner = person.role === "owner";
    return `
      <form class="card" data-add-form>
        <h2>Add a person</h2>
        <div class="grid2">
          <label>Name <input data-new="full_name" value="${escape(person.full_name)}" autocomplete="off"></label>
          <label>Email <input data-new="email" type="email" value="${escape(person.email)}" autocomplete="off"></label>
          <label>Role
            <select data-new="role"${attr("disabled", !isOwner)}>${roleOptions(person.role, model.rolesFor(viewer))}</select>
          </label>
          <label>Store
            ${isOwner
              ? `<select data-new="location_id"${attr("disabled", isNewOwner)}>${isNewOwner ? '<option value="">Every store (owners)</option>' : storeOptions(person.location_id)}</select>`
              : `<input value="${escape(storeName(profile.location_id))}" disabled>`}
          </label>
        </div>
        <p class="hint">Adding them creates their login with a temporary password for you to give them.</p>
        <p class="form-error" data-new-problems>${person.email || person.full_name ? escape(problems[0] ?? "") : ""}</p>
        <div class="actions">
          <button class="primary" type="submit" data-submit${attr("disabled", problems.length > 0 || state.busy)}>Add Person</button>
          <button class="secondary" type="button" data-action="cancel-add">Cancel</button>
        </div>
      </form>`;
  }

  function peopleCard() {
    const shown = state.people.filter((person) => !state.filter || person.location_id === state.filter);
    const filter = isOwner ? `
      <label class="inline">Show
        <select data-field="filter">
          <option value="">Everyone</option>
          ${state.stores.map((store) => `<option value="${escape(store.id)}"${attr("selected", store.id === state.filter)}>${escape(store.name)}</option>`).join("")}
        </select>
      </label>` : "";
    return `
      <div class="card">
        <div class="detail-head"><h2>People</h2>${filter}</div>
        ${shown.length ? `<ol class="person-list">${shown.map(personRow).join("")}</ol>` : '<p class="hint">Nobody here yet.</p>'}
      </div>`;
  }

  function personRow(person) {
    if (state.editing === person.id) return editRow(person);
    const you = person.id === viewer.id ? " <small>(you)</small>" : "";
    return `
      <li class="person${person.active ? "" : " off"}">
        <div class="person-main">
          <span><strong>${escape(person.full_name || person.email)}</strong>${you}</span>
          <span class="hint">${escape(person.email)}</span>
        </div>
        <div class="person-meta">
          <span class="role role-${escape(person.role)}">${escape(model.roleLabel(person.role))}</span>
          <span>${escape(person.role === "owner" ? "Every store" : storeName(person.location_id))}</span>
          ${person.active ? "" : '<span class="access-off">Access off</span>'}
        </div>
        <div class="person-actions">
          ${canChange(person) ? `<button class="secondary" data-action="edit" data-id="${escape(person.id)}"${attr("disabled", state.busy)}>Edit</button>` : ""}
        </div>
      </li>`;
  }

  function editRow(person) {
    const can = permissionsFor(person);
    const edits = state.edits;
    const isOwnerRole = edits.role === "owner";
    return `
      <li class="person editing">
        <div class="grid2">
          <label>Name <input data-edit="full_name" value="${escape(edits.full_name)}"${attr("disabled", !can.name)}></label>
          <label>Email <input value="${escape(person.email)}" disabled></label>
          <label>Role <select data-edit="role"${attr("disabled", !can.role)}>${roleOptions(edits.role, can.role ? model.rolesFor(viewer) : [person.role])}</select></label>
          <label>Store
            <select data-edit="location_id"${attr("disabled", !can.store || isOwnerRole)}>${isOwnerRole ? '<option value="">Every store (owners)</option>' : storeOptions(edits.location_id)}</select>
          </label>
        </div>
        <label class="check"><input type="checkbox" data-edit="active"${attr("checked", edits.active)}${attr("disabled", !can.access)}> Can sign in to Field Ready</label>
        ${person.id === viewer.id ? '<p class="hint">You can\'t turn off your own access.</p>' : ""}
        ${model.isLastOwner(person, state.people) ? '<p class="hint">The only owner stays an owner with access. Make someone else an owner first.</p>' : ""}
        <p class="form-error" data-edit-problem></p>
        <div class="actions">
          <button class="primary" data-action="save-person" data-id="${escape(person.id)}"${attr("disabled", state.busy)}>Save</button>
          <button class="secondary" data-action="cancel-edit">Cancel</button>
          ${can.password ? `<button class="link" data-action="reset-password" data-id="${escape(person.id)}"${attr("disabled", state.busy)}>Reset Password</button>` : ""}
        </div>
      </li>`;
  }

  function waitingCard() {
    if (state.invitations.length === 0) return "";
    return `
      <div class="card">
        <h2>Waiting for a login</h2>
        <p class="hint">Invited before the website could create logins, or interrupted. Cancel them and add them again to create the login.</p>
        <ol class="person-list">
          ${state.invitations.map((invite) => `
            <li class="person">
              <div class="person-main"><strong>${escape(invite.full_name || invite.email)}</strong><span class="hint">${escape(invite.email)}</span></div>
              <div class="person-meta">
                <span class="role role-${escape(invite.role)}">${escape(model.roleLabel(invite.role))}</span>
                <span>${escape(invite.role === "owner" ? "Every store" : storeName(invite.location_id))}</span>
              </div>
              <div class="person-actions"><button class="danger" data-action="cancel-invite" data-email="${escape(invite.email)}"${attr("disabled", state.busy)}>Cancel</button></div>
            </li>`).join("")}
        </ol>
      </div>`;
  }

  function storesCard() {
    const count = (id) => state.people.filter((person) => person.location_id === id && person.active).length;
    const contactCount = (id) => state.contacts.filter((contact) => contact.location_id === id).length;
    return `
      <div class="card">
        <h2>Stores</h2>
        <p class="hint">A store that's turned off disappears from the app's store pickers. Its machines, people, and history stay.
          Each store's contacts are who its customers see on their app's Home screen.</p>
        <ol class="store-list">
          ${state.stores.map((store) => `
            <li class="store${store.active ? "" : " off"}">
              <label class="store-name">Name <input data-store-name="${escape(store.id)}" value="${escape(store.name)}"${attr("disabled", state.busy)}></label>
              <label class="check"><input type="checkbox" data-store-active="${escape(store.id)}"${attr("checked", store.active)}${attr("disabled", state.busy)}> In use</label>
              <span class="hint">${count(store.id)} ${count(store.id) === 1 ? "person" : "people"}</span>
              <button class="link" data-action="toggle-contacts" data-store="${escape(store.id)}"${attr("aria-expanded", state.contactsStore === store.id)}>
                ${state.contactsStore === store.id ? "Hide contacts" : `Contacts (${contactCount(store.id)})`}</button>
              ${state.contactsStore === store.id ? `<div class="store-contacts">${contactsPanel(store.id)}</div>` : ""}
            </li>`).join("")}
        </ol>
        <form class="add-option" data-add-store>
          <label>Add a store <input name="name" placeholder="Store name" autocomplete="off"></label>
          <button class="secondary" type="submit"${attr("disabled", state.busy)}>Add</button>
        </form>
      </div>`;
  }

  // ---------------------------------------------------------------- editing

  /** Keeps the add form's button and first problem current without redrawing (typing isn't interrupted). */
  function refreshAddForm() {
    const problems = model.newPersonProblems(state.newPerson, viewer, state.everyone, state.allInvitations);
    const area = root.querySelector("[data-new-problems]");
    if (area) area.textContent = state.newPerson.email || state.newPerson.full_name ? problems[0] ?? "" : "";
    const submit = root.querySelector("[data-submit]");
    if (submit) submit.disabled = problems.length > 0 || state.busy;
  }

  function onInput(event) {
    const element = event.target;
    if (element.dataset.field === "filter") {
      state.filter = element.value;
      return render();
    }
    if (element.dataset.new) {
      const field = element.dataset.new;
      state.newPerson[field] = element.value;
      if (field === "role") {
        if (element.value === "owner") state.newPerson.location_id = null;
        else if (!state.newPerson.location_id) state.newPerson.location_id = "";
        return render();
      }
      return refreshAddForm();
    }
    if (element.dataset.newContact && state.newContact) {
      state.newContact[element.dataset.newContact] = element.value;
      return;
    }
    if (element.dataset.edit && state.edits) {
      const field = element.dataset.edit;
      state.edits[field] = element.type === "checkbox" ? element.checked : element.value;
      if (field === "role") {
        if (element.value === "owner") state.edits.location_id = null;
        return render();
      }
    }
  }

  async function onChange(event) {
    onInput(event);
    const element = event.target;
    if (element.dataset.contact) return saveContactField(element.dataset.contact, element.dataset.contactField, element.value);
    if (element.dataset.storeName) return renameStore(element.dataset.storeName, element.value);
    if (element.dataset.storeActive) return setStoreActive(element.dataset.storeActive, element.checked, element);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (event.target.closest("[data-add-form]")) return addPerson();
    const storeForm = event.target.closest("[data-add-store]");
    if (storeForm) {
      const name = storeForm.name.value.trim();
      if (!name) return;
      return run(async () => {
        await api.addStore(profile.organization_id, name);
        await fetchAll();
        return `Added ${name}. Phones see it at their next sync.`;
      });
    }
  }

  async function onClick(event) {
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    const person = personFor(element.dataset.id);
    switch (element.dataset.action) {
      case "reload": return load();
      case "add":
        state.adding = true;
        state.newPerson = blankPerson();
        render();
        root.querySelector('[data-new="full_name"]')?.focus();
        return;
      case "cancel-add":
        state.adding = false;
        return render();
      case "edit":
        state.editing = person.id;
        state.edits = { full_name: person.full_name, role: person.role, location_id: person.location_id, active: person.active };
        return render();
      case "cancel-edit":
        state.editing = null;
        state.edits = null;
        return render();
      case "save-person": return savePerson(person);
      case "reset-password": return resetPassword(person);
      case "cancel-invite": return cancelInvitation(element.dataset.email);
      case "toggle-contacts":
        state.contactsStore = state.contactsStore === element.dataset.store ? null : element.dataset.store;
        state.newContact = null;
        return render();
      case "add-contact":
        state.newContact = { location_id: element.dataset.store, role: element.dataset.role, name: "", phone: "", email: "" };
        render();
        root.querySelector('[data-new-contact="name"]')?.focus();
        return;
      case "cancel-contact":
        state.newContact = null;
        return render();
      case "save-new-contact": return saveNewContact();
      case "remove-contact": return removeContact(element.dataset.id);
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

  // ---------------------------------------------------------------- saving

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
      message = error instanceof api.SaveConflict ? `${error.message} Reload the page and try again.` : api.describe(error);
    }
    state.busy = false;
    render();
    if (message) notice(root, message, kind);
  }

  function addPerson() {
    const person = state.newPerson;
    if (model.newPersonProblems(person, viewer, state.everyone, state.allInvitations).length) return;
    const password = model.temporaryPassword();
    const email = person.email.trim().toLowerCase();
    const name = person.full_name.trim();
    return run(async () => {
      const answer = await api.callPeople("create", {
        email, fullName: name, role: person.role, locationId: person.role === "owner" ? null : person.location_id, password,
      });
      state.adding = false;
      await fetchAll();
      if (answer?.status === "existing") {
        return `${name} already had a Field Ready login, so they can sign in now with their own password.`;
      }
      state.handover = { kind: "new", name, email, password };
      return `Added ${name}.`;
    });
  }

  function savePerson(person) {
    const edits = state.edits;
    const changes = {};
    if (edits.full_name.trim() !== person.full_name) changes.full_name = edits.full_name.trim();
    if (edits.role !== person.role) changes.role = edits.role;
    const location = edits.role === "owner" ? null : edits.location_id || null;
    if (location !== person.location_id) changes.location_id = location;
    if (edits.active !== person.active) changes.active = edits.active;
    if (Object.keys(changes).length === 0) {
      state.editing = null;
      return render();
    }
    if (edits.role !== "owner" && !location) {
      root.querySelector("[data-edit-problem]").textContent = "Choose a store.";
      return;
    }
    if (changes.active === false && !confirm(`Turn off ${person.full_name || person.email}'s access? They can't sign in or sync until it's turned back on. Their inspections stay.`)) return;
    return run(async () => {
      await api.savePerson(person, changes);
      state.editing = null;
      state.edits = null;
      await fetchAll();
      return `Saved ${edits.full_name.trim() || person.email}. The app picks up the change the next time they open it.`;
    });
  }

  function resetPassword(person) {
    const name = person.full_name || person.email;
    if (!confirm(`Make a new temporary password for ${name}? Their current password stops working.`)) return;
    const password = model.temporaryPassword();
    return run(async () => {
      await api.callPeople("resetPassword", { userId: person.id, password });
      state.editing = null;
      state.edits = null;
      state.handover = { kind: "reset", name, email: person.email, password };
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

  function renameStore(id, name) {
    const store = state.stores.find((s) => s.id === id);
    if (!store || !name.trim() || name.trim() === store.name) return render();
    return run(async () => {
      await api.saveStore(store, { name: name.trim() });
      await fetchAll();
      return `Renamed to ${name.trim()}. Phones show the new name at their next sync.`;
    });
  }

  function setStoreActive(id, active, checkbox) {
    const store = state.stores.find((s) => s.id === id);
    if (!store) return;
    if (!active && !confirm(`Stop using ${store.name}? It disappears from the app's store pickers. Its machines, people, and history stay.`)) {
      checkbox.checked = true;
      return;
    }
    return run(async () => {
      await api.saveStore(store, { active });
      await fetchAll();
      return active ? `${store.name} is back in use.` : `${store.name} is no longer offered in the app.`;
    });
  }

  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  root.innerHTML = `<p class="loading">Loading people and stores…</p>`;
  load();

  /** Whether it's fine to leave: nothing half-entered, or the person agrees to lose it. */
  return (silent = false) => {
    const busy = state.adding && (state.newPerson.email || state.newPerson.full_name);
    const unsaved = busy || state.editing || (state.newContact && state.newContact.name);
    return !unsaved || (!silent && confirm("You have an unfinished change on this page. Leave without saving?"));
  };
}
