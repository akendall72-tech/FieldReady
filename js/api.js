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

/** Active option lists (guidance systems, features, correction types…) grouped by list name. */
export async function loadOptions() {
  const rows = unwrap(await supabase
    .from("catalog_options")
    .select("list, value, label, parent_value, sort_order, details, active")
    .eq("active", true)
    .order("sort_order", { ascending: true }));
  const lists = {};
  for (const row of rows) (lists[row.list] ??= []).push(row);
  return lists;
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
