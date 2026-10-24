// Tests for js/customers-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/customers-model.test.mjs

import {
  CONTACT_ROLES, canManageCustomer, canEditContacts, loginsFor, newLogin, newLoginProblems,
  contactGroups, contactProblems,
} from "../js/customers-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const owner = { id: "owner", role: "owner", location_id: null };
const admin = { id: "admin", role: "admin", location_id: "north" };
const employee = { id: "tech", role: "employee", location_id: "north" };
const farmA = { id: "a", name: "Hillcrest Farms", email: "Office@Hillcrest.example", phone: "555-0142", location_id: "north" };
const farmB = { id: "b", name: "Prairie Creek Ag", email: "", phone: "", location_id: "south" };
const people = [
  { id: "l1", role: "customer", customer_id: "a", full_name: "Hank Hill", email: "hank@hillcrest.example" },
  { id: "l2", role: "customer", customer_id: "a", full_name: "Ann Hill", email: "ann@hillcrest.example" },
  { id: "l3", role: "customer", customer_id: "b", full_name: "Pat Prairie", email: "pat@prairie.example" },
  { id: "tech", role: "employee", location_id: "north", full_name: "Tech", email: "tech@agri.example" },
];

// Who manages what
check("owners manage every customer", canManageCustomer(owner, farmA) && canManageCustomer(owner, farmB));
check("admins manage their store's customers only", canManageCustomer(admin, farmA) && !canManageCustomer(admin, farmB));
check("employees manage no customers", !canManageCustomer(employee, farmA));
check("owners edit every store's contacts", canEditContacts(owner, "north") && canEditContacts(owner, "south"));
check("admins edit their own store's contacts", canEditContacts(admin, "north") && !canEditContacts(admin, "south"));
check("employees edit no contacts", !canEditContacts(employee, "north"));

// Logins
check("a customer can have several logins, by name", loginsFor(farmA, people).map((p) => p.full_name).join() === "Ann Hill,Hank Hill");
check("staff are never a customer's logins", loginsFor(farmA, people).every((p) => p.role === "customer"));
check("a new login starts from the customer's name and email", newLogin(farmA).full_name === "Hillcrest Farms" && newLogin(farmA).email === "office@hillcrest.example");
check("a complete login is fine", newLoginProblems({ full_name: "Hank", email: "new@hillcrest.example" }, people).length === 0);
check("emails already used are caught", newLoginProblems({ full_name: "Hank", email: "HANK@hillcrest.example" }, people).includes("That email already has a Field Ready login."));
check("waiting invitations are caught", newLoginProblems({ full_name: "Hank", email: "w@x.example" }, people, [{ email: "w@x.example" }]).some((p) => p.includes("waiting")));
check("customers without an email need one entered", newLoginProblems(newLogin(farmB), people).includes("Enter a valid email address."));

// Contacts
const contacts = [
  { id: "1", location_id: "north", role: "service", name: "Sam Service", sort_order: 0 },
  { id: "2", location_id: "north", role: "ptx_specialist", name: "Pat PTx", sort_order: 1 },
  { id: "3", location_id: "north", role: "ptx_specialist", name: "Alex PTx", sort_order: 0 },
  { id: "4", location_id: "south", role: "sales", name: "Elsewhere", sort_order: 0 },
];
const groups = contactGroups(contacts, "north");
check("four contact groups in the app's order", groups.map((g) => g.label).join("|") === CONTACT_ROLES.map((r) => r.label).join("|") && groups.length === 4);
check("each group in its saved order", groups[0].contacts.map((c) => c.name).join() === "Alex PTx,Pat PTx");
check("only this store's contacts", groups[1].contacts.length === 0 && groups[3].contacts.length === 1);
check("a contact needs a name", contactProblems({ name: " ", phone: "555" }).includes("Enter the contact's name."));
check("…and a phone or email", contactProblems({ name: "Pat" }).includes("Enter a phone number or an email.")
  && contactProblems({ name: "Pat", phone: "555-0100" }).length === 0);
check("…with a real email if given", contactProblems({ name: "Pat", email: "pat" }).includes("Check the email address."));

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
