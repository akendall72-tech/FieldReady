# Field Ready Admin

The website Agri-Service staff use to manage Field Ready: customers and their machines (with
customers' app logins), inspection checklists (Guidance, Planter, Machine, and everyone's own
Custom ones), and for owners and admins the machine options and people & stores (with each
store's contacts for customers). It's plain HTML, CSS, and JavaScript that talks straight to the
Field Ready Supabase project, so there's nothing to build or run on a server. GitHub Pages serves
it from this repository.

The app itself, the database schema, and the access rules live in the private `FieldReadyApp`
repository.

## Who can do what

| | Owners | Admins | Employees |
|---|---|---|---|
| Sign in | Yes | Yes | Yes, for Customers & machines only |
| Customers and machines | Every store's: add, edit, archive, delete | Their store's: add, edit, archive, delete | Their store's: add and edit |
| Guidance, Planter, and Machine checklists | Edit everything, publish; add, copy, and retire Machine checklists | Edit How to Check steps in the draft; copy a Machine checklist as their own Custom one | — |
| Custom checklists | Their own | Their own | Their own |
| Machine options (including equipment types and machine questions) | Edit everything | Look only | — |
| People | Add and change anyone; reset passwords | Add employees to their store; turn their access off or on; reset their passwords | — |
| Stores | Add, rename, stop using | — | — |
| Store contacts | Every store's | Their own store's | — |
| Customer logins | Every customer's | Their own store's customers' | — |

Customer logins can't use the website; they see their equipment in the app. A customer or machine
with a finalized inspection can be archived but never deleted. The database enforces these rules
(`supabase/migrations` in FieldReadyApp); the website only hides what someone can't do.

## Security

- `index.html` sets a content security policy: scripts, styles, and images only from this site,
  and network calls only to Field Ready's Supabase project. Anything new from elsewhere (a font, a
  library, another API) has to be added there, or it's blocked.
- Libraries live in `vendor/`, checked against npm's checksum and pinned with an `integrity` hash.
- GitHub Pages can't send security headers, and every Pages site under `akendall72-tech.github.io`
  shares one browser origin (and so this site's stored sign-in). Give this site its own domain.

## How the checklist editor works

- Checklists come in four kinds, one tab each: **Guidance** (offered on every equipment type that
  can have guidance), **Planter** (planters), **Machine** (one or more per equipment type, each
  naming the types it's for), and **Custom** (each person's own; only they see them and use them in
  the app, and once they finalize an inspection with one, their store's admins, the owners, and the
  customer can see that inspection).
- **New Checklist** and **Copy** start a draft of version 1. **Retire** stops phones offering a
  checklist for new inspections; inspections already started or finished with it keep it. Retired
  checklists can be brought back.
- A check's **Applies to** can name equipment types and machine answers (for example, only machines
  on tracks, or with a front loader). A machine that hasn't answered a question keeps the check.
- Phones use the **live** version: the highest published version number.
- **Start Editing** makes one shared **draft** of the next version. Save as often as you like;
  phones don't see drafts.
- **Publish** (owners) makes the draft live. Phones pick it up at their next sync, and draft
  inspections switch to it when they're opened. Finalized inspections keep the version they were
  signed with. A published version can't be changed; edits always make a new version.
- Check keys never change once published, so answers on draft inspections carry over.
- The editor won't publish a checklist phones couldn't use (the same rules the app applies).

## How the options editor works

- Each list is what technicians pick from when they describe a machine: guidance systems,
  steering, correction types and their services, component types, optional features, and so on.
- **Rename**, **reorder**, **hide**, and **add** options, and set what the app does with them
  (for example, whether a steering type steers automatically, which decides if steering checks
  apply). **Save Changes** sends them; phones pick them up at their next sync.
- An option's value (shown as "Saved as …") never changes, because machines and inspections store
  it. Hidden options aren't offered for new work but still show on records that have them.
- Options the app relies on (Other, Unknown, Preseason, the display, receiver, and steering
  component types…) can be renamed but not hidden.
- **Equipment types** can be added. Each has an icon and two settings: whether it can have guidance
  (it gets the guidance questions and Guidance inspections) and whether it has Precision Planting
  technology. Optional features, component types, and **machine questions** say which types they're
  **used on**; a planter's features are its Precision Planting products. Each machine question has
  its **answers** listed under it.
- Saving never overwrites an option someone else saved since you opened the page.

## How the people page works

- **Add Person** creates the person's login and shows a temporary password once, to give them.
  They sign in to the app with it and change it in Settings › Change Password.
- Logins are created by the `people` server function in Supabase (its code is in the app's
  repository). It holds the secret key that creating logins needs; this site never has it.
- Changes to someone's store, role, or access reach their app the next time they open it. Nobody can
  turn off their own access, and the only owner stays an owner.

## How the customers and machines page works

- Search finds a customer by their name, email, or phone, or by any of their machines' make, model,
  or serial number. Archived customers and machines show only with **Show archived**.
- **Add Customer** and **Edit** change a customer's name, phone, email, and store. **Add Machine**
  and clicking a machine open the machine page, with everything the app records about it:
  details, technology (tractors only: guidance system, software, steering, correction), components,
  optional features or Precision Planting products (these save as soon as they're picked),
  and correction subscriptions. Picking a factory-integrated guidance system sets factory steering,
  as in the app.
- Saving never overwrites a customer or machine someone else saved since you opened it. Phones pick
  up changes at their next sync, and deletions reach them through the server's deletion log.
- **Archive** hides a customer (and their machines) or a machine from lists, keeping its history.
  **Delete** removes it everywhere, with its technology, subscriptions, and draft inspections; it's
  offered only when no finalized inspection depends on it.
- **Add Login** gives a customer's person an app login (a farm can have several). It shows a
  temporary password once; they choose their own the first time they sign in.
- A customer login sees only that customer's equipment, completed inspections with reports,
  subscriptions, and who to contact at their store. It can't change anything.
- Each store's contacts (PTx Product Specialists, Sales, Customer Service, Service) are edited under
  **People & stores › Stores › Contacts**; admins see their own store's contacts there.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/site.css` | The page and its look (the app's colors) |
| `vendor/` | Supabase's browser library, kept here instead of loaded from a CDN (how to update: `vendor/README.md`) |
| `js/config.js` | The Supabase address and **publishable** key. Both are meant to be public; never put a secret or service-role key here |
| `js/api.js` | Sign-in and database calls |
| `js/main.js` | Sign-in, who may use the site, header and pages |
| `js/views/checklist.js` | The checklists by kind, and the checklist editor |
| `js/checklist-model.js` | Checklist rules (validation, versions, keys, kinds, new checklists), tested on their own |
| `js/views/options.js` | The machine options editor |
| `js/views/people.js` | The people and stores page, with each store's contacts |
| `js/views/customers.js` | The customers and machines list, the customer editor, and customers' app logins |
| `js/views/machine.js` | The machine page (details, technology, components, features, subscriptions) |
| `js/equipment-model.js` | Customer and machine rules (who may do what, saving, which options to offer); tested on their own |
| `js/customers-model.js` | Customer login and store contact rules; tested on their own |
| `js/people-model.js` | Who may change whom, the add form's rules, temporary passwords; tested on their own |
| `js/options-model.js` | Option rules (lists and their settings, new values, ordering, changes), tested on their own |
| `tests/*.test.mjs` | Tests for those rules |

## Testing

The rules run in the JavaScript engine built into macOS:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/checklist-model.test.mjs -- ../FieldReady/FieldReady/Resources/Templates/*.json ../FieldReady/supabase/seed/checklists/*.json ../FieldReady/supabase/seed/default_catalog.sql
```

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/options-model.test.mjs -- ../FieldReady/supabase/seed/default_catalog.sql
```

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/people-model.test.mjs
```

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/customers-model.test.mjs
```

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/equipment-model.test.mjs
```

To try the site locally, serve this folder (for example `python3 -m http.server 8765`) and open
http://localhost:8765.
