// Subscription choices for the Subscriptions page: the correction services technicians pick from
// when they record a machine's subscription, grouped by provider. Pure functions, no page code, so
// they're tested on their own (tests/subscriptions-model.test.mjs). Services are `correction_service`
// options under their correction type (see options-model.js), which the app reads (OptionCatalog).

import { optionsIn, newOption } from "./options-model.js";

/** The heading for services without a provider or heading. Nothing can be added under it. */
export const NO_PROVIDER = "No provider";

/** The heading a service is listed under: its provider, else its heading (like a state RTK network). */
export function headingOf(row) {
  const provider = String(row.details?.provider ?? "").trim();
  if (provider) return { name: provider, field: "provider" };
  const group = String(row.details?.group ?? "").trim();
  return group ? { name: group, field: "group" } : { name: NO_PROVIDER, field: "provider" };
}

/**
 * Services grouped under their provider, alphabetically (No provider last); within each, by
 * correction type, then their order. `extra` names providers just added, which have no services yet.
 */
export function providerGroups(rows, extra = []) {
  const types = optionsIn(rows, "correction_type").map((type) => type.value);
  const rank = (value) => (types.includes(value) ? types.indexOf(value) : types.length);
  const services = rows
    .filter((row) => row.list === "correction_service")
    .sort((a, b) => rank(a.parent_value) - rank(b.parent_value) || a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  const groups = new Map();
  for (const row of services) {
    const heading = headingOf(row);
    const key = heading.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { ...heading, services: [] });
    groups.get(key).services.push(row);
  }
  for (const name of extra) {
    const key = String(name ?? "").trim().toLowerCase();
    if (key && !groups.has(key)) groups.set(key, { name: name.trim(), field: "provider", services: [] });
  }
  return [...groups.values()].sort((a, b) => (a.name === NO_PROVIDER) - (b.name === NO_PROVIDER) || a.name.localeCompare(b.name));
}

/** What stops a new provider from being added, in plain words, or null. */
export function newProviderProblem(name, groups) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "Enter the provider's name.";
  if (groups.some((group) => group.name.toLowerCase() === trimmed.toLowerCase())) return "That provider is already listed.";
  return null;
}

/** What stops a new service from being added, in plain words. Empty when it can be. */
export function newServiceProblems({ label, type }, rows) {
  const found = [];
  const name = String(label ?? "").trim();
  if (!name) found.push("Enter the service's name.");
  if (!type) found.push("Choose its correction type.");
  else if (name && rows.some((row) => row.list === "correction_service" && row.parent_value === type
      && row.label.trim().toLowerCase() === name.toLowerCase())) {
    found.push("That correction type already has a service with that name.");
  }
  return found;
}

/** A new service under a provider (or heading) and correction type, with an optional note. */
export function newService(rows, { label, type, note = "", heading, organizationId }) {
  const row = newOption(rows, "correction_service", label, { organizationId, parent: type });
  row.details[heading.field] = heading.name;
  if (note.trim()) row.details.note = note.trim();
  return row;
}
