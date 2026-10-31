# Salida en vivo: NFW + niubision.app + niubision.com

Todo esto se ejecuta **solo después del OK explícito de Miguel**. Hasta entonces, `go-live.sh` corre en modo ensayo: imprime cada comando y no ejecuta nada.

## Decisiones que necesito antes (Miguel)
1. **Dominio final de NFW** (`NFW_ORIGIN`). Hoy NFW solo vive en `*.nfw-preview.pages.dev`.
2. **Correo de NFW en producción**: dominio verificado en Resend, `MAIL_FROM` y `RESEND_API_KEY`. Sin esto, en producción no llegan los enlaces para entrar (`DEV_MAGIC_LINK` se apaga).
3. **Permisos de la llave restringida live** (`rk_live_`). Debe poder escribir Products, Prices, Coupons, Customers, Checkout Sessions, Subscriptions, Billing Portal y Webhook Endpoints. Si no los tiene, el paso 3 falla sin crear nada a medias (es idempotente): se amplían los permisos en el Dashboard y se repite.
4. **Redondeo del IVU**: los 8 precios caen en medio centavo exacto y se redondean hacia arriba (43.49, 108.16…). Si prefiere hacia abajo, es un cambio de una línea.

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
