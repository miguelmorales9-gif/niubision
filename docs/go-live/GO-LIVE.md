# Salida en vivo: NFW + niubision.app + niubision.com

Todo esto se ejecuta **solo después del OK explícito de Miguel**. Hasta entonces, `go-live.sh` corre en modo ensayo: imprime cada comando y no ejecuta nada.

## Decisiones (ya tomadas por Miguel el 31-oct)
- Dominio de NFW: **https://workouts.niubision.app**. Pages `nfw-preview` lleva el dominio propio y la ruta `workouts.niubision.app/api/*` va al Worker `nfw-api`. Mismo origen para APP_ORIGIN, CORS, las URL de regreso de Stripe (portal: `/#/cuenta`) y el webhook `https://workouts.niubision.app/api/stripe/webhook`.
- IVU: se redondea hacia arriba en el medio centavo (se queda así).
- Correo: Resend, remitente `NiuBision Fitness Workouts <acceso@niubision.app>`. Llave «NFW» solo para enviar, limitada a niubision.app, guardada en `/home/box/.nfw-secrets/resend_nfw.txt`.

## Pendiente: DNS de Resend en la zona niubision.app (Cloudflare → DNS, solo agregar)
| Tipo | Nombre | Valor |
|---|---|---|
| TXT | resend._domainkey | (clave DKIM que muestra Resend → Domains → niubision.app) |
| MX (prioridad 10) | send | feedback-smtp.us-east-1.amazonses.com |
| TXT | send | v=spf1 include:amazonses.com ~all |
| CNAME (solo DNS, nube gris) | rsend | send.forge.rmta.net |

El DMARC actual (`p=reject; adkim=s; aspf=s`) se queda: DKIM con d=niubision.app pasa la alineación estricta. No se tocan los registros raíz ni niubision.com. Después: Resend → Verify, y poner `MAIL_FROM` en el Worker.

## Pendiente: llave live de Stripe
Confirmar que la llave restringida live (`rk_live_`) puede escribir Products, Prices, Coupons, Customers, Checkout Sessions, Subscriptions, Billing Portal y Webhook Endpoints.

## Lista (≈10 min)
| # | Paso | Comando | Verificación |
|---|---|---|---|
| 1 | Pruebas + respaldo de D1 | `bash go-live.sh preflight` | NFW 133/133, NiuBision 15/15 |
| 2 | PR de lanzamiento → main | `… merge` | `main` = rama superior |
| 3 | Objetos Stripe live + 2 webhooks | `… stripe` | `stripe_nfw_live_ids.json` y 2 archivos whsec (600) |
| 4 | Secretos + `STRIPE_LIVE_OK=1` | `… secrets` y editar `api/wrangler.toml` de NFW (origen, `DEV_MAGIC_LINK="0"`, `DEMO_LOGIN="0"`, correo) | `wrangler secret list` |
| 5 | Desplegar Workers y Pages (quita la franja «Vista previa» de NFW; NiuBision con `NB_ENV=production NB_STRIPE=1`) | `… deploy` | URLs responden 200 |
| 6 | Humo | `… smoke` | `billing:"live"`, «IVU incluido», webhook sin firma → 400 |
| 7 | Compra real mínima + reembolso (Miguel) | Evaluación 43.49 y NFW Premium 11.14 | Recibo: base + IVU; código llega |

Uso: `GO_LIVE_OK=SI NFW_ORIGIN=https://… RUN=1 bash docs/go-live/go-live.sh all`

## Volver atrás (1 min)
- Tarjeta: `npx wrangler secret delete STRIPE_LIVE_OK` en `api/` (NFW) y `cloud/` (NiuBision). Stripe queda inerte y PayPal/ATH siguen funcionando.
- Pages: Deployments → Rollback. Workers: `npx wrangler rollback`.
