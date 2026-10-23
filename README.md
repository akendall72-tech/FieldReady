# Field Ready Admin

The website owners and admins use to manage Field Ready: the inspection checklists, machine
options, people & stores (with each store's contacts for customers), and customers' app logins. It's plain HTML, CSS, and JavaScript that talks straight to the
Field Ready Supabase project, so there's nothing to build or run on a server. GitHub Pages serves
it from this repository.

The app itself, the database schema, and the access rules live in the private `FieldReadyApp`
repository.

## Who can do what

| | Owners | Admins | Employees |
|---|---|---|---|
| Sign in | Yes | Yes | No (they use the app) |
| Inspection checklist | Edit everything, publish | Edit How to Check steps in the draft | — |
| Machine options | Edit everything | Look only | — |
| People | Add and change anyone; reset passwords | Add employees to their store; turn their access off or on; reset their passwords | — |
| Stores | Add, rename, stop using | — | — |
| Store contacts | Every store's | Their own store's | — |
| Customer logins | Every customer's | Their own store's customers' | — |

The database enforces these rules (`supabase/migrations` in FieldReadyApp); the website only hides
what someone can't do.

## How the checklist editor works

- There's one checklist per equipment type. The **Tractor / Planter** switch picks which one to edit.
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
- **Equipment types** (Tractor, Planter) can be renamed but not added here: each type needs its own
  technology questions and checklist in the app. Optional features and component types say which
  types they're **used on**; a planter's features are its Precision Planting products.
- Saving never overwrites an option someone else saved since you opened the page.

## How the people page works

- **Add Person** creates the person's login and shows a temporary password once, to give them.
  They sign in to the app with it and change it in Settings › Change Password.
- Logins are created by the `people` server function in Supabase (its code is in the app's
  repository). It holds the secret key that creating logins needs; this site never has it.
- Changes to someone's store, role, or access reach their app the next time they open it. Nobody can
  turn off their own access, and the only owner stays an owner.

## How the customers page works

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
| `js/config.js` | The Supabase address and **publishable** key. Both are meant to be public; never put a secret or service-role key here |
| `js/api.js` | Sign-in and database calls |
| `js/main.js` | Sign-in, who may use the site, header and pages |
| `js/views/checklist.js` | The checklist editor |
| `js/checklist-model.js` | Checklist rules (validation, versions, keys), tested on their own |
| `js/views/options.js` | The machine options editor |
| `js/views/people.js` | The people and stores page, with each store's contacts |
| `js/views/customers.js` | The customers page (app logins for customers) |
| `js/customers-model.js` | Customer login and store contact rules; tested on their own |
| `js/people-model.js` | Who may change whom, the add form's rules, temporary passwords; tested on their own |
| `js/options-model.js` | Option rules (lists and their settings, new values, ordering, changes), tested on their own |
| `tests/*.test.mjs` | Tests for those rules |

## Testing

The rules run in the JavaScript engine built into macOS:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/checklist-model.test.mjs -- ../FieldReady/FieldReady/Resources/Templates/*.json ../FieldReady/supabase/seed/default_catalog.sql
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

To try the site locally, serve this folder (for example `python3 -m http.server 8765`) and open
http://localhost:8765.
