// D1 data layer shared by the Worker and the migration script.
// DB_MODE: "kv" (KV only) | "dual" (write KV + D1, read the newer of D1/KV by rev) | "d1" (D1 only, KV untouched).
const LIST_KINDS = ["clients", "payments", "contracts", "receipts", "programRequests", "revoked", "inbox", "appointments",
  "history", "checkins", "weighins", "measures", "videos", "customRoutines"];

function toMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}

export function projectState(studioKey, state) {
  const out = [];
  const s = state || {};
  for (const kind of LIST_KINDS) {
    const list = Array.isArray(s[kind]) ? s[kind] : [];
    list.forEach((it, i) => {
      if (!it || typeof it !== "object") return;
      const id = String(it.id || it.code || it.accessCode || (kind + ":" + i));
      out.push({
        studio_key: studioKey, kind, id,
        client_id: it.clientId != null ? String(it.clientId) : (kind === "clients" ? id : null),
        at: toMs(it.at || it.date || it.updatedAt || it.createdAt || it.ts),
        status: it.status != null ? String(it.status) : null,
        amount: it.amount != null && !isNaN(Number(it.amount)) ? Number(it.amount) : null,
        json: JSON.stringify(it)
      });
    });
  }
  return out;
}

export function rowToDb(row) {
  const { studioKey, token, state, sessions, fails, push, _rev } = row;
  const extra = Object.assign({}, row);
  ["studioKey", "token", "state", "sessions", "fails", "push", "_rev"].forEach((k) => delete extra[k]);
  return {
    key: studioKey, token: token || null, rev: Number(_rev) || 0,
    state_json: JSON.stringify(state || {}), sessions_json: JSON.stringify(sessions || {}),
    fails_json: JSON.stringify(fails || {}), push_json: JSON.stringify(push || {}),
    extra_json: JSON.stringify(extra), updated_at: Date.now()
  };
}

export function dbToRow(r) {
  const row = Object.assign({}, JSON.parse(r.extra_json || "{}"), {
    studioKey: r.key, token: r.token, state: JSON.parse(r.state_json || "{}"),
    sessions: JSON.parse(r.sessions_json || "{}"), fails: JSON.parse(r.fails_json || "{}"),
    push: JSON.parse(r.push_json || "{}"), _rev: Number(r.rev) || 0
  });
  if (row.token == null) delete row.token;
  return row;
}

export function dbMode(env) {
  const m = String((env && env.DB_MODE) || "kv").toLowerCase();
  if (!env || !env.DB) return "kv";
  return m === "dual" || m === "d1" ? m : "kv";
}

export async function d1ReadRow(env, key) {
  const r = await env.DB.prepare("SELECT * FROM studios WHERE key = ?").bind(key).first();
  return r ? dbToRow(r) : null;
}

export async function d1WriteRow(env, row) {
  const d = rowToDb(row);
  const stmts = [
    env.DB.prepare(`INSERT INTO studios (key, token, rev, state_json, sessions_json, fails_json, push_json, extra_json, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(key) DO UPDATE SET token=?2, rev=?3, state_json=?4, sessions_json=?5, fails_json=?6, push_json=?7, extra_json=?8, updated_at=?9`)
      .bind(d.key, d.token, d.rev, d.state_json, d.sessions_json, d.fails_json, d.push_json, d.extra_json, d.updated_at),
    env.DB.prepare("DELETE FROM entities WHERE studio_key = ?").bind(d.key)
  ];
  for (const e of projectState(d.key, row.state)) {
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO entities (studio_key, kind, id, client_id, at, status, amount, json) VALUES (?,?,?,?,?,?,?,?)")
      .bind(e.studio_key, e.kind, e.id, e.client_id, e.at, e.status, e.amount, e.json));
  }
  await env.DB.batch(stmts);
}

// SQL text for the offline migration (wrangler d1 execute --file)
function q(v) { return v == null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"; }
export function rowToSql(row) {
  const d = rowToDb(row);
  const lines = [`INSERT OR REPLACE INTO studios (key, token, rev, state_json, sessions_json, fails_json, push_json, extra_json, updated_at) VALUES (${[d.key, d.token, d.rev, d.state_json, d.sessions_json, d.fails_json, d.push_json, d.extra_json, d.updated_at].map(q).join(", ")});`,
    `DELETE FROM entities WHERE studio_key = ${q(d.key)};`];
  for (const e of projectState(d.key, row.state)) {
    lines.push(`INSERT OR REPLACE INTO entities (studio_key, kind, id, client_id, at, status, amount, json) VALUES (${[e.studio_key, e.kind, e.id, e.client_id, e.at, e.status, e.amount, e.json].map(q).join(", ")});`);
  }
  return lines.join("\n");
}
