# NiuBision — Platform (Phase 4)

Short reference for auth, sync, backup, and push. Spanish-first product; this doc is for engineers.

## Auth model
- Coach: PIN of the studio via `POST /api/auth/login` (`role: "coach"`, `pin`). Session token in `sessionStorage` (`nb_auth_sess`); also used as `Authorization: Bearer` for `/api/state`.
- Client: 6-digit access code via login or `GET /api/redeem?code=`. Redeem returns the client seat + routine library slice.
- Studio key remains `NIUBI` (existing cloud pointer). Do not invent new hardcoded secrets; reuse PIN / ntfy topic already in the app.
- Primary API: `https://api.niubision.com/api` (`CLOUD_API`). Worker fallback host is secondary. Public jsonblob / crudcrud / restful are disabled for the primary path.

## Sync keys (local)
| Key | Role |
|-----|------|
| `nb_settings` | cloudUrl, cloudToken, cloudKind, wa, pay |
| `nb_last_sync_at` | last successful push/pull/redeem |
| `nb_program_requests` | Pedir → Bandeja queue (merged by id) |
| `nb_inbox` | coach notices |
| `nb_notify` / `nb_alerts` | notification permission + coach ntfy listen |
| `nb_auth_sess` | short-lived Bearer session |

Cloud payload always includes **pending + recently approved** `programRequests`. Worker/server `mergeStudio` merges them by id (terminal approved/ignored/rejected ranks above pending; no silent wipe of active routine on the client — redeem applies coach assignment).

### Multi-device flow
1. Client **Pedir** → local queue + `POST /api/program-request` + ntfy ping to coach.
2. Coach device **pull on focus/visibility** → Bandeja shows the request → Aprobar → `cloudPush` updates client.routine.
3. Client **pull on focus/visibility** via redeem (`clientCloudRefresh`) → Hoy updates without overwriting an in-progress local session’s history.

## Backup
- Local: Ajustes → **Descargar respaldo** (`backupPayload` JSON: clients, legal, payments, inbox, programRequests).
- Restore: file picker in Ajustes / Gente (merge-friendly for programRequests).
- Cloud: Ajustes → **Descargar de la nube** hits `GET /api/export?pin=…` when auth/pin allows.

## Push / notifications
- **Web Push (VAPID) — preferred:** Worker secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, optional `VAPID_SUBJECT` (`mailto:…`). Public key is **never** committed as a private secret; client fetches it from `GET /api/push/vapid`. Subscribe via Ajustes / Plan → Activar avisos → `pushManager.subscribe` → `POST /api/push/subscribe` (coach session/PIN or client code). SW already handles `push` + `notificationclick`.
- **Server sends** short Spanish payloads on Pedir (`/api/program-request`), pay/lead notices, código issued (`/api/paid` / PayPal IPN), and Pedir approved (coach `PUT /api/state` when a request flips to `approved`).
- **ntfy:** quiet optional fallback when this device has no `nb_webpush` flag (no VAPID subscription saved). Prefer Web Push when a subscription exists on the Worker.
- **Rotate VAPID:** generate a new pair (`npx web-push generate-vapid-keys`), `wrangler secret put` both keys, redeploy Worker. Clients re-subscribe on next Activar avisos / boot (permission already granted). Never paste the private key into a PR or commit.
- **Before first deploy:** from `cloud/`:
  ```bash
  npx web-push generate-vapid-keys
  wrangler secret put VAPID_PUBLIC_KEY
  wrangler secret put VAPID_PRIVATE_KEY
  wrangler secret put VAPID_SUBJECT   # e.g. mailto:miguel.morales9@gmail.com
  ```

## Deferred by design
- **4.3 English UI** — do not dilute ES-PR. Keep copy Spanish.
- **4.4 Store wrappers** — no Capacitor / App Store / Play binaries until Phase 2 metrics justify them. PWA manifest may be polished only.

Last updated: 2026-09-30
