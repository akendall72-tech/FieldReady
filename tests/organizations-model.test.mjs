// Tests for js/organizations-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/organizations-model.test.mjs

import { blankOrganization, newOrganizationProblems, renameProblems, summary, ownerStatus, handoverMessage } from "../js/organizations-model.js";
import { newPasswordProblem } from "../js/people-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const organizations = [
  {
    id: "a", name: "Agri-Service", staff: 5, customerLogins: 1,
    stores: [{ name: "North", active: true }, { name: "South", active: true }, { name: "Old", active: false }],
    owners: [{ id: "o1", name: "Olivia Owner", email: "owner@example.com", active: true, waiting: false }],
  },
];

// New organizations
{
  const ok = { name: "Prairie Implement", storeName: "Main Street", ownerName: "Pat Prairie", ownerEmail: " Pat@Example.com " };
  check("a blank form has every problem", newOrganizationProblems(blankOrganization(), organizations).length === 4);
  check("a complete form is fine", newOrganizationProblems(ok, organizations).length === 0);
  check("names are unique, ignoring case", newOrganizationProblems({ ...ok, name: " agri-service " }, organizations).includes("An organization with that name already exists."));
  check("a store is required", newOrganizationProblems({ ...ok, storeName: " " }, organizations).includes("Enter the first store's name."));
  check("an owner name is required", newOrganizationProblems({ ...ok, ownerName: "" }, organizations).includes("Enter the owner's name."));
  check("emails must look right", newOrganizationProblems({ ...ok, ownerEmail: "pat" }, organizations).includes("Enter a valid email address for the owner."));
  check("an owner's email can't own a second organization", newOrganizationProblems({ ...ok, ownerEmail: "OWNER@example.com" }, organizations).some((p) => p.includes("already owns")));
}

// The list
check("a new name is fine", renameProblems("  Prairie Ag Supply ", organizations[0], organizations).length === 0);
check("…its own name in other capitals too", renameProblems(organizations[0].name.toUpperCase(), organizations[0], organizations).length === 0);
check("a name is needed", renameProblems("  ", organizations[0], organizations)[0] === "Enter the organization's name.");
check("…and can't be another organization's", renameProblems("prairie ag", organizations[0], [...organizations, { id: "b", name: "Prairie Ag" }])[0]
  === "Another organization already has that name.");
check("summary counts stores in use", summary(organizations[0]) === "2 stores · 5 staff · 1 customer login");
check("summary plurals", summary({ stores: [{ active: true }], staff: 1, customerLogins: 0 }) === "1 store · 1 staff · 0 customer logins");
check("owners with access off", ownerStatus({ active: false, waiting: true }) === "Access off");
check("owners still on a temporary password", ownerStatus({ active: true, waiting: true }) === "Hasn't chosen a password yet");
check("owners who chose a password", ownerStatus({ active: true, waiting: false }) === "Signed in");

// The handover message (sent by hand when the email didn't go)
{
  const link = "https://example.github.io/FieldReady/welcome.html#token_hash=abc&type=recovery";
  const details = { kind: "new", organizationName: "Prairie Implement", ownerName: "Pat Prairie", email: "pat@example.com", link };
  const base = "https://example.github.io/FieldReady/index.html?x=1#organizations";
  const message = handoverMessage(details, base);
  check("greets by first name", message.startsWith("Hi Pat,"));
  check("names the organization and login", message.includes("Prairie Implement") && message.includes("Your login is pat@example.com."));
  check("gives the link, not a password", message.includes(link) && !/password: /i.test(message));
  check("links the website", message.includes("Sign in at https://example.github.io/FieldReady/ with"));
  check("links both guides", message.includes("https://example.github.io/FieldReady/admin-guide.html") && message.includes("https://example.github.io/FieldReady/guide.html"));
  check("works from the folder address", handoverMessage(details, "https://example.github.io/FieldReady/#organizations").includes("Sign in at https://example.github.io/FieldReady/ with"));
  const reset = handoverMessage({ ...details, kind: "reset" }, base);
  check("a reset gives a new link", reset.includes("link to choose a new password") && reset.includes(link) && !reset.includes("Add your stores"));
}

// Choosing your own password
check("passwords need 10 characters", newPasswordProblem("short-pw1", "short-pw1") === "Use at least 10 characters.");
check("…ten is enough", newPasswordProblem("long-enough", "long-enough") === null);
check("passwords must match", newPasswordProblem("long enough", "long enougj") === "The passwords don't match.");
check("a good password is fine", newPasswordProblem("long enough", "long enough") === null);

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
