# Vendored libraries

Kept in this repository so the site never loads code from another server at run time (a
compromised CDN could otherwise read people's sign-ins). `index.html`'s content security policy
only allows scripts from this site.

| Folder | What | Source | Checked |
|---|---|---|---|
| `supabase-js-2.45.4/` | Supabase's browser library (`dist/umd/supabase.js`, its unused WebSocket fallback chunk `591.supabase.js`, and its MIT `LICENSE`) | npm `@supabase/supabase-js@2.45.4` | The npm tarball matched npm's published `sha512-E5p8/zOLaQ3a462MZnmnz03CrduA5ySH9hZyL03Y+QZLIOO4/Gs8Rdy4ZCKDHsN7x0xdanVEWWFN3pJFQr9/hg==` (2026-10-23) |

## Updating

1. Download `https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-<version>.tgz` and check
   its SHA-512 against `dist.integrity` from `https://registry.npmjs.org/@supabase/supabase-js/<version>`.
2. Copy `package/dist/umd/*.js` and `package/LICENSE` into a new `supabase-js-<version>/` folder.
3. In `index.html`, point the script tag at the new folder and update its `integrity`:
   `echo "sha384-$(openssl dgst -sha384 -binary vendor/supabase-js-<version>/supabase.js | base64)"`
4. Remove the old folder, then sign in and try each page.
