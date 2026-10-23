// People rules shared by the People & stores page. Pure functions, no page code, so they're tested
// on their own (tests/people-model.test.mjs). They mirror the database's access rules
// (supabase/migrations/…_people_and_stores.sql in FieldReadyApp), which have the final say:
// the page only hides what someone can't do.

export const ROLES = [
  { value: "owner", label: "Owner", about: "Everything, at every store" },
  { value: "admin", label: "Admin", about: "Their store, its people, and checklist steps" },
  { value: "employee", label: "Employee", about: "Inspections at their store" },
];

export const roleLabel = (role) => ROLES.find((r) => r.value === role)?.label ?? role;

/** Roles a person can give someone new: owners any, admins employees only. */
export function rolesFor(viewer) {
  if (viewer.role === "owner") return ROLES.map((r) => r.value);
  if (viewer.role === "admin") return ["employee"];
  return [];
}

/** Whether `person` is the organization's only active owner (who must stay one). */
export const isLastOwner = (person, people) =>
  person.role === "owner" && person.active && !people.some((p) => p.id !== person.id && p.role === "owner" && p.active);

/**
 * What `viewer` may change about `person`. Owners: everyone, but not their own access, and the last
 * owner stays an active owner. Admins: the employees at their own store (name, access, password),
 * and their own name and password.
 */
export function permissions(viewer, person, people = []) {
  const none = { name: false, role: false, store: false, access: false, password: false };
  const self = viewer.id === person.id;
  if (viewer.role === "owner") {
    const last = isLastOwner(person, people);
    return { name: true, role: !last, store: true, access: !self && !last, password: true };
  }
  if (viewer.role === "admin") {
    if (self) return { ...none, name: true, password: true };
    if (person.role === "employee" && person.location_id === viewer.location_id) {
      return { ...none, name: true, access: true, password: true };
    }
  }
  return none;
}

export const isEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text ?? "").trim());

/** What stops a new person from being added, in plain words. Empty when they can be. */
export function newPersonProblems(person, viewer, people = [], invitations = []) {
  const found = [];
  const email = String(person.email ?? "").trim().toLowerCase();
  if (!String(person.full_name ?? "").trim()) found.push("Enter their name.");
  if (!isEmail(email)) found.push("Enter a valid email address.");
  else if (people.some((p) => p.email === email)) found.push("Someone with that email is already on the list.");
  else if (invitations.some((i) => i.email === email)) found.push("That email is waiting for a login. Cancel it below first.");
  if (!rolesFor(viewer).includes(person.role)) found.push("Choose a role.");
  if (person.role !== "owner" && !person.location_id) found.push("Choose a store.");
  return found;
}

/** Owners first, then admins, then employees; by name within each. */
export function sortPeople(people) {
  const rank = (role) => ROLES.findIndex((r) => r.value === role);
  return [...people].sort((a, b) => rank(a.role) - rank(b.role) || (a.full_name || a.email).localeCompare(b.full_name || b.email));
}

// Letters and digits that can't be mistaken for each other when read aloud or typed.
const CLEAR = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const WORDS = ["Field", "Seed", "Disc", "Row", "Hitch", "Tread", "Furrow", "Harvest", "Prairie", "Tiller", "Canopy", "Sprout"];

/**
 * A temporary password that's easy to read out: "Seed-K7QM-4XPR". About 45 bits from the
 * browser's secure random generator; the person changes it in the app.
 */
export function temporaryPassword(random = (n) => crypto.getRandomValues(new Uint32Array(n))) {
  const values = random(9);
  const word = WORDS[values[0] % WORDS.length];
  const chars = Array.from(values.slice(1), (v) => CLEAR[v % CLEAR.length]).join("");
  return `${word}-${chars.slice(0, 4)}-${chars.slice(4)}`;
}
