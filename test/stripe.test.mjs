import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planOf, stripeMode, signPayload, verifySignature, createCheckout, NB_PLANS } from "../cloud/stripe.js";
import worker from "../cloud/worker.js";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("Stripe: precios del servidor = PLANS de la app (sin IVU)", () => {
  const s = R("app/app.js");
  for (const p of NB_PLANS) assert.match(s, new RegExp('id: "' + p.id + '", eyebrow: "[^"]*", name: "' + p.name + '", price: "' + p.price + '"'));
  assert.equal(planOf("NiuBision Estándar · 12 semanas").price, 349);
  assert.equal(planOf("NiuBision Estándar").price, 127);
  assert.equal(planOf("Armado de rutina 12 USD").price, 12);
  assert.equal(planOf("algo raro"), null);
});
test("Stripe: modo prueba; live rechazada sin OK", () => {
  assert.equal(stripeMode({}), "off");
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: "sk_test_x" }), "test");
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: "rk_live_x" }), "rejected");
  assert.equal(stripeMode({ STRIPE_SECRET_KEY: "rk_live_x", STRIPE_LIVE_OK: "1" }), "live");
});
test("Stripe: firma del webhook (válida, alterada, vencida)", async () => {
  const sig = await signPayload("whsec_x", "{}", 1000);
  assert.equal(await verifySignature("whsec_x", "{}", sig, 300, 1100), true);
  assert.equal(await verifySignature("whsec_x", "{ }", sig, 300, 1100), false);
  assert.equal(await verifySignature("whsec_x", "{}", sig, 300, 5000), false);
  assert.equal(await verifySignature("otro", "{}", sig, 300, 1100), false);
});
test("Stripe: checkout de pago único por el monto del plan", async () => {
  let body; const f = async (u, o) => { body = new URLSearchParams(o.body); return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }); };
  const r = await createCheckout({ STRIPE_SECRET_KEY: "sk_test_x" }, { plan: "NiuBision Base", invoice: "p123" }, "https://app.example", f);
  assert.equal(r.amount, "97"); assert.equal(body.get("mode"), "payment");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "9700");
  assert.equal(body.get("metadata[invoice]"), "p123");
  assert.match(body.get("success_url"), /^https:\/\/app\.example\/\?pago=ok/);
  await assert.rejects(createCheckout({ STRIPE_SECRET_KEY: "sk_test_x" }, { plan: "x", invoice: "p1" }, "https://a", f));
});
const KV = { get: async () => null, put: async () => {} };
test("Stripe: webhook rechaza firma mala y llave live; inerte sin llaves", async () => {
  const call = (env, sig) => worker.fetch(new Request("https://w/api/stripe/webhook", { method: "POST", headers: sig ? { "stripe-signature": sig } : {}, body: "{}" }), env);
  assert.equal((await call({ STUDIO: KV })).status, 501);
  assert.equal((await call({ STUDIO: KV, STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "w" }, "t=1,v1=00")).status, 501);
  assert.equal((await call({ STUDIO: KV, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "w" }, "t=1,v1=00")).status, 400);
  const live = JSON.stringify({ id: "evt_1", type: "x", livemode: true, data: { object: {} } });
  const r = await worker.fetch(new Request("https://w/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": await signPayload("w", live) }, body: live }), { STUDIO: KV, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "w" });
  assert.equal(r.status, 400);
});
test("App: la tarjeta solo aparece si config.js la activa; PayPal y ATH siguen", () => {
  const s = R("app/app.js");
  assert.match(s, /concat\(stripeOn\(\) \? \[\{ id: "stripe"/);
  assert.match(s, /id: "paypal", mark: "PP"/); assert.match(s, /id: "ath", mark: "ATH"/);
  assert.match(s, /if \(NB_API_OVERRIDE\) return \[NB_API_OVERRIDE\];/);
  assert.equal(R("app/app.js"), R("public/app/app.js"));
});
