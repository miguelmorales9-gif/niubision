import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientGate, canNotifyTraining, isSigned } from "../cloud/status.js";
import worker, { _runDailyReminders, _notifyClient } from "../cloud/worker.js";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const SIG = { date: "2026-10-30", signature: "data:image/png;base64," + "x".repeat(40) };
const NOW = Date.UTC(2026, 10, 1, 13); // 9 AM Puerto Rico
const mk = (o = {}) => Object.assign({ id: "c1", name: "Cliente Uno", plan: "NiuBision Estándar", accessCode: "123456" }, o);

test("estado: sin relevo/contrato = pendiente de firma; sin pago confirmado = pendiente de pago", () => {
  assert.equal(clientGate(mk({ unpaid: true }), {}, NOW).status, "pendiente de firma");
  assert.equal(clientGate(mk({ unpaid: false, waiver: SIG }), {}, NOW).status, "pendiente de firma", "falta contrato");
  assert.equal(clientGate(mk({ unpaid: false, contract: SIG }), {}, NOW).status, "pendiente de firma", "falta relevo");
  assert.equal(clientGate(mk({ unpaid: false, waiver: SIG }), { contracts: [Object.assign({ clientId: "c1" }, SIG)] }, NOW).status, "activo", "contrato en state.contracts");
  for (const unpaid of [true, undefined, "false", 0]) assert.equal(clientGate(mk({ unpaid, waiver: SIG, contract: SIG }), {}, NOW).status, "pendiente de pago", String(unpaid));
  assert.equal(clientGate(mk({ unpaid: false, waiver: SIG, contract: SIG }), {}, NOW).status, "activo");
  assert.equal(clientGate(mk({ unpaid: false, waiver: SIG, contract: SIG, endDate: "2026-10-01" }), {}, NOW).status, "vencido");
  assert.equal(clientGate(mk({ unpaid: false, waiver: SIG, contract: SIG }), { revoked: [{ clientId: "c1" }] }, NOW).paid, false, "anulado");
  // pagos iniciados (ATH registrado, checkout Stripe empezado/vencido, PRUEBA humo) no cuentan
  const st = { payments: [{ clientId: "c1", status: "iniciado", method: "ATH Móvil" }, { clientId: "c1", status: "sin completar", method: "Tarjeta (Stripe)" }] };
  assert.equal(clientGate(mk({ unpaid: true, waiver: SIG, contract: SIG }), st, NOW).status, "pendiente de pago");
  assert.equal(isSigned(null), false); assert.equal(canNotifyTraining(null), false);
});

const VAPID = {}; // sin VAPID: deliverPush no envía; medimos la decisión
test("avisos: recordatorio diario solo a clientes firmados y con pago confirmado", async () => {
  const row = { studioKey: "NIUBI", state: { clients: [
    mk({ id: "a", unpaid: true }), // sin firma ni pago
    mk({ id: "b", unpaid: true, waiver: SIG, contract: SIG, accessCode: "222222" }), // firmado, sin pago
    mk({ id: "c", unpaid: false, accessCode: "333333" }), // pagado, sin firma
    mk({ id: "d", unpaid: false, waiver: SIG, contract: SIG, accessCode: "444444" }) // ok
  ] }, push: { coach: [], clients: {}, prefs: {} } };
  for (const id of "abcd") row.push.prefs[id] = { daily: true, hour: 9 };
  const store = new Map([["NIUBI", JSON.stringify(row)]]);
  const env = Object.assign({ STUDIO: { get: async (k) => store.get(k) || null, put: async (k, v) => { store.set(k, v); } } }, VAPID);
  const out = await _runDailyReminders(env, NOW);
  assert.equal(out.optedIn, 4); assert.equal(out.gated, 3); assert.equal(out.due, 1);
});
test("avisos: notifyClient no manda entrenamiento sin firma/pago; el pago sin firma pide firmar", async () => {
  const row = { state: { clients: [mk({ id: "a", unpaid: false }), mk({ id: "b", unpaid: true, waiver: SIG, contract: SIG, accessCode: "222222" }), mk({ id: "d", unpaid: false, waiver: SIG, contract: SIG, accessCode: "444444" })] }, push: { coach: [], clients: {} } };
  assert.equal((await _notifyClient({}, row, "a", "", "Programa listo", "x", "/", "nb-aprobado", "training")).skipped, "pendiente_firma");
  assert.equal((await _notifyClient({}, row, "b", "", "Programa listo", "x", "/", "nb-aprobado", "training")).skipped, "pendiente_pago");
  assert.equal((await _notifyClient({}, row, "a", "", "Código listo", "x", "/", "nb-code", "code")).tag, "nb-firma");
  assert.equal((await _notifyClient({}, row, "d", "", "Programa listo", "x", "/", "nb-aprobado", "training")).tag, "nb-aprobado");
});
test("avisos: /api/push/send a cliente sin firma o sin pago = 409; /api/lead nunca se marca pagado", async () => {
  const tok = "t".repeat(40);
  const row = { studioKey: "NIUBI", sessions: { [tok]: { role: "coach", exp: NOW + 3600e3, last: NOW } }, state: { clients: [mk({ id: "a", unpaid: false }), mk({ id: "b", unpaid: true, waiver: SIG, contract: SIG, accessCode: "222222" })] }, push: { coach: [], clients: {} } };
  const store = new Map([["NIUBI", JSON.stringify(row)]]);
  const env = { STUDIO: { get: async (k) => store.get(k) || null, put: async (k, v) => { store.set(k, v); } } };
  const send = (clientId) => worker.fetch(new Request("https://w/api/push/send", { method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ kind: "today", clientId }) }), env);
  const realNow = Date.now; Date.now = () => NOW; // fuera del horario silencioso
  try {
    const a = await send("a"); assert.equal(a.status, 409); assert.equal((await a.json()).code, "pendiente_firma");
    const b = await send("b"); assert.equal(b.status, 409); assert.equal((await b.json()).code, "pendiente_pago");
  } finally { Date.now = realNow; }
  const src = R("cloud/worker.js");
  assert.match(src, /unpaid: true, \/\/ un lead nunca se marca pagado/);
});

test("app: estado del coach derivado de firma + pago (misma regla que el servidor)", () => {
  const src = R("app/app.js");
  const grab = (name) => { const i = src.indexOf(name); assert.ok(i >= 0, name); let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && !--d) break; } return src.slice(i, j + 1); };
  const pre = "const state = { contracts: [] }; const attachLegalToClient = (c) => c; const isRevoked = (code, id) => id === 'rv'; const todayKey = () => '2026-11-01';\n";
  const fns = ["function clientSignedDocs(", "function clientPaidConfirmed(", "function clientStatus(", "function daysLeft(", "function sessionsLeft(", "function planMeta(", "function isPendingStatus(", "function canTrainingNotify(", "function statusLabel("].map(grab).join("\n");
  const f = new Function(pre + fns + "\nreturn { clientStatus, statusLabel, canTrainingNotify };")();
  const st = (o) => f.clientStatus(mk(o));
  assert.equal(st({ unpaid: true }), "pendiente de firma y pago");
  assert.equal(st({ unpaid: false }), "pendiente de firma");
  assert.equal(st({ unpaid: true, waiver: SIG, contract: SIG, startDate: "2026-10-31", endDate: "2026-11-28" }), "pendiente de pago");
  assert.equal(st({ waiver: SIG, contract: SIG }), "pendiente de pago", "sin campo unpaid tampoco cuenta");
  assert.equal(st({ unpaid: false, waiver: SIG, contract: SIG, endDate: "2026-12-30" }), "activo");
  assert.equal(st({ id: "rv", unpaid: false, waiver: SIG, contract: SIG }), "pendiente de pago");
  assert.equal(f.statusLabel("pendiente de pago"), "Pendiente de pago");
  assert.equal(f.statusLabel("pendiente de firma"), "Pendiente de firma");
  assert.equal(f.canTrainingNotify(mk({ unpaid: false })), false);
  assert.match(grab("function nudgeGym("), /canTrainingNotify\(selfClient\(\)\)/);
  assert.match(grab("function silentClients("), /canTrainingNotify/);
  assert.equal(R("app/app.js"), R("public/app/app.js"));
});

import { s2sSign, coachingActiveFor } from "../cloud/s2s.js";
test("s2s NFW: coaching activo por email normalizado, firma HMAC obligatoria", async () => {
  const st = { clients: [
    mk({ id: "ok", email: "Ana@Ejemplo.com ", unpaid: false, waiver: SIG, contract: SIG }),
    mk({ id: "np", email: "nopago@x.com", unpaid: true, waiver: SIG, contract: SIG }),
    mk({ id: "nf", email: "nofirma@x.com", unpaid: false }),
    mk({ id: "ve", email: "vencido@x.com", unpaid: false, waiver: SIG, contract: SIG, endDate: "2026-10-01" })
  ] };
  assert.equal(coachingActiveFor(st, "  ana@ejemplo.COM", NOW), true);
  for (const e of ["nopago@x.com", "nofirma@x.com", "vencido@x.com", "otro@x.com", ""]) assert.equal(coachingActiveFor(st, e, NOW), false, e);
  const store = new Map([["NIUBI", JSON.stringify({ studioKey: "NIUBI", state: st })]]);
  const env = { NFW_S2S_SECRET: "s".repeat(40), STUDIO: { get: async (k) => store.get(k) || null, put: async () => {} } };
  const call = async (email, sig, ts = Date.now()) => worker.fetch(new Request("https://api.x/api/s2s/coaching-status", { method: "POST", headers: { "content-type": "application/json", "x-nb-ts": String(ts), "x-nb-sig": sig }, body: JSON.stringify({ email }) }), env, {});
  const realNow = Date.now();
  let r = await call("ana@ejemplo.com", await s2sSign(env.NFW_S2S_SECRET, realNow, "ana@ejemplo.com"), realNow); assert.equal(r.status, 200);
  const j = await r.json(); assert.deepEqual(j, { active: true });
  r = await call("ana@ejemplo.com", "00"); assert.equal(r.status, 401);
  const old = realNow - 10 * 60e3; r = await call("ana@ejemplo.com", await s2sSign(env.NFW_S2S_SECRET, old, "ana@ejemplo.com"), old); assert.equal(r.status, 401);
  r = await call("ana@ejemplo.com", await s2sSign("otro", realNow, "ana@ejemplo.com"), realNow); assert.equal(r.status, 401);
  delete env.NFW_S2S_SECRET; r = await call("ana@ejemplo.com", "x"); assert.equal(r.status, 503);
});
