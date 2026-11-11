// Tests for js/promotions-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/promotions-model.test.mjs

import {
  CONDITIONS, blankCondition, withOp, describeCondition, conditionProblem, blankOffer, addDays, offerProblems, cleanOffer,
  offerState, resultsFor, audienceWords, storesWords, isOpenLead, leadStatusLabel, valueKind, findCustomers, customerName,
} from "../js/promotions-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const rows = [
  { list: "equipment_type", value: "planter", label: "Planter" }, { list: "equipment_type", value: "sprayer", label: "Sprayer" },
  { list: "component_kind", value: "display", label: "Display" }, { list: "feature", value: "sectionControl", label: "Section control" },
  { list: "receiver_correction_level", value: "high", label: "High (RTK)" },
];

// Conditions
check("every condition has a starting value of its own kind", CONDITIONS.every((c) => {
  const blank = blankCondition(c.field);
  return blank.field === c.field && blank.op === c.ops[0].op;
}));
check("the database's fields, one each", CONDITIONS.map((c) => c.field).join() ===
  "customer,equipment_type,manufacturer,model_year,guidance_system,steering,correction,receiver_level,component,feature,subscription,inspection");
check("expires within takes days", valueKind({ field: "subscription", op: "expires_within" }).unit === "days");
check("…none takes nothing", valueKind({ field: "subscription", op: "none" }).type === "none");
check("changing to an op with another kind of value resets it", withOp(blankCondition("subscription"), "none").value === null);
check("…and back gives a number", withOp({ field: "subscription", op: "none", value: null }, "expires_within").value === 60);
check("changing between ops of the same kind keeps it", withOp({ field: "feature", op: "installed", value: "sectionControl" }, "not_installed").value === "sectionControl");

// Wording
check("a list in plain words", describeCondition({ field: "equipment_type", op: "in", value: ["planter", "sprayer"] }, rows) === "Equipment type is Planter or Sprayer");
check("one choice", describeCondition({ field: "receiver_level", op: "in", value: ["high"] }, rows) === "Receiver accuracy is High (RTK)");
check("a range", describeCondition({ field: "model_year", op: "between", value: { from: 2015, to: 2020 } }) === "Model year 2015–2020");
check("an open range", describeCondition({ field: "model_year", op: "between", value: { from: 2018, to: null } }) === "Model year 2018 or newer");
check("a component with a model", describeCondition({ field: "component", op: "has", value: { kind: "display", model: "750" } }, rows) === "Has a display whose model contains “750”");
check("a feature not installed", describeCondition({ field: "feature", op: "not_installed", value: "sectionControl" }, rows) === "Section control isn't installed");
check("a renewal window", describeCondition({ field: "subscription", op: "expires_within", value: 60 }) === "Correction subscription expires within 60 days");
check("a finding covers fails and recommendations", describeCondition({ field: "inspection", op: "finding", value: null }) === "The last inspection had a failed check or a recommendation");
check("no recent inspection", describeCondition({ field: "inspection", op: "none_for_months", value: 12 }) === "No inspection in the last 12 months");

// Chosen customers
const customers = [
  { id: "a", name: "Hillcrest Farms", store_name: "North" }, { id: "b", name: "NT Farm", store_name: "South" },
  { id: "c", name: "Big Farm Co", store_name: "North" }, { id: "d", name: "Farmstead LLC", store_name: "North" },
];
check("a new customer condition starts with nobody chosen", JSON.stringify(blankCondition("customer").value) === "[]");
check("chosen customers by name", describeCondition({ field: "customer", op: "in", value: ["a", "b"] }, [], customers) === "Customer is Hillcrest Farms or NT Farm");
check("customers this person can't see aren't named", describeCondition({ field: "customer", op: "in", value: ["a", "x", "y"] }, [], customers) === "Customer is Hillcrest Farms or 2 other customers"
  && describeCondition({ field: "customer", op: "in", value: ["x"] }, [], customers) === "Customer is 1 other customer");
check("…and a name only for one on the list", customerName(customers, "b") === "NT Farm" && customerName(customers, "x") === null);
check("a customer condition needs someone chosen", conditionProblem({ field: "customer", op: "in", value: [] }) === "Customer: choose at least one."
  && conditionProblem({ field: "customer", op: "in", value: ["a"] }) === null);
check("finding customers matches part of a name, either case, starts first", findCustomers(customers, "FARM").map((c) => c.id).join() === "d,a,b,c");
check("…leaves out the chosen ones", findCustomers(customers, "farm", ["a", "d"]).map((c) => c.id).join() === "b,c");
check("…stops at the limit", findCustomers(customers, "farm", [], 2).length === 2);
check("…and shows nothing until something's typed", findCustomers(customers, "  ").length === 0);

// Problems
check("a list needs a choice", conditionProblem({ field: "steering", op: "in", value: [] }) === "Steering: choose at least one.");
check("a make needs words", conditionProblem({ field: "manufacturer", op: "contains", value: "  " }) !== null);
check("years in order", conditionProblem({ field: "model_year", op: "between", value: { from: 2020, to: 2015 } }) !== null);
check("…and four digits", conditionProblem({ field: "model_year", op: "between", value: { from: 20, to: null } }) !== null);
check("days are whole and positive", conditionProblem({ field: "subscription", op: "expires_within", value: 0 }) !== null
  && conditionProblem({ field: "subscription", op: "expires_within", value: 90 }) === null);
check("conditions with nothing to fill in are fine", conditionProblem({ field: "inspection", op: "finding", value: null }) === null);

const offer = { ...blankOffer("2026-11-10"), title: "Renew early", deal: "10% off" };
check("a blank offer runs 30 days", offer.ends_on === "2026-12-10" && addDays("2026-12-31", 1) === "2027-01-01");
check("a titled offer with no conditions is ready (it reaches everyone)", offerProblems(offer).length === 0);
check("an offer needs a title", offerProblems({ ...offer, title: " " })[0] === "Give the offer a title.");
check("…and to end after it starts", offerProblems({ ...offer, ends_on: "2026-11-01" }).includes("The offer has to end on or after the day it starts."));
check("…and good conditions", offerProblems({ ...offer, rules: [{ field: "feature", op: "installed", value: "" }] }).includes("Feature: choose one."));
check("saving trims and keeps the conditions", JSON.stringify(cleanOffer({ ...offer, title: " Renew early ", rules: [blankCondition("inspection")] })) ===
  JSON.stringify({ title: "Renew early", description: "", deal: "10% off", code: "", starts_on: "2026-11-10", ends_on: "2026-12-10", store_ids: [],
    rules: [{ field: "inspection", op: "finding", value: null }] }));

// States and results
check("drafts", offerState({ status: "draft" }, "2026-11-10").label === "Draft");
check("running", offerState({ status: "live", starts_on: "2026-11-01", ends_on: "2026-11-30" }, "2026-11-10").key === "running");
check("scheduled", offerState({ status: "live", starts_on: "2026-12-01", ends_on: "2026-12-30" }, "2026-11-10").key === "scheduled");
check("ended", offerState({ status: "live", starts_on: "2026-10-01", ends_on: "2026-10-30" }, "2026-11-10").label === "Ended");
check("stopped", offerState({ status: "stopped", starts_on: "2026-11-01", ends_on: "2026-11-30" }, "2026-11-10").label === "Stopped");
const results = [
  { promotion_id: "p", seen: 3, interested: 1, not_now: 1, sold: 1 },
  { promotion_id: "q", seen: 1, interested: 1, not_now: 0, sold: 0 },
];
const r = resultsFor(results, "p");
check("results come from the server's counts", r.seen === 3 && r.interested === 1 && r.notNow === 1 && r.sold === 1);
check("an offer nobody has answered has zeros", JSON.stringify(resultsFor(results, "new")) === JSON.stringify({ seen: 0, interested: 0, notNow: 0, sold: 0 }));
check("audience in words", audienceWords({ customers: 2, machines: 3 }) === "Matches 2 customers, 3 machines"
  && audienceWords({ customers: 1, machines: 1 }) === "Matches 1 customer, 1 machine"
  && audienceWords({ customers: 1200, machines: 3400 }) === "Matches 1200 customers, 3400 machines");
check("stores in words", storesWords({ store_ids: [] }, []) === "Every store"
  && storesWords({ store_ids: ["n"] }, [{ id: "n", name: "North" }]) === "North");
check("open leads", isOpenLead({ lead_status: "new" }) && isOpenLead({ lead_status: "contacted" }) && !isOpenLead({ lead_status: "sold" }));
check("lead labels", leadStatusLabel("notInterested") === "Not interested" && leadStatusLabel(null) === "New");

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
