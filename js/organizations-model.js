// Organization rules for the Organizations page, which only platform admins see. Pure functions, no
// page code, so they're tested on their own (tests/organizations-model.test.mjs). The `people`
// server function (supabase/functions/people in FieldReadyApp) has the final say.

import { isEmail } from "./people-model.js";

const clean = (text) => String(text ?? "").trim();

export const blankOrganization = () => ({ name: "", storeName: "", ownerName: "", ownerEmail: "" });

/** What stops a new organization from being created, in plain words. Empty when it can be. */
export function newOrganizationProblems(form, organizations = []) {
  const found = [];
  const name = clean(form.name);
  const email = clean(form.ownerEmail).toLowerCase();
  if (!name) found.push("Enter the dealer's name.");
  else if (organizations.some((o) => clean(o.name).toLowerCase() === name.toLowerCase())) found.push("An organization with that name already exists.");
  if (!clean(form.storeName)) found.push("Enter the first store's name.");
  if (!clean(form.ownerName)) found.push("Enter the owner's name.");
  if (!isEmail(email)) found.push("Enter a valid email address for the owner.");
  else if (organizations.some((o) => o.owners.some((owner) => owner.email === email))) {
    found.push("That email already owns an organization. Each login belongs to one organization.");
  }
  return found;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** "2 stores · 5 staff · 1 customer login": stores in use and people who can sign in. */
export function summary(organization) {
  const stores = organization.stores.filter((store) => store.active).length;
  return [
    plural(stores, "store", "stores"),
    `${organization.staff} staff`,
    plural(organization.customerLogins, "customer login", "customer logins"),
  ].join(" · ");
}

/** Where an owner's sign-in stands. */
export function ownerStatus(owner) {
  if (!owner.active) return "Access off";
  if (owner.waiting) return "Hasn't chosen a password yet";
  return "Signed in";
}

/**
 * The message to send a new owner (or one sent a new password link) by hand, when the email didn't
 * go, with the website's address and guides worked out from `base`, the page's own address.
 */
export function handoverMessage({ kind, organizationName, ownerName, email, link }, base) {
  // The folder the page is in: drop any #page or ?query, then the file name.
  const site = String(base).replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  const firstName = clean(ownerName).split(/\s+/)[0] || clean(ownerName);
  if (kind === "reset") {
    return [
      `Hi ${firstName},`,
      "",
      `Here's a link to choose a new password for your Field Ready login (${email}, ${organizationName}). It works once:`,
      link,
    ].join("\n");
  }
  return [
    `Hi ${firstName},`,
    "",
    `Your Field Ready organization, ${organizationName}, is ready, and you're its owner. Your login is ${email}.`,
    "",
    "1. Choose your password with this link (it works once):",
    `   ${link}`,
    `2. Sign in at ${site} with your email and that password.`,
    "3. Add your stores, people, and customers. Your option lists and forms are already loaded; change them to suit your shop.",
    "",
    "You can also sign in to the Field Ready app with the same email and password.",
    "",
    `Admin Website Guide: ${site}admin-guide.html`,
    `Field Ready Field Guide: ${site}guide.html`,
  ].join("\n");
}
