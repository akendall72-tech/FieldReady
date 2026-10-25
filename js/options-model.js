// Machine option rules shared by the options editor. Pure functions, no page code, so they're
// tested on their own (tests/options-model.test.mjs).
//
// Each option is a catalog_options row. Machines and inspections store its value, so a value never
// changes once saved; the label is what people see. The app reads the settings in `details`
// (OptionCatalog in the app), and keeps its own built-in setting for any a row doesn't have.

import { slug } from "./checklist-model.js";

/** Lists whose options say which equipment types use them. */
const USED_ON = { key: "equipment", type: "equipment", label: "Used on" };

/**
 * The lists, in the order the editor shows them. `settings` are the details the app reads;
 * `fixed` are values the app relies on, which can be renamed but not hidden. `canAdd: false`
 * lists need app support for new options.
 */
export const LISTS = [
  {
    id: "equipment_type",
    title: "Equipment types",
    about: "The kinds of machine. Each type has its own machine questions; its settings decide the technology questions and which inspections it's offered. Machine checklists name the types they're for.",
    settings: [
      { key: "symbol", type: "symbol", label: "Icon" },
      { key: "guidance", type: "bool", label: "Can have guidance: asks the guidance questions and offers Guidance inspections" },
      { key: "planter", type: "bool", label: "Precision Planting technology: records planter products and offers Planter inspections" },
    ],
    fixed: ["tractor", "planter"],
  },
  {
    id: "machine_question",
    title: "Machine questions",
    about: "Asked when a machine is added or edited, for the equipment types each is used on. Checklist checks can apply only to some answers, like tracks or a front loader.",
    settings: [USED_ON],
    fixed: [],
  },
  {
    id: "machine_answer",
    title: "Answers",
    about: "The answers offered for each machine question.",
    parentList: "machine_question",
    parentLabel: "Question",
    empty: "No answers for this question yet.",
    settings: [],
    fixed: [],
  },
  {
    id: "guidance_system",
    title: "Guidance systems",
    about: "The first question about a tractor's technology. Checklist checks can apply to some systems only.",
    settings: [
      { key: "subtitle", type: "text", label: "Description", hint: "Shown under the name in the app" },
      { key: "factoryIntegrated", type: "bool", label: "Factory-integrated: guidance software and steering are built in" },
    ],
    fixed: ["other"],
  },
  {
    id: "guidance_software",
    title: "Guidance software",
    about: "The steering product on aftermarket systems. Not asked for factory-integrated systems.",
    settings: [],
    fixed: ["unknown"],
  },
  {
    id: "steering",
    title: "Steering",
    about: "How the machine steers. Steering checks are skipped only when this says the machine has no auto-steer.",
    settings: [{ key: "autoSteer", type: "tristate", label: "Steers automatically" }],
    fixed: ["factoryIntegrated", "unknown"],
  },
  {
    id: "correction_type",
    title: "Correction types",
    about: "Where the machine's GNSS correction comes from. Each has its own list of services.",
    settings: [{ key: "paid", type: "bool", label: "Normally needs a paid subscription (flagged when none is recorded)" }],
    fixed: ["unknown"],
  },
  {
    id: "correction_service",
    title: "Correction services",
    about: "The services offered for each correction type when a subscription is added. Anything else can be typed in.",
    parentList: "correction_type",
    parentLabel: "Correction type",
    empty: "No services listed for this correction type. Technicians type the service in.",
    settings: [
      { key: "provider", type: "text", label: "Provider", hint: "Saved on the subscription, e.g. Trimble" },
      { key: "group", type: "text", label: "Heading", hint: "Services are grouped under this; the provider if empty" },
      { key: "performance", type: "text", label: "Accuracy the manual states", hint: "Only from a manual" },
      { key: "note", type: "text", label: "Note" },
      { key: "source", type: "text", label: "Source", hint: "Where this service's details come from" },
    ],
    fixed: [],
  },
  {
    id: "receiver_correction_level",
    title: "Receiver correction levels",
    about: "What a GNSS receiver is unlocked for.",
    settings: [],
    fixed: ["unknown"],
  },
  {
    id: "component_kind",
    title: "Component types",
    about: "The parts recorded on a machine, in the order the app lists them.",
    settings: [
      USED_ON,
      { key: "symbol", type: "symbol", label: "Icon" },
      { key: "correctionLevel", type: "bool", label: "Has a correction level (like a GNSS receiver)" },
    ],
    fixed: ["display", "receiver", "controller", "steering", "other"],
  },
  {
    id: "feature",
    title: "Optional features",
    about: "Features a machine may have, such as a planter's Precision Planting products. A feature's checks are included only when it's marked Installed.",
    settings: [USED_ON, { key: "examples", type: "text", label: "Description", hint: "Shown under the name in the app" }],
    fixed: [],
  },
  {
    id: "inspection_type",
    title: "Inspection types",
    about: "Chosen when an inspection starts and printed on the report.",
    settings: [],
    fixed: ["preseason"],
  },
  {
    id: "not_tested_reason",
    title: "Reasons not tested",
    about: "Why a check wasn't done.",
    settings: [{ key: "needsDetail", type: "bool", label: "The technician must describe the reason" }],
    fixed: ["other"],
  },
];

/** Icons the app can show for a component or equipment type (SF Symbols names), in plain words. */
export const SYMBOLS = [
  { value: "display", label: "Screen" },
  { value: "location.circle", label: "Location" },
  { value: "antenna.radiowaves.left.and.right", label: "Antenna" },
  { value: "steeringwheel", label: "Steering wheel" },
  { value: "cpu", label: "Chip" },
  { value: "wifi", label: "Wireless" },
  { value: "camera", label: "Camera" },
  { value: "sensor", label: "Sensor" },
  { value: "gauge.with.dots.needle.33percent", label: "Gauge" },
  { value: "bolt", label: "Power" },
  { value: "cable.connector", label: "Cable" },
  { value: "shippingbox", label: "Box" },
  { value: "leaf", label: "Leaf" },
  { value: "gearshape.2", label: "Gears" },
  { value: "sprinkler.and.droplets", label: "Sprayer" },
  { value: "drop", label: "Drop" },
  { value: "wind", label: "Wind" },
  { value: "tornado", label: "Swirl" },
  { value: "circle.grid.3x3", label: "Seeds" },
  { value: "cylinder", label: "Bale" },
  { value: "scissors", label: "Scissors" },
  { value: "rays", label: "Rays" },
  { value: "square.3.layers.3d.down.right", label: "Layers" },
  { value: "arrow.up.and.down.square", label: "Lift" },
  { value: "wrench.and.screwdriver", label: "Tools" },
];

export const listInfo = (id) => LISTS.find((list) => list.id === id);

/**
 * The icon the app shows for an option: its own, or for one saved without an icon, the app's
 * built-in one (OptionCatalog fills it in): tractors a steering wheel, planters a leaf, any other
 * equipment type a steering wheel, and component types a box.
 */
export function shownSymbol(row) {
  if (row.details?.symbol) return row.details.symbol;
  if (row.list === "equipment_type") return row.value === "planter" ? "leaf" : "steeringwheel";
  return "shippingbox";
}

/** Whether a list's options say which equipment types use them. */
export const hasUsedOn = (list) => (listInfo(list)?.settings ?? []).some((setting) => setting.type === "equipment");

/** The equipment types an option is used on. Options saved before planters existed are tractor options. */
export const usedOn = (row) => (Array.isArray(row.details?.equipment) ? row.details.equipment : ["tractor"]);

/** The options of one list (and one parent, for correction services), in order. */
export function optionsIn(rows, list, parent = null) {
  return rows
    .filter((row) => row.list === list && (row.parent_value ?? null) === (parent ?? null))
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

/** Whether an option can be hidden: values the app relies on stay in their list. */
export const canHide = (row) => !(listInfo(row.list)?.fixed ?? []).includes(row.value);

/**
 * A value for a new option, unique in its list: camel case from its name, or for correction
 * services the name itself (the app matches saved subscriptions by name).
 */
export function newValue(label, taken, list = "") {
  const base = list === "correction_service" ? label.trim() : slug(label) || "option";
  const join = list === "correction_service" ? " " : "";
  let value = base;
  for (let n = 2; taken.has(value); n += 1) value = `${base}${join}${n}`;
  return value;
}

/**
 * A new option at the end of its list. Settings start off (or not known) until someone sets them;
 * "used on" starts with `equipment` (the type being viewed), or empty so someone has to choose.
 */
export function newOption(rows, list, label, { organizationId, parent = null, equipment = null } = {}) {
  const siblings = optionsIn(rows, list, parent);
  const details = {};
  for (const setting of listInfo(list)?.settings ?? []) {
    if (setting.type === "bool") details[setting.key] = false;
    if (setting.type === "tristate") details[setting.key] = null;
    if (setting.type === "equipment") details[setting.key] = equipment ? [equipment] : [];
  }
  if (list === "correction_service") details.provider = "";
  return {
    id: null,
    organization_id: organizationId,
    list,
    value: newValue(label, new Set(siblings.map((row) => row.value)), list),
    label: label.trim(),
    parent_value: parent,
    sort_order: siblings.length ? Math.max(...siblings.map((row) => row.sort_order)) + 1 : 0,
    active: true,
    details,
  };
}

/** Moves an option up or down within its list, renumbering the list. Returns the new order. */
export function moveOption(rows, row, offset) {
  const siblings = optionsIn(rows, row.list, row.parent_value);
  const from = siblings.indexOf(row);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= siblings.length) return siblings;
  siblings.splice(from, 1);
  siblings.splice(to, 0, row);
  siblings.forEach((option, index) => { option.sort_order = index; });
  return siblings;
}

/** What would confuse people or phones, in plain words. Empty when the lists can be saved. */
export function problems(rows) {
  const found = [];
  const seen = new Map();
  for (const row of rows) {
    const list = listInfo(row.list);
    const parent = row.parent_value && rows.find((other) => other.list === list?.parentList && other.value === row.parent_value);
    const where = list ? (row.parent_value ? `${list.title} (${parent?.label ?? row.parent_value})` : list.title) : row.list;
    if (!row.label || !row.label.trim()) {
      found.push(`An option in ${where} has no name.`);
      continue;
    }
    if (!row.value || !row.value.trim()) found.push(`“${row.label}” in ${where} has no value.`);
    const key = `${row.list}|${row.parent_value ?? ""}|${row.label.trim().toLowerCase()}`;
    if (seen.has(key) && row.active && seen.get(key).active) {
      found.push(`Two options in ${where} are both called “${row.label.trim()}”.`);
    }
    if (!seen.has(key) || row.active) seen.set(key, row);
    // The app groups services under their heading (or provider). Generic services, like a state
    // RTK network, have a heading but no provider.
    const heading = `${row.details?.provider ?? ""}${row.details?.group ?? ""}`.trim();
    if (hasUsedOn(row.list) && row.active && usedOn(row).length === 0) {
      found.push(`“${row.label}” in ${where} isn't used on any equipment type.`);
    }
    if (row.list === "correction_service" && row.active && !heading) {
      found.push(`“${row.label}” in ${where} needs a provider or a heading.`);
    }
  }
  return found;
}

/** A row's saved form, for telling whether it changed. */
const snapshot = (row) => JSON.stringify({
  label: row.label, sort_order: row.sort_order, active: row.active, details: row.details, parent_value: row.parent_value ?? null,
});

/** Remembers how each saved row looked, so `changes` can tell what to send. */
export const baseline = (rows) => new Map(rows.filter((row) => row.id).map((row) => [row.id, snapshot(row)]));

/** The rows to add and the rows to update. */
export function changes(rows, saved) {
  return {
    added: rows.filter((row) => !row.id),
    updated: rows.filter((row) => row.id && saved.get(row.id) !== snapshot(row)),
  };
}
