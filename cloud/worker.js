import { dbMode, d1ReadRow, d1WriteRow } from "./db.js";
import { sendWebPush } from "./webpush.js";
import { stripeMode, createCheckout as stripeCheckout, verifySignature as stripeVerify, stripeApi, isFounderPlan, founderAllowed, founderLeft, FOUNDER_LIMIT } from "./stripe.js";
const COACH_MAIL = "miguel.morales9@gmail.com";
const LEGACY = "nb-cloud-v1";

function mergeStudio(prev, next) {
  const a = prev && typeof prev === "object" ? prev : {};
  const b = next && typeof next === "object" ? next : {};
  const op = String(b._op || "");
  const revoked = [];
  const seen = new Set();
  [].concat(a.revoked || [], b.revoked || []).forEach((r) => {
    if (!r || typeof r !== "object") return;
    const k = String(r.code || "") + "|" + String(r.clientId || "");
    if (k === "|" || seen.has(k)) return;
    seen.add(k);
    revoked.push(r);
  });
  const dead = new Set(revoked.map((r) => String(r.code || "")).filter((c) => /^\d{6}$/.test(c)));
  const deadIds = new Set(revoked.map((r) => String(r.clientId || "")).filter(Boolean));
  const keyOf = (c) => (c.id ? "id:" + c.id : c.accessCode ? "a:" + c.accessCode : "n:" + String(c.name || "").toLowerCase());
  const alive = (c) => c && !(c.id && deadIds.has(String(c.id))) && !(c.accessCode && dead.has(String(c.accessCode)));
  const gone = (x) => {
    if (!x) return true;
    if (x.clientId && deadIds.has(String(x.clientId))) return true;
    if (x.id && deadIds.has(String(x.id))) return true;
    if (x.accessCode && dead.has(String(x.accessCode))) return true;
    if (x.code && dead.has(String(x.code))) return true;
    return false;
  };
  if (op === "paid") {
    const invoice = String(b.invoice || "");
    const payHit = (a.payments || []).find((p) => invoice && (p.id === invoice || p.invoice === invoice));
    const clientId = String(b.clientId || (payHit && payHit.clientId) || "");
    const phone = String(b.phone || "").replace(/\D/g, "");
    const wantCode = String(b.accessCode || "").replace(/\D/g, "").slice(0, 6);
    const payments = (a.payments || []).map((p) => {
      if ((invoice && (p.id === invoice || p.invoice === invoice)) || (clientId && p.clientId === clientId && p.status !== "recibido")) {
        return Object.assign({}, p, {
          status: "recibido",
          method: b.method || p.method,
          amount: b.amount || p.amount,
          accessCode: (/^\d{6}$/.test(wantCode) ? wantCode : (p.accessCode || ""))
        });
      }
      return p;
    });
    const used = new Set((a.clients || []).map((x) => String(x.accessCode || "")).filter(Boolean));
    const gen = () => String(100000 + Math.floor(Math.random() * 900000));
    let matched = false;
    let clients = (a.clients || []).map((c) => {
      const hit = (clientId && c.id === clientId)
        || (phone.length >= 10 && String(c.phone || "").replace(/\D/g, "") === phone)
        || (invoice && (c.id === invoice || c.accessCode === invoice));
      if (!hit) return c;
      matched = true;
      let code = String(c.accessCode || "");
      const taken = new Set(used);
      taken.delete(code);
      // Coach-issued code is source of truth for redeem.
      if (/^\d{6}$/.test(wantCode)) {
        code = wantCode;
      } else if (!/^\d{6}$/.test(code) || taken.has(code)) {
        do { code = gen(); } while (taken.has(code) || used.has(code));
      }
      used.add(code);
      return Object.assign({}, c, {
        unpaid: false,
        accessCode: code,
        name: b.name || c.name,
        plan: b.plan || c.plan,
        phone: b.phone || c.phone
      });
    });
    if (!matched && (clientId || b.name)) {
      let code = /^\d{6}$/.test(wantCode) ? wantCode : gen();
      while (used.has(code)) code = gen();
      used.add(code);
      clients = clients.concat([{
        id: clientId || ("c" + Date.now()),
        name: b.name || "",
        phone: b.phone || "",
        plan: b.plan || "",
        unpaid: false,
        accessCode: code,
        routine: "full-inicio"
      }]);
    }
    let paymentsOut = payments;
    const codeForPay = (clients.find((c) => (clientId && c.id === clientId) || (b.name && String(c.name || "").toLowerCase() === String(b.name || "").toLowerCase())) || {}).accessCode
      || (/^\d{6}$/.test(wantCode) ? wantCode : "");
    if (clientId && !paymentsOut.some((p) => p.clientId === clientId && p.status === "recibido")) {
      paymentsOut = paymentsOut.concat([{
        id: invoice || ("p" + Date.now()),
        date: new Date().toISOString().slice(0, 10),
        plan: b.plan || "",
        amount: b.amount || "",
        method: b.method || "ATH Móvil",
        status: "recibido",
        name: b.name || "",
        clientId,
        accessCode: codeForPay
      }]);
    }
    const phoneD = phone.replace(/\D/g, "");
    const inboxCleared = (a.inbox || []).filter((n) => {
      if (!n || (n.type !== "pay" && n.type !== "lead")) return true;
      if (clientId && n.clientId === clientId) return false;
      if (phoneD.length >= 10 && String(n.phone || "").replace(/\D/g, "") === phoneD) return false;
      if (b.name && String(n.name || "").toLowerCase() === String(b.name || "").toLowerCase()) return false;
      if (invoice && (n.invoice === invoice || n.ref === invoice || n.id === invoice)) return false;
      return true;
    });
    return Object.assign({}, a, { clients, payments: paymentsOut, inbox: inboxCleared, revoked, updatedAt: Date.now() });
  }
  if (op === "revoke") {
    return Object.assign({}, a, {
      clients: (a.clients || []).filter(alive),
      payments: (a.payments || []).filter((p) => !gone(p)),
      inbox: (a.inbox || []).filter((n) => !gone(n)),
      contracts: (a.contracts || []).filter((k) => !gone(k)),
      receipts: (a.receipts || []).filter((r) => !gone(r)),
      checkins: (a.checkins || []).filter((h) => !gone(h)),
      appointments: (a.appointments || []).filter((x) => !gone(x)),
      videos: (a.videos || []).filter((v) => !gone(v)),
      revoked,
      updatedAt: Date.now()
    });
  }
  if (op === "report") {
    const clients = (a.clients || []).map((c) => {
      const hit = (b.clients || []).find((x) => (c.id && x.id === c.id) || (c.accessCode && x.accessCode === c.accessCode));
      if (!hit || !hit.report) return c;
      return Object.assign({}, c, { report: hit.report, lastSession: hit.report.lastSession || c.lastSession });
    });
    return Object.assign({}, a, { clients, revoked, updatedAt: Date.now() });
  }
  const preferDoc = (next, prev) => {
    const sig = (d) => !!(d && typeof d === "object" && String(d.signature || "").length > 20);
    if (sig(prev) && !sig(next)) return prev;
    if (sig(next)) return Object.assign({}, prev && typeof prev === "object" ? prev : {}, next);
    if (next && typeof next === "object" && (next.date || next.name) && !(prev && (prev.date || prev.signature))) return next;
    return prev || next;
  };
  const map = new Map();
  (a.clients || []).filter(alive).forEach((c) => map.set(keyOf(c), c));
  (b.clients || []).filter(alive).forEach((c) => {
    const prev = map.get(keyOf(c)) || {};
    const row = Object.assign({}, prev, c);
    row.waiver = preferDoc(c.waiver, prev.waiver);
    row.health = preferDoc(c.health, prev.health);
    row.contract = preferDoc(c.contract, prev.contract);
    row.photos = (Array.isArray(c.photos) && c.photos.length) ? c.photos : (prev.photos || c.photos);
    if (prev.unpaid === false) row.unpaid = false;
    if (prev.accessCode && !c.accessCode) row.accessCode = prev.accessCode;
    map.set(keyOf(c), row);
  });
  const folded = [];
  const seenName = new Map();
  Array.from(map.values()).forEach((c) => {
    const name = String(c.name || "").toLowerCase().trim();
    const phone = String(c.phone || "").replace(/\D/g, "");
    const code = String(c.accessCode || "");
    const k = phone.length >= 10 ? "p:" + phone : (code ? "a:" + code : (name ? "n:" + name : "id:" + c.id));
    const prev = seenName.get(k);
    if (prev && !(code && prev.accessCode && code !== String(prev.accessCode))) {
      const i = folded.indexOf(prev);
      const row = Object.assign({}, prev, c, {
        id: prev.id || c.id,
        waiver: (c.waiver && (c.waiver.signature || c.waiver.date)) ? c.waiver : prev.waiver,
        health: (c.health && c.health.date) ? c.health : prev.health,
        contract: c.contract || prev.contract,
        accessCode: c.accessCode || prev.accessCode
      });
      if (i >= 0) folded[i] = row;
      seenName.set(k, row);
      return;
    }
    folded.push(c);
    seenName.set(k, c);
    if (c.id) seenName.set("id:" + c.id, c);
  });
  const payMap = new Map();
  [].concat(a.payments || [], b.payments || []).forEach((p) => {
    if (!p || typeof p !== "object") return;
    const who = String(p.clientId || "") + "|" + String(p.name || "").toLowerCase();
    const k = who + "|" + String(p.date || "") + "|" + String(p.amount || "");
    const prev = payMap.get(k);
    const rank = (x) => (x && x.status === "recibido" ? 2 : 1);
    if (!prev || rank(p) >= rank(prev)) payMap.set(k, Object.assign({}, prev || {}, p));
  });
  const byDoc = (list) => {
    const m = new Map();
    (list || []).forEach((x) => {
      if (!x || typeof x !== "object") return;
      const k = String(x.id || "") || ("n:" + String(x.name || "").toLowerCase() + "|" + String(x.date || ""));
      const prev = m.get(k);
      if (!prev) { m.set(k, x); return; }
      const row = Object.assign({}, prev, x);
      if (prev.signature && !x.signature) row.signature = prev.signature;
      if (prev.text && !x.text) row.text = prev.text;
      m.set(k, row);
    });
    return Array.from(m.values());
  };
  const rest = Object.assign({}, b);
  ["clients", "payments", "inbox", "contracts", "receipts", "revoked", "programRequests", "_op"].forEach((k) => { delete rest[k]; });
  const mergePr = (aa, bb) => {
    const map = {};
    [].concat(aa || [], bb || []).forEach((r) => {
      if (!r || !r.id) return;
      const prev = map[r.id];
      if (!prev) { map[r.id] = r; return; }
      const rank = (x) => {
        const s = x && x.status;
        if (s === "approved" || s === "ignored" || s === "rejected") return 2;
        if (s === "pending") return 1;
        return 0;
      };
      if (rank(r) > rank(prev) || (rank(r) === rank(prev) && Number(r.at || 0) >= Number(prev.at || 0))) map[r.id] = Object.assign({}, prev, r);
    });
    return Object.keys(map).map((k) => map[k]).sort((x, y) => Number(y.at || 0) - Number(x.at || 0)).slice(0, 80);
  };
  const fromClients = (folded.length ? folded : Array.from(map.values()))
    .map((c) => c && c.contract ? Object.assign({ clientId: c.id }, c.contract) : null)
    .filter(Boolean);
  const out = Object.assign({}, a, op === "lead" || op === "pay" ? {} : rest, {
    clients: folded.length ? folded : Array.from(map.values()),
    revoked,
    inbox: [].concat(a.inbox || [], b.inbox || []).filter((n) => !gone(n)).slice(-40),
    payments: Array.from(payMap.values()).filter((p) => !gone(p)).slice(-80),
    contracts: byDoc([].concat(a.contracts || [], b.contracts || [], fromClients)).filter((k) => !gone(k)),
    receipts: byDoc([].concat(a.receipts || [], b.receipts || [])).filter((r) => !gone(r)),
    programRequests: mergePr(a.programRequests, b.programRequests),
    updatedAt: Date.now()
  });
  delete out._op;
  return out;
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization, X-Nb-Pin",
      "access-control-expose-headers": "Retry-After",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
    }, extra || {})
  });
}

// ---- Per-IP rate limiting (Workers Rate Limiting bindings, see wrangler.toml) ----
// bucket -> [binding name, period seconds]
const RL = {
  auth: ["RL_AUTH", 60],   // PIN / coach login, studio, export, revoke, error log read: 10/min
  code: ["RL_CODE", 60],   // code redeem / receipt / paid / me: 20/min
  pay: ["RL_PAY", 60],     // pay, lead, program-request, report, push subscribe: 20/min
  ipn: ["RL_IPN", 60],     // PayPal IPN (PayPal servers): 60/min
  write: ["RL_WRITE", 60], // state PUT, logout: 60/min
  log: ["RL_LOG", 60],     // client error reports: 10/min
  test: ["RL_TEST", 10],   // GET /api/rl-test (non-mutating probe): 5 per 10 s
  read: ["RL_READ", 60]    // everything else: 300/min
};
function rlBucket(path, method) {
  if (path === "/" || path === "/health" || path === "/api/health") return null;
  if (path === "/api/rl-test") return "test";
  if (path === "/api/auth/login" || path === "/api/login" || path === "/api/studio" || path === "/api/export" || path === "/api/revoke" || path === "/api/admin/daily-summary") return "auth";
  if (path.indexOf("/api/log") === 0) return method === "POST" ? "log" : "auth";
  if (path === "/api/redeem" || path === "/api/receipt" || path === "/api/paid" || path === "/api/auth/me" || path === "/api/me") return "code";
  if (path === "/api/paypal" || path === "/api/stripe/webhook") return "ipn";
  if (path === "/api/stripe/checkout") return "pay";
  if (path === "/api/pay" || path === "/api/lead" || path === "/api/program-request" || path === "/api/report" || path.indexOf("/api/push/") === 0 && method === "POST") return "pay";
  if (method !== "GET" && method !== "HEAD") return "write";
  return "read";
}
async function rateLimited(req, env, path, method) {
  const b = rlBucket(path, method);
  if (!b) return null;
  const [name, period] = RL[b];
  const lim = env && env[name];
  if (!lim || typeof lim.limit !== "function") return null; // binding absent: fail open
  try {
    const { success } = await lim.limit({ key: b + ":" + clientIp(req) });
    if (success) return null;
  } catch (e) {
    return null; // never block on limiter errors
  }
  console.log(JSON.stringify({ level: "warn", ev: "rate_limited", bucket: b, path, method }));
  return json({ error: "Demasiados intentos. Espere un minuto y vuelva a intentar.", code: "rate_limited", retryAfter: period }, 429, { "retry-after": String(period) });
}

// ---- Client error reports (POST /api/log), PII-scrubbed, deduped, KV TTL 30 days ----
const LOG_TTL = 30 * 24 * 3600;
const LOG_DAY_MAX_D1 = 1000; // D1 free tier: 100k writes/day
const LOG_DAY_MAX = 50; // unique errors stored per UTC day (=> max 100 KV writes/day)
const LOG_ORIGINS = /^https:\/\/((www\.)?niubision\.(app|com)|([a-z0-9-]+\.)?niubision-(app|web)\.pages\.dev|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/i;
function scrub(v, max) {
  return String(v == null ? "" : v)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b[0-9a-f]{16,}\b/gi, "[hex]")
    .replace(/\d{6,}/g, "[n]")
    .replace(/(pin|token|code|c|inv|pago)=[^&\s"']*/gi, "$1=[x]")
    .slice(0, max);
}
async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function handleLog(req, env, url, method) {
  if (method === "POST") {
    const origin = req.headers.get("origin") || "";
    const raw = await req.text();
    if (raw.length > 4096) return json({ error: "Demasiado grande" }, 413);
    if (!LOG_ORIGINS.test(origin)) return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
    let b = {};
    try { b = JSON.parse(raw); } catch (e) { return json({ error: "JSON inválido" }, 400); }
    const path = String(b.path || "").split(/[?#]/)[0];
    const rec = {
      t: Date.now(),
      src: /^(app|web)$/.test(b.src) ? b.src : "app",
      kind: scrub(b.kind || "error", 20),
      msg: scrub(b.msg, 300),
      stack: scrub(b.stack, 1500),
      path: scrub(path, 200),
      line: Number(b.line) || 0,
      col: Number(b.col) || 0,
      v: scrub(b.v, 40),
      ua: scrub(req.headers.get("user-agent") || b.ua, 200),
      country: (req.cf && req.cf.country) || ""
    };
    if (!rec.msg) return json({ error: "Falta msg" }, 400);
    const h = await sha(rec.src + "|" + rec.msg + "|" + rec.stack.split("\n")[0] + "|" + rec.v);
    rec.h = h;
    console.log(JSON.stringify(Object.assign({ level: "error", ev: "client_error" }, rec)));
    // Hard daily cap on KV writes so error reports never starve client data (free tier: 1000 writes/day).
    // Per unique error: 2 writes (record + day index). Cap LOG_DAY_MAX uniques/day => <= 2*LOG_DAY_MAX writes.
    // Over cap (or duplicate today): Workers Logs only (console line above).
    const day = new Date(rec.t).toISOString().slice(0, 10);
    if (dbMode(env) !== "kv") {
      try {
        const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM logs WHERE day = ?").bind(day).first();
        if (((c && c.n) || 0) < LOG_DAY_MAX_D1) {
          await env.DB.prepare(`INSERT INTO logs (h, day, t, n, src, kind, msg, stack, path, line, col, v, ua, country) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(h, day) DO UPDATE SET n = n + 1, t = excluded.t`).bind(h, day, rec.t, rec.src, rec.kind, rec.msg, rec.stack, rec.path, rec.line, rec.col, rec.v, rec.ua, rec.country).run();
        } else {
          await env.DB.prepare("UPDATE logs SET n = n + 1, t = ? WHERE h = ? AND day = ?").bind(rec.t, h, day).run();
        }
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
      } catch (e) {
        console.error(JSON.stringify({ level: "error", ev: "d1_log_failed", msg: String(e && e.message || e) }));
      }
    }
    const mem = (globalThis.__nbLogDay && globalThis.__nbLogDay.day === day) ? globalThis.__nbLogDay : (globalThis.__nbLogDay = { day, full: false, seen: new Set() });
    if (!mem.full && !mem.seen.has(h)) {
      const idxKey = "logday:" + day;
      let idx = { n: 0, h: [] };
      try { idx = JSON.parse((await env.STUDIO.get(idxKey)) || "null") || idx; } catch (e) {}
      idx.h.forEach((x) => mem.seen.add(x));
      if (idx.n >= LOG_DAY_MAX) {
        mem.full = true;
        console.log(JSON.stringify({ level: "warn", ev: "log_kv_cap_reached", day, n: idx.n }));
      } else if (!mem.seen.has(h)) {
        mem.seen.add(h);
        idx.n += 1; idx.h.push(h);
        const inv = String(9999999999999 - rec.t).padStart(13, "0");
        await env.STUDIO.put("log:" + inv + ":" + h, JSON.stringify(rec), { expirationTtl: LOG_TTL });
        await env.STUDIO.put(idxKey, JSON.stringify(idx), { expirationTtl: 2 * 24 * 3600 });
      }
    }
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
  }
  if (method === "GET") {
    if (!pinOk(env, pinOf(req, url, null))) return json({ error: "PIN de estudio requerido" }, 403);
    const hours = Math.min(24 * 30, Math.max(1, Number(url.searchParams.get("hours")) || 24 * 30));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const since = Date.now() - hours * 3600 * 1000;
    const items = [];
    if (dbMode(env) !== "kv") {
      const rs = await env.DB.prepare("SELECT src, kind, msg, stack, path, line, col, v, ua, country, t, h, n FROM logs WHERE t >= ? ORDER BY t DESC LIMIT ?").bind(since, limit).all();
      (rs.results || []).forEach((r) => items.push(r));
    }
    const list = items.length ? { keys: [] } : await env.STUDIO.list({ prefix: "log:", limit });
    for (const k of list.keys) {
      const v = await env.STUDIO.get(k.name);
      if (!v) continue;
      const r = JSON.parse(v);
      if (r.t >= since) items.push(r);
    }
    if (url.pathname.replace(/\/$/, "") === "/api/log/summary") {
      const g = {};
      items.forEach((r) => { const k = r.src + " · " + r.msg; g[k] = g[k] || { n: 0, last: 0, v: r.v, path: r.path }; g[k].n += Number(r.n) || 1; g[k].last = Math.max(g[k].last, r.t); });
      return json({ ok: true, hours, distinct: Object.keys(g).length, groups: Object.entries(g).map(([k, x]) => Object.assign({ key: k }, x)).sort((a, b) => b.last - a.last) });
    }
    return json({ ok: true, hours, count: items.length, items });
  }
  return json({ error: "Método no permitido" }, 405);
}

function newToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function kvRow(env, key) {
  const raw = await env.STUDIO.get(key);
  return raw ? JSON.parse(raw) : null;
}
async function rowOf(env, key) {
  const mode = dbMode(env);
  if (mode === "kv") {
    const r = await kvRow(env, key);
    if (r) return r;
  } else {
    let d = null;
    try { d = await d1ReadRow(env, key); } catch (e) { console.error(JSON.stringify({ level: "error", ev: "d1_read_failed", key, msg: String(e && e.message || e) })); }
    if (mode === "d1" && d) return d;
    const k = await kvRow(env, key);
    // D1 wins only when it has seen a dual-write (rev > 0) at least as new as KV; migrated rev-0 rows defer to KV.
    if (d && (!k || ((Number(d._rev) || 0) > 0 && (Number(d._rev) || 0) >= (Number(k._rev) || 0)))) return d;
    if (k) {
      if (d) console.log(JSON.stringify({ level: "warn", ev: "d1_stale_kv_fallback", key, d1: d._rev, kv: k._rev }));
      return k;
    }
    if (d) return d;
  }
  const row = { studioKey: key, token: newToken(), state: {} };
  await putRow(env, row);
  return row;
}

async function putRow(env, row) {
  const mode = dbMode(env);
  row._rev = (Number(row._rev) || 0) + 1;
  if (mode !== "d1") await env.STUDIO.put(row.studioKey, JSON.stringify(row));
  if (mode !== "kv") {
    try { await d1WriteRow(env, row); }
    catch (e) {
      console.error(JSON.stringify({ level: "error", ev: "d1_write_failed", key: row.studioKey, msg: String(e && e.message || e) }));
      if (mode === "d1") throw e;
    }
  }
}

function bearer(req, url) {
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return (m && m[1].trim()) || ""; // ?token= ya no se acepta (quedaba en registros)
}

function pinOf(req, url, body) {
  return String((body && body.pin) || req.headers.get("x-nb-pin") || ""); // ?pin= ya no se acepta
}

function coachPin(env) {
  return String((env && env.COACH_PIN) || "").trim();
}
function pinMatch(env, got) {
  const want = coachPin(env);
  if (!want) return false;
  return safeEq(got, want);
}
// Con segundo factor activo (COACH_TOTP_SECRET) el PIN suelto ya no autoriza nada:
// hay que entrar por /api/auth/login con PIN + código y usar la sesión.
function pinOk(env, got) {
  if (totpOn(env)) return false;
  return pinMatch(env, got);
}

// ---- TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s, ±1 paso) ----
function totpOn(env) { return !!String((env && env.COACH_TOTP_SECRET) || "").trim(); }
function b32decode(str) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
async function totpAt(secret, step) {
  const key = await crypto.subtle.importKey("raw", b32decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8); let x = step;
  for (let i = 7; i >= 0; i--) { msg[i] = x & 255; x = Math.floor(x / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
async function totpOk(secret, code, now) {
  const c = String(code || "").replace(/\D/g, "");
  if (c.length !== 6) return false;
  const t = Math.floor((now || Date.now()) / 30000);
  for (const d of [-1, 0, 1]) if (safeEq(await totpAt(secret, t + d), c)) return true;
  return false;
}

// ---- Sesiones: vencimiento absoluto + por inactividad ----
const SESSION_RULES = { coach: { abs: 12 * 3600 * 1000, idle: 30 * 60 * 1000 }, client: { abs: 8 * 3600 * 1000, idle: 2 * 3600 * 1000 } };
function sessionAlive(s, now) {
  if (!s || !(s.exp > now)) return false;
  const r = SESSION_RULES[s.role] || SESSION_RULES.client;
  const last = Number(s.last || 0);
  if (last && now - last > r.idle) return false;
  return true;
}


// El token fijo del estudio (row.token) ya no autoriza: el coach usa sólo sesiones que vencen.
function tokOk(row, tok) {
  return false;
}

function pruneSessions(row) {
  const now = Date.now();
  const s = row.sessions || {};
  Object.keys(s).forEach((k) => {
    if (!sessionAlive(s[k], now)) delete s[k];
  });
  row.sessions = s;
  const f = row.fails || {};
  Object.keys(f).forEach((k) => {
    if (f[k] && f[k].until && f[k].until < now && !f[k].n) delete f[k];
  });
  row.fails = f;
}

function clientIp(req) {
  return (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon");
}

function rateBlocked(row, key) {
  const f = (row.fails || {})[key];
  return !!(f && f.until && Date.now() < f.until);
}

function rateHit(row, key, limit) {
  row.fails = row.fails || {};
  const f = row.fails[key] || { n: 0, until: 0 };
  f.n += 1;
  const cap = Number(limit) > 0 ? Number(limit) : 8;
  if (f.n >= cap) {
    f.until = Date.now() + 15 * 60 * 1000;
    f.n = 0;
  }
  row.fails[key] = f;
}

function rateClear(row, key) {
  if (row.fails) delete row.fails[key];
}

function dropSessions(row, pred) {
  pruneSessions(row);
  Object.keys(row.sessions || {}).forEach((k) => {
    if (pred(row.sessions[k])) delete row.sessions[k];
  });
}

async function identity(req, env, url) {
  const tok = bearer(req, url);
  const row = await rowOf(env, "NIUBI");
  pruneSessions(row);
  if (tokOk(row, tok)) return { row, role: "coach", token: tok };
  const s = (row.sessions || {})[tok];
  const now = Date.now();
  if (sessionAlive(s, now)) {
    // Renovar "última actividad" sin escribir en cada petición (máx. 1 escritura / 5 min).
    if (!s.last || now - s.last > 5 * 60 * 1000) { s.last = now; try { await putRow(env, row); } catch (_) {} }
    return { row, role: s.role, clientId: s.clientId || "", code: s.code || "", token: tok };
  }
  return { row, role: null, token: tok };
}

async function mailReceipt(row) {
  if (globalThis.__NB_PREVIEW) { console.log(JSON.stringify({ ev: "mail_receipt_preview_skip", plan: row && row.plan })); return; }
  const addrs = [COACH_MAIL];
  const extra = String(row.email || row.clientEmail || "").trim();
  if (extra && extra !== COACH_MAIL) addrs.push(extra);
  const text = [
    "Recibo NiuBision",
    "See the work. Enjoy the day.",
    "",
    "Fecha: " + (row.date || ""),
    "Cliente: " + (row.name || "Cliente"),
    "Plan: " + (row.plan || ""),
    ...(nbIvu(row.amount) ? ["Base: " + nbIvu(row.amount).base + " USD", "IVU (11.5 %): " + nbIvu(row.amount).ivu + " USD"] : []),
    "Total, IVU incluido: " + (row.amount || "—") + " USD",
    "Método: " + (row.method || ""),
    "Estado: " + (row.status || "recibido"),
    row.accessCode ? "Código: " + row.accessCode : "",
    "",
    "Precio final, IVU de Puerto Rico (11.5 %) incluido."
  ].filter(Boolean).join("\n");
  for (let i = 0; i < addrs.length; i++) {
    try {
      await fetch("https://ntfy.sh/niubision-recibo", {
        method: "POST",
        headers: {
          Title: "Recibo NiuBision",
          Email: addrs[i],
          Tags: "receipt"
        },
        body: text
      });
    } catch (e) {}
    try {
      await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(addrs[i]), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          _subject: "Recibo NiuBision",
          _template: "box",
          name: row.name || "Cliente",
          plan: row.plan || "",
          amount: String(row.amount || "") + " USD",
          method: row.method || "",
          date: row.date || "",
          code: row.accessCode || "",
          message: text
        })
      });
    } catch (e2) {}
  }
}


function vapidCfg(env) {
  const publicKey = String((env && env.VAPID_PUBLIC_KEY) || "").trim();
  const privateKey = String((env && env.VAPID_PRIVATE_KEY) || "").trim();
  const subject = String((env && env.VAPID_SUBJECT) || "mailto:miguel.morales9@gmail.com").trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function normSub(raw) {
  if (!raw || typeof raw !== "object") return null;
  const endpoint = String(raw.endpoint || "").trim();
  const keys = raw.keys || {};
  const p256dh = String(keys.p256dh || "").trim();
  const auth = String(keys.auth || "").trim();
  if (!/^https:\/\//i.test(endpoint) || !p256dh || !auth) return null;
  return {
    endpoint,
    expirationTime: raw.expirationTime == null ? null : raw.expirationTime,
    keys: { p256dh, auth },
    role: String(raw.role || "").toLowerCase() === "client" ? "client" : "coach",
    clientId: String(raw.clientId || "").slice(0, 64),
    accessCode: String(raw.accessCode || "").replace(/\D/g, "").slice(0, 6),
    at: Date.now()
  };
}

function pushBucket(row) {
  row.push = row.push && typeof row.push === "object" ? row.push : { coach: [], clients: {} };
  if (!Array.isArray(row.push.coach)) row.push.coach = [];
  if (!row.push.clients || typeof row.push.clients !== "object") row.push.clients = {};
  return row.push;
}

function upsertSub(list, sub) {
  const next = (list || []).filter((s) => s && s.endpoint && s.endpoint !== sub.endpoint);
  next.unshift({
    endpoint: sub.endpoint,
    expirationTime: sub.expirationTime,
    keys: sub.keys,
    at: sub.at || Date.now()
  });
  return next.slice(0, 8);
}

function dropEndpoint(row, endpoint) {
  const b = pushBucket(row);
  b.coach = (b.coach || []).filter((s) => s && s.endpoint !== endpoint);
  Object.keys(b.clients || {}).forEach((cid) => {
    b.clients[cid] = (b.clients[cid] || []).filter((s) => s && s.endpoint !== endpoint);
    if (!b.clients[cid].length) delete b.clients[cid];
  });
}

async function deliverPush(env, row, targets, payload) {
  const vapid = vapidCfg(env);
  if (!vapid || !targets || !targets.length) return { sent: 0, gone: 0 };
  let sent = 0;
  let gone = 0;
  const body = Object.assign({ title: "NiuBision" }, payload || {});
  for (const sub of targets) {
    if (!sub || !sub.endpoint) continue;
    try {
      const r = await sendWebPush(sub, body, vapid, { ttl: 86400, urgency: "high", topic: String(body.tag || "nb").slice(0, 32) });
      if (r.ok) sent += 1;
      if (r.gone) {
        gone += 1;
        dropEndpoint(row, sub.endpoint);
      }
    } catch (e) {}
  }
  return { sent, gone };
}

function coachSubs(row) {
  return (pushBucket(row).coach || []).slice();
}

function clientSubs(row, clientId, accessCode) {
  const b = pushBucket(row);
  const out = [];
  const seen = new Set();
  const add = (list) => {
    (list || []).forEach((s) => {
      if (!s || !s.endpoint || seen.has(s.endpoint)) return;
      seen.add(s.endpoint);
      out.push(s);
    });
  };
  if (clientId && b.clients[clientId]) add(b.clients[clientId]);
  if (accessCode) {
    const hit = ((row.state && row.state.clients) || []).find((c) => String(c.accessCode || "") === String(accessCode));
    if (hit && hit.id && b.clients[hit.id]) add(b.clients[hit.id]);
  }
  return out;
}

async function notifyCoach(env, row, title, body, url, tag) {
  const r = await deliverPush(env, row, coachSubs(row), {
    title: String(title || "NiuBision").slice(0, 48),
    body: String(body || "").slice(0, 120),
    url: url || "/?view=inbox",
    tag: tag || "nb-coach"
  });
  if (r.gone) await putRow(env, row);
  return r;
}

async function notifyClient(env, row, clientId, accessCode, title, body, url, tag) {
  const r = await deliverPush(env, row, clientSubs(row, clientId, accessCode), {
    title: String(title || "NiuBision").slice(0, 48),
    body: String(body || "").slice(0, 120),
    url: url || "/?view=work",
    tag: tag || "nb-client"
  });
  if (r.gone) await putRow(env, row);
  return r;
}

// ---- Push: coach templates, client daily-reminder prefs, quiet hours (America/Puerto_Rico) ----
const PUSH_TZ = "America/Puerto_Rico";
const QUIET_START = 21; // 9 PM
const QUIET_END = 8;    // 8 AM
const PUSH_TEMPLATES = {
  plan: { title: "Nuevo plan", body: "Miguel le preparó un plan nuevo. Ábralo en Hoy.", url: "/?view=work", tag: "nb-plan" },
  today: { title: "Sesión de hoy", body: "Su sesión de hoy está lista. Cuando pueda, ábrala en Hoy.", url: "/?view=work", tag: "nb-today" },
  daily: { title: "Sesión de hoy", body: "Recordatorio: su sesión de hoy le espera en NiuBision.", url: "/?view=work", tag: "nb-daily" }
};
function prNow(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PUSH_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms == null ? Date.now() : ms));
  const g = (t) => (parts.find((x) => x.type === t) || {}).value;
  return { day: g("year") + "-" + g("month") + "-" + g("day"), hour: Number(g("hour")) % 24 };
}
function isQuiet(hour) { return hour >= QUIET_START || hour < QUIET_END; }
function pushPrefs(row) {
  const b = pushBucket(row);
  if (!b.prefs || typeof b.prefs !== "object") b.prefs = {};
  return b.prefs;
}
function normHour(h) {
  const n = Math.round(Number(h));
  if (!isFinite(n)) return 9;
  return Math.min(QUIET_START - 1, Math.max(QUIET_END, n));
}
function clientOf(row, idn, body) {
  const clients = (row.state && row.state.clients) || [];
  const code = String((body && body.accessCode) || idn.code || "").replace(/\D/g, "").slice(0, 6);
  const cid = String((body && body.clientId) || idn.clientId || "");
  return clients.find((c) => c && ((cid && String(c.id) === cid) || (/^\d{6}$/.test(code) && String(c.accessCode || "") === code))) || null;
}
// Daily reminder (Cron, hourly). Opt-in only (prefs[clientId].daily === true), never in quiet hours,
// once per PR day, skipped if the client already logged today.
async function runDailyReminders(env, nowMs) {
  const row = await rowOf(env, "NIUBI");
  const { day, hour } = prNow(nowMs);
  const out = { ev: "cron_reminder", day, hour, optedIn: 0, due: 0, sent: 0, skipped: 0 };
  if (isQuiet(hour)) { out.quiet = true; console.log(JSON.stringify(out)); return out; }
  const prefs = pushPrefs(row);
  const clients = (row.state && row.state.clients) || [];
  let dirty = false;
  for (const cid of Object.keys(prefs)) {
    const p = prefs[cid];
    if (!p || p.daily !== true) continue;
    out.optedIn += 1;
    if (normHour(p.hour) !== hour || p.lastSent === day) continue;
    const c = clients.find((x) => x && String(x.id) === cid);
    if (!c || c.archived) { out.skipped += 1; continue; }
    if (c.lastSeen === day || (c.lastSession && c.lastSession.date === day)) { out.skipped += 1; continue; }
    out.due += 1;
    const r = await deliverPush(env, row, clientSubs(row, cid, ""), PUSH_TEMPLATES.daily);
    out.sent += r.sent;
    p.lastSent = day; dirty = true;
    if (r.gone) dirty = true;
  }
  if (dirty) await putRow(env, row);
  console.log(JSON.stringify(out));
  return out;
}

// ---- Daily summary (read-only): GET /api/admin/daily-summary[?day=YYYY-MM-DD], PIN header or SUMMARY_TOKEN ----
function safeEq(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function prDayRange(day) {
  const [y, m, d] = day.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d, 4); // America/Puerto_Rico = UTC-4, no DST
  return [start, start + 86400000];
}
async function dailySummary(env, day) {
  const row = await rowOf(env, "NIUBI");
  const st = row.state || {};
  const [t0, t1] = prDayRange(day);
  const inDay = (v) => {
    if (v == null || v === "") return false;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10) === day;
    const n = Number(v);
    return isFinite(n) && n >= t0 && n < t1;
  };
  const clients = (st.clients || []).filter(Boolean);
  const active = clients.filter((c) => inDay(c.lastSeen) || (c.lastSession && inDay(c.lastSession.date)));
  const sessClients = clients.filter((c) => c.lastSession && inDay(c.lastSession.date));
  const studioSessions = (st.history || []).filter((h) => h && inDay(h.date));
  const leads = (st.inbox || []).filter((n) => n && n.type === "lead" && inDay(n.at));
  const pays = (st.payments || []).filter((p) => p && inDay(p.date || p.at || p.paidAt));
  const sum = pays.reduce((n, p) => n + (Number(String(p.amount || "").replace(/[^0-9.]/g, "")) || 0), 0);
  const errors = { total: 0, distinct: 0, top: [], source: "none" };
  if (dbMode(env) !== "kv" && env.DB) {
    try {
      const rs = await env.DB.prepare("SELECT src, kind, msg, n FROM logs WHERE t >= ? AND t < ? ORDER BY n DESC").bind(t0, t1).all();
      const items = rs.results || [];
      errors.source = "d1";
      errors.distinct = items.length;
      errors.total = items.reduce((n, r) => n + (Number(r.n) || 1), 0);
      errors.top = items.slice(0, 5).map((r) => ({ n: Number(r.n) || 1, where: String(r.src || ""), kind: String(r.kind || ""), msg: String(r.msg || "").slice(0, 140) }));
    } catch (e) { errors.source = "error"; }
  }
  return {
    ok: true, day, tz: PUSH_TZ, generatedAt: new Date().toISOString(),
    activeClients: { count: active.length, names: active.map((c) => String(c.name || "").split(" ")[0]).slice(0, 50) },
    sessionsLogged: { clients: sessClients.length, studioDevice: studioSessions.length, total: sessClients.length + studioSessions.length },
    newLeads: { count: leads.length, items: leads.slice(0, 20).map((n) => ({ name: String(n.name || "").split(" ")[0], plan: String(n.plan || "") })) },
    payments: { count: pays.length, totalUsd: Math.round(sum * 100) / 100, items: pays.slice(0, 20).map((p) => ({ plan: String(p.plan || ""), amount: String(p.amount || ""), method: String(p.method || ""), status: String(p.status || "") })) },
    errors,
    totals: { clients: clients.length }
  };
}

async function handle(req, env) {
  globalThis.__NB_PREVIEW = !!(env && env.NB_PREVIEW === "1");
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method.toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization, X-Nb-Pin"
      }
    });
  }
  if (!env || !env.STUDIO) return json({ error: "Falta el KV STUDIO" }, 500);
  if (path === "/api/health" && url.searchParams.get("db") === "1") {
    let d1 = null;
    try { d1 = env.DB ? (await env.DB.prepare("SELECT COUNT(*) AS n FROM studios").first()).n : null; } catch (e) { d1 = "error"; }
    return json({ ok: true, mode: dbMode(env), d1Studios: d1 });
  }
  const limited = await rateLimited(req, env, path, method);
  if (limited) return limited;
  if (path === "/api/rl-test") return json({ ok: true, probe: true });
  if (path === "/api/log" || path === "/api/log/summary") return handleLog(req, env, url, method);
  if (path === "/" || path === "/api/health" || path === "/health") return json({ ok: true, db: dbMode(env), v: 36, push: !!(env && env.VAPID_PUBLIC_KEY) });

  if ((path === "/api/auth/login" || path === "/api/login") && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const row = await rowOf(env, "NIUBI");
    pruneSessions(row);
    const role = String(body.role || "").toLowerCase() === "coach" ? "coach" : "client";
    const key = role === "coach" ? "coach" : ("c:" + String(body.code || "").replace(/\D/g, ""));
    if (rateBlocked(row, key)) {
      return json({ error: "Demasiados intentos. Espere 15 minutos." }, 429);
    }
    if (role === "coach") {
      if (!(pinMatch(env, body.pin))) {
        rateHit(row, "coach");
        await putRow(env, row);
        return json({ error: "Clave incorrecta" }, 403);
      }
      if (totpOn(env)) {
        if (!body.totp) return json({ error: "Falta el código de verificación", totp: true }, 401);
        if (!(await totpOk(env.COACH_TOTP_SECRET, body.totp))) {
          rateHit(row, "coach");
          await putRow(env, row);
          return json({ error: "Código de verificación incorrecto", totp: true }, 401);
        }
      }
      rateClear(row, "coach");
      const token = newToken();
      row.sessions[token] = { role: "coach", exp: Date.now() + SESSION_RULES.coach.abs, last: Date.now() };
      await putRow(env, row);
      return json({ ok: true, role: "coach", token, exp: row.sessions[token].exp, studioToken: token });
    }
    const digits = String(body.code || "").replace(/\D/g, "");
    if (digits.length !== 6) return json({ error: "Código de 6 dígitos" }, 400);
    const dead = new Set(((row.state && row.state.revoked) || []).map((r) => String(r.code || "")));
    const deadIds = new Set(((row.state && row.state.revoked) || []).map((r) => String(r.clientId || "")).filter(Boolean));
    const hit = ((row.state && row.state.clients) || []).find((c) => String(c.accessCode || "") === digits);
    if (!hit || dead.has(digits) || (hit.id && deadIds.has(String(hit.id)))) {
      rateHit(row, key);
      await putRow(env, row);
      return json({ error: "Código no válido o anulado" }, 404);
    }
    if (hit.unpaid) {
      return json({ error: "Pago pendiente" }, 403);
    }
    rateClear(row, key);
    dropSessions(row, (s) => s && s.role === "client" && s.clientId === hit.id);
    const token = newToken();
    row.sessions[token] = {
      role: "client",
      clientId: hit.id,
      code: digits,
      exp: Date.now() + SESSION_RULES.client.abs,
      last: Date.now()
    };
    await putRow(env, row);
    return json({
      ok: true,
      role: "client",
      token,
      exp: row.sessions[token].exp,
      clientId: hit.id,
      client: {
        id: hit.id,
        name: hit.name,
        plan: hit.plan,
        routine: hit.routine,
        accessCode: hit.accessCode,
        unpaid: false,
        sex: hit.sex,
        age: hit.age,
        phone: hit.phone
      }
    });
  }

  if ((path === "/api/auth/me" || path === "/api/me") && method === "GET") {
    const idn = await identity(req, env, url);
    if (!idn.role) return json({ error: "Sesión vencida" }, 401);
    return json({ ok: true, role: idn.role, clientId: idn.clientId || "", exp: idn.row.sessions && idn.row.sessions[idn.token] && idn.row.sessions[idn.token].exp });
  }

  if ((path === "/api/auth/logout" || path === "/api/logout") && method === "POST") {
    const idn = await identity(req, env, url);
    if (idn.token && idn.row.sessions) delete idn.row.sessions[idn.token];
    await putRow(env, idn.row);
    return json({ ok: true });
  }


  if (path === "/api/admin/daily-summary" && method === "GET") {
    const tok = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const okPin = pinOk(env, String(req.headers.get("x-nb-pin") || ""));
    const okTok = !!(env && env.SUMMARY_TOKEN) && safeEq(tok, String(env.SUMMARY_TOKEN));
    if (!okPin && !okTok) return json({ error: "No autorizado" }, 401);
    let day = String(url.searchParams.get("day") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = prNow(Date.now() - 86400000).day;
    return json(await dailySummary(env, day), 200, { "cache-control": "no-store" });
  }

  if (path === "/api/push/prefs") {
    const idn = await identity(req, env, url);
    const body = method === "POST" ? await req.json().catch(() => ({})) : {};
    const c = clientOf(idn.row, idn, body);
    if (idn.role !== "client" || !c) return json({ error: "Auth de cliente requerida" }, 401);
    const prefs = pushPrefs(idn.row);
    if (method === "POST") {
      const cur = prefs[c.id] || {};
      prefs[c.id] = { daily: body.daily === true, hour: normHour(body.hour != null ? body.hour : cur.hour), lastSent: cur.lastSent || "", at: Date.now() };
      await putRow(env, idn.row);
    }
    const p = prefs[c.id] || { daily: false, hour: 9 };
    return json({ ok: true, daily: p.daily === true, hour: normHour(p.hour), quiet: [QUIET_START, QUIET_END], tz: PUSH_TZ });
  }

  if (path === "/api/push/send" && method === "POST") {
    const idn = await identity(req, env, url);
    if (idn.role !== "coach") return json({ error: "Auth de coach requerida" }, 401);
    const body = await req.json().catch(() => ({}));
    const tpl = PUSH_TEMPLATES[body.kind === "plan" ? "plan" : body.kind === "today" ? "today" : ""];
    if (!tpl) return json({ error: "Tipo de aviso inválido" }, 400);
    const self = body.target === "self";
    const { hour } = prNow();
    if (!self && isQuiet(hour)) return json({ error: "Horario silencioso (9 PM a 8 AM). Intente más tarde.", code: "quiet" }, 409);
    let targets;
    if (self) targets = coachSubs(idn.row);
    else {
      const c = ((idn.row.state && idn.row.state.clients) || []).find((x) => x && String(x.id) === String(body.clientId || ""));
      if (!c) return json({ error: "Cliente no encontrado" }, 404);
      targets = clientSubs(idn.row, c.id, c.accessCode);
    }
    if (!targets.length) return json({ ok: false, sent: 0, error: self ? "Este equipo no tiene avisos activos" : "El cliente no tiene avisos activos", code: "nosubs" }, 200);
    const payload = self ? Object.assign({}, tpl, { title: "Prueba · " + tpl.title, tag: tpl.tag + "-test" }) : tpl;
    const r = await deliverPush(env, idn.row, targets, payload);
    if (r.gone) await putRow(env, idn.row);
    return json({ ok: r.sent > 0, sent: r.sent, gone: r.gone });
  }

  if (path === "/api/push/vapid" && method === "GET") {
    const vapid = vapidCfg(env);
    if (!vapid) return json({ ok: false, error: "VAPID no configurado" }, 503);
    return json({ ok: true, publicKey: vapid.publicKey, subject: vapid.subject });
  }

  if (path === "/api/push/subscribe" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const sub = normSub(body.subscription || body);
    if (!sub) return json({ error: "Suscripción inválida" }, 400);
    const idn = await identity(req, env, url);
    const row = idn.row;
    const bucket = pushBucket(row);
    const wantCoach = String(body.role || sub.role || idn.role || "").toLowerCase() === "coach";
    const pinMatches = pinOk(env, pinOf(req, url, body));
    if (wantCoach || idn.role === "coach") {
      if (idn.role !== "coach" && !pinMatches) return json({ error: "Auth de coach requerida" }, 401);
      bucket.coach = upsertSub(bucket.coach, sub);
      await putRow(env, row);
      return json({ ok: true, role: "coach" });
    }
    const code = String(body.accessCode || sub.accessCode || idn.code || "").replace(/\D/g, "").slice(0, 6);
    const cid = String(body.clientId || sub.clientId || idn.clientId || "");
    const clients = (row.state && row.state.clients) || [];
    const living = clients.find((c) => {
      if (!c) return false;
      if (cid && String(c.id) === cid) return true;
      if (/^\d{6}$/.test(code) && String(c.accessCode || "") === code) return true;
      return false;
    });
    const clientOk = idn.role === "client" || !!living;
    if (!clientOk) return json({ error: "Auth de cliente requerida" }, 401);
    const clientId = String((living && living.id) || cid || idn.clientId || "");
    if (!clientId) return json({ error: "Falta clientId" }, 400);
    bucket.clients[clientId] = upsertSub(bucket.clients[clientId], sub);
    await putRow(env, row);
    return json({ ok: true, role: "client", clientId });
  }

  if ((path === "/api/push/unsubscribe" || path === "/api/push/unsub") && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const endpoint = String((body.subscription && body.subscription.endpoint) || body.endpoint || "").trim();
    if (!endpoint) return json({ error: "Falta endpoint" }, 400);
    const idn = await identity(req, env, url);
    dropEndpoint(idn.row, endpoint);
    await putRow(env, idn.row);
    return json({ ok: true });
  }

  if (path === "/api/studio") {
    let body = {};
    if (method === "POST") body = await req.json().catch(() => ({}));
    let key = String(body.studioKey || url.searchParams.get("key") || "NIUBI").toUpperCase();
    if (!pinOk(env, pinOf(req, url, body))) return json({ error: "PIN de estudio requerido" }, 403);
    const row = await rowOf(env, key || "NIUBI");
    pruneSessions(row);
    const token = newToken();
    row.sessions = row.sessions || {};
    row.sessions[token] = { role: "coach", exp: Date.now() + SESSION_RULES.coach.abs, last: Date.now() };
    await putRow(env, row);
    return json({ ok: true, token, exp: row.sessions[token].exp });
  }

  if (path === "/api/export" && method === "GET") {
    const row = await rowOf(env, "NIUBI");
    const pinMatches = pinOk(env, pinOf(req, url, {})); // x-nb-pin (no ?pin=)
    const eid = await identity(req, env, url);
    if (!pinMatches && eid.role !== "coach") return json({ error: "No" }, 403);
    return json({
      ok: true,
      studioKey: "NIUBI",
      updatedAt: (row.state && row.state.updatedAt) || Date.now(),
      state: row.state || {}
    });
  }

  if (path === "/api/state" && method === "GET") {
    const idn = await identity(req, env, url);
    if (idn.role !== "coach") return json({ error: "Estudio no encontrado" }, 404);
    return json({ ok: true, state: idn.row.state || {} });
  }

  if (path === "/api/state" && method === "PUT") {
    const idn = await identity(req, env, url);
    if (idn.role !== "coach") return json({ error: "Estudio no encontrado" }, 404);
    const body = await req.json().catch(() => ({}));
    const prevPr = ((idn.row.state && idn.row.state.programRequests) || []).slice();
    idn.row.state = mergeStudio(idn.row.state || {}, body);
    await putRow(env, idn.row);
    try {
      const nextPr = (idn.row.state && idn.row.state.programRequests) || [];
      for (const r of nextPr) {
        if (!r || r.status !== "approved") continue;
        const was = prevPr.find((x) => x && x.id === r.id);
        if (was && was.status === "approved") continue;
        const label = String(r.routineName || r.routineId || "programa").slice(0, 40);
        await notifyClient(env, idn.row, r.clientId, r.accessCode, "Programa listo", "Miguel te asignó " + label + ".", "/?view=work", "nb-aprobado");
      }
    } catch (e) {}
    return json({ ok: true, state: idn.row.state });
  }

  if (path === "/api/redeem") {
    let code = url.searchParams.get("code") || "";
    if (method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.code) code = String(body.code);
    }
    const digits = String(code).replace(/\D/g, "");
    const row = await rowOf(env, "NIUBI");
    const dead = new Set(((row.state && row.state.revoked) || []).map((r) => String(r.code || "")));
    if (dead.has(digits)) return json({ error: "Código anulado" }, 404);
    const list = (row.state && row.state.clients) || [];
    const hit = list.find((c) => String(c.accessCode || "") === digits);
    if (!hit) return json({ error: "Código no válido" }, 404);
    if (hit.unpaid) return json({ error: "Pago pendiente" }, 403);
    const library = {
      customRoutines: (row.state && row.state.customRoutines) || [],
      routineEdits: (row.state && row.state.routineEdits) || {}
    };
    return json({ ok: true, client: hit, library });
  }

  if (path === "/api/lead" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const c = body.client || {};
    if (!c.name) return json({ error: "Falta el nombre" }, 400);
    const row = await rowOf(env, "NIUBI");
    pruneSessions(row);
    const leadKey = "lead:" + clientIp(req);
    if (rateBlocked(row, leadKey)) {
      return json({ error: "Demasiados intentos. Espere 15 minutos." }, 429);
    }
    rateHit(row, leadKey, 30);
    const revoked = (row.state && row.state.revoked) || [];
    const deadIds = new Set(revoked.map((r) => String(r.clientId || "")).filter(Boolean));
    let cid = String(c.id || "c" + Date.now());
    if (deadIds.has(cid)) cid = "c" + Date.now();
    const client = {
      id: cid,
      name: String(c.name).slice(0, 80),
      plan: String(c.plan || "Estandar"),
      unpaid: c.unpaid !== false,
      sex: c.sex || "",
      age: c.age || "",
      phone: String(c.phone || ""),
      email: String(c.email || "")
    };
    if (c.health && typeof c.health === "object" && (c.health.date || c.health.name)) client.health = c.health;
    if (c.waiver && typeof c.waiver === "object" && (c.waiver.date || c.waiver.signature)) client.waiver = c.waiver;
    if (c.contract && typeof c.contract === "object" && (c.contract.date || c.contract.signature)) client.contract = c.contract;
    const inbox = (row.state && row.state.inbox) || [];
    const dup = inbox.some((n) => n && n.clientId === client.id && (Date.now() - (n.at || 0) < 30 * 60 * 1000));
    row.state = mergeStudio(row.state || {}, {
      _op: "lead",
      clients: [client],
      contracts: client.contract ? [Object.assign({ clientId: client.id }, client.contract)] : [],
      inbox: dup ? [] : [{ id: "in" + Date.now(), type: "lead", name: client.name, plan: client.plan, at: Date.now(), clientId: client.id }]
    });
    await putRow(env, row);
    await notifyCoach(env, row, "Lead NiuBision", (client.name || "Cliente") + " firmó. Confirme el pago.", "/?view=inbox", "nb-lead");
    return json({ ok: true, state: { inbox: row.state.inbox } });
  }

  if (path === "/api/pay" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const row = await rowOf(env, "NIUBI");
    pruneSessions(row);
    const payKey = "pay:" + clientIp(req);
    if (rateBlocked(row, payKey)) {
      return json({ error: "Demasiados intentos. Espere 15 minutos." }, 429);
    }
    rateHit(row, payKey, 30);
    if (isFounderPlan(body.plan) && !founderAllowed(row.state, String(body.clientId || ""))) return json({ error: "cupos_fundador_agotados" }, 409);
    const invoice = String(body.invoice || body.id || ("p" + Date.now()));
    const payPhone = String(body.phone || "");
    const payment = {
      id: invoice,
      invoice,
      ref: String(body.ref || ("NB-" + invoice.replace(/\D/g, "").slice(-6))),
      date: new Date().toISOString().slice(0, 10),
      plan: body.plan || "",
      amount: body.amount || "",
      method: body.method || "",
      status: "iniciado",
      name: body.name || "Cliente",
      clientId: body.clientId || "",
      phone: payPhone,
      email: body.email || ""
    };
    const inbox = (row.state && row.state.inbox) || [];
    const phoneDigits = payPhone.replace(/\D/g, "");
    const dupPay = inbox.some((n) => n && n.type === "pay" && (
      (payment.clientId && n.clientId === payment.clientId)
      || (phoneDigits.length >= 10 && String(n.phone || "").replace(/\D/g, "") === phoneDigits)
      || (payment.name && String(n.name || "").toLowerCase() === String(payment.name).toLowerCase())
    ) && String(n.amount || "") === String(payment.amount || "") && (Date.now() - (n.at || 0) < 30 * 60 * 1000));
    row.state = mergeStudio(row.state || {}, {
      _op: "pay",
      payments: [payment],
      inbox: dupPay ? [] : [{ id: "in" + Date.now(), type: "pay", name: payment.name, plan: payment.plan, at: Date.now(), clientId: payment.clientId, phone: payPhone, amount: payment.amount, method: payment.method, invoice: payment.invoice, ref: payment.ref }]
    });
    await putRow(env, row);
    await notifyCoach(env, row, "Pago NiuBision", (payment.name || "Cliente") + " · " + (payment.amount || "") + " USD", "/?view=inbox", "nb-pay");
    return json({ ok: true });
  }

  if (path === "/api/receipt" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    await mailReceipt(body);
    return json({ ok: true });
  }

  if (path === "/api/paypal" && method === "POST") {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    const raw = await req.text();
    const row = await rowOf(env, "NIUBI");
    if (ct.indexOf("json") >= 0) {
      const body = JSON.parse(raw || "{}");
      if (isFounderPlan(body.plan) && !founderAllowed(row.state, String(body.clientId || ""))) return json({ error: "cupos_fundador_agotados" }, 409);
      const invoice = String(body.invoice || body.id || ("p" + Date.now()));
      const payment = {
        id: invoice,
        invoice,
        ref: String(body.ref || ("NB-" + invoice.replace(/\D/g, "").slice(-6))),
        date: new Date().toISOString().slice(0, 10),
        plan: body.plan || "",
        amount: body.amount || "",
        method: "PayPal",
        status: "iniciado",
        name: body.name || "Cliente",
        clientId: body.clientId || "",
        email: body.email || ""
      };
      row.state = mergeStudio(row.state || {}, { _op: "pay", payments: [payment] });
      await putRow(env, row);
      return json({ ok: true });
    }
    const check = await fetch("https://ipnpb.paypal.com/cgi-bin/webscr", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "cmd=_notify-validate&" + raw
    });
    if (String(await check.text()).trim() !== "VERIFIED") return json({ error: "IPN no verificado" }, 400);
    const params = new URLSearchParams(raw);
    if (params.get("payment_status") !== "Completed") return json({ ok: true, skipped: true });
    const invoice = params.get("invoice") || params.get("custom") || "";
    const pay = ((row.state && row.state.payments) || []).find((p) => p.id === invoice || p.invoice === invoice) || {};
    row.state = mergeStudio(row.state || {}, {
      _op: "paid",
      invoice,
      clientId: pay.clientId || "",
      name: pay.name || "",
      amount: params.get("mc_gross") || "",
      method: "PayPal"
    });
    await putRow(env, row);
    const cl = ((row.state && row.state.clients) || []).find((c) => c.id === pay.clientId) || {};
    await mailReceipt({
      date: new Date().toISOString().slice(0, 10),
      name: cl.name || pay.name || params.get("item_name"),
      plan: cl.plan || pay.plan,
      amount: params.get("mc_gross"),
      method: "PayPal",
      status: "recibido",
      accessCode: cl.accessCode,
      email: cl.email || params.get("payer_email")
    });
    if (cl.id || cl.accessCode) {
      await notifyClient(env, row, cl.id, cl.accessCode, "Código listo", "Pago recibido. Su acceso ya está activo.", "/?view=work", "nb-code");
    }
    await notifyCoach(env, row, "Pago PayPal", (cl.name || pay.name || "Cliente") + " · " + (params.get("mc_gross") || "") + " USD", "/?view=inbox", "nb-pay");
    return json({ ok: true });
  }

  // ---- Stripe Checkout (además de PayPal y ATH; ver cloud/stripe.js) ----
  if (path === "/api/stripe/config" && method === "GET") {
    const mode = stripeMode(env);
    return json({ enabled: mode === "test" || mode === "live", mode });
  }
  if (path === "/api/founder" && method === "GET") {
    const row = await rowOf(env, "NIUBI");
    return json({ plan: "NiuBision Estándar · Precio fundador", price: "110.38", limit: FOUNDER_LIMIT, left: founderLeft(row.state) }, 200, { "cache-control": "public, max-age=60" });
  }
  if (path === "/api/stripe/checkout" && method === "POST") {
    const mode = stripeMode(env);
    if (mode === "rejected") return json({ error: "Stripe solo acepta llaves de prueba aquí" }, 400);
    if (mode === "off") return json({ error: "Pago con tarjeta no disponible" }, 501);
    const body = await req.json().catch(() => ({}));
    if (isFounderPlan(body.plan)) { const frow = await rowOf(env, "NIUBI"); if (!founderAllowed(frow.state, String(body.clientId || ""))) return json({ error: "cupos_fundador_agotados" }, 409); }
    let out;
    try { out = await stripeCheckout(env, body, String(env.APP_URL || "https://niubision.app").replace(/\/$/, "")); }
    catch (e) { return json({ error: e.message || "stripe_error" }, e.status === 400 ? 400 : 502); }
    const invoice = String(body.invoice || "").replace(/[^\w-]/g, "").slice(0, 40);
    const row = await rowOf(env, "NIUBI");
    row.state = mergeStudio(row.state || {}, { _op: "pay", payments: [{
      id: invoice, invoice, ref: String(body.ref || ("NB-" + invoice.replace(/\D/g, "").slice(-6))),
      date: new Date().toISOString().slice(0, 10), plan: out.plan, amount: out.amount, method: "Tarjeta (Stripe)",
      status: "iniciado", name: body.name || "Cliente", clientId: body.clientId || "", email: body.email || "", stripeSession: out.id
    }] });
    await putRow(env, row);
    return json({ ok: true, url: out.url, amount: out.amount, plan: out.plan });
  }
  if (path === "/api/stripe/webhook" && method === "POST") {
    const mode = stripeMode(env);
    if ((mode !== "test" && mode !== "live") || !env.STRIPE_WEBHOOK_SECRET) return json({ error: "stripe_inactivo" }, 501);
    const raw = await req.text();
    if (!await stripeVerify(env.STRIPE_WEBHOOK_SECRET, raw, req.headers.get("stripe-signature"))) return json({ error: "firma_invalida" }, 400);
    let ev; try { ev = JSON.parse(raw); } catch (e) { return json({ error: "json" }, 400); }
    if (!!ev.livemode !== (mode === "live")) return json({ error: "modo_incorrecto" }, 400);
    const seenKey = "stripe_evt:" + ev.id;
    if (env.STUDIO && await env.STUDIO.get(seenKey)) return json({ ok: true, duplicate: true });
    if (env.STUDIO) await env.STUDIO.put(seenKey, "1", { expirationTtl: 7 * 24 * 3600 });
    const o = (ev.data && ev.data.object) || {};
    const meta = o.metadata || {};
    const invoice = String(meta.invoice || o.client_reference_id || "");
    const row = await rowOf(env, "NIUBI");
    const pay = ((row.state && row.state.payments) || []).find((p) => invoice && (p.id === invoice || p.invoice === invoice)) || {};
    if ((ev.type === "checkout.session.completed" && o.payment_status === "paid") || ev.type === "checkout.session.async_payment_succeeded") {
      const amount = String(((o.amount_total || 0) / 100).toFixed(2)).replace(/\.00$/, "");
      row.state = mergeStudio(row.state || {}, { _op: "paid", invoice, clientId: pay.clientId || meta.clientId || "", name: pay.name || meta.name || "", amount, method: "Tarjeta (Stripe)" });
      await putRow(env, row);
      const cl = ((row.state && row.state.clients) || []).find((c) => c.id === (pay.clientId || meta.clientId)) || {};
      await mailReceipt({ date: new Date().toISOString().slice(0, 10), name: cl.name || pay.name || meta.name, plan: cl.plan || pay.plan || meta.plan, amount, method: "Tarjeta (Stripe)", status: "recibido", accessCode: cl.accessCode, email: cl.email || (o.customer_details && o.customer_details.email) });
      if (cl.id || cl.accessCode) await notifyClient(env, row, cl.id, cl.accessCode, "Código listo", "Pago recibido. Su acceso ya está activo.", "/?view=work", "nb-code");
      await notifyCoach(env, row, "Pago con tarjeta", (cl.name || pay.name || meta.name || "Cliente") + " · " + amount + " USD", "/?view=inbox", "nb-pay");
      return json({ ok: true, paid: invoice });
    }
    if (ev.type === "checkout.session.async_payment_failed" || ev.type === "payment_intent.payment_failed" || ev.type === "checkout.session.expired") {
      if (invoice && pay.id) {
        row.state = mergeStudio(row.state || {}, { _op: "pay", payments: [Object.assign({}, pay, { status: ev.type === "checkout.session.expired" ? "sin completar" : "fallido" })] });
        await putRow(env, row);
      }
      return json({ ok: true, status: ev.type });
    }
    if (ev.type === "charge.refunded") return json({ ok: true, ignored: "reembolso: revíselo en Stripe" });
    return json({ ok: true, ignored: ev.type });
  }

  if (path === "/api/paid" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const idn = await identity(req, env, url);
    if (idn.role !== "coach" && !pinOk(env, pinOf(req, url, body))) {
      return json({ error: "Estudio no encontrado" }, 404);
    }
    const row = idn.row;
    row.state = mergeStudio(row.state || {}, {
      _op: "paid",
      clientId: String(body.clientId || ""),
      invoice: String(body.invoice || ""),
      method: body.method || "",
      amount: body.amount || "",
      name: body.name || "",
      phone: body.phone || "",
      plan: body.plan || "",
      accessCode: String(body.accessCode || "").replace(/\D/g, "").slice(0, 6)
    });
    const phone = String(body.phone || "").replace(/\D/g, "");
    const hit = ((row.state && row.state.clients) || []).find((c) =>
      (body.clientId && c.id === String(body.clientId)) ||
      (phone.length >= 10 && String(c.phone || "").replace(/\D/g, "") === phone)
    );
    await putRow(env, row);
    const codeOut = hit && hit.accessCode;
    if (hit) {
      await notifyClient(env, row, hit.id, codeOut, "Código listo", "Su código de acceso ya está activo. Ábralo en NiuBision.", "/?view=work", "nb-code");
      await notifyCoach(env, row, "Código emitido", (hit.name || body.name || "Cliente") + " · " + (codeOut || ""), "/?view=inbox", "nb-code-coach");
    }
    return json({ ok: true, accessCode: codeOut, clientId: hit && hit.id });
  }

  if (path === "/api/revoke" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const idn = await identity(req, env, url);
    if (idn.role !== "coach" && !pinOk(env, pinOf(req, url, body))) {
      return json({ error: "Estudio no encontrado" }, 404);
    }
    const row = idn.row;
    const cid = String(body.clientId || "");
    const code = String(body.code || "").replace(/\D/g, "");
    row.state = mergeStudio(row.state || {}, {
      _op: "revoke",
      revoked: [{ code, clientId: cid, at: Date.now() }]
    });
    dropSessions(row, (s) => s && ((cid && s.clientId === cid) || (code && s.code === code)));
    await putRow(env, row);
    return json({ ok: true });
  }

  if (path === "/api/program-request" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const reqRow = body.request || body;
    if (!reqRow || !reqRow.id || !reqRow.routineId) return json({ error: "Falta el pedido" }, 400);
    const row = await rowOf(env, "NIUBI");
    const code = String(reqRow.accessCode || "").replace(/\D/g, "").slice(0, 6);
    if (!/^\d{6}$/.test(code)) return json({ error: "Código de acceso requerido" }, 401);
    const clients = (row.state && row.state.clients) || [];
    const revoked = (row.state && row.state.revoked) || [];
    const deadCodes = new Set(revoked.map((r) => String(r.code || "")).filter(Boolean));
    const deadIds = new Set(revoked.map((r) => String(r.clientId || "")).filter(Boolean));
    const living = clients.find((c) => {
      if (!c || String(c.accessCode || "") !== code) return false;
      if (c.id && deadIds.has(String(c.id))) return false;
      if (deadCodes.has(code)) return false;
      return true;
    });
    if (!living) return json({ error: "Cliente no encontrado o código anulado" }, 404);
    const clientId = String(reqRow.clientId || living.id || "");
    const note = {
      id: "in" + Date.now(),
      type: "program_req",
      name: String(reqRow.name || living.name || "Cliente").slice(0, 80),
      clientId,
      accessCode: code,
      routineId: String(reqRow.routineId || ""),
      routineName: String(reqRow.routineName || ""),
      at: Date.now(),
      reqId: String(reqRow.id)
    };
    row.state = mergeStudio(row.state || {}, {
      programRequests: [Object.assign({}, reqRow, {
        status: reqRow.status || "pending",
        at: reqRow.at || Date.now(),
        accessCode: code,
        clientId,
        name: note.name
      })],
      inbox: [note]
    });
    await putRow(env, row);
    await notifyCoach(env, row, "Pedir programa", note.name + " pide " + (note.routineName || note.routineId || "programa"), "/?view=inbox", "nb-pedir");
    return json({ ok: true });
  }

  if (path === "/api/report" && (method === "POST" || method === "PUT")) {
    const body = await req.json().catch(() => ({}));
    const idn = await identity(req, env, url);
    const code = String(body.accessCode || idn.code || "").replace(/\D/g, "").slice(0, 6);
    const clientId = String(body.clientId || idn.clientId || "");
    const byCode = code && ((idn.row.state && idn.row.state.clients) || []).some((c) => String(c.accessCode || "") === code);
    const allowed = idn.role === "coach"
      || (idn.role === "client" && ((clientId && idn.clientId === clientId) || (code && idn.code === code)));
    void byCode; // ya no basta con conocer un código: hace falta sesión
    if (!allowed) return json({ error: "Sesión requerida" }, 401);
    idn.row.state = mergeStudio(idn.row.state || {}, {
      _op: "report",
      clients: [{
        id: clientId,
        accessCode: code,
        report: Object.assign({}, body.report || {}, { updatedAt: Date.now() })
      }]
    });
    await putRow(env, idn.row);
    return json({ ok: true });
  }

  return json({ error: "No encontrado" }, 404);
}

export { b32decode, totpAt, totpOk, sessionAlive, SESSION_RULES, safeEq, pinOk, pinMatch };
export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      let path = "";
      try { path = new URL(request.url).pathname; } catch (e) {}
      console.error(JSON.stringify({ level: "error", ev: "worker_exception", path, method: request.method, msg: String(err && err.message || err).slice(0, 300), stack: String(err && err.stack || "").slice(0, 1500) }));
      return json({ error: String(err && err.message ? err.message : err) }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    try { await runDailyReminders(env, event && event.scheduledTime); }
    catch (err) { console.error(JSON.stringify({ level: "error", ev: "cron_exception", msg: String(err && err.message || err).slice(0, 300) })); }
  }
};

function nbIvu(total) {
  const c = Math.round(Number(String(total || "").replace(/[^\d.]/g, "")) * 100);
  if (!c) return null;
  const b = Math.round(c * 1000 / 1115);
  return { base: (b / 100).toFixed(2), ivu: ((c - b) / 100).toFixed(2) };
}
