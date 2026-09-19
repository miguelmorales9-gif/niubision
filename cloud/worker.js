const COACH_PIN = "9798";
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
      const hit = (clientId && c.id === clientId)
        || (invoice && (c.id === invoice || c.accessCode === invoice));
      if (!hit) return c;
      let code = String(c.accessCode || "");
      if (!/^\d{6}$/.test(code) || used.has(code)) {
        do { code = gen(); } while (used.has(code));
        used.add(code);
      }
      return Object.assign({}, c, { unpaid: false, accessCode: code });
    });
    return Object.assign({}, a, { clients, payments, revoked, updatedAt: Date.now() });
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
    if (next && typeof next === "object" && (next.date || next.signature || next.name)) return next;
    if (prev && typeof prev === "object" && (prev.date || prev.signature || prev.name)) return prev;
    return next || prev;
  };
  const map = new Map();
  (a.clients || []).filter(alive).forEach((c) => map.set(keyOf(c), c));
  (b.clients || []).filter(alive).forEach((c) => {
    const prev = map.get(keyOf(c)) || {};
    const row = Object.assign({}, prev, c);
    row.waiver = preferDoc(c.waiver, prev.waiver);
    row.health = preferDoc(c.health, prev.health);
    row.contract = preferDoc(c.contract, prev.contract);
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
  const out = Object.assign({}, a, op === "lead" || op === "pay" ? {} : b, {
    clients: folded.length ? folded : Array.from(map.values()),
    revoked,
    inbox: (Array.isArray(b.inbox) && !op ? b.inbox : [].concat(a.inbox || [], b.inbox || [])).filter((n) => !gone(n)).slice(-40),
    payments: (Array.isArray(b.payments) && !op ? b.payments : Array.from(payMap.values())).filter((p) => !gone(p)).slice(-80),
    contracts: (Array.isArray(b.contracts) && !op ? b.contracts : (b.contracts || a.contracts || [])).filter((k) => !gone(k)),
    receipts: (Array.isArray(b.receipts) && !op ? b.receipts : (b.receipts || a.receipts || [])).filter((r) => !gone(r)),
    updatedAt: Date.now()
  });
  delete out._op;
  return out;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization, X-Nb-Pin"
    }
  });
}

function newToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function rowOf(env, key) {
  const raw = await env.STUDIO.get(key);
  if (raw) return JSON.parse(raw);
  const row = { studioKey: key, token: newToken(), state: {} };
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

function pinOf(req, url, body) {
  return String((body && body.pin) || url.searchParams.get("pin") || req.headers.get("x-nb-pin") || "");
}

function tokOk(row, tok) {
  if (!tok || !row) return false;
  if (tok === row.token) return true;
  if (tok === LEGACY) return true;
  return false;
}

async function mailReceipt(row) {
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
    "Monto: " + (row.amount || "—") + " USD",
    "Método: " + (row.method || ""),
    "Estado: " + (row.status || "recibido"),
    row.accessCode ? "Código: " + row.accessCode : "",
    "",
    "Precio final. NiuBision no cobra IVU."
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

async function handle(req, env) {
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
  if (path === "/" || path === "/api/health" || path === "/health") return json({ ok: true, db: "kv", v: 21 });

  if (path === "/api/studio") {
    let body = {};
    if (method === "POST") body = await req.json().catch(() => ({}));
    let key = String(body.studioKey || url.searchParams.get("key") || "NIUBI").toUpperCase();
    if (pinOf(req, url, body) !== COACH_PIN) return json({ error: "PIN de estudio requerido" }, 403);
    const row = await rowOf(env, key || "NIUBI");
    if (!row.token || row.token === LEGACY) {
      row.token = newToken();
      await putRow(env, row);
    }
    return json({ ok: true, token: row.token });
  }

  if (path === "/api/export" && method === "GET") {
    if (pinOf(req, url, {}) !== COACH_PIN) return json({ error: "No" }, 403);
    const row = await rowOf(env, "NIUBI");
    return json({
      ok: true,
      studioKey: "NIUBI",
      updatedAt: (row.state && row.state.updatedAt) || Date.now(),
      state: row.state || {}
    });
  }

  if (path === "/api/state" && method === "GET") {
    const row = await rowOf(env, "NIUBI");
    if (!tokOk(row, bearer(req, url))) return json({ error: "Estudio no encontrado" }, 404);
    return json({ ok: true, state: row.state || {} });
  }

  if (path === "/api/state" && method === "PUT") {
    const row = await rowOf(env, "NIUBI");
    if (!tokOk(row, bearer(req, url))) return json({ error: "Estudio no encontrado" }, 404);
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
    const dead = new Set(((row.state && row.state.revoked) || []).map((r) => String(r.code || "")));
    if (dead.has(digits)) return json({ error: "Código anulado" }, 404);
    const list = (row.state && row.state.clients) || [];
    const hit = list.find((c) => String(c.accessCode || "") === digits);
    if (!hit) return json({ error: "Estudio no encontrado" }, 404);
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
      inbox: dup ? [] : [{ id: "in" + Date.now(), type: "lead", name: client.name, plan: client.plan, at: Date.now(), clientId: client.id }]
    });
    await putRow(env, row);
    return json({ ok: true, state: { inbox: row.state.inbox } });
  }

  if (path === "/api/pay" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const row = await rowOf(env, "NIUBI");
    const payment = {
      id: String(body.invoice || "p" + Date.now()),
      date: new Date().toISOString().slice(0, 10),
      plan: body.plan || "",
      amount: body.amount || "",
      method: body.method || "",
      status: "iniciado",
      name: body.name || "Cliente",
      clientId: body.clientId || "",
      email: body.email || ""
    };
    const inbox = (row.state && row.state.inbox) || [];
    const dupPay = inbox.some((n) => n && n.type === "pay" && n.clientId === payment.clientId && String(n.amount || "") === String(payment.amount || "") && (Date.now() - (n.at || 0) < 30 * 60 * 1000));
    row.state = mergeStudio(row.state || {}, {
      _op: "pay",
      payments: [payment],
      inbox: dupPay ? [] : [{ id: "in" + Date.now(), type: "pay", name: payment.name, plan: payment.plan, at: Date.now(), clientId: payment.clientId, amount: payment.amount, method: payment.method }]
    });
    await putRow(env, row);
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
      const payment = {
        id: String(body.invoice || "p" + Date.now()),
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
    row.state = mergeStudio(row.state || {}, {
      _op: "paid",
      invoice,
      amount: params.get("mc_gross") || "",
      method: "PayPal"
    });
    await putRow(env, row);
    const pay = ((row.state && row.state.payments) || []).find((p) => p.id === invoice || p.invoice === invoice) || {};
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
    return json({ ok: true });
  }

  if (path === "/api/revoke" && method === "POST") {
    const row = await rowOf(env, "NIUBI");
    if (!tokOk(row, bearer(req, url))) return json({ error: "Estudio no encontrado" }, 404);
    const body = await req.json().catch(() => ({}));
    row.state = mergeStudio(row.state || {}, {
      _op: "revoke",
      revoked: [{ code: String(body.code || "").replace(/\D/g, ""), clientId: String(body.clientId || ""), at: Date.now() }]
    });
    await putRow(env, row);
    return json({ ok: true });
  }

  if (path === "/api/report" && (method === "POST" || method === "PUT")) {
    const body = await req.json().catch(() => ({}));
    const row = await rowOf(env, "NIUBI");
    const code = String(body.accessCode || "").replace(/\D/g, "").slice(0, 6);
    const allowed = tokOk(row, bearer(req, url)) || (code && ((row.state && row.state.clients) || []).some((c) => String(c.accessCode || "") === code));
    if (!allowed) return json({ error: "Estudio no encontrado" }, 404);
    row.state = mergeStudio(row.state || {}, {
      _op: "report",
      clients: [{
        id: body.clientId,
        accessCode: code,
        report: Object.assign({}, body.report || {}, { updatedAt: Date.now() })
      }]
    });
    await putRow(env, row);
    return json({ ok: true });
  }

  return json({ error: "No encontrado" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 500);
    }
  }
};
