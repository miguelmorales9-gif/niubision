# Look Hybrid — Obsidiana + Ember CTA + Nube mint relief

Preview only · `eng/ui-look-hybrid` · **NO merge / no niubision.com**

## v5
- Live-test fix: demo seat no longer false-late (`sessionAgeDays` −1 when no session; ignore `lastSeen`).
- Hoy tighter: one primary Empezar; no welcome wall on demo; hide 0% ring; drop redundant “Sesión de hoy” prio.
- Preview demo survives reload (`nb_preview_demo` + re-seed); skip `/auth/login` 429 for `240101`.
- Spanish UI: kill remaining “See the work” on About/recibo/semana; header stays “Mira el trabajo…”.
- Programas: Pedir otro forces catalog open + render.
- Cache `hybrid-v5` / `nb-offline-hybrid-v5`.

## v4
- Cover: **Planes** directly under **Entrar** (ghost CTA); Acerca/Privacidad stay quiet footer.
- Programas client-first: active + Pedir first; plantillas collapsed behind A/B/C + search; real **Tipo** `<select>`; density down; A+B+C kept.
- Quiet preview-demo `/api/report` skip (local seat).
- Cache `hybrid-v4` / `nb-offline-hybrid-v4`.

## Prior
v3 honest amber hold ring · v2 redeem diagnosis + demo `240101` / `?demo=hoy`
