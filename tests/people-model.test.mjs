// Tests for js/people-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/people-model.test.mjs

import {
  rolesFor, permissions, isLastOwner, newPersonProblems, sortPeople, temporaryPassword, roleLabel,
} from "../js/people-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const person = (id, role, location_id, extra = {}) => ({ id, role, location_id, active: true, email: `${id}@example.com`, full_name: id, ...extra });
const owner = person("owner", "owner", null);
const admin = person("admin", "admin", "north");
const tech = person("tech", "employee", "north");
const southTech = person("southTech", "employee", "south");
const southAdmin = person("southAdmin", "admin", "south");
const people = [owner, admin, tech, southTech, southAdmin];

// Adding people
check("owners give any role", rolesFor(owner).join() === "owner,admin,employee");
check("admins add employees only", rolesFor(admin).join() === "employee");
check("employees add nobody", rolesFor(tech).length === 0);

// Changing people
{
  const p = permissions(owner, tech, people);
  check("owners change everything about others", p.name && p.role && p.store && p.access && p.password);
  const self = permissions(owner, owner, people);
  check("owners can't turn off their own access", !self.access);
  check("the last owner stays an owner", isLastOwner(owner, people) && !self.role);
  const second = person("owner2", "owner", null);
  check("with two owners, either can be changed", !isLastOwner(owner, [...people, second]) && permissions(owner, owner, [...people, second]).role);
  check("…but never turn off their own access", !permissions(owner, owner, [...people, second]).access);
}
{
  const p = permissions(admin, tech, people);
  check("admins manage their store's employees", p.name && p.access && p.password && !p.role && !p.store);
  const other = permissions(admin, southTech, people);
  check("admins can't touch other stores", !other.name && !other.access && !other.password);
  const peer = permissions(admin, southAdmin, people);
  check("admins can't change other admins", !peer.access && !peer.password);
  const self = permissions(admin, admin, people);
  check("admins change their own name and password only", self.name && self.password && !self.access && !self.role);
  check("employees change nothing here", Object.values(permissions(tech, tech, people)).every((v) => !v));
}

// The add form
{
  const ok = { full_name: "Pat Tech", email: "Pat@Example.com", role: "employee", location_id: "north" };
  check("a complete new employee is fine", newPersonProblems(ok, owner, people).length === 0);
  check("owners need no store", newPersonProblems({ ...ok, role: "owner", location_id: null }, owner, people).length === 0);
  check("others need a store", newPersonProblems({ ...ok, location_id: null }, owner, people).includes("Choose a store."));
  check("admins can't add admins", newPersonProblems({ ...ok, role: "admin" }, admin, people).includes("Choose a role."));
  check("emails must look right", newPersonProblems({ ...ok, email: "pat" }, owner, people).includes("Enter a valid email address."));
  check("no one is added twice", newPersonProblems({ ...ok, email: "TECH@example.com" }, owner, people).some((p) => p.includes("already on the list")));
  check("waiting invitations are caught", newPersonProblems(ok, owner, people, [{ email: "pat@example.com" }]).some((p) => p.includes("waiting for a login")));
  check("names are required", newPersonProblems({ ...ok, full_name: " " }, owner, people).includes("Enter their name."));
}

// Order and labels
check("owners, admins, then employees", sortPeople([tech, southAdmin, owner, admin]).map((p) => p.id).join() === "owner,admin,southAdmin,tech");
check("role labels", roleLabel("admin") === "Admin");

// Temporary passwords
{
  const fixed = temporaryPassword((n) => Uint32Array.from({ length: n }, (_, i) => i));
  check("passwords read like Field-BCDE-FGHJ", fixed === "Field-BCDE-FGHJ");
  const real = temporaryPassword((n) => {
    const values = new Uint32Array(n);
    for (let i = 0; i < n; i += 1) values[i] = Math.floor(Math.random() * 2 ** 32);
    return values;
  });
  check("passwords are long enough for the server", real.length >= 13 && /^[A-Z][a-z]+-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(real));
  check("no look-alike characters", !/[01OIL]/.test(real.split("-").slice(1).join("")));
}

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
