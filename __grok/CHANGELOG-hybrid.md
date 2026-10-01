# Look Hybrid — Obsidiana + Ember CTA + Nube mint relief

Preview only · branch `eng/ui-look-hybrid` · **NO merge / no niubision.com / logo untouched**

## Direction
Base A Obsidiana (deep ink + cream, editorial, Spanish-first, live cream orb).
From B Ember: amber primary CTA punch on Entrar / Empezar / Aprobar / Pedir — denser full-width Empezar.
From C Nube v2: soft mint ONLY on chips, success/empty, subtle accents — not light-slate canvas.

## v2 (estudia / corrige)
- **Redeem root cause:** not CORS / not wrong path. Prod `api.niubision.com/api/redeem` returns 404 because codes are dead in KV (`281177` = anulado; `696895` / `121018` = no válido). CORS is `*`.
- **Host fix:** `isPagesHost` now includes `*.pages.dev` so preview does not invent `pages.dev/api` as cloud base.
- **QA entry (preview only):** demo code `240101` or `?demo=hoy` seeds a local client seat → Hoy. Does **not** write to prod KV.
- **Cover polish:** «Tu sesión de hoy» / «Entrenamiento con tu coach» / footer «ENTRENAMIENTO CON TU COACH»; amber hold ring + cue; legal disclaimer contrast raised.

## Cache
`hybrid-v2` / `nb-offline-hybrid-v2`

## Explicitly NOT included
- English «NEXT LEVEL»
- Gym-bro fire photo heroes
- Shout condensed all-caps English
- New logo lockups (production cream orb + wordmark only)
- Merge to main / publish to niubision.com
