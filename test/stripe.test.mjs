import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planOf, stripeMode, signPayload, verifySignature, createCheckout, NB_PLANS } from "../cloud/stripe.js";
import worker from "../cloud/worker.js";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("Stripe: precios del servidor = PLANS de la app (IVU 11.5 % incluido)", () => {
  const s = R("app/app.js");
  for (const p of NB_PLANS) assert.match(s, new RegExp('id: "' + p.id + '", eyebrow: "[^"]*", name: "' + p.name + '", price: "' + (p.cents / 100).toFixed(2) + '", base: "' + p.price + '"'));
  const want = { eval: 4349, base: 10816, estandar: 14384, estandarFundador: 11038, premium: 21966, estandar12: 38914, premium12: 58984, presencial: 6133, ai: 1338 };
  for (const p of NB_PLANS) assert.equal(p.cents, want[p.id], p.id);
  assert.ok(!/sin IVU|no cobra IVU/i.test(s + R("cloud/worker.js") + R("web/index.html")));
  assert.equal(planOf("NiuBision Estándar · 12 semanas").price, 349);
  assert.equal(planOf("NiuBision Estándar").price, 129);
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
  assert.equal(r.amount, "108.16"); assert.equal(body.get("mode"), "payment");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "10816");
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

test("App: planPriceOf no confunde 12 semanas con el mensual (bug 127/197)", () => {
  const src = R("app/app.js");
  const grab = (name) => { const i = src.indexOf(name); let d = 0, j = src.indexOf("{", i); const a = j; for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && !--d) break; } return src.slice(i, j + 1); };
  const plansSrc = src.slice(src.indexOf("const PLANS = ["), src.indexOf("\n];", src.indexOf("const PLANS = [")) + 3);
  const fn = new Function(plansSrc + "\n" + grab("function planPriceOf(") + "\n" + grab("function ivuSplit(").replace(/^/, "const IVU_RATE_MILLI = 115;\n") + "\nreturn { planPriceOf, ivuSplit };")();
  assert.equal(fn.planPriceOf("NiuBision Estándar · 12 semanas").amount, "389.14");
  assert.equal(fn.planPriceOf("NiuBision Premium · 12 semanas").amount, "589.84");
  assert.equal(fn.planPriceOf("NiuBision Premium · 12 semanas 589.84 USD").amount, "589.84");
  assert.equal(fn.planPriceOf("NiuBision Estándar").amount, "143.84");
  assert.equal(fn.planPriceOf("NiuBision Premium").amount, "219.66");
  assert.equal(fn.planPriceOf("Evaluación").amount, "43.49");
  assert.deepEqual(fn.ivuSplit("43.49"), { base: "39.00", ivu: "4.49", total: "43.49" });
  assert.deepEqual(fn.ivuSplit("589.84"), { base: "529.00", ivu: "60.84", total: "589.84" });
});

test("precio fundador Estándar: 110.38, 5 cupos, solo clientes activos", async () => {
  const m = await import("../cloud/stripe.js");
  assert.equal(m.planOf("NiuBision Estándar · Precio fundador").id, "estandarFundador");
  assert.equal(m.planOf("NiuBision Estándar").id, "estandar");
  const F = "NiuBision Estándar · Precio fundador";
  const mk = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: "c" + i, plan: F, unpaid: false, ...extra }));
  assert.equal(m.founderLeft({ clients: mk(2).concat(mk(3, { unpaid: true }).map((c, i) => ({ ...c, id: "u" + i }))) }), 3);
  const full = { clients: mk(5) };
  assert.equal(m.founderLeft(full), 0);
  assert.equal(m.founderAllowed(full, "nuevo"), false);
  assert.equal(m.founderAllowed(full, "c1"), true);
  assert.equal(m.founderLeft({ clients: mk(5), revoked: [{ clientId: "c0" }] }), 1);
});
