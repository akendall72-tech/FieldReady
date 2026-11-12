// Tests for js/activity-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/activity-model.test.mjs

import { ACTIVITY_GROUPS, groupFilter, describeActivity, actorLabel } from "../js/activity-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}
const say = (action, subject, details = {}) => describeActivity({ action, subject, details });

// Filters
check("All has no filter", groupFilter("all") === null);
check("an unknown filter shows everything", groupFilter("nonsense") === null);
check("People covers people, logins and two-step", groupFilter("people") === "action.like.person.*,action.like.login.*,action.like.two_step.*");
check("Emails covers sent and failed", groupFilter("emails") === "action.like.email.*");
const actions = ["person.changed", "person.access_off", "person.access_on", "person.removed", "login.created", "login.deleted", "two_step.reset",
  "email.sent", "email.failed", "store.added", "store.renamed", "store.closed", "store.reopened", "store.removed", "contact.added",
  "contact.changed", "contact.removed", "organization.created", "organization.renamed", "organization.changed", "form.published", "form.retired",
  "option.added", "option.changed", "option.removed", "customer.deleted", "machine.deleted", "inspection.deleted",
  "promotion.published", "promotion.stopped", "lead.new", "lead.contacted", "lead.sold", "lead.notInterested", "receiver.moved"];
const groupsOf = (action) => ACTIVITY_GROUPS.filter((g) => g.prefixes.some((p) => action.startsWith(p))).map((g) => g.id);
check("every action the database and the function record has exactly one filter", actions.every((action) => groupsOf(action).length === 1));

// Wording
check("a receiver moved between a customer's machines", say("receiver.moved", "AG-25", { serial: "1234", from: "Fendt 724", to: "MF 7S.180" })
  === "moved receiver AG-25 (S/N 1234) from Fendt 724 to MF 7S.180");
check("Records shows receiver moves", groupFilter("records").includes("action.like.receiver.*"));
check("role and store changes", say("person.changed", "Erin Tech", { role: ["employee", "admin"], store: ["North", "South"] })
  === "changed Erin Tech: role employee → admin; store North → South");
check("a store set for the first time", say("person.changed", "Erin", { store: [null, "North"] }) === "changed Erin: store none → North");
check("access turned off", say("person.access_off", "Pat") === "turned off Pat's access");
check("a new login with its role", say("login.created", "Pat", { email: "pat@x.test", role: "employee" }) === "added a login for Pat (pat@x.test) as an employee");
check("…an admin", say("login.created", "Pat", { email: "pat@x.test", role: "admin" }) === "added a login for Pat (pat@x.test) as an admin");
check("…a customer login", say("login.created", "Hank", { email: "h@x.test", role: "customer" }) === "added a login for Hank (h@x.test) as a customer login");
check("the email isn't repeated when it's the name", say("login.deleted", "pat@x.test", { email: "pat@x.test" }) === "deleted pat@x.test's login");
check("an invitation emailed", say("email.sent", "Pat", { email: "pat@x.test", kind: "staff" }) === "emailed Pat an invitation (pat@x.test)");
check("a password link emailed", say("email.sent", "Pat", { kind: "reset" }) === "emailed Pat a password link");
check("an email that failed, link shown", say("email.failed", "Pat", { linkShown: true }) === "couldn't email Pat; the link was shown to copy");
check("a renamed store", say("store.renamed", "South", { name: ["Old South", "South"] }) === "renamed a store: Old South → South");
check("a store contact", say("contact.added", "Sam", { role: "ptx_specialist", store: "North" }) === "added Sam as a store contact (PTx specialist, North)");
check("customer inspections turned off", say("organization.changed", "Agri-Service", { customer_inspections: [true, false] }) === "turned customer inspections off");
check("…and on", say("organization.changed", "Agri-Service", { customer_inspections: [false, true] }) === "turned customer inspections on");
check("the promotions permission", say("person.changed", "Sam", { promotions: [false, true] }) === "changed Sam: can now manage promotions");
check("the forms and options permission", say("person.changed", "Sam", { setup: [false, true] }) === "changed Sam: can now edit forms and options");
check("…taken away", say("person.changed", "Sam", { setup: [true, false] }) === "changed Sam: can no longer edit forms and options");
check("a published offer", say("promotion.published", "Renew early", { ends: "2026-12-10" }) === "published the offer Renew early (until 2026-12-10)");
check("a new lead", say("lead.new", "Hillcrest Farms", { offer: "Renew early", machine: "Fendt 724" }) === "tapped I'm interested in Renew early for the Fendt 724 (Hillcrest Farms)");
check("a lead sold", say("lead.sold", "Hillcrest Farms", { offer: "Renew early" }) === "marked Hillcrest Farms's interest in Renew early as sold");
check("a lead email", say("email.sent", "Hillcrest Farms", { kind: "lead", email: "sam@x.test" }) === "emailed the store about Hillcrest Farms's interest (sam@x.test)");
check("a published form", say("form.published", "PTx guidance inspection 1.1") === "published the PTx guidance inspection 1.1 form");
check("an option added names its list", say("option.added", "Trimble RTX", { list: "correction_service" }) === "added Trimble RTX to correction services");
check("an option renamed and hidden", say("option.changed", "Trimble RTX", { list: "correction_service", label: ["RTX", "Trimble RTX"], shown: [true, false] })
  === "changed Trimble RTX in correction services: renamed from RTX, hidden");
check("an unknown list still reads", say("option.removed", "X", { list: "made_up_list" }) === "removed X from made up list");
check("a deleted inspection", say("inspection.deleted", "Field Ready · 2026-11-05") === "deleted an inspection (Field Ready · 2026-11-05)");
check("an action the page doesn't know yet", say("future.thing", "Y") === "future.thing: Y");
check("a missing subject", say("person.access_on", "") === "turned on someone's access");
check("who did it", actorLabel({ actor_name: " Olivia " }) === "Olivia" && actorLabel({ actor_name: "" }) === "Someone");

if (failures.length) {
  print(`activity model: ${passed} passed, ${failures.length} failed`);
  for (const name of failures) print(`  FAIL ${name}`);
  throw new Error("activity model tests failed");
}
print(`activity model: ${passed} checks passed`);
