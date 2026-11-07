// My equipment (customer logins): the machines on the customer's own farm, to add and keep up to
// date on a big screen rather than a phone. Each opens the same machine page staff use
// (views/machine.js), limited to what a customer may do. The database allows a customer login only
// its own farm's machines; their changes are marked for the dealer's staff to check.

import * as api from "../api.js";
import { escape, notice } from "../ui.js";
import * as model from "../equipment-model.js";
import { mountMachine } from "./machine.js";

export function mountFarm(root, { profile }) {
  const state = {
    machines: [],
    customers: [],
    stores: [],
    options: [],
    /** While a machine is open: whether it's fine to leave it (from mountMachine). */
    machinePage: null,
    loading: true,
    loadError: null,
  };
  const farmName = profile.customers?.name || "your farm";
  const typeLabel = (type) => model.labelFor(state.options, "equipment_type", type ?? "tractor");

  async function load(message) {
    state.loading = true;
    try {
      const [machines, customers, stores, options] = await Promise.all([
        api.loadMachines(), api.loadCustomers(), api.loadStores(), api.loadOptionRows(),
      ]);
      Object.assign(state, { machines, customers, stores, options, loadError: null });
    } catch (error) {
      state.loadError = api.describe(error);
    }
    state.loading = false;
    render();
    if (message) notice(root, message, "success");
  }

  function machineCard(machine) {
    const facts = [typeLabel(machine.equipment_type), machine.model_year, machine.serial_number ? `Serial ${machine.serial_number}` : ""]
      .filter(Boolean).join(" · ");
    return `
      <li>
        <button class="list-row" data-action="open" data-id="${escape(machine.id)}">
          <strong>${escape(model.machineName(machine))}</strong>
          <span class="meta">${escape(facts)}</span>
          ${machine.finalized ? `<span class="meta">${machine.finalized} finished ${machine.finalized === 1 ? "inspection" : "inspections"}</span>` : ""}
        </button>
      </li>`;
  }

  function render() {
    if (state.machinePage) return;
    const active = state.machines.filter((machine) => !machine.archived_at).sort((a, b) => model.machineName(a).localeCompare(model.machineName(b)));
    const archived = state.machines.filter((machine) => machine.archived_at);
    root.innerHTML = `
      <div data-notice></div>
      <div class="toolbar">
        <div>
          <h1>My equipment</h1>
          <p class="meta">${escape(farmName)}. Add your machines and keep their technology and subscriptions up to date; your dealer sees your changes.</p>
        </div>
        <button class="primary" data-action="add">Add Machine</button>
      </div>
      ${state.loadError ? `<div class="card"><p class="form-error">${escape(state.loadError)}</p><button class="secondary" data-action="reload">Try Again</button></div>` : ""}
      ${state.loading ? '<p class="loading">Loading…</p>' : ""}
      ${!state.loading && !state.loadError ? `
        <div class="card">
          ${active.length ? `<ul class="farm-list">${active.map(machineCard).join("")}</ul>` : '<p class="meta">No machines yet. Tap Add Machine to add your first one.</p>'}
        </div>
        ${archived.length ? `
          <div class="card">
            <h2>Archived</h2>
            <p class="hint">Hidden from your lists with their history kept. Your dealer can bring one back.</p>
            <ul class="farm-list">${archived.map(machineCard).join("")}</ul>
          </div>` : ""}` : ""}`;
  }

  function openMachine(machineId) {
    root.innerHTML = `<div data-machine-page></div>`;
    state.machinePage = mountMachine(root.querySelector("[data-machine-page]"), {
      profile,
      machineId,
      customerId: profile.customer_id,
      customers: state.customers,
      stores: state.stores,
      options: state.options,
      onClose: closeMachine,
    });
  }

  function closeMachine(message) {
    state.machinePage = null;
    load(message);
  }

  root.addEventListener("click", (event) => {
    if (state.machinePage) return;
    const element = event.target.closest("[data-action]");
    if (!element || !root.contains(element)) return;
    switch (element.dataset.action) {
      case "add": return openMachine(null);
      case "open": return openMachine(element.dataset.id);
      case "reload": return load();
    }
  });

  render();
  load();

  /** Leaving with unsaved machine changes asks first, as on Customers & machines. */
  return (silent = false) => !state.machinePage || state.machinePage(silent);
}
