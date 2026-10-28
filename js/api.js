// Talking to the Field Ready database. Every request runs as the signed-in person, so the same
// access rules as the app apply: the website can't do anything their role doesn't allow.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

// Loaded by index.html from vendor/ (this site's own copy), before this module runs.
const { createClient } = globalThis.supabase;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export class SaveConflict extends Error {}

/** Plain words for an error from the database or the network. */
export function describe(error) {
  if (!error) return "Something went wrong.";
  if (error.message === "Invalid login credentials") return "That email and password don't match.";
  // Access rules give a general message; the database's own checks explain themselves.
  if (error.code === "42501") return /row-level security/i.test(error.message ?? "") ? "Your access doesn't allow that." : error.message;
  if (error.code === "23514") return error.message;
  if (error.code === "23505") return "Someone else already started a draft. Reload to see it.";
  if (error instanceof TypeError || /fetch|network/i.test(error.message ?? "")) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return error.message ?? String(error);
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  unwrap(await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }));
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** The signed-in person's profile, or null if nobody has given this login access. */
export async function loadProfile(userId) {
  return unwrap(await supabase
    .from("profiles")
    .select("id, full_name, email, role, active, location_id, organization_id, organizations(name), locations(name)")
    .eq("id", userId)
    .maybeSingle());
}

/** Every version of every checklist this person can see (owners and admins see drafts too). */
export async function loadChecklists() {
  return unwrap(await supabase
    .from("inspection_templates")
    .select("id, organization_id, template_id, version, title, status, content, notes, updated_at, published_at, created_at")
    .order("created_at", { ascending: true }));
}

/** Every option (guidance systems, features, correction services…), hidden ones included. */
export async function loadOptionRows() {
  return unwrap(await supabase
    .from("catalog_options")
    .select("id, organization_id, list, value, label, parent_value, sort_order, active, details, updated_at")
    .order("sort_order", { ascending: true }));
}

/** Option lists grouped by list name, in order. Hidden options are included (marked `active: false`). */
export async function loadOptions() {
  const lists = {};
  for (const row of await loadOptionRows()) (lists[row.list] ??= []).push(row);
  return lists;
}

const OPTION_COLUMNS = ["organization_id", "list", "value", "label", "parent_value", "sort_order", "active", "details"];
const pick = (row, columns) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));

/**
 * Adds new options and saves edited ones. An edited option someone else saved since it was loaded
 * is skipped, and SaveConflict names them, so nobody's change is overwritten without them knowing.
 */
export async function saveOptions(added, updated) {
  if (added.length) {
    const { error } = await supabase.from("catalog_options").insert(added.map((row) => pick(row, OPTION_COLUMNS)));
    if (error?.code === "23505") throw new Error("An option with that value already exists in the list. Reload to see it.");
    if (error) throw error;
  }
  const skipped = [];
  for (const row of updated) {
    const rows = unwrap(await supabase
      .from("catalog_options")
      .update(pick(row, ["label", "sort_order", "active", "details"]))
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("id"));
    if (rows.length === 0) skipped.push(row.label);
  }
  if (skipped.length) {
    throw new SaveConflict(`Someone else changed ${skipped.map((label) => `“${label}”`).join(", ")} since you opened this page, so ${skipped.length === 1 ? "that change wasn't" : "those changes weren't"} saved.`);
  }
}

export async function createDraft(live, version, content) {
  return unwrap(await supabase
    .from("inspection_templates")
    .insert({
      organization_id: live.organization_id,
      template_id: live.template_id,
      version,
      title: content.title ?? live.title,
      status: "draft",
      content,
      notes: `Started from version ${live.version}.`,
    })
    .select()
    .single());
}

/**
 * Saves the draft unless someone else saved it since it was loaded (then throws SaveConflict,
 * so nobody's work is overwritten without them knowing).
 */
export async function saveDraft(draft, content) {
  const rows = unwrap(await supabase
    .from("inspection_templates")
    .update({ content, title: content.title ?? draft.title })
    .eq("id", draft.id)
    .eq("updated_at", draft.updated_at)
    .select());
  if (rows.length === 0) throw new SaveConflict("Someone else saved this draft since you opened it.");
  return rows[0];
}

export async function publishDraft(draft) {
  const rows = unwrap(await supabase
    .from("inspection_templates")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", draft.id)
    .eq("updated_at", draft.updated_at)
    .select());
  if (rows.length === 0) throw new SaveConflict("The draft changed since you opened it.");
  return rows[0];
}

export async function discardDraft(draft) {
  unwrap(await supabase.from("inspection_templates").delete().eq("id", draft.id));
}

/** Starts a new checklist (Machine or Custom) as a draft of its first version. */
export async function createChecklist(organizationId, content) {
  const { error } = await supabase.from("inspection_templates").insert({
    organization_id: organizationId, template_id: content.id, version: content.version, title: content.title,
    status: "draft", content, notes: "",
  });
  if (error?.code === "23505") throw new Error("A checklist with that name already exists. Choose another name.");
  if (error) throw error;
}

/**
 * Retires a checklist (published → retired: phones stop offering it) or brings it back
 * (retired → published). Every version with the first status changes.
 */
export async function setChecklistStatus(templateId, from, to) {
  const rows = unwrap(await supabase.from("inspection_templates").update({ status: to })
    .eq("template_id", templateId).eq("status", from).select("id"));
  if (rows.length === 0) throw new Error("Nothing changed. Someone may have changed it already, or your access doesn't allow it.");
}

// ---------------------------------------------------------------- people and stores

/** Everyone this person may see (owners: everyone; admins: their store). */
export async function loadPeople() {
  return unwrap(await supabase
    .from("profiles")
    .select("id, full_name, email, role, active, location_id, customer_id, must_change_password, updated_at, created_at")
    .order("full_name", { ascending: true }));
}

/** Invitations that haven't become logins (made before the website, or interrupted). */
export async function loadInvitations() {
  return unwrap(await supabase
    .from("invitations")
    .select("email, full_name, role, location_id, customer_id, created_at")
    .order("created_at", { ascending: true }));
}

export async function loadStores() {
  return unwrap(await supabase
    .from("locations")
    .select("id, name, active, created_at")
    .order("name", { ascending: true }));
}

/**
 * Saves changes to a person unless someone else saved them since they were loaded. Nothing changing
 * also means the access rules didn't allow it.
 */
export async function savePerson(person, changes) {
  const rows = unwrap(await supabase
    .from("profiles")
    .update(changes)
    .eq("id", person.id)
    .eq("updated_at", person.updated_at)
    .select("id"));
  if (rows.length === 0) throw new SaveConflict(`Someone else changed ${person.full_name || person.email} since you opened this page, or your access doesn't allow that change.`);
}

/** Requests (made in the app) to delete a login. Owners see everyone's; others only their own. */
export async function loadDeletionRequests() {
  return unwrap(await supabase
    .from("account_deletion_requests")
    .select("id, profile_id, full_name, email, role, requested_at")
    .order("requested_at", { ascending: true }));
}

/** Declines a deletion request: the login stays. */
export async function declineDeletionRequest(id) {
  unwrap(await supabase.from("account_deletion_requests").delete().eq("id", id));
}

export async function cancelInvitation(email) {
  unwrap(await supabase.from("invitations").delete().eq("email", email));
}

export async function addStore(organizationId, name) {
  const { error } = await supabase.from("locations").insert({ organization_id: organizationId, name: name.trim() });
  if (error?.code === "23505") throw new Error(`There's already a store called “${name.trim()}”.`);
  if (error) throw error;
}

export async function saveStore(store, changes) {
  const { error } = await supabase.from("locations").update(changes).eq("id", store.id);
  if (error?.code === "23505") throw new Error(`There's already a store called “${changes.name}”.`);
  if (error) throw error;
}

/**
 * The `people` server function: creates logins and resets passwords (they need Supabase's secret
 * key, which only the function has). Returns its answer, or throws its plain-words error.
 */
export async function callPeople(action, payload) {
  const { data, error } = await supabase.functions.invoke("people", { body: { action, ...payload } });
  if (!error) return data;
  const answer = await error.context?.json?.().catch(() => null);
  if (answer?.error) throw new Error(answer.error);
  if (error.context?.status === 404 || error.name === "FunctionsFetchError") {
    throw new Error("Couldn't reach the people server function. If it hasn't been deployed yet, deploy it in Supabase (see supabase/README.md in the app repository); otherwise check your connection.");
  }
  throw error;
}

// ---------------------------------------------------------------- customers and store contacts

/**
 * Every row of a query, page by page until an empty page (the server may cap how many rows one
 * answer holds). `query` builds the query fresh for each page.
 */
async function loadAll(query, pageSize = 500) {
  const rows = [];
  while (true) {
    const page = unwrap(await query().range(rows.length, rows.length + pageSize - 1));
    if (page.length === 0) return rows;
    rows.push(...page);
  }
}

/** Customers this person may see (owners: everyone; staff: their store). */
export async function loadCustomers() {
  return loadAll(() => supabase
    .from("customers")
    .select("id, organization_id, name, email, phone, location_id, archived_at, updated_at")
    .order("name", { ascending: true })
    .order("id", { ascending: true }));
}

/** Every store's contacts for customers. */
export async function loadContacts() {
  return unwrap(await supabase
    .from("store_contacts")
    .select("id, organization_id, location_id, role, name, phone, email, sort_order, updated_at")
    .order("sort_order", { ascending: true }));
}

const CONTACT_COLUMNS = ["organization_id", "location_id", "role", "name", "phone", "email", "sort_order"];

/** Adds a contact (no id yet) or saves changes to one. */
export async function saveContact(contact) {
  const values = Object.fromEntries(CONTACT_COLUMNS.map((column) => [column, contact[column] ?? ""]));
  values.name = String(values.name).trim();
  values.phone = String(values.phone).trim();
  values.email = String(values.email).trim().toLowerCase();
  const query = contact.id
    ? supabase.from("store_contacts").update(values).eq("id", contact.id).select("id")
    : supabase.from("store_contacts").insert(values).select("id");
  const rows = unwrap(await query);
  if (rows.length === 0) throw new Error("Your access doesn't allow changing that store's contacts.");
}

export async function deleteContact(id) {
  unwrap(await supabase.from("store_contacts").delete().eq("id", id));
}

// ---------------------------------------------------------------- customers and machines

const MACHINE_LIST_COLUMNS = "id, organization_id, customer_id, location_id, equipment_type, manufacturer, model_name, model_year, serial_number, archived_at, customer_changed, updated_at";

/** Every machine this person may see, with how many finalized inspections each has. */
export async function loadMachines() {
  return (await loadAll(() => supabase
    .from("machines")
    .select(`${MACHINE_LIST_COLUMNS}, finalized:inspections(count)`)
    .eq("finalized.status", "finalized")
    .order("manufacturer", { ascending: true })
    .order("id", { ascending: true })))
    .map((machine) => ({ ...machine, finalized: machine.finalized?.[0]?.count ?? 0 }));
}

/** One machine with its components, features, and subscriptions. */
export async function loadMachine(id) {
  const machine = unwrap(await supabase
    .from("machines")
    .select("*, finalized:inspections(count), technology_components(*), installed_features(*), correction_subscriptions(*)")
    .eq("id", id)
    .eq("finalized.status", "finalized")
    .maybeSingle());
  if (!machine) throw new Error("That machine isn't there any more, or your access doesn't include it.");
  return { ...machine, finalized: machine.finalized?.[0]?.count ?? 0 };
}

/** Plain words for a refused delete: finalized inspections are permanent records. */
function explainDelete(error, what) {
  if (error?.code === "23503") return new Error(`This ${what} has finalized inspections, so it can't be deleted. Archive it instead.`);
  return error;
}

/**
 * Adds a record (no id yet) or saves changes to one, unless someone else saved it since it was
 * loaded (SaveConflict). Returns the saved row.
 */
async function saveRecord(table, record, values, label) {
  if (!record.id) {
    const { data, error } = await supabase.from(table).insert({ id: crypto.randomUUID(), organization_id: record.organization_id, ...values }).select().single();
    if (error) throw error;
    return data;
  }
  const rows = unwrap(await supabase.from(table).update(values).eq("id", record.id).eq("updated_at", record.updated_at).select());
  if (rows.length === 0) throw new SaveConflict(`Someone else changed ${label} since you opened it, or your access doesn't allow that change.`);
  return rows[0];
}

export const saveCustomer = (customer, values) => saveRecord("customers", customer, values, customer.name || "this customer");
export const saveMachine = (machine, values) => saveRecord("machines", machine, values, "this machine");

/** Archives (or brings back) a customer or machine. Only owners and admins can; for others the server keeps the date as it was. */
/**
 * Marks a machine the customer added or changed as checked by staff (the server clears the mark
 * for staff; anything else about the machine stays as it is).
 */
export async function markChecked(machine) {
  const rows = unwrap(await supabase.from("machines").update({ customer_changed: false })
    .eq("id", machine.id).eq("updated_at", machine.updated_at).select("id, customer_changed"));
  if (rows.length === 0) throw new SaveConflict("Someone else changed this machine since you opened it.");
}

export async function setArchived(table, record, archived) {
  const rows = unwrap(await supabase.from(table).update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", record.id).eq("updated_at", record.updated_at).select("id, archived_at"));
  if (rows.length === 0) throw new SaveConflict("Someone else changed this since you opened it.");
  if (Boolean(rows[0].archived_at) !== archived) throw new Error("Only owners, and admins at this store, can archive or bring back.");
}

async function deleteRecord(table, id, what) {
  const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");
  if (error) throw explainDelete(error, what);
  if (!data?.length) throw new Error(`The ${what} wasn't deleted. Your access may not allow it.`);
}

/**
 * Draft inspections go first, as the app does it: the server keeps a machine while any inspection
 * points to it. Finalized ones stay, so the delete that follows is refused if there are any.
 */
async function deleteDrafts(machineIds) {
  if (machineIds.length) unwrap(await supabase.from("inspections").delete().in("machine_id", machineIds).eq("status", "draft"));
}

export async function deleteCustomer(id) {
  const machines = unwrap(await supabase.from("machines").select("id").eq("customer_id", id));
  await deleteDrafts(machines.map((machine) => machine.id));
  await deleteRecord("customers", id, "customer");
}

export async function deleteMachine(id) {
  await deleteDrafts([id]);
  await deleteRecord("machines", id, "machine");
}

const COMPONENT_COLUMNS = ["kind", "model_name", "serial_number", "firmware_version", "correction_level", "verification", "notes"];
const SUBSCRIPTION_COLUMNS = ["provider", "service_name", "correction_type", "account_reference", "expiration_date", "source", "checked_on", "notes"];

async function saveChild(table, columns, machineId, row) {
  const values = Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
  const query = row.id
    ? supabase.from(table).update(values).eq("id", row.id).select("id")
    : supabase.from(table).insert({ id: crypto.randomUUID(), machine_id: machineId, ...values }).select("id");
  const rows = unwrap(await query);
  if (rows.length === 0) throw new Error("That wasn't saved. Your access may not allow it.");
}

export const saveComponent = (machineId, component) => saveChild("technology_components", COMPONENT_COLUMNS, machineId, component);
export const saveSubscription = (machineId, subscription) => saveChild("correction_subscriptions", SUBSCRIPTION_COLUMNS, machineId, subscription);
export const deleteComponent = (id) => deleteRecord("technology_components", id, "component");
export const deleteSubscription = (id) => deleteRecord("correction_subscriptions", id, "subscription");

/** Saves feature states as updates to existing rows and inserts for new kinds (see equipment-model featureChanges). */
export async function saveFeatures(machineId, { updates, inserts }) {
  for (const feature of updates) {
    unwrap(await supabase.from("installed_features").update({ state: feature.state }).eq("id", feature.id).select("id"));
  }
  if (inserts.length) {
    unwrap(await supabase.from("installed_features")
      .insert(inserts.map((feature) => ({ id: crypto.randomUUID(), machine_id: machineId, kind: feature.kind, state: feature.state }))));
  }
}
