# Play Store (TWA) checklist — niubision.app

Template only. Nothing here is served until real values exist.

1. Publish the split first (app live at https://niubision.app, manifest `id` = `https://niubision.app/`, `start_url`/`scope` = `/`).
2. Generate the TWA with Bubblewrap: `npx @bubblewrap/cli init --manifest https://niubision.app/manifest.webmanifest` → package name (e.g. `app.niubision.twa`), keystore (back it up offline).
3. Create the app in Play Console, enroll in **Play App Signing**, copy the **SHA-256 of the app signing key** (not only the upload key).
4. Copy `twa/assetlinks.template.json` → `/.well-known/assetlinks.json` in the app build with the real package name + fingerprint(s). Serve as `application/json`, HTTP 200, no redirect, at `https://niubision.app/.well-known/assetlinks.json`.
5. Verify: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://niubision.app&relation=delegate_permission/common.handle_all_urls`.
6. Lighthouse/PWA installability green; icons 512 + maskable present; offline start works.
7. Store listing: privacy policy URL → `https://niubision.app/?view=privacy`; content rating; Data safety form (health/fitness data, contact info); target API level per current Play policy.
8. Internal testing track → closed testing (Play requires testers for new personal accounts) → production.
9. Payments: PayPal/ATH happen on the web (TWA = browser). Review Play payments policy for digital services before release.
10. `.app` is on the HSTS preload list (whole TLD): HTTPS only, no HTTP fallback. Cloudflare Pages issues the certificate automatically once the custom domain is active; nothing else to configure.
