import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { b32decode, totpAt, totpOk, sessionAlive, SESSION_RULES, pinOk, pinMatch, safeEq } from "../cloud/worker.js";
const R = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
// RFC 6238 vector: secreto ASCII "12345678901234567890", T=59 s -> 287082
const RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("TOTP: vector RFC 6238", async () => {
  assert.equal(b32decode(RFC).length, 20);
  assert.equal(await totpAt(RFC, 1), "287082");
  assert.equal(await totpOk(RFC, "287082", 59000), true);
  assert.equal(await totpOk(RFC, "000000", 59000), false);
  assert.equal(await totpOk(RFC, "12", 59000), false);
});

test("PIN: con TOTP activo el PIN suelto ya no autoriza", () => {
  const env = { COACH_PIN: "4321" };
  assert.equal(pinOk(env, "4321"), true);
  assert.equal(pinOk(env, "1111"), false);
  const env2 = { COACH_PIN: "4321", COACH_TOTP_SECRET: RFC };
  assert.equal(pinOk(env2, "4321"), false);
  assert.equal(pinMatch(env2, "4321"), true);
  assert.equal(safeEq("abc", "abd"), false);
});

test("Sesiones: vencen por inactividad y por tiempo absoluto", () => {
  const now = Date.now();
  const c = { role: "coach", exp: now + SESSION_RULES.coach.abs, last: now };
  assert.equal(sessionAlive(c, now + 60000), true);
  assert.equal(sessionAlive(c, now + SESSION_RULES.coach.idle + 1000), false);
  assert.equal(sessionAlive({ ...c, last: now + SESSION_RULES.coach.abs }, now + SESSION_RULES.coach.abs + 1), false);
  const k = { role: "client", exp: now + SESSION_RULES.client.abs, last: now };
  assert.equal(sessionAlive(k, now + 3600000), true);
  assert.equal(sessionAlive(k, now + SESSION_RULES.client.idle + 1000), false);
  assert.equal(sessionAlive({ role: "client", exp: now + 1000 }, now), true); // sesiones previas sin "last"
});

test("Cabeceras del build: DENY, frame-ancestors, display-capture", () => {
  const s = R("scripts/build-split.sh");
  assert.match(s, /APP_HEADERS=.*X-Frame-Options: DENY/);
  assert.match(s, /APP_HEADERS=.*Content-Security-Policy: frame-ancestors 'none'/);
  assert.match(s, /APP_HEADERS=.*display-capture=\(\)/);
  assert.match(s, /WEB_HEADERS=.*frame-ancestors 'none'/);
});

test("App: marca de agua sólo con sesión de cliente/coach, no en portada", () => {
  const a = R("app/app.js"), css = R("app/styles.css");
  assert.match(a, /function nbGuard\(\)/);
  assert.match(a, /state\.role === "client" \|\| state\.role === "coach"/);
  assert.match(css, /\.nb-wm\{[^}]*pointer-events:none/);
  assert.match(css, /:root\.nb-hidden body\.nb-protect #app\{filter:blur/);
  assert.equal(R("public/app/app.js"), a, "public/ sincronizado");
});

test("API: respuestas JSON con cabeceras de seguridad", async () => {
  const w = (await import("../cloud/worker.js")).default;
  const res = await w.fetch(new Request("https://x/api/nada"), {}, {});
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
});

function kv(init) { const m = new Map(Object.entries(init || {})); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, list: async () => ({ keys: [] }), _m: m }; }
async function call(w, env, path, method, body, tok) {
  const h = { "content-type": "application/json" }; if (tok) h.authorization = "Bearer " + tok;
  const r = await w.fetch(new Request("https://x" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
test("Autorización: un cliente no lee el estudio; coach necesita PIN + TOTP", async () => {
  const w = (await import("../cloud/worker.js")).default;
  const row = { studioKey: "NIUBI", token: "t".repeat(40), state: { clients: [{ id: "cA", name: "Prueba A", accessCode: "111111" }, { id: "cB", name: "Prueba B", accessCode: "222222" }] }, sessions: {} };
  const env = { STUDIO: kv({ NIUBI: JSON.stringify(row) }), COACH_PIN: "9876", COACH_TOTP_SECRET: RFC };
  const a = await call(w, env, "/api/auth/login", "POST", { role: "client", code: "111111" });
  assert.equal(a.status, 200); assert.equal(a.j.clientId, "cA");
  assert.equal((await call(w, env, "/api/state", "GET", null, a.j.token)).status, 404);
  assert.equal((await call(w, env, "/api/studio", "POST", { pin: "9876" })).status, 403, "PIN suelto bloqueado con TOTP");
  const p1 = await call(w, env, "/api/auth/login", "POST", { role: "coach", pin: "9876" });
  assert.equal(p1.status, 401); assert.equal(p1.j.totp, true); assert.equal(p1.j.token, undefined);
  assert.equal((await call(w, env, "/api/auth/login", "POST", { role: "coach", pin: "9876", totp: "000000" })).status, 401);
  const code = await totpAt(RFC, Math.floor(Date.now() / 30000));
  const c = await call(w, env, "/api/auth/login", "POST", { role: "coach", pin: "9876", totp: code });
  assert.equal(c.status, 200);
  assert.equal((await call(w, env, "/api/state", "GET", null, c.j.token)).status, 200);
  // Inactividad: forzar "last" viejo -> sesión vencida
  const saved = JSON.parse(env.STUDIO._m.get("NIUBI"));
  saved.sessions[c.j.token].last = Date.now() - SESSION_RULES.coach.idle - 1000;
  env.STUDIO._m.set("NIUBI", JSON.stringify(saved));
  assert.equal((await call(w, env, "/api/auth/me", "GET", null, c.j.token)).status, 401);
});

test("Riesgos cerrados: token fijo, /api/report sin sesión, ?pin= en URL; resumen diario sigue", async () => {
  const w = (await import("../cloud/worker.js")).default;
  const row = { studioKey: "NIUBI", token: "f".repeat(40), state: { clients: [{ id: "cA", name: "Prueba A", accessCode: "111111" }] }, sessions: {} };
  const env = { STUDIO: kv({ NIUBI: JSON.stringify(row) }), COACH_PIN: "9876", SUMMARY_TOKEN: "s".repeat(32) };
  // token fijo del estudio ya no autoriza
  assert.equal((await call(w, env, "/api/state", "GET", null, "f".repeat(40))).status, 404);
  // /api/report: sólo con código, sin sesión -> 401
  assert.equal((await call(w, env, "/api/report", "POST", { accessCode: "111111", clientId: "cA", report: {} })).status, 401);
  const a = await call(w, env, "/api/auth/login", "POST", { role: "client", code: "111111" });
  assert.equal((await call(w, env, "/api/report", "POST", { accessCode: "111111", clientId: "cA", report: {} }, a.j.token)).status, 200);
  // ?pin= y ?token= ya no autorizan
  assert.equal((await call(w, env, "/api/export?pin=9876", "GET")).status, 403);
  assert.equal((await call(w, env, "/api/admin/daily-summary?pin=9876", "GET")).status, 401);
  // PIN por cabecera/cuerpo sigue
  const r = await w.fetch(new Request("https://x/api/export", { headers: { "x-nb-pin": "9876" } }), env, { waitUntil() {} });
  assert.equal(r.status, 200);
  // coach: studioToken = sesión que vence
  const c = await call(w, env, "/api/auth/login", "POST", { role: "coach", pin: "9876" });
  assert.equal(c.j.studioToken, c.j.token);
  assert.equal((await call(w, env, "/api/state", "GET", null, c.j.studioToken)).status, 200);
  const st = await call(w, env, "/api/studio", "POST", { pin: "9876" });
  assert.equal(st.status, 200); assert.notEqual(st.j.token, row.token); assert.ok(st.j.exp > Date.now());
  // resumen diario (rutina): Bearer SUMMARY_TOKEN y x-nb-pin
  const s1 = await w.fetch(new Request("https://x/api/admin/daily-summary", { headers: { authorization: "Bearer " + "s".repeat(32) } }), env, { waitUntil() {} });
  assert.equal(s1.status, 200);
  const s2 = await w.fetch(new Request("https://x/api/admin/daily-summary", { headers: { "x-nb-pin": "9876" } }), env, { waitUntil() {} });
  assert.equal(s2.status, 200);
});
