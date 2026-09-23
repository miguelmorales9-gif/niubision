# NiuBision IA — A + B + C (Programas)

Spanish-first coach–client model for Puerto Rico.

## A — Desk first (Hoy)

- **Hoy** shows only the **active** program / today’s work.
- No catalog mid-set. Training stays focused.
- Coach desk: floor roster, Bandeja entry, open Sesión from Hoy.
- Client Hoy: active day only.

## B — Shared Programas shelf

- **Programas** is one library for coach **and** client (same cards).
- Cards show badge **Tu programa** (active) vs **Plantilla** (catalog).
- Search + filters by nivel / días / tipo (existing routine metadata).
- Coach actions on a card: **Asignar · Asignar + WA · Editar**.
- Client actions on a card: **Ver · Pedir a Miguel**.
- Pedir does **not** overwrite the client’s active assignment.

## C — Client self-serve with coach approval

1. Client taps **Pedir a Miguel** on a plantilla.
2. A pending row is stored in `localStorage` key `nb_program_requests` (also mirrored into coach cloud payload when sync runs).
3. Coach **Bandeja** shows section **Pedidos de programa**  
   e.g. “María pide Hipertrofia 3 días” with **Aprobar / Otra / Ignorar**.
4. **Aprobar** assigns that template as the client’s active program (same path as existing assign).
5. **Ignorar** dismisses. **Otra** opens the assign + WhatsApp picker (or Gente if no ficha).

## Nav (v1)

| Role  | Tabs |
|-------|------|
| Coach | Hoy · Bandeja · Programas · Gente *(Sesión sigue desde Hoy)* |
| Client| Hoy · Programas · Yo · Plan |

Editor completo / IA builder remains reachable from Programas (coach) and legacy `data-view=rutinas`.

## Storage

- `nb_program_requests`: `[{ id, type:"program_req", status:"pending"|"approved"|"ignored", routineId, routineName, name, clientId, accessCode, at, ... }]`
- Inbox notes may also carry `type:"program_req"` for visibility in existing inbox merge.

Last updated: 2026-09-23
