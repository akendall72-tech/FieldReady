// The Activity page's wording: who did what, from the database's activity log (public.activity_log,
// written by triggers and the people server function). Pure functions, no page code, so they're
// tested on their own (tests/activity-model.test.mjs).

import { listInfo } from "./options-model.js";

/** The page's filters, and the actions (by prefix) each one shows. */
export const ACTIVITY_GROUPS = [
  { id: "all", label: "All", prefixes: [] },
  { id: "people", label: "People", prefixes: ["person.", "login.", "two_step."] },
  { id: "stores", label: "Stores", prefixes: ["store.", "contact.", "organization."] },
  { id: "forms", label: "Forms", prefixes: ["form."] },
  { id: "options", label: "Options", prefixes: ["option."] },
  { id: "records", label: "Records", prefixes: ["customer.", "machine.", "inspection."] },
  { id: "emails", label: "Emails", prefixes: ["email."] },
];

/** The filter's actions, as a PostgREST "or" filter (null: everything). */
export function groupFilter(groupId) {
  const group = ACTIVITY_GROUPS.find((g) => g.id === groupId);
  if (!group || group.prefixes.length === 0) return null;
  return group.prefixes.map((prefix) => `action.like.${prefix}*`).join(",");
}

const ROLES = { owner: "owner", admin: "admin", employee: "employee", customer: "customer login" };
const CONTACT_ROLES = { ptx_specialist: "PTx specialist", sales: "sales", customer_service: "customer service", service: "service" };
const listName = (id) => (listInfo(id)?.title ?? String(id ?? "options").replace(/_/g, " ")).toLowerCase();
const pair = (value) => (Array.isArray(value) && value.length === 2 ? value : null);

/** "role employee → admin; store North → South", from a details object's [before, after] pairs. */
function changes(details, names) {
  const parts = [];
  for (const [key, label] of Object.entries(names)) {
    const change = pair(details?.[key]);
    if (!change) continue;
    const [before, after] = change.map((value) => (key === "role" ? ROLES[value] ?? value : value) || "none");
    parts.push(`${label} ${before} → ${after}`);
  }
  return parts.join("; ");
}

/** One entry in plain words, after the person's name: "turned off Pat's access". */
export function describeActivity(entry) {
  const subject = entry.subject || "someone";
  const d = entry.details ?? {};
  const email = d.email && d.email !== subject ? ` (${d.email})` : "";
  switch (entry.action) {
    case "person.changed": {
      const what = changes(d, { role: "role", store: "store", name: "name" });
      return `changed ${subject}${what ? `: ${what}` : ""}`;
    }
    case "person.access_off": return `turned off ${subject}'s access`;
    case "person.access_on": return `turned on ${subject}'s access`;
    case "person.removed": return `removed ${subject} from the list`;
    case "login.created": {
      const role = ROLES[d.role] ?? d.role;
      return `added a login for ${subject}${email}${role ? ` as ${/^[aeiou]/i.test(role) ? "an" : "a"} ${role}` : ""}`;
    }
    case "login.deleted": return `deleted ${subject}'s login${email}`;
    case "two_step.reset": return `reset ${subject}'s two-step sign-in`;
    case "email.sent": return d.kind === "reset" ? `emailed ${subject} a password link${email}` : `emailed ${subject} an invitation${email}`;
    case "email.failed": return `couldn't email ${subject}${email}${d.linkShown ? "; the link was shown to copy" : ""}`;
    case "store.added": return `added the store ${subject}`;
    case "store.renamed": return `renamed a store: ${changes(d, { name: "" }).trim() || subject}`;
    case "store.closed": return `closed the store ${subject}`;
    case "store.reopened": return `reopened the store ${subject}`;
    case "store.removed": return `removed the store ${subject}`;
    case "contact.added": return `added ${subject} as a store contact${d.role ? ` (${CONTACT_ROLES[d.role] ?? d.role}${d.store ? `, ${d.store}` : ""})` : ""}`;
    case "contact.changed": return `changed the store contact ${subject}`;
    case "contact.removed": return `removed the store contact ${subject}`;
    case "organization.created": return `set up the organization ${subject}${d.store ? ` with the store ${d.store}` : ""}`;
    case "organization.renamed": return `renamed the organization: ${changes(d, { name: "" }).trim() || subject}`;
    case "organization.changed": {
      const on = pair(d.customer_inspections);
      return on ? `turned customer inspections ${on[1] ? "on" : "off"}` : "changed the organization's settings";
    }
    case "form.published": return `published the ${subject} form`;
    case "form.retired": return `retired the ${subject} form`;
    case "option.added": return `added ${subject} to ${listName(d.list)}`;
    case "option.removed": return `removed ${subject} from ${listName(d.list)}`;
    case "option.changed": {
      const parts = [];
      const label = pair(d.label);
      if (label) parts.push(`renamed from ${label[0]}`);
      const shown = pair(d.shown);
      if (shown) parts.push(shown[1] ? "shown again" : "hidden");
      if (d.settings) parts.push("settings changed");
      return `changed ${subject} in ${listName(d.list)}${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }
    case "customer.deleted": return `deleted the customer ${subject}`;
    case "machine.deleted": return `deleted the machine ${subject}`;
    case "inspection.deleted": return `deleted an inspection${entry.subject ? ` (${entry.subject})` : ""}`;
    default: return `${entry.action}${entry.subject ? `: ${entry.subject}` : ""}`;
  }
}

/** Who did it: their name then, or "Someone" when the log has none. */
export const actorLabel = (entry) => entry.actor_name?.trim() || "Someone";
