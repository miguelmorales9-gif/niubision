# Stripe (tarjeta) junto a PayPal y ATH Móvil — modo de prueba

- **No reemplaza nada**: PayPal y ATH Móvil siguen igual. La opción «Tarjeta» solo aparece si `config.js` trae `STRIPE: true` (hoy solo en la vista previa).
- **Pago único** por el monto del plan, igual que el enlace de PayPal (`_xclick`). Sin suscripción recurrente.
- **Precios**: los de `PLANS` en `app/app.js`, copiados en `cloud/stripe.js` (`NB_PLANS`); una prueba verifica que coincidan. El servidor fija el monto (no confía en el cliente).
- **IVU**: la app dice «Precio final, sin IVU»; Stripe cobra el mismo monto, sin sumar impuesto.
- **Webhook** `POST /api/stripe/webhook` (firma verificada, idempotente): `checkout.session.completed` marca el pago «recibido» (igual que el IPN de PayPal), avisa al coach y al cliente y envía el recibo.
- El Worker **rechaza llaves live** salvo `STRIPE_LIVE_OK="1"` (solo con el OK de Miguel).

## Secretos (nunca en el repo)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Opcional: `STRIPE_PRICES` (JSON `{ "base": "price_…" }`) para usar precios del catálogo de Stripe en lugar de `price_data`.

## Vista previa
- App: `https://stripe-prueba.niubision-app.pages.dev` (rama de Pages, no producción). `NB_ENV.API` dirige todo el tráfico al Worker de prueba y `NO_NOTIFY` apaga los avisos ntfy.
- Worker: `niubision-api-stripe-preview` con su propia D1 (`niubision-db-stripe-preview`) y KV; `NB_PREVIEW="1"` no envía recibos por correo.
