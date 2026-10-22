// Talking to the Field Ready database. Every request runs as the signed-in person, so the same
// access rules as the app apply: the website can't do anything their role doesn't allow.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export class SaveConflict extends Error {}

/** Plain words for an error from the database or the network. */
export function describe(error) {
  if (!error) return "Something went wrong.";
  if (error.message === "Invalid login credentials") return "That email and password don't match.";
  if (error.code === "42501") return "Your access doesn't allow that.";
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
