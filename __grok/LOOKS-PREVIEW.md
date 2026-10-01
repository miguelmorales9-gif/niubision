# NiuBision UI looks — three preview deploys

| Look | Branch | Alias | Cache bust |
|------|--------|-------|------------|
| A Obsidiana | `eng/ui-look-obsidiana` | https://obsidiana.niubision-ui-preview.pages.dev | `obsidiana-preview` / `nb-offline-obsidiana-preview` |
| B Ember | `eng/ui-look-ember` | https://ember.niubision-ui-preview.pages.dev | `ember-preview` / `nb-offline-ember-preview` |
| C Nube v2 | `eng/ui-look-nube` | https://nube.niubision-ui-preview.pages.dev | `nube-preview` / `nb-offline-nube-preview` |

## Hard-refresh
On phone: open URL → Safari/Chrome hard refresh (or Settings → clear site data for `*.pages.dev`) so the new SW cache name wins. One pull-to-refresh after first load is usually enough.

## Constraints
NO merge to main · NO niubision.com · production orb MARK exact · Spanish · flows intact

## TODO Nube later
If Imagine delivers Nube v3 (`niubision-look-C-nube-v3-*.jpg`), branch from `eng/ui-look-nube`, retoken, bump cache, redeploy `--branch nube` (or `nube-v3`) without touching Obsidiana/Ember aliases. See `CHANGELOG-nube.md`.
