// Tests for js/subscriptions-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/subscriptions-model.test.mjs

import { headingOf, providerGroups, newProviderProblem, newServiceProblems, newService, NO_PROVIDER } from "../js/subscriptions-model.js";
import { problems } from "../js/options-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const row = (list, value, label, sort_order, extra = {}) => ({ id: `${list}-${value}`, list, value, label, sort_order, active: true, parent_value: null, details: {}, ...extra });
const rows = [
  row("correction_type", "satellite", "Satellite", 0),
  row("correction_type", "networkRTK", "Network RTK", 1),
  row("correction_service", "VRS Now", "VRS Now", 0, { parent_value: "networkRTK", details: { provider: "Trimble" } }),
  row("correction_service", "CenterPoint RTX", "CenterPoint RTX", 1, { parent_value: "satellite", details: { provider: "Trimble" } }),
  row("correction_service", "SF3", "SF3", 0, { parent_value: "satellite", details: { provider: "John Deere" } }),
  row("correction_service", "State network", "State network", 2, { parent_value: "networkRTK", details: { provider: "", group: "State RTK networks" } }),
  row("correction_service", "Mystery", "Mystery", 3, { parent_value: "networkRTK", details: {} }),
];

// Grouping
const groups = providerGroups(rows);
check("grouped by provider, alphabetically, No provider last", groups.map((g) => g.name).join() === "John Deere,State RTK networks,Trimble,No provider");
check("within a provider, by correction type", groups.find((g) => g.name === "Trimble").services.map((s) => s.label).join() === "CenterPoint RTX,VRS Now");
check("a heading stands in for a missing provider", headingOf(rows[5]).field === "group" && headingOf(rows[5]).name === "State RTK networks");
check("services with neither are under No provider", headingOf(rows[6]).name === NO_PROVIDER);
check("a provider just added shows with no services", providerGroups(rows, ["Ag Leader"]).find((g) => g.name === "Ag Leader")?.services.length === 0);
check("…but not twice", providerGroups(rows, ["trimble"]).filter((g) => g.name.toLowerCase() === "trimble").length === 1);

// Adding
check("a provider needs a name", newProviderProblem(" ", groups) === "Enter the provider's name.");
check("…that isn't already listed", newProviderProblem("trimble", groups) === "That provider is already listed.");
check("a new provider is fine", newProviderProblem("Ag Leader", groups) === null);
check("a service needs a name and a type", newServiceProblems({ label: "", type: "" }, rows).length === 2);
check("…and a name its type doesn't have", newServiceProblems({ label: "vrs now", type: "networkRTK" }, rows).includes("That correction type already has a service with that name."));
check("the same name under another type is fine", newServiceProblems({ label: "VRS Now", type: "satellite" }, rows).length === 0);

const added = newService(rows, { label: " TerraStar-C PRO ", type: "satellite", note: " Yearly subscription ", heading: { name: "Ag Leader", field: "provider" }, organizationId: "org" });
check("a new service saves its name as its value, under its type and provider", added.value === "TerraStar-C PRO" && added.label === "TerraStar-C PRO"
  && added.parent_value === "satellite" && added.details.provider === "Ag Leader" && added.details.note === "Yearly subscription" && added.id === null);
check("…at the end of its type", added.sort_order === 2);
const generic = newService(rows, { label: "County network", type: "networkRTK", heading: { name: "State RTK networks", field: "group" }, organizationId: "org" });
check("under a heading, it gets the heading", generic.details.group === "State RTK networks" && generic.details.provider === "" && generic.details.note === undefined);
check("new services pass the option rules", problems([...rows.slice(0, 5), added, generic]).length === 0);

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
