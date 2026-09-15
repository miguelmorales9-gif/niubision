/**
 * Cloudflare Worker — same API as cloud/server.mjs
 * Bind KV namespace as STUDIO. wrangler deploy.
 */
const FIXED_TOKEN = "nb-cloud-v1";

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
    const gen = () => String(100000 + Math.floor(Math.random() * 900000));
    const clients = (a.clients || []).map((c) => {
      const hit = (clientId && c.id === clientId) || (b.name && String(c.name || "").toLowerCase() === String(b.name || "").toLowerCase());
      if (!hit) return c;
      let code = String(c.accessCode || "");
      if (!/^\d{6}$/.test(code)) { code = gen(); used.add(code); }
      return Object.assign({}, c, { unpaid: false, accessCode: code });
    });
    return Object.assign({}, a, { clients, payments, revoked, updatedAt: Date.now() });
  }
  if (op === "revoke") return Object.assign({}, a, { clients: (a.clients || []).filter(alive), revoked, updatedAt: Date.now() });
  if (op === "report") {
    const clients = (a.clients || []).map((c) => {
      const hit = (b.clients || []).find((x) => (c.id && x.id === c.id) || (c.accessCode && x.accessCode === c.accessCode));
      if (!hit || !hit.report) return c;
      return Object.assign({}, c, { report: hit.report, lastSession: hit.report.lastSession || c.lastSession });
    });
    return Object.assign({}, a, { clients, revoked, updatedAt: Date.now() });
  }
  const map = new Map();
  (a.clients || []).filter(alive).forEach((c) => map.set(keyOf(c), c));
  (b.clients || []).filter(alive).forEach((c) => map.set(keyOf(c), Object.assign({}, map.get(keyOf(c)) || {}, c)));
  const out = Object.assign({}, a, op === "lead" || op === "pay" ? {} : b, {
    clients: Array.from(map.values()),
    revoked,
    inbox: [].concat(a.inbox || [], b.inbox || []).slice(-80),
    payments: [].concat(a.payments || [], b.payments || []).slice(-200),
    updatedAt: Date.now(),
  });
  delete out._op;
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    },
  });
}

async function rowOf(env, key) {
  const raw = await env.STUDIO.get(key);
  if (raw) return JSON.parse(raw);
  const row = { studioKey: key, token: key === "NIUBI" ? FIXED_TOKEN : crypto.randomUUID(), state: {} };
  await env.STUDIO.put(key, JSON.stringify(row));
  return row;
}

async function putRow(env, row) {
  await env.STUDIO.put(row.studioKey, JSON.stringify(row));
}

function bearer(req, url) {
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return (m && m[1].trim()) || url.searchParams.get("token") || "";
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, OPTIONS", "access-control-allow-headers": "Content-Type, Authorization" } });
    if (path === "/" || path === "/api/health" || path === "/health") return json({ ok: true, db: "kv" });
    if (path === "/api/studio") {
      let key = (url.searchParams.get("key") || "NIUBI").toUpperCase();
      if (method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (body.studioKey) key = String(body.studioKey).toUpperCase();
      }
      const row = await rowOf(env, key || "NIUBI");
      return json({ ok: true, token: row.token });
    }
    if (path === "/api/state" && method === "GET") {
      const tok = bearer(req, url);
      const row = await rowOf(env, "NIUBI");
      if (row.token !== tok) return json({ error: "Estudio no encontrado" }, 404);
      return json({ ok: true, state: row.state || {} });
    }
    if (path === "/api/state" && method === "PUT") {
      const tok = bearer(req, url);
      const row = await rowOf(env, "NIUBI");
      if (row.token !== tok) return json({ error: "Estudio no encontrado" }, 404);
      const body = await req.json().catch(() => ({}));
      row.state = mergeStudio(row.state || {}, body);
      await putRow(env, row);
      return json({ ok: true, state: row.state });
    }
    if (path === "/api/redeem") {
      let code = url.searchParams.get("code") || "";
      if (method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (body.code) code = String(body.code);
      }
      const digits = String(code).replace(/\D/g, "");
      const row = await rowOf(env, "NIUBI");
      const list = (row.state && row.state.clients) || [];
      const hit = list.find((c) => String(c.accessCode || "") === digits);
      if (!hit) return json({ error: "Estudio no encontrado" }, 404);
      if (hit.unpaid) return json({ error: "Pago pendiente" }, 403);
      return json({ ok: true, token: row.token, client: hit, state: row.state });
    }
    if (path === "/api/lead" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const c = body.client || {};
      if (!c.name) return json({ error: "Falta el nombre" }, 400);
      const row = await rowOf(env, "NIUBI");
      const client = { id: String(c.id || "c" + Date.now()), name: String(c.name).slice(0, 80), plan: String(c.plan || "Estándar"), unpaid: c.unpaid !== false, phone: String(c.phone || ""), email: String(c.email || "") };
      row.state = mergeStudio(row.state || {}, { _op: "lead", clients: [client], inbox: [{ id: "in" + Date.now(), type: "lead", name: client.name, plan: client.plan, at: Date.now(), clientId: client.id }] });
      await putRow(env, row);
      return json({ ok: true, state: row.state });
    }
    if (path === "/api/pay" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const row = await rowOf(env, "NIUBI");
      const payment = { id: String(body.invoice || "p" + Date.now()), date: new Date().toISOString().slice(0, 10), plan: body.plan || "", amount: body.amount || "", method: body.method || "", status: "iniciado", name: body.name || "Cliente", clientId: body.clientId || "" };
      row.state = mergeStudio(row.state || {}, { _op: "pay", payments: [payment], inbox: [{ id: "in" + Date.now(), type: "pay", name: payment.name, plan: payment.plan, at: Date.now(), clientId: payment.clientId, amount: payment.amount, method: payment.method }] });
      await putRow(env, row);
      return json({ ok: true, state: row.state });
    }
    if (path === "/api/paypal" && method === "POST") {
      const ct = (req.headers.get("content-type") || "").toLowerCase();
      const raw = await req.text();
      const row = await rowOf(env, "NIUBI");
      if (ct.includes("json")) {
        const body = JSON.parse(raw || "{}");
        const payment = { id: String(body.invoice || "p" + Date.now()), date: new Date().toISOString().slice(0, 10), plan: body.plan || "", amount: body.amount || "", method: "PayPal", status: "iniciado", name: body.name || "Cliente", clientId: body.clientId || "" };
        row.state = mergeStudio(row.state || {}, { _op: "pay", payments: [payment] });
        await putRow(env, row);
        return json({ ok: true });
      }
      const check = await fetch("https://ipnpb.paypal.com/cgi-bin/webscr", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "cmd=_notify-validate&" + raw });
      if (String(await check.text()).trim() !== "VERIFIED") return json({ error: "IPN no verificado" }, 400);
      const params = new URLSearchParams(raw);
      if (params.get("payment_status") !== "Completed") return json({ ok: true, skipped: true });
      row.state = mergeStudio(row.state || {}, { _op: "paid", invoice: params.get("invoice") || params.get("custom") || "", amount: params.get("mc_gross") || "", method: "PayPal" });
      await putRow(env, row);
      return json({ ok: true });
    }
    if (path === "/api/revoke" && method === "POST") {
      const tok = bearer(req, url);
      const row = await rowOf(env, "NIUBI");
      if (row.token !== tok) return json({ error: "Estudio no encontrado" }, 404);
      const body = await req.json().catch(() => ({}));
      row.state = mergeStudio(row.state || {}, { _op: "revoke", revoked: [{ code: String(body.code || "").replace(/\D/g, ""), clientId: String(body.clientId || ""), at: Date.now() }] });
      await putRow(env, row);
      return json({ ok: true });
    }
    if (path === "/api/report" && (method === "POST" || method === "PUT")) {
      const tok = bearer(req, url);
      const row = await rowOf(env, "NIUBI");
      if (row.token !== tok) return json({ error: "Estudio no encontrado" }, 404);
      const body = await req.json().catch(() => ({}));
      row.state = mergeStudio(row.state || {}, { _op: "report", clients: [{ id: body.clientId, accessCode: String(body.accessCode || "").replace(/\D/g, "").slice(0, 6), report: Object.assign({}, body.report || {}, { updatedAt: Date.now() }) }] });
      await putRow(env, row);
      return json({ ok: true, state: row.state });
    }
    return json({ error: "No encontrado" }, 404);
  },
};
