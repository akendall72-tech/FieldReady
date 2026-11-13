// People rules shared by the People & stores page. Pure functions, no page code, so they're tested
// on their own (tests/people-model.test.mjs). They mirror the database's access rules
// (supabase/migrations/…_people_and_stores.sql in FieldReadyApp), which have the final say:
// the page only hides what someone can't do.

export const ROLES = [
  { value: "owner", label: "Owner", about: "Everything, at every store" },
  { value: "admin", label: "Admin", about: "Their store and its people" },
  { value: "employee", label: "Employee", about: "Inspections at their store" },
];

export const roleLabel = (role) => ROLES.find((r) => r.value === role)?.label ?? role;

/** Roles a person can give someone new: owners any, admins employees only. */
export function rolesFor(viewer) {
  if (viewer.role === "owner") return ROLES.map((r) => r.value);
  if (viewer.role === "admin") return ["employee"];
  return [];
}

/**
 * Whether this person edits the shared inspection forms and the option lists (Machine options,
 * Subscriptions): owners always, other staff when an owner gives them the permission. Mirrors
 * private.can_edit_setup() in supabase/migrations/…_setup_editors.sql.
 */
export const canEditSetup = (profile) =>
  profile?.role === "owner" || (profile?.role !== "customer" && profile?.can_edit_setup === true);

/**
 * Whether `viewer` may give or take away `person`'s forms and options permission: owners, for admins
 * and employees other than themselves (owners always can; customer logins never). Mirrors
 * private.guard_profile_update.
 */
export const canGiveSetup = (viewer, person) =>
  viewer.role === "owner" && viewer.id !== person.id && (person.role === "admin" || person.role === "employee");

/**
 * Whether this person works customer leads (sees them, marks them, and is notified): owners for every
 * store, Customer lead managers for their own. Mirrors private.works_leads() in
 * supabase/migrations/…_lead_managers.sql.
 */
export const canManageLeads = (profile) =>
  profile?.role === "owner" || (profile?.role !== "customer" && profile?.can_manage_leads === true);

/**
 * Whether this person makes and changes the organization's custom checklists: owners always, other
 * staff when an owner gives them the permission. Mirrors private.can_edit_custom() in
 * supabase/migrations/…_shared_custom_checklists.sql.
 */
export const canEditCustom = (profile) =>
  profile?.role === "owner" || (profile?.role !== "customer" && profile?.can_edit_custom === true);

/** Who may give or take away someone's custom checklists permission: the same rule as the forms and options one. */
export const canGiveCustom = (viewer, person) => canGiveSetup(viewer, person);

/** Who may give or take away someone's lead manager box: the same rule as the forms and options one. */
export const canGiveLeads = (viewer, person) => canGiveSetup(viewer, person);

/** Whether this person sees the Promotions page: owners, promotions managers, and lead managers. */
export const seesPromotions = (profile) =>
  profile?.role === "owner" || (profile?.role !== "customer" && (profile?.can_manage_promotions === true || profile?.can_manage_leads === true));

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

/**
 * Organization levels: how many staff logins (owners, admins, and employees with access on) each
 * allows. Customer logins never count. Mirrors private.staff_limit in
 * supabase/migrations/…_organization_levels.sql; only Prime Theory Labs sets a level.
 */
export const LEVELS = [
  { level: 1, limit: 50, range: "up to 50 staff" },
  { level: 2, limit: 100, range: "51–100 staff" },
  { level: 3, limit: 150, range: "101–150 staff" },
  { level: 4, limit: 200, range: "151–200 staff" },
  { level: 5, limit: null, range: "more than 200 staff" },
];

/** A level's details (Level 1 for anything unknown). */
export const levelInfo = (level) => LEVELS.find((l) => l.level === Number(level)) ?? LEVELS[0];

/** "Level 2 (51–100 staff)". */
export const levelLabel = (level) => `Level ${levelInfo(level).level} (${levelInfo(level).range})`;

/**
 * Where the organization stands against its level, from public.staff_allowance() ({ level,
 * staff_limit, used }, or null before it's known): whether a new staff login fits, and a line for
 * People & stores.
 */
export function staffRoom(allowance) {
  if (!allowance) return { full: false, over: false, line: "" };
  const { level, staff_limit: limit, used } = allowance;
  const name = `Level ${levelInfo(level).level}`;
  if (limit === null || limit === undefined) {
    return { full: false, over: false, line: `${used} staff logins in use. ${name} has no limit. Customer logins don't count.` };
  }
  if (used > limit) {
    return { full: true, over: true, line: `${used} staff logins are on, more than ${name}'s ${limit}. Nobody loses access, but new staff logins wait until fewer than ${limit} are on. Turn off access for people who no longer need it, or contact Prime Theory Labs to move up a level.` };
  }
  if (used >= limit) {
    return { full: true, over: false, line: `All ${limit} staff logins of ${name} are in use. To add someone, turn off access for someone who no longer needs it, or contact Prime Theory Labs to move up a level. Customer logins don't count.` };
  }
  return { full: false, over: false, line: `${used} of ${limit} staff logins in use (${name}). Customer logins don't count.` };
}

export const isEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text ?? "").trim());

/**
 * What stops a new person from being added, in plain words. Empty when they can be. `allowance` is
 * the organization's public.staff_allowance() row, when known: a full level takes no new staff login.
 */
export function newPersonProblems(person, viewer, people = [], invitations = [], allowance = null) {
  const found = [];
  const room = staffRoom(allowance);
  if (room.full && person.role !== "customer") {
    found.push(`Your organization's level allows ${allowance.staff_limit} staff logins, and they're all in use. Turn off access for someone who no longer needs it, or contact Prime Theory Labs to move up a level.`);
  }
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

/** What's wrong with a password someone is choosing for themselves (the app's rule), or null. */
export function newPasswordProblem(password, confirmation) {
  // Supabase › Authentication › Email asks for the same minimum, and so does the app.
  if (String(password ?? "").length < 10) return "Use at least 10 characters.";
  if (password !== confirmation) return "The passwords don't match.";
  return null;
}
