// Customer login and store contact rules for the Customers tab and the store contacts editor. Pure
// functions, no page code, so they're tested on their own (tests/customers-model.test.mjs). They
// mirror the database's rules (supabase/migrations/…_customer_logins.sql in FieldReadyApp), which
// have the final say.

import { isEmail } from "./people-model.js";

/** The four kinds of store contact customers see in the app, in the order it shows them. */
export const CONTACT_ROLES = [
  { value: "ptx_specialist", label: "PTx Product Specialist" },
  { value: "sales", label: "Sales Representative" },
  { value: "customer_service", label: "Customer Service Representative" },
  { value: "service", label: "Service" },
];

/** Owners manage every customer's logins; admins those of customers at their own store. */
export const canManageCustomer = (viewer, customer) =>
  viewer.role === "owner" || (viewer.role === "admin" && customer.location_id === viewer.location_id);

/** Owners edit every store's contacts; admins their own store's. */
export const canEditContacts = (viewer, storeId) =>
  viewer.role === "owner" || (viewer.role === "admin" && storeId === viewer.location_id);

/** The app logins that belong to this customer. */
export const loginsFor = (customer, people) =>
  people.filter((person) => person.role === "customer" && person.customer_id === customer.id)
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));

/** A new login for a customer, starting from the customer's own name and email. */
export const newLogin = (customer) => ({ full_name: customer.name ?? "", email: (customer.email ?? "").trim().toLowerCase() });

/** What stops a customer login from being added, in plain words. Empty when it can be. */
export function newLoginProblems(login, people = [], invitations = []) {
  const found = [];
  const email = String(login.email ?? "").trim().toLowerCase();
  if (!String(login.full_name ?? "").trim()) found.push("Enter the name of the person who'll sign in.");
  if (!isEmail(email)) found.push("Enter a valid email address.");
  else if (people.some((p) => p.email === email)) found.push("That email already has a Field Ready login.");
  else if (invitations.some((i) => i.email === email)) found.push("That email is waiting for a login. Cancel it first.");
  return found;
}

/** A store's contacts grouped by role, in role order, each group in its saved order. */
export function contactGroups(contacts, storeId) {
  const mine = contacts.filter((contact) => contact.location_id === storeId);
  return CONTACT_ROLES.map((role) => ({
    ...role,
    contacts: mine.filter((c) => c.role === role.value).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  }));
}

/** What's wrong with a contact before it's saved. Empty when it can be. */
export function contactProblems(contact) {
  const found = [];
  if (!String(contact.name ?? "").trim()) found.push("Enter the contact's name.");
  if (!String(contact.phone ?? "").trim() && !String(contact.email ?? "").trim()) found.push("Enter a phone number or an email.");
  if (String(contact.email ?? "").trim() && !isEmail(contact.email)) found.push("Check the email address.");
  return found;
}
