// Promotions: the conditions an offer can set, how they read, and what makes an offer ready to
// publish. Pure functions, no page code, so they're tested on their own
// (tests/promotions-model.test.mjs). The database checks the same conditions
// (private.condition_matches, last in migrations/20261114100000_offer_customer_condition.sql); keep
// the two together.

import { labelFor } from "./equipment-model.js";

/** What a condition's value is, by field and op. */
const VALUE = {
  customer: () => ({ type: "customers" }),
  equipment_type: () => ({ type: "list", list: "equipment_type" }),
  manufacturer: () => ({ type: "text", placeholder: "Fendt" }),
  model_year: () => ({ type: "range" }),
  guidance_system: () => ({ type: "list", list: "guidance_system" }),
  steering: () => ({ type: "list", list: "steering" }),
  correction: () => ({ type: "list", list: "correction_type" }),
  receiver_level: () => ({ type: "list", list: "receiver_correction_level" }),
  component: () => ({ type: "component", list: "component_kind" }),
  feature: () => ({ type: "one", list: "feature" }),
  subscription: (op) => (op === "expires_within" ? { type: "number", unit: "days" } : { type: "none" }),
  inspection: (op) => (op === "none_for_months" ? { type: "number", unit: "months" } : { type: "none" }),
};

/** The conditions owners can choose, in the order the picker shows them. */
export const CONDITIONS = [
  { field: "customer", label: "Customer", ops: [{ op: "in", label: "is" }] },
  { field: "equipment_type", label: "Equipment type", ops: [{ op: "in", label: "is" }] },
  { field: "manufacturer", label: "Make", ops: [{ op: "contains", label: "contains" }] },
  { field: "model_year", label: "Model year", ops: [{ op: "between", label: "is between" }] },
  { field: "guidance_system", label: "Guidance system", ops: [{ op: "in", label: "is" }] },
  { field: "steering", label: "Steering", ops: [{ op: "in", label: "is" }] },
  { field: "correction", label: "Correction source", ops: [{ op: "in", label: "is" }] },
  { field: "receiver_level", label: "Receiver accuracy", ops: [{ op: "in", label: "is" }] },
  { field: "component", label: "Has a component", ops: [{ op: "has", label: "of type" }] },
  { field: "feature", label: "Feature", ops: [{ op: "installed", label: "is installed" }, { op: "not_installed", label: "isn't installed" }] },
  { field: "subscription", label: "Correction subscription", ops: [
    { op: "expires_within", label: "expires within" }, { op: "expired", label: "has expired" }, { op: "none", label: "none recorded" },
  ] },
  { field: "inspection", label: "Inspection", ops: [
    { op: "finding", label: "the last one had a failed check or a recommendation" }, { op: "none_for_months", label: "none in the last" },
  ] },
];

export const conditionInfo = (field) => CONDITIONS.find((c) => c.field === field);
export const valueKind = (condition) => (VALUE[condition.field]?.(condition.op) ?? { type: "none" });

/** A new condition of this kind with sensible starting values. */
export function blankCondition(field = "equipment_type") {
  const info = conditionInfo(field) ?? CONDITIONS[0];
  const op = info.ops[0].op;
  const kind = VALUE[info.field](op);
  return { field: info.field, op, value: startingValue(kind) };
}

function startingValue(kind) {
  switch (kind.type) {
    case "list": return [];
    case "customers": return [];
    case "text": return "";
    case "range": return { from: null, to: null };
    case "component": return { kind: "display", model: "" };
    case "one": return "";
    case "number": return kind.unit === "days" ? 60 : 12;
    default: return null;
  }
}

/** Changing the op can change what the value is (subscription "expires within" takes days). */
export function withOp(condition, op) {
  const kind = VALUE[condition.field]?.(op) ?? { type: "none" };
  const same = valueKind(condition).type === kind.type;
  return { ...condition, op, value: same ? condition.value : startingValue(kind) };
}

const joinOr = (words) => (words.length <= 1 ? words[0] ?? "…" : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`);
const listWords = (rows, list, values) => joinOr((values ?? []).map((value) => labelFor(rows, list, value)));

/** A chosen customer's name, from offer_customers' rows; null for one this person can't see or that's gone. */
export const customerName = (customers, id) => customers.find((c) => c.id === id)?.name ?? null;

/** Customers whose name contains the words, not already chosen; names that start with them first. */
export function findCustomers(customers, query, chosen = [], limit = 8) {
  const words = String(query ?? "").trim().toLowerCase();
  if (!words) return [];
  const name = (c) => String(c.name ?? "").toLowerCase();
  return customers
    .filter((c) => !chosen.includes(c.id) && name(c).includes(words))
    .sort((a, b) => Number(name(b).startsWith(words)) - Number(name(a).startsWith(words)))
    .slice(0, limit);
}

/** One condition in plain words: "Equipment type is Planter or Sprayer". `customers` names chosen customers. */
export function describeCondition(condition, rows = [], customers = []) {
  const v = condition.value;
  switch (condition.field) {
    case "customer": {
      const ids = Array.isArray(v) ? v : [];
      if (!ids.length) return "Customer is …";
      const names = ids.map((id) => customerName(customers, id)).filter(Boolean);
      const others = ids.length - names.length;
      return `Customer is ${joinOr(others ? [...names, others === 1 ? "1 other customer" : `${others} other customers`] : names)}`;
    }
    case "equipment_type": return `Equipment type is ${listWords(rows, "equipment_type", v)}`;
    case "manufacturer": return `Make contains “${String(v ?? "").trim() || "…"}”`;
    case "model_year": {
      const from = v?.from ?? null;
      const to = v?.to ?? null;
      if (from != null && to != null) return `Model year ${from}–${to}`;
      if (from != null) return `Model year ${from} or newer`;
      if (to != null) return `Model year ${to} or older`;
      return "Model year …";
    }
    case "guidance_system": return `Guidance system is ${listWords(rows, "guidance_system", v)}`;
    case "steering": return `Steering is ${listWords(rows, "steering", v)}`;
    case "correction": return `Correction source is ${listWords(rows, "correction_type", v)}`;
    case "receiver_level": return `Receiver accuracy is ${listWords(rows, "receiver_correction_level", v)}`;
    case "component": {
      const kind = labelFor(rows, "component_kind", v?.kind) || "component";
      const model = String(v?.model ?? "").trim();
      return model ? `Has a ${kind.toLowerCase()} whose model contains “${model}”` : `Has a ${kind.toLowerCase()}`;
    }
    case "feature": {
      const feature = labelFor(rows, "feature", v) || "…";
      return condition.op === "installed" ? `${feature} is installed` : `${feature} isn't installed`;
    }
    case "subscription":
      if (condition.op === "expires_within") return `Correction subscription expires within ${v} days`;
      if (condition.op === "expired") return "Correction subscription has expired";
      return "No correction subscription recorded";
    case "inspection":
      if (condition.op === "none_for_months") return `No inspection in the last ${v} months`;
      return "The last inspection had a failed check or a recommendation";
    default: return "Unknown condition";
  }
}

/** What's wrong with a condition, or null. */
export function conditionProblem(condition) {
  const v = condition.value;
  switch (valueKind(condition).type) {
    case "list": return Array.isArray(v) && v.length ? null : `${conditionInfo(condition.field)?.label ?? "Condition"}: choose at least one.`;
    case "customers": return Array.isArray(v) && v.length ? null : "Customer: choose at least one.";
    case "text": return String(v ?? "").trim() ? null : "Make: enter part of the name.";
    case "one": return v ? null : "Feature: choose one.";
    case "range": {
      const from = v?.from ?? null;
      const to = v?.to ?? null;
      const year = (n) => n == null || (Number.isInteger(n) && n >= 1950 && n <= 2100);
      if (from == null && to == null) return "Model year: enter a first or last year.";
      if (!year(from) || !year(to)) return "Model year: use four-digit years.";
      if (from != null && to != null && from > to) return "Model year: the first year comes before the last.";
      return null;
    }
    case "number": return Number.isInteger(v) && v > 0 && v <= 3650 ? null : `${conditionInfo(condition.field)?.label ?? "Condition"}: enter a whole number.`;
    default: return null;
  }
}

export function blankOffer(today) {
  return { id: null, title: "", description: "", deal: "", code: "", starts_on: today, ends_on: addDays(today, 30), store_ids: [], rules: [], status: "draft" };
}

export function addDays(day, days) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Everything that stops an offer being saved or published, in order. */
export function offerProblems(offer) {
  const problems = [];
  if (!offer.title.trim()) problems.push("Give the offer a title.");
  if (offer.title.trim().length > 80) problems.push("Keep the title to 80 characters.");
  if (offer.deal.trim().length > 80) problems.push("Keep the deal to 80 characters.");
  if (offer.description.trim().length > 600) problems.push("Keep the description to 600 characters.");
  if (offer.code.trim().length > 40) problems.push("Keep the code to 40 characters.");
  if (!offer.starts_on || !offer.ends_on) problems.push("Choose when the offer starts and ends.");
  else if (offer.ends_on < offer.starts_on) problems.push("The offer has to end on or after the day it starts.");
  if (offer.rules.length > 12) problems.push("Use 12 conditions at most.");
  for (const condition of offer.rules) {
    const problem = conditionProblem(condition);
    if (problem) problems.push(problem);
  }
  return problems;
}

/** The columns saved for an offer. */
export const cleanOffer = (offer) => ({
  title: offer.title.trim(), description: offer.description.trim(), deal: offer.deal.trim(), code: offer.code.trim(),
  starts_on: offer.starts_on, ends_on: offer.ends_on, store_ids: offer.store_ids ?? [], rules: offer.rules ?? [],
});

/** Where an offer is in its life, as the list shows it. */
export function offerState(offer, today) {
  if (offer.status === "draft") return { key: "draft", label: "Draft" };
  if (offer.status === "stopped") return { key: "ended", label: "Stopped" };
  if (offer.ends_on < today) return { key: "ended", label: "Ended" };
  if (offer.starts_on > today) return { key: "scheduled", label: "Starts " + offer.starts_on };
  return { key: "running", label: "Running" };
}

/** How customers responded to an offer, from offer_results' rows (counted on the server); zeros before anyone has. */
export function resultsFor(results, promotionId) {
  const row = results.find((r) => r.promotion_id === promotionId);
  return { seen: row?.seen ?? 0, interested: row?.interested ?? 0, notNow: row?.not_now ?? 0, sold: row?.sold ?? 0 };
}

export const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "sold", label: "Sold" },
  { value: "notInterested", label: "Not interested" },
];
export const leadStatusLabel = (value) => LEAD_STATUSES.find((s) => s.value === value)?.label ?? "New";
export const isOpenLead = (lead) => !lead.lead_status || lead.lead_status === "new" || lead.lead_status === "contacted";

/** "Matches 23 customers, 31 machines" from offer_audience_summary (counted on the server). */
export function audienceWords({ customers = 0, machines = 0 } = {}) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `Matches ${plural(customers, "customer")}, ${plural(machines, "machine")}`;
}

/** Stores an offer reaches, in words. */
export function storesWords(offer, stores) {
  if (!offer.store_ids?.length) return "Every store";
  return offer.store_ids.map((id) => stores.find((s) => s.id === id)?.name ?? "A removed store").join(", ");
}
