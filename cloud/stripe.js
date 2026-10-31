// Stripe Checkout para NiuBision (junto a PayPal y ATH Móvil; no los reemplaza).
// Pago único por el monto del plan, igual que el enlace de PayPal (_xclick): precio final, sin IVU, como dice la app.
// Inerte sin STRIPE_SECRET_KEY. Rechaza llaves live salvo STRIPE_LIVE_OK="1" (solo con el OK de Miguel).
// Precios: tabla del servidor (no confía en el monto del cliente). Espejo de PLANS en app/app.js.
export const NB_PLANS = [
  { id: "eval", name: "Evaluación", price: 39 },
  { id: "base", name: "NiuBision Base", price: 97 },
  { id: "estandar12", name: "NiuBision Estándar · 12 semanas", price: 349 },
  { id: "premium12", name: "NiuBision Premium · 12 semanas", price: 529 },
  { id: "estandar", name: "NiuBision Estándar", price: 127 },
  { id: "premium", name: "NiuBision Premium", price: 197 },
  { id: "presencial", name: "Sesión en gimnasio", price: 55 },
  { id: "ai", name: "Armado de rutina", price: 12 }
];
export function planOf(label) {
  const raw = String(label || "");
  if (/rutina con ia|ia · rutina/i.test(raw)) return NB_PLANS.find((p) => p.id === "ai");
  // Igual que planPriceOf en la app (nombres más largos primero para no confundir «Estándar» con «Estándar · 12 semanas»).
  return NB_PLANS.find((p) => raw.indexOf(p.name) >= 0) || NB_PLANS.find((p) => p.name.indexOf(raw) >= 0 && raw.length > 2) || null;
}
export function stripeMode(env) {
  const k = String((env && env.STRIPE_SECRET_KEY) || "");
  if (!k) return "off";
  if (/^(sk|rk)_test_/.test(k)) return "test";
  if (/^(sk|rk)_live_/.test(k) && env.STRIPE_LIVE_OK === "1") return "live";
  return "rejected";
}
function form(obj, pre = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    const key = pre ? pre + "[" + k + "]" : k;
    if (typeof v === "object") form(v, key, out); else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
  }
  return out.join("&");
}
export async function stripeApi(env, method, path, params, fetcher = fetch) {
  const r = await fetcher("https://api.stripe.com/v1" + path, {
    method,
    headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2024-06-20" },
    body: params ? form(params) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || "stripe_error"), { status: r.status });
  return j;
}
function priceIds(env) { try { return JSON.parse(env.STRIPE_PRICES || "{}"); } catch (e) { return {}; } }
export async function createCheckout(env, body, appUrl, fetcher = fetch) {
  const plan = planOf(body.plan);
  if (!plan) throw Object.assign(new Error("Plan no reconocido"), { status: 400 });
  const inv = String(body.invoice || "").replace(/[^\w-]/g, "").slice(0, 40);
  if (!inv) throw Object.assign(new Error("Falta la factura"), { status: 400 });
  const ids = priceIds(env);
  const line = ids[plan.id]
    ? { price: ids[plan.id], quantity: 1 }
    : { price_data: { currency: "usd", unit_amount: plan.price * 100, product_data: { name: "NiuBision — " + plan.name } }, quantity: 1 };
  const email = String(body.email || "").trim();
  const meta = { invoice: inv, plan: plan.name, plan_id: plan.id, clientId: String(body.clientId || "").slice(0, 60), name: String(body.name || "").slice(0, 80) };
  const params = {
    mode: "payment",
    client_reference_id: inv,
    "line_items[0]": line,
    success_url: appUrl + "/?pago=ok&metodo=stripe&inv=" + encodeURIComponent(inv),
    cancel_url: appUrl + "/?pago=cancel",
    locale: "es",
    customer_email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
    customer_creation: "if_required",
    submit_type: "pay",
    metadata: meta,
    payment_intent_data: { metadata: meta, description: "NiuBision — " + plan.name }
  };
  const s = await stripeApi(env, "POST", "/checkout/sessions", params, fetcher);
  return { url: s.url, id: s.id, amount: String(plan.price), plan: plan.name };
}
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function signPayload(secret, payload, t = Math.floor(Date.now() / 1000)) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "t=" + t + ",v1=" + hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(t + "." + payload)));
}
export async function verifySignature(secret, payload, header, tolerance = 300, now = Math.floor(Date.now() / 1000)) {
  if (!secret || !header) return false;
  const parts = String(header).split(",");
  const t = Number((parts.find((p) => p.startsWith("t=")) || "").slice(2));
  const v1s = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1s.length || Math.abs(now - t) > tolerance) return false;
  const exp = (await signPayload(secret, payload, t)).split("v1=")[1];
  return v1s.some((v) => v.length === exp.length && [...v].reduce((a, c, i) => a | (c.charCodeAt(0) ^ exp.charCodeAt(i)), 0) === 0);
}
