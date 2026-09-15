#!/usr/bin/env node
/**
 * NiuBision studio API — real backend for niubision.com
 * Run: node cloud/server.mjs
 * Env: PORT, DATABASE_URL (Neon/Postgres). Without DATABASE_URL uses ./studio-data.json
 */
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const FILE = process.env.STUDIO_FILE || join(process.cwd(), "studio-data.json");
const FIXED_TOKEN = "nb-cloud-v1";

function token() {
  return randomBytes(32).toString("hex");
}

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
  const keyOf = (c) => {
    if (c.id) return "id:" + c.id;
    if (c.accessCode) return "a:" + c.accessCode;
    if (c.phone) return "p:" + String(c.phone).replace(/\D/g, "");
    return "n:" + String(c.name || "").toLowerCase();
  };
  const alive = (c) => {
    if (!c) return false;
    if (c.id && deadIds.has(String(c.id))) return false;
    if (c.accessCode && dead.has(String(c.accessCode))) return false;
    return true;
  };
  if (op === "paid") {
    const invoice = String(b.invoice || "");
    const clientId = String(b.clientId || "");
    const payments = (a.payments || []).map((p) => {
      if ((invoice && (p.id === invoice || p.invoice === invoice)) || (clientId && p.clientId === clientId && p.status !== "recibido")) {
        return Object.assign({}, p, { status: "recibido", method: b.method || p.method, amount: b.amount || p.amount });
      }
      return p;
    });
    const used = new Set((a.clients || []).map((c) => String(c.accessCode || "")));
    const gen = () => {
      for (let i = 0; i < 40; i++) {
        const n = String(100000 + Math.floor(Math.random() * 900000));
        if (!used.has(n)) return n;
      }
      return String(100000 + Math.floor(Math.random() * 900000));
    };
    const clients = (a.clients || []).map((c) => {
      const hit = (clientId && c.id === clientId) || (b.name && String(c.name || "").toLowerCase() === String(b.name || "").toLowerCase());
      if (!hit) return c;
      const code = /^\d{6}$/.test(String(c.accessCode || "")) ? c.accessCode : gen();
      used.add(code);
      return Object.assign({}, c, { unpaid: false, accessCode: code });
    });
    return Object.assign({}, a, { clients, payments, revoked, updatedAt: Date.now() });
  }
  if (op === "report") {
    const clients = (a.clients || []).map((c) => {
      const hit = (b.clients || []).find((x) => (c.id && x.id === c.id) || (c.accessCode && x.accessCode === c.accessCode));
      if (!hit || !hit.report) return c;
      const prevAt = (c.report && c.report.updatedAt) || 0;
      const nextAt = hit.report.updatedAt || 0;
      if (nextAt < prevAt) return c;
      return Object.assign({}, c, { report: hit.report, lastSession: hit.report.lastSession || c.lastSession });
    });
    return Object.assign({}, a, { clients, revoked, updatedAt: Date.now() });
  }
  if (op === "revoke") {
    return Object.assign({}, a, { clients: (a.clients || []).filter(alive), revoked, updatedAt: Date.now() });
  }
  const map = new Map();
  (a.clients || []).filter(alive).forEach((c) => map.set(keyOf(c), c));
  (b.clients || []).filter(alive).forEach((c) => {
    const prevC = map.get(keyOf(c)) || {};
    map.set(keyOf(c), Object.assign({}, prevC, c, {
      report: (c.report && (c.report.updatedAt || 0) >= ((prevC.report && prevC.report.updatedAt) || 0)) ? c.report : prevC.report,
    }));
  });
  const inboxMap = new Map();
  [].concat(a.inbox || [], b.inbox || []).forEach((item) => {
    if (!item) return;
    inboxMap.set(String(item.id || item.type + item.clientId + item.at), item);
  });
  const payMap = new Map();
  [].concat(a.payments || [], b.payments || []).forEach((p) => {
    if (!p) return;
    payMap.set(String(p.id || p.date + p.name), Object.assign({}, payMap.get(String(p.id || p.date + p.name)) || {}, p));
  });
  const out = Object.assign({}, a, op === "lead" || op === "pay" ? {} : b, {
    clients: Array.from(map.values()),
    revoked,
    inbox: Array.from(inboxMap.values()).sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 80),
    payments: Array.from(payMap.values()).slice(-200),
    updatedAt: Date.now(),
  });
  delete out._op;
  return out;
}

let pool = null;
async function pgReady() {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  if (pool) return true;
  const pg = await import("pg");
  const Pg = pg.default || pg;
  pool = new Pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await pool.query(`create table if not exists studios (
    studio_key text primary key,
    token text not null,
    state jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  )`);
  return true;
}

async function load() {
  if (await pgReady()) {
    const { rows } = await pool.query("select studio_key, token, state from studios");
    return {
      studios: rows.map((r) => ({
        id: r.studio_key,
        studioKey: r.studio_key,
        token: r.token,
        state: r.state || {},
      })),
    };
  }
  try {
    const d = JSON.parse(readFileSync(FILE, "utf8"));
    if (d && Array.isArray(d.studios)) return d;
  } catch {
    /* empty */
  }
  return { studios: [] };
}

async function save(data) {
  if (await pgReady()) {
    for (const s of data.studios || []) {
      await pool.query(
        `insert into studios (studio_key, token, state, updated_at)
         values ($1, $2, $3::jsonb, now())
         on conflict (studio_key) do update set token = $2, state = $3::jsonb, updated_at = now()`,
        [s.studioKey, s.token, JSON.stringify(s.state || {})]
      );
    }
    return;
  }
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(data));
}

async function studioRow(db, key) {
  let row = db.studios.find((s) => s.studioKey === key);
  if (!row) {
    row = { id: key, token: key === "NIUBI" ? FIXED_TOKEN : token(), studioKey: key, state: {} };
    db.studios.push(row);
    await save(db);
  }
  if (key === "NIUBI" && row.token !== FIXED_TOKEN) {
    row.token = FIXED_TOKEN;
    await save(db);
  }
  return row;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("access-control-allow-headers", "Content-Type, Authorization");
  res.setHeader("cache-control", "no-store");
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function bearer(req) {
  const h = String(req.headers.authorization || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : "";
}

const API = ["/api/studio", "/api/state", "/api/redeem", "/api/lead", "/api/report", "/api/pay", "/api/paypal", "/api/revoke", "/api/health", "/health"];

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
  const path = url.pathname.replace(/\/$/, "") || "/";
  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("access-control-allow-headers", "Content-Type, Authorization");
    res.end();
    return;
  }
  if (API.indexOf(path) < 0 && path !== "/") {
    send(res, 404, { error: "No encontrado" });
    return;
  }
  if (path === "/" && method === "GET") {
    send(res, 200, { ok: true, name: "NiuBision API", health: "/api/health" });
    return;
  }
  const db = await load();
  if ((path === "/api/health" || path === "/health") && method === "GET") {
    send(res, 200, { ok: true, db: pool ? "postgres" : existsSync(FILE) ? "file" : "memory" });
    return;
  }
  if (path === "/api/studio" && (method === "GET" || method === "POST")) {
    let key = (url.searchParams.get("key") || url.searchParams.get("studioKey") || "").toUpperCase();
    if (method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (body.studioKey) key = String(body.studioKey).toUpperCase();
      } catch {
        /* ignore */
      }
    }
    if (!key) key = "NIUBI";
    if (!/^[A-Z0-9]{4,12}$/.test(key)) {
      send(res, 400, { error: "Clave de estudio inválida" });
      return;
    }
    const row = await studioRow(db, key);
    send(res, 200, { ok: true, token: row.token });
    return;
  }
  if (path === "/api/state" && method === "GET") {
    const tok = bearer(req) || url.searchParams.get("token") || "";
    const row = db.studios.find((s) => s.token === tok);
    if (!row) {
      send(res, 404, { error: "Estudio no encontrado" });
      return;
    }
    send(res, 200, { ok: true, state: row.state || {} });
    return;
  }
  if (path === "/api/state" && method === "PUT") {
    const tok = bearer(req);
    const row = db.studios.find((s) => s.token === tok);
    if (!row) {
      send(res, 404, { error: "Estudio no encontrado" });
      return;
    }
    const body = JSON.parse((await readBody(req)) || "{}");
    row.state = mergeStudio(row.state || {}, body && typeof body === "object" ? body : {});
    await save(db);
    send(res, 200, { ok: true, state: row.state });
    return;
  }
  if (path === "/api/redeem" && (method === "GET" || method === "POST")) {
    let code = url.searchParams.get("code") || "";
    if (method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (body.code) code = String(body.code);
      } catch {
        /* ignore */
      }
    }
    const raw = String(code).replace(/\s+/g, "");
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 6) {
      for (const s of db.studios) {
        const revoked = (s.state && s.state.revoked) || [];
        const dead = new Set(revoked.map((r) => String(r.code || "")));
        const deadIds = new Set(revoked.map((r) => String(r.clientId || "")));
        if (dead.has(digits)) {
          send(res, 404, { error: "Código anulado" });
          return;
        }
        const list = (s.state && s.state.clients) || [];
        const hit = list.find((c) => String(c.accessCode || "") === digits);
        if (hit && hit.id && deadIds.has(String(hit.id))) {
          send(res, 404, { error: "Código anulado" });
          return;
        }
        if (hit && hit.unpaid) {
          send(res, 403, { error: "Pago pendiente" });
          return;
        }
        if (hit) {
          send(res, 200, { ok: true, token: s.token, client: hit, state: s.state });
          return;
        }
      }
      send(res, 404, { error: "Estudio no encontrado" });
      return;
    }
    send(res, 404, { error: "Estudio no encontrado" });
    return;
  }
  if (path === "/api/lead" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const c = body.client || {};
    if (!String(c.name || "").trim()) {
      send(res, 400, { error: "Falta el nombre" });
      return;
    }
    const row = await studioRow(db, "NIUBI");
    const client = {
      id: String(c.id || "c" + Date.now()),
      name: String(c.name).slice(0, 80),
      plan: String(c.plan || "Estándar").slice(0, 80),
      routine: String(c.routine || "full-inicio"),
      unpaid: c.unpaid !== false,
      phone: String(c.phone || "").replace(/\D/g, ""),
      email: String(c.email || ""),
      sex: String(c.sex || ""),
      age: Number(c.age) || undefined,
    };
    row.state = mergeStudio(row.state || {}, {
      _op: "lead",
      clients: [client],
      inbox: [{ id: "in" + Date.now(), type: "lead", name: client.name, plan: client.plan, at: Date.now(), clientId: client.id }],
    });
    await save(db);
    send(res, 200, { ok: true, state: row.state });
    return;
  }
  if (path === "/api/report" && (method === "POST" || method === "PUT")) {
    const tok = bearer(req);
    const row = db.studios.find((s) => s.token === tok);
    if (!row) {
      send(res, 404, { error: "Estudio no encontrado" });
      return;
    }
    const body = JSON.parse((await readBody(req)) || "{}");
    const patch = {
      id: body.clientId,
      accessCode: String(body.accessCode || "").replace(/\D/g, "").slice(0, 6),
      report: Object.assign({}, body.report || {}, { updatedAt: Date.now() }),
    };
    row.state = mergeStudio(row.state || {}, { _op: "report", clients: [patch] });
    await save(db);
    send(res, 200, { ok: true, state: row.state });
    return;
  }
  if (path === "/api/pay" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const row = await studioRow(db, "NIUBI");
    const payment = {
      id: String(body.invoice || body.id || ("p" + Date.now())),
      date: new Date().toISOString().slice(0, 10),
      plan: String(body.plan || ""),
      amount: String(body.amount || ""),
      method: String(body.method || ""),
      status: "iniciado",
      name: String(body.name || "Cliente"),
      clientId: String(body.clientId || ""),
      invoice: String(body.invoice || ""),
    };
    row.state = mergeStudio(row.state || {}, {
      _op: "pay",
      payments: [payment],
      inbox: [{ id: "in" + Date.now(), type: "pay", name: payment.name, plan: payment.plan, at: Date.now(), clientId: payment.clientId, amount: payment.amount, method: payment.method }],
    });
    await save(db);
    send(res, 200, { ok: true, state: row.state });
    return;
  }
  if (path === "/api/paypal" && method === "POST") {
    const raw = await readBody(req);
    const ct = String(req.headers["content-type"] || "").toLowerCase();
    if (ct.includes("json")) {
      req.headers["x-replay"] = "1";
      const body = JSON.parse(raw || "{}");
      const row = await studioRow(db, "NIUBI");
      const payment = {
        id: String(body.invoice || body.id || ("p" + Date.now())),
        date: new Date().toISOString().slice(0, 10),
        plan: String(body.plan || ""),
        amount: String(body.amount || ""),
        method: String(body.method || "PayPal"),
        status: "iniciado",
        name: String(body.name || "Cliente"),
        clientId: String(body.clientId || ""),
        invoice: String(body.invoice || ""),
      };
      row.state = mergeStudio(row.state || {}, {
        _op: "pay",
        payments: [payment],
        inbox: [{ id: "in" + Date.now(), type: "pay", name: payment.name, plan: payment.plan, at: Date.now(), clientId: payment.clientId, amount: payment.amount, method: payment.method }],
      });
      await save(db);
      send(res, 200, { ok: true, state: row.state });
      return;
    }
    try {
      const check = await fetch("https://ipnpb.paypal.com/cgi-bin/webscr", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "cmd=_notify-validate&" + raw,
      });
      const verdict = String(await check.text()).trim();
      if (verdict !== "VERIFIED") {
        send(res, 400, { ok: false, error: "IPN no verificado" });
        return;
      }
    } catch {
      send(res, 502, { ok: false, error: "No se pudo validar PayPal" });
      return;
    }
    const params = new URLSearchParams(raw);
    if (params.get("payment_status") !== "Completed") {
      send(res, 200, { ok: true, skipped: true });
      return;
    }
    const row = await studioRow(db, "NIUBI");
    const invoice = String(params.get("invoice") || params.get("custom") || "");
    const pays = (row.state && row.state.payments) || [];
    const match = pays.find((p) => p.id === invoice || p.invoice === invoice);
    row.state = mergeStudio(row.state || {}, {
      _op: "paid",
      invoice,
      clientId: match ? match.clientId : "",
      name: match ? match.name : params.get("item_name") || "",
      amount: params.get("mc_gross") || "",
      method: "PayPal",
      plan: match ? match.plan : "",
    });
    await save(db);
    send(res, 200, { ok: true, state: row.state });
    return;
  }
  if (path === "/api/revoke" && method === "POST") {
    const tok = bearer(req);
    const row = db.studios.find((s) => s.token === tok);
    if (!row) {
      send(res, 404, { error: "Estudio no encontrado" });
      return;
    }
    const body = JSON.parse((await readBody(req)) || "{}");
    row.state = mergeStudio(row.state || {}, {
      _op: "revoke",
      revoked: [{ code: String(body.code || "").replace(/\D/g, ""), clientId: String(body.clientId || ""), name: String(body.name || ""), phone: String(body.phone || ""), at: Date.now() }],
    });
    await save(db);
    send(res, 200, { ok: true, state: row.state });
    return;
  }
  send(res, 405, { error: "Método no permitido" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    try { send(res, 500, { error: "Error del servidor" }); } catch {
      res.end();
    }
    console.error(err);
  });
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("NiuBision API on " + PORT + (process.env.DATABASE_URL ? " (postgres)" : " (file)"));
});
