# Field Ready Admin

The website owners and admins use to manage Field Ready: the inspection checklist now, machine
options and people & stores next. It's plain HTML, CSS, and JavaScript that talks straight to the
Field Ready Supabase project, so there's nothing to build or run on a server. GitHub Pages serves
it from this repository.

The app itself, the database schema, and the access rules live in the private `FieldReadyApp`
repository.

## Who can do what

| | Owners | Admins | Employees |
|---|---|---|---|
| Sign in | Yes | Yes | No (they use the app) |
| Inspection checklist | Edit everything, publish | Edit How to Check steps in the draft | — |

The database enforces these rules (`supabase/migrations` in FieldReadyApp); the website only hides
what someone can't do.

## How the checklist editor works

- Phones use the **live** version: the highest published version number.
- **Start Editing** makes one shared **draft** of the next version. Save as often as you like;
  phones don't see drafts.
- **Publish** (owners) makes the draft live. Phones pick it up at their next sync, and draft
  inspections switch to it when they're opened. Finalized inspections keep the version they were
  signed with. A published version can't be changed; edits always make a new version.
- Check keys never change once published, so answers on draft inspections carry over.
- The editor won't publish a checklist phones couldn't use (the same rules the app applies).

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/site.css` | The page and its look (the app's colors) |
| `js/config.js` | The Supabase address and **publishable** key. Both are meant to be public; never put a secret or service-role key here |
| `js/api.js` | Sign-in and database calls |
| `js/main.js` | Sign-in, who may use the site, header and pages |
| `js/views/checklist.js` | The checklist editor |
| `js/checklist-model.js` | Checklist rules (validation, versions, keys), tested on their own |
| `tests/checklist-model.test.mjs` | Tests for those rules |

## Testing

The checklist rules run in the JavaScript engine built into macOS:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/checklist-model.test.mjs -- ../FieldReady/FieldReady/Resources/Templates/preseason-general.json
```

To try the site locally, serve this folder (for example `python3 -m http.server 8765`) and open
http://localhost:8765.
