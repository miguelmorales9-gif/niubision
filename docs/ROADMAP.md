# NiuBision — path to exceptional

**North star:** A client opens NiuBision, sees today’s session in under 5 seconds, logs sets without thinking, and Miguel sees who trained / who stalled without WhatsApp archaeology.

**Positioning:** Best coach–client training app for Puerto Rico — Spanish-first, ATH/PayPal, real accountability, trust before sweat. Not a Hevy clone.

## Already strong
- Brand + Spanish voice; PWA install; splash ritual
- Trust stack: relevo → PAR-Q → contrato → código
- Coach + client modes, routines, exercise library, Hoy
- Local payments (PayPal + ATH)
- Thin cloud sync started

## Blockers
1. ~~1.3MB single HTML (~322 functions, mirrored copies)~~ → Phase 0.2 starts the split (`app/styles.css` + `app/app.js`)
2. Onboarding friction (code wall, PAR-Q behind waiver with no preview)
3. Manual 6-digit codes after payment
4. Workout UX behind Strong/Hevy (rest timer, last weights, offline clarity)
5. ~~Coach cockpit lacks “who needs attention”~~ → Phase 3 bandeja (this PR)
6. Cloud half-built (`REPLACE_AFTER_CREATE` KV)
7. No funnel/crash analytics
8. A11y / empty states / error copy gaps

---

## Phase 0 — Foundation
| ID | Work | Status |
|----|------|--------|
| 0.1 | Merge phone + HTML sync PR | **done** (PR #1) |
| 0.2 | Split monolith into `app/` (CSS + classic JS) + sync/build | **this PR** |
| 0.3 | Single SW / cache-bust source of truth | **started** (CACHE bump + `/app/*` in SHELL) |
| 0.4 | Staging + smoke checklist | planned |
| 0.5 | Privacy-light funnel analytics | planned |

## Phase 1 — First-run UX
| ID | Work | Status |
|----|------|--------|
| 1.1 | Guest tour: Planes → confianza → pagar → código → Entrar | **this PR** |
| 1.2 | Entrar: paste-friendly 6-digit, autofocus | **this PR** |
| 1.3 | Post-unlock “Tu día 1” screen | **this PR** |
| 1.4 | Waiver + PAR-Q stepped wizard with draft save | **this PR** (PAR-Q stepped; waiver stays one sheet) |
| 1.5 | Offline banner + last-sync timestamp | **this PR** |

## Phase 2 — Training loop
| ID | Work | Status |
|----|------|--------|
| 2.1 | Set logger: previous load, rest timer | **this PR** (starter) |
| 2.2 | Exercise sheets with short ES cues | planned (cues already in session) |
| 2.3 | End-of-session summary + WhatsApp share | **this PR** |
| 2.4 | Weekly check-in (local, dismissible) | **this PR** |
| 2.5 | Large tap targets (≥44px set complete) | **this PR** |

## Phase 3 — Coach superpowers
| ID | Work | Status |
|----|------|--------|
| 3.1 | Today inbox (paid / waiting code / PAR-Q / missed) | **done** (this PR) |
| 3.2 | Assign routine + WhatsApp template one-tap | **done** (this PR) |
| 3.3 | Auto-code after verified payment | **done** (this PR) |
| 3.4 | Client timeline | **done** (this PR) |
| 3.5 | Export PDF week | **done** (this PR) |

## Phase 3.5 — Programas IA (A+B+C)
| ID | Work | Status |
|----|------|--------|
| 3.5.1 | Shared Programas shelf + Pedir → Bandeja → Aprobar | **this PR** |
| 3.5.2 | Coach/client nav: Programas tab; Hoy stays active-only | **this PR** |

## Phase 4 — Platform
| ID | Work | Status |
|----|------|--------|
| 4.1 | Real backend auth + backups + multi-device | **done** (this PR) |
| 4.2 | Push notifications (SW + local + ntfy; VAPID follow-up) | **done** (this PR) |
| 4.3 | English later — do not dilute ES-PR first | **deferred** (intentional hold) |
| 4.4 | Store wrappers only after Phase 2 metrics | **deferred** (intentional hold) |
| 4.5 | Motion / empty-state visual system | **done** (this PR) |

See `docs/PLATFORM.md` for auth, sync, backup, and push notes.

## Working agreements
- Engineering owns PRs and concrete diffs on this repo.
- Merge/release and client-facing messages stay Miguel’s call unless he delegates.
- Prefer small PRs; keep shell `index.html` + `sw.js` + `app/` canonical; `npm run sync:html` mirrors to `public/`.
- Edit flow: change `app/styles.css` / `app/app.js` / shell `index.html`, then `npm run sync:html` (or `npm run build`).

Last updated: 2026-09-23
