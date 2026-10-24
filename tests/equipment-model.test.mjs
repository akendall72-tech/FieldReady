// Tests for js/equipment-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/equipment-model.test.mjs

import {
  canEdit, canManage, storesFor, canDeleteMachine, canDeleteCustomer, customerProblems, machineProblems, cleanMachine,
  isFactoryIntegrated, steeringFor, choices, hasCorrectionLevel, serviceGroups, featureChanges, featureStates, machineName,
  findCustomers,
} from "../js/equipment-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const owner = { role: "owner", location_id: null };
const admin = { role: "admin", location_id: "north" };
const tech = { role: "employee", location_id: "north" };
const stores = [
  { id: "north", name: "North", active: true },
  { id: "south", name: "South", active: true },
  { id: "old", name: "Old", active: false },
];

// Who may do what
check("everyone edits at their own store", canEdit(owner, "south") && canEdit(admin, "north") && canEdit(tech, "north"));
check("…but staff not at another store", !canEdit(admin, "south") && !canEdit(tech, "south"));
check("owners and admins archive and delete at their store", canManage(owner, "south") && canManage(admin, "north"));
check("employees never archive or delete", !canManage(tech, "north"));
check("owners pick any store in use", storesFor(owner, stores).map((s) => s.id).join() === "north,south");
check("staff pick only their own", storesFor(tech, stores).map((s) => s.id).join() === "north");
check("a record keeps showing its current store", storesFor(tech, stores, "old").map((s) => s.id).join() === "north,old");

// Deleting
const machines = [
  { id: "m1", customer_id: "a", finalized: 0 },
  { id: "m2", customer_id: "a", finalized: 2 },
  { id: "m3", customer_id: "b", finalized: 0 },
];
check("a machine without finalized inspections can be deleted", canDeleteMachine(machines[0]));
check("one with them can't", !canDeleteMachine(machines[1]));
check("a customer can be deleted only if none of their machines has finalized inspections", !canDeleteCustomer({ id: "a" }, machines) && canDeleteCustomer({ id: "b" }, machines));

// Saving
check("a customer needs a name and a store", customerProblems({ name: " ", location_id: null }).length === 2);
check("…and a real email if one is given", customerProblems({ name: "Farm", location_id: "north", email: "farm" }).length === 1
  && customerProblems({ name: "Farm", location_id: "north", email: "" }).length === 0);
check("a machine needs a manufacturer or model, a customer, and a store", machineProblems({}).length === 3
  && machineProblems({ model_name: "3660", customer_id: "a", location_id: "north" }).length === 0);
check("model years are four digits", machineProblems({ manufacturer: "Kinze", customer_id: "a", location_id: "north", model_year: "21" }).length === 1);
const cleaned = cleanMachine({ manufacturer: " Kinze ", model_name: "3660", model_year: "2021", customer_id: "a", location_id: "north" });
check("saved machines are trimmed, with defaults for unanswered questions", cleaned.manufacturer === "Kinze" && cleaned.model_year === 2021
  && cleaned.equipment_type === "tractor" && cleaned.guidance_system === "other" && cleaned.steering === "unknown");

// Options
const rows = [
  { list: "guidance_system", value: "ptx", label: "PTx", sort_order: 0, active: true, details: { factoryIntegrated: false } },
  { list: "guidance_system", value: "fendtGuide", label: "Fendt Guide", sort_order: 1, active: true, details: { factoryIntegrated: true } },
  { list: "guidance_system", value: "old", label: "Old system", sort_order: 2, active: false, details: {} },
  { list: "feature", value: "isobus", label: "ISOBUS", sort_order: 0, active: true, details: { equipment: ["tractor"] } },
  { list: "feature", value: "vDrive", label: "vDrive", sort_order: 1, active: true, details: { equipment: ["planter"] } },
  { list: "feature", value: "legacy", label: "Legacy", sort_order: 2, active: true, details: {} },
  { list: "component_kind", value: "display", label: "Display", sort_order: 0, active: true, details: { equipment: ["tractor", "planter"], correctionLevel: false } },
  { list: "component_kind", value: "receiver", label: "GNSS receiver", sort_order: 1, active: true, details: { equipment: ["tractor"], correctionLevel: true } },
  { list: "correction_service", value: "VRS Now", label: "VRS Now", parent_value: "networkRTK", sort_order: 0, active: true, details: { provider: "Trimble", group: "Trimble" } },
  { list: "correction_service", value: "Local", label: "Local network", parent_value: "networkRTK", sort_order: 1, active: true, details: { provider: "", group: "Other networks" } },
];
check("factory-integrated systems are recognized", isFactoryIntegrated(rows, "fendtGuide") && !isFactoryIntegrated(rows, "ptx"));
check("a factory system gets factory steering", steeringFor(rows, "fendtGuide", "assisted") === "factoryIntegrated");
check("leaving one clears it", steeringFor(rows, "ptx", "factoryIntegrated") === "unknown" && steeringFor(rows, "ptx", "assisted") === "assisted");
check("hidden options aren't offered…", choices(rows, "guidance_system").map((r) => r.value).join() === "ptx,fendtGuide");
check("…unless the record has one", choices(rows, "guidance_system", { current: "old" }).map((r) => r.value).join() === "ptx,fendtGuide,old");
check("unknown values still show as themselves", choices(rows, "guidance_system", { current: "spaceship" }).at(-1).label === "spaceship");
check("planters get planter features", choices(rows, "feature", { equipmentType: "planter" }).map((r) => r.value).join() === "vDrive");
check("tractors get tractor features, including ones saved before planters", choices(rows, "feature", { equipmentType: "tractor" }).map((r) => r.value).join() === "isobus,legacy");
check("component types follow the equipment type", choices(rows, "component_kind", { equipmentType: "planter" }).map((r) => r.value).join() === "display");
check("receivers have a correction level", hasCorrectionLevel(rows, "receiver") && !hasCorrectionLevel(rows, "display"));
const groups = serviceGroups(rows, "networkRTK");
check("services are grouped under their heading", groups.map((g) => `${g.title}:${g.services.join("+")}`).join("|") === "Trimble:VRS Now|Other networks:Local network");
check("other correction types list nothing", serviceGroups(rows, "satellite").length === 0);

// Features
const existing = [{ id: "f1", kind: "isobus", state: "installed" }, { id: "f2", kind: "legacy", state: "unknown" }];
const changes = featureChanges(existing, { isobus: "notInstalled", legacy: "unknown", vDrive: "installed", other: "unknown" });
check("existing feature rows are updated, never duplicated", changes.updates.map((f) => `${f.id}:${f.state}`).join() === "f1:notInstalled");
check("new kinds are inserted, but not when left Unknown", changes.inserts.map((f) => `${f.kind}:${f.state}`).join() === "vDrive:installed");
check("states read back by kind", featureStates(existing).isobus === "installed");

// Display and search
check("machine names join make and model", machineName({ manufacturer: "Kinze", model_name: "3660" }) === "Kinze 3660" && machineName({}) === "Unnamed machine");
const customers = [
  { id: "a", name: "Hillcrest Farms", email: "", phone: "555-0142", location_id: "north" },
  { id: "b", name: "Prairie Creek", email: "", phone: "", location_id: "south", archived_at: "2026-01-01" },
];
const fleet = [{ customer_id: "a", manufacturer: "Kinze", model_name: "3660", serial_number: "K-16" }];
check("search finds a customer by their machine's serial", findCustomers(customers, fleet, { search: "k-16" }).map((c) => c.id).join() === "a");
check("archived customers are hidden unless asked", findCustomers(customers, fleet).length === 1 && findCustomers(customers, fleet, { archived: true }).length === 2);
check("a store filter keeps that store's customers", findCustomers(customers, fleet, { store: "south", archived: true }).map((c) => c.id).join() === "b");

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
