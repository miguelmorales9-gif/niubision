// Crea (idempotente) los objetos Stripe de NFW y los webhooks de NFW y NiuBision.
// Uso:  MODE=test node stripe-setup.mjs            (llave de prueba; ensayo)
//       MODE=live GO_LIVE_OK=SI NFW_ORIGIN=https://... node stripe-setup.mjs   (SOLO con el OK de Miguel)
// Nunca imprime llaves ni whsec: los guarda con permiso 600 en /home/box/.nfw-secrets/.
import fs from 'node:fs';
const MODE = process.env.MODE || 'test'; const D = '/home/box/.nfw-secrets/';
if (MODE === 'live' && process.env.GO_LIVE_OK !== 'SI') throw new Error('Falta GO_LIVE_OK=SI (OK explícito de Miguel).');
const K = fs.readFileSync(D + (MODE === 'live' ? 'stripe_live_rk.txt' : 'stripe_test_key.txt'), 'utf8').trim();
if (MODE === 'live' ? !/^(rk|sk)_live_/.test(K) : !/^sk_test_/.test(K)) throw new Error('La llave no corresponde al modo ' + MODE);
const NFW_ORIGIN = process.env.NFW_ORIGIN || (MODE === 'live' ? '' : 'https://v3-premium.nfw-preview.pages.dev');
if (!NFW_ORIGIN) throw new Error('Falta NFW_ORIGIN (dominio final de NFW).');
const NFW_HOOK = process.env.NFW_HOOK || (MODE === 'live' ? 'https://nfw-api.miguel-morales9.workers.dev/api/stripe/webhook' : 'https://nfw-api-stripe.miguel-morales9.workers.dev/api/stripe/webhook');
const NB_HOOK = process.env.NB_HOOK || (MODE === 'live' ? 'https://niubision-api.miguel-morales9.workers.dev/api/stripe/webhook' : 'https://niubision-api-stripe-preview.miguel-morales9.workers.dev/api/stripe/webhook');
const f = (o, p = '', out = []) => { for (const [k, v] of Object.entries(o)) { if (v == null) continue; const key = p ? `${p}[${k}]` : k; if (typeof v === 'object') f(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v)); } return out.join('&'); };
const S = async (m, path, b) => { const r = await fetch('https://api.stripe.com/v1' + path, { method: m, headers: { authorization: 'Bearer ' + K, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' }, body: b ? f(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(m + ' ' + path + ' → ' + (j.error && j.error.message)); return j; };
// Permisos mínimos (llave restringida): Products, Prices, Coupons, Customers, Checkout Sessions, Subscriptions, Invoices (lectura), Billing Portal, Webhook Endpoints (escritura).
const out = {};
const prod = async (id, name) => { try { return await S('GET', '/products/' + id); } catch { return S('POST', '/products', { id, name, tax_code: 'txcd_10000000' }); } };
const price = async (lk, product, amt, interval) => { const l = await S('GET', '/prices?lookup_keys[]=' + lk); if (l.data[0]) { if (l.data[0].unit_amount !== amt) throw new Error(lk + ' existe con otro monto'); return l.data[0]; } return S('POST', '/prices', { lookup_key: lk, product, unit_amount: amt, currency: 'usd', tax_behavior: 'inclusive', recurring: { interval } }); };
const coupon = async (id, name, off, dur) => { try { return await S('GET', '/coupons/' + id); } catch { return S('POST', '/coupons', { id, name, amount_off: off, currency: 'usd', duration: dur }); } };
await prod('nfw_premium', 'NiuBision Fitness Workouts · Premium'); await prod('nfw_coaching', 'NiuBision Fitness Workouts · Coaching');
out.STRIPE_PRICE_PREMIUM_MONTHLY = (await price('nfw_premium_mensual', 'nfw_premium', 1114, 'month')).id;
out.STRIPE_PRICE_PREMIUM_YEARLY = (await price('nfw_premium_anual', 'nfw_premium', 6689, 'year')).id;
out.STRIPE_PRICE_COACHING_MONTHLY = (await price('nfw_coaching_mensual', 'nfw_coaching', 14384, 'month')).id;
out.STRIPE_FOUNDER_COUPON = (await coupon('nfw_fundador_anual', 'Fundador Premium anual (primer año)', 1115, 'once')).id;
out.STRIPE_COACH_FOUNDER_COUPON = (await coupon('nfw_fundador_coaching', 'Fundador Coaching', 3346, 'forever')).id;
const pc = await S('POST', '/billing_portal/configurations', { business_profile: { headline: 'NiuBision Fitness Workouts' }, default_return_url: NFW_ORIGIN + '/#/cuenta', features: { customer_update: { enabled: true, allowed_updates: { 0: 'email', 1: 'address' } }, invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: { 0: 'too_expensive', 1: 'unused', 2: 'other' } } }, subscription_update: { enabled: true, default_allowed_updates: { 0: 'price' }, proration_behavior: 'create_prorations', products: { 0: { product: 'nfw_premium', prices: { 0: out.STRIPE_PRICE_PREMIUM_MONTHLY, 1: out.STRIPE_PRICE_PREMIUM_YEARLY } } } } } });
out.STRIPE_PORTAL_CONFIG = pc.id;
const hook = async (url, desc, events, file) => { const all = (await S('GET', '/webhook_endpoints?limit=100')).data; const ex = all.find(w => w.url === url); if (ex) { console.log('webhook ya existe', ex.id, '(se conserva su whsec)'); return ex.id; } const wh = await S('POST', '/webhook_endpoints', { url, description: desc, enabled_events: Object.fromEntries(events.map((e, i) => [i, e])) }); fs.writeFileSync(D + file, wh.secret, { mode: 0o600 }); return wh.id; };
const sfx = MODE === 'live' ? 'live' : 'test';
out.nfw_webhook = await hook(NFW_HOOK, 'NFW ' + sfx, ['checkout.session.completed', 'invoice.paid', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed'], `stripe_whsec_nfw_${sfx}.txt`);
out.nb_webhook = await hook(NB_HOOK, 'NiuBision ' + sfx, ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'], `stripe_whsec_niubision_${sfx}.txt`);
fs.writeFileSync(D + `stripe_nfw_${sfx}_ids.json`, JSON.stringify(out, null, 1), { mode: 0o600 });
console.log('ok', MODE, Object.keys(out).join(', '));
