// Customer and machine rules for the Customers & machines page. Pure functions, no page code, so
// they're tested on their own (tests/equipment-model.test.mjs). They follow the app's forms
// (CustomerFormView, MachineFormView, TechnologyConfigView in FieldReadyApp) and the database's
// rules (core schema plus migrations/…_equipment_on_website.sql), which have the final say.

import { isEmail } from "./people-model.js";
import { optionsIn, usedOn } from "./options-model.js";

export const FEATURE_STATES = [
  { value: "installed", label: "Installed" },
  { value: "notInstalled", label: "Not installed" },
  { value: "unknown", label: "Unknown" },
];

export const VERIFICATION = [
  { value: "verified", label: "Verified on machine" },
  { value: "unverified", label: "Not verified" },
  { value: "unknown", label: "Unknown" },
];

export const SUBSCRIPTION_SOURCES = [
  { value: "notVerified", label: "Not verified" },
  { value: "customerReported", label: "Customer reported" },
  { value: "fromDocument", label: "From customer account or document" },
  { value: "providerVerified", label: "Verified with provider" },
];

// ---------------------------------------------------------------- who may do what

/** Everyone on staff adds and edits at their own store; owners at every store. */
export const canEdit = (viewer, storeId) =>
  viewer.role === "owner" || ((viewer.role === "admin" || viewer.role === "employee") && storeId === viewer.location_id);

/** Archiving and deleting: owners anywhere, admins at their own store. */
export const canManage = (viewer, storeId) =>
  viewer.role === "owner" || (viewer.role === "admin" && storeId === viewer.location_id);

/** Stores a person can put a customer or machine in (plus the record's current store). */
export function storesFor(viewer, stores, current = null) {
  return stores.filter((store) => store.id === current || (store.active && (viewer.role === "owner" || store.id === viewer.location_id)));
}

/** A machine with a finalized inspection is permanent history: archive it instead. */
export const canDeleteMachine = (machine) => (machine.finalized ?? 0) === 0;

/** Deleting a customer deletes their machines, so none may have finalized inspections. */
export const canDeleteCustomer = (customer, machines) =>
  machines.filter((m) => m.customer_id === customer.id).every(canDeleteMachine);

// ---------------------------------------------------------------- saving

export function customerProblems(customer) {
  const found = [];
  if (!String(customer.name ?? "").trim()) found.push("Enter the customer's name.");
  if (String(customer.email ?? "").trim() && !isEmail(customer.email)) found.push("Check the email address. It should look like name@example.com.");
  if (!customer.location_id) found.push("Choose a store.");
  return found;
}

export function machineProblems(machine) {
  const found = [];
  if (!String(machine.manufacturer ?? "").trim() && !String(machine.model_name ?? "").trim()) found.push("Enter the manufacturer or model.");
  if (!machine.customer_id) found.push("Choose the customer.");
  if (!machine.location_id) found.push("Choose a store.");
  const year = String(machine.model_year ?? "").trim();
  if (year && !/^(19|20)\d\d$/.test(year)) found.push("Enter the model year as four digits, or leave it blank.");
  return found;
}

/** Trimmed values in the shape the database takes. */
export function cleanCustomer(customer) {
  return {
    name: customer.name.trim(),
    phone: String(customer.phone ?? "").trim(),
    email: String(customer.email ?? "").trim().toLowerCase(),
    location_id: customer.location_id,
  };
}

export function cleanMachine(machine, rows = []) {
  const year = String(machine.model_year ?? "").trim();
  const type = machine.equipment_type || "tractor";
  return {
    customer_id: machine.customer_id,
    location_id: machine.location_id,
    equipment_type: machine.equipment_type || "tractor",
    manufacturer: String(machine.manufacturer ?? "").trim(),
    model_name: String(machine.model_name ?? "").trim(),
    model_year: year ? Number(year) : null,
    serial_number: String(machine.serial_number ?? "").trim(),
    yard_location: String(machine.yard_location ?? "").trim(),
    guidance_system: machine.guidance_system || "other",
    guidance_software: machine.guidance_software || "unknown",
    steering: machine.steering || "unknown",
    correction: machine.correction || "unknown",
    details: cleanAnswers(rows, type, machine.details),
  };
}

/**
 * A machine's answers as saved: answered questions only, dropping answers to questions that only
 * other equipment types ask (a question this page doesn't know is kept).
 */
export function cleanAnswers(rows, type, details) {
  return Object.fromEntries(Object.entries(details ?? {}).filter(([question, answer]) => {
    if (!question || !String(answer ?? "").trim()) return false;
    const known = rows.find((row) => row.list === "machine_question" && row.value === question);
    return !known || usedOn(known).includes(type);
  }));
}

// ---------------------------------------------------------------- options

/** Whether machines of this type can carry guidance technology (the app's rule: tractors, unless the type says). */
export function canHaveGuidance(rows, type) {
  const row = rows.find((r) => r.list === "equipment_type" && r.value === type);
  return typeof row?.details?.guidance === "boolean" ? row.details.guidance : type === "tractor";
}

/** Whether machines of this type record Precision Planting products. */
export function hasPlanterTechnology(rows, type) {
  const row = rows.find((r) => r.list === "equipment_type" && r.value === type);
  return typeof row?.details?.planter === "boolean" ? row.details.planter : type === "planter";
}

/** The questions asked about a machine of this type, in order (plus `answered` ones that are hidden). */
export const questionsFor = (rows, type, answered = []) => {
  const shown = choices(rows, "machine_question", { equipmentType: type });
  for (const value of answered) {
    const row = rows.find((r) => r.list === "machine_question" && r.value === value);
    if (row && !shown.includes(row) && usedOn(row).includes(type)) shown.push(row);
  }
  return shown;
};

/** A question's answers, in order, plus the current answer when it's hidden or unknown. */
export function answerChoices(rows, question, current = null) {
  const all = optionsIn(rows, "machine_answer", question);
  const shown = all.filter((row) => row.active);
  if (current && !shown.some((row) => row.value === current)) {
    shown.push(all.find((row) => row.value === current) ?? { list: "machine_answer", value: current, label: current, active: false, details: {} });
  }
  return shown;
}

/** Whether a guidance system is factory-integrated (its software and steering are built in). */
export const isFactoryIntegrated = (rows, system) =>
  rows.some((row) => row.list === "guidance_system" && row.value === system && row.details?.factoryIntegrated === true);

/** A factory-integrated system has factory steering; switching away from one clears it (as the app does). */
export function steeringFor(rows, system, steering) {
  if (isFactoryIntegrated(rows, system)) return "factoryIntegrated";
  return steering === "factoryIntegrated" ? "unknown" : steering;
}

/**
 * A list's options for a picker: active ones (for features and component types, only those used on
 * the machine's equipment type), plus the current value when it's hidden, so it still shows.
 */
export function choices(rows, list, { equipmentType = null, current = null } = {}) {
  const fits = (row) => row.active && (!equipmentType || !["feature", "component_kind", "machine_question"].includes(list) || usedOn(row).includes(equipmentType));
  const shown = optionsIn(rows, list).filter(fits);
  if (current && !shown.some((row) => row.value === current)) {
    const kept = optionsIn(rows, list).find((row) => row.value === current);
    shown.push(kept ?? { list, value: current, label: current, active: false, details: {} });
  }
  return shown;
}

export const labelFor = (rows, list, value) => rows.find((row) => row.list === list && row.value === value)?.label ?? value ?? "";

/** Component types that have a correction level (GNSS receivers). */
export const hasCorrectionLevel = (rows, kind) =>
  rows.some((row) => row.list === "component_kind" && row.value === kind && row.details?.correctionLevel === true);

/** Listed correction services for a correction type, grouped under their heading, in order. */
export function serviceGroups(rows, correctionType) {
  const groups = [];
  for (const row of optionsIn(rows, "correction_service", correctionType).filter((r) => r.active)) {
    const provider = row.details?.provider ?? "";
    const title = row.details?.group || provider;
    let group = groups.find((g) => g.title === title && g.provider === provider);
    if (!group) groups.push(group = { title, provider, services: [] });
    group.services.push(row.label);
  }
  return groups;
}

// ---------------------------------------------------------------- features

/**
 * What to save for a machine's features: updates to rows it has, inserts for kinds it doesn't
 * (never a second row for a kind), skipping anything unchanged. A kind with no row reads as
 * Unknown, so leaving it Unknown needs nothing saved.
 */
export function featureChanges(existing, desired) {
  const updates = [];
  const inserts = [];
  for (const [kind, state] of Object.entries(desired)) {
    const row = existing.find((f) => f.kind === kind);
    if (row) {
      if (row.state !== state) updates.push({ ...row, state });
    } else if (state !== "unknown") {
      inserts.push({ kind, state });
    }
  }
  return { updates, inserts };
}

/** The machine's state for each feature kind ("unknown" when it has no row). */
export const featureStates = (features) => Object.fromEntries(features.map((f) => [f.kind, f.state]));

// ---------------------------------------------------------------- display

export const machineName = (machine) =>
  [machine.manufacturer, machine.model_name].filter((part) => String(part ?? "").trim()).join(" ") || "Unnamed machine";

/** Customers matching a search (customer name, email, phone, or any of their machines). */
export function findCustomers(customers, machines, { search = "", store = "", archived = false } = {}) {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return customers
    .filter((c) => (archived || !c.archived_at) && (!store || c.location_id === store))
    .filter((c) => {
      const theirs = machines.filter((m) => m.customer_id === c.id);
      const text = [c.name, c.email, c.phone, ...theirs.flatMap((m) => [m.manufacturer, m.model_name, m.serial_number])].join(" ").toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
