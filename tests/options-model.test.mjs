// Tests for js/options-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/options-model.test.mjs -- ../FieldReady/supabase/seed/default_catalog.sql
//
// The optional argument is the app's default option seed, whose lists must all be known here.

import {
  LISTS, SYMBOLS, optionsIn, canHide, newValue, newOption, moveOption, problems, baseline, changes, hasUsedOn, usedOn,
} from "../js/options-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

let nextId = 1;
const row = (list, value, label, order, extra = {}) => ({
  id: `id-${nextId++}`, organization_id: "org", list, value, label, parent_value: null, sort_order: order, active: true, details: {},
  ...extra,
});

const sample = () => [
  row("guidance_system", "ptx", "PTx", 0),
  row("guidance_system", "fendtGuide", "Fendt Guide", 1, { details: { factoryIntegrated: true } }),
  row("guidance_system", "other", "Other", 2),
  row("correction_service", "VRS Now", "VRS Now", 0, { parent_value: "networkRTK", details: { provider: "Trimble" } }),
  row("correction_service", "RTX", "RTX", 0, { parent_value: "satellite", details: { provider: "Trimble" } }),
];

// Lists and order
{
  const rows = sample();
  check("options come in order", optionsIn(rows, "guidance_system").map((r) => r.value).join() === "ptx,fendtGuide,other");
  check("services are per correction type", optionsIn(rows, "correction_service", "networkRTK").map((r) => r.value).join() === "VRS Now");
  check("every list has a title and about text", LISTS.every((list) => list.title && list.about));
  check("icons are SF Symbols names", SYMBOLS.every((s) => /^[a-z0-9.]+$/.test(s.value)));
}

// Values the app relies on
{
  const rows = sample();
  check("Other can't be hidden", !canHide(rows[2]));
  check("PTx can be hidden", canHide(rows[0]));
  check("component types the app uses stay", !canHide(row("component_kind", "receiver", "GNSS receiver", 1)));
}

// New options
{
  check("values are camel case from the name", newValue("John Deere StarFire", new Set()) === "johnDeereStarfire");
  check("values never repeat in a list", newValue("PTx", new Set(["ptx"])) === "ptx2");
  check("service values are the name", newValue("Local VRS", new Set(), "correction_service") === "Local VRS");
  check("service values never repeat", newValue("Local VRS", new Set(["Local VRS"]), "correction_service") === "Local VRS 2");

  const rows = sample();
  const deere = newOption(rows, "guidance_system", "  John Deere ", { organizationId: "org" });
  check("a new option goes last", deere.sort_order === 3 && deere.label === "John Deere" && deere.value === "johnDeere");
  check("a new option is unsaved and shown", deere.id === null && deere.active === true && deere.organization_id === "org");
  check("yes/no settings start off", deere.details.factoryIntegrated === false && !("subtitle" in deere.details));
  const steering = newOption(rows, "steering", "Hydraulic kit", { organizationId: "org" });
  check("auto-steer starts not known", steering.details.autoSteer === null && "autoSteer" in steering.details);
  const service = newOption(rows, "correction_service", "Local VRS", { organizationId: "org", parent: "networkRTK" });
  check("a new service belongs to its correction type", service.parent_value === "networkRTK" && service.sort_order === 1);
  check("a new service needs a provider", problems([...rows, service]).some((p) => p.includes("needs a provider or a heading")));
  service.details.provider = "Agri-Service";
  check("…and is fine with one", problems([...rows, service]).length === 0);
  service.details = { provider: "", group: "Other networks" };
  check("…or with just a heading, like the built-in VRS / NTRIP network", problems([...rows, service]).length === 0);
}

// Equipment types ("used on")
{
  check("features and component types say what they're used on", hasUsedOn("feature") && hasUsedOn("component_kind") && !hasUsedOn("steering"));
  check("options saved before planters are tractor options", usedOn(row("feature", "isobus", "ISOBUS", 0)).join() === "tractor");
  check("equipment types can't be added here", LISTS.find((list) => list.id === "equipment_type").canAdd === false);
  check("tractor and planter can't be hidden", !canHide(row("equipment_type", "planter", "Planter", 1)));
  const rows = sample();
  const product = newOption(rows, "feature", "Seed firmer", { organizationId: "org", equipment: "planter" });
  check("a new option is used on the type being viewed", product.details.equipment.join() === "planter");
  const unsure = newOption(rows, "feature", "Yield monitor", { organizationId: "org" });
  check("…or on nothing yet, which must be fixed before saving", unsure.details.equipment.length === 0
    && problems([...rows, unsure]).some((p) => p.includes("isn't used on any equipment type")));
}

// Moving
{
  const rows = sample();
  const order = moveOption(rows, rows[2], -1).map((r) => r.value).join();
  check("moving up swaps and renumbers", order === "ptx,other,fendtGuide" && rows[2].sort_order === 1 && rows[1].sort_order === 2);
  check("moving past the top does nothing", moveOption(rows, rows[0], -1).map((r) => r.value).join() === "ptx,other,fendtGuide");
}

// Problems
{
  const rows = sample();
  check("the sample is fine", problems(rows).length === 0);
  rows[0].label = " ";
  check("blank names are caught", problems(rows).some((p) => p.includes("has no name")));
  rows[0].label = "fendt guide";
  check("repeated names are caught", problems(rows).some((p) => p.includes("both called")));
  rows[0].active = false;
  check("a hidden option may share a name", problems(rows).length === 0);
}

// Changes
{
  const rows = sample();
  const saved = baseline(rows);
  check("nothing changed at first", changes(rows, saved).added.length === 0 && changes(rows, saved).updated.length === 0);
  rows[0].label = "PTx Trimble";
  rows[1].details = { ...rows[1].details, subtitle: "Built in" };
  rows.push(newOption(rows, "feature", "Yield monitor", { organizationId: "org" }));
  const found = changes(rows, saved);
  check("edited rows are found", found.updated.map((r) => r.value).join() === "ptx,fendtGuide");
  check("new rows are found", found.added.map((r) => r.value).join() === "yieldMonitor");
}

// The app's default seed uses only lists this editor knows.
const seedPath = (typeof arguments !== "undefined" ? arguments : scriptArgs ?? [])[0];
if (seedPath) {
  const seed = read(seedPath);
  const lists = new Set([...seed.matchAll(/^\s*\('([a-z_]+)', '/gm)].map((m) => m[1]));
  const ids = new Set(LISTS.map((list) => list.id));
  const unknown = [...lists].filter((list) => !ids.has(list));
  check(`every seeded list is editable (${unknown.join(", ")})`, lists.size > 0 && unknown.length === 0);
  const text = (sql) => sql.slice(1, -1).replaceAll("''", "'");
  const literal = "'(?:[^']|'')*'";
  const tuple = new RegExp(`^\\s*\\((${literal}), (${literal}), (${literal}), (null|${literal}), (\\d+), (${literal})\\)`, "gm");
  const seeded = [...seed.matchAll(tuple)].map((m, n) => ({
    id: `seed-${n}`, list: text(m[1]), value: text(m[2]), label: text(m[3]), parent_value: m[4] === "null" ? null : text(m[4]),
    sort_order: Number(m[5]), active: true, details: JSON.parse(text(m[6])),
  }));
  const found = problems(seeded);
  check(`the default options pass the rules (${found.join(" ")})`, seeded.length > 50 && found.length === 0);
  const symbols = new Set(SYMBOLS.map((s) => s.value));
  const icons = [...seed.matchAll(/"symbol":"([^"]+)"/g)].map((m) => m[1]);
  check(`every seeded icon can be chosen (${icons.filter((s) => !symbols.has(s)).join(", ")})`, icons.every((s) => symbols.has(s)));
}

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
