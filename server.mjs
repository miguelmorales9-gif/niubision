import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const PORT = Number(process.env.PORT || 8787);
const FILE = process.env.NB_DATA || new URL("./data.json", import.meta.url).pathname;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
};

function load() {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return { studios: {}, tokens: {} }; }
}
function save(db) {
  writeFileSync(FILE, JSON.stringify(db));
}
function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}
function token() { return randomBytes(18).toString("hex"); }
function auth(req, db) {
  const h = req.headers.authorization || "";
  const t = h.replace(/^Bearer\s+/i, "");
  const row = db.tokens[t];
  if (!row) return null;
  return { token: t, ...row, studio: db.studios[row.studioId] };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 2_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  const db = load();
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "niubision-cloud" });
    }
    if (req.method === "POST" && url.pathname === "/studio") {
      const body = await readBody(req);
      const id = "s" + Date.now();
      const t = token();
      db.studios[id] = { id, pin: String(body.pin || ""), studioKey: body.studioKey || "", state: {}, created: Date.now() };
      db.tokens[t] = { studioId: id, role: "coach" };
      save(db);
      return json(res, 200, { token: t, studioId: id });
    }
    if (req.method === "POST" && url.pathname === "/redeem") {
      const body = await readBody(req);
      const code = String(body.code || "");
      const parts = code.split("|");
      if (parts[0] !== "NB2" || parts.length < 5) return json(res, 400, { error: "Código no válido" });
      const studio = Object.values(db.studios).find((s) => s.studioKey === parts[1]);
      if (!studio) return json(res, 404, { error: "Estudio no encontrado. El coach debe conectar la nube primero." });
      const t = token();
      db.tokens[t] = { studioId: studio.id, role: "client", name: parts[2] };
      save(db);
      return json(res, 200, { token: t, studioId: studio.id, state: studio.state || {} });
    }
    if (url.pathname === "/state") {
      const session = auth(req, db);
      if (!session || !session.studio) return json(res, 401, { error: "Sin sesión" });
      if (req.method === "GET") return json(res, 200, { state: session.studio.state || {} });
      if (req.method === "PUT") {
        const body = await readBody(req);
        session.studio.state = body;
        session.studio.updatedAt = Date.now();
        save(db);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, 500, { error: "Error del servidor" });
  }
});

server.listen(PORT, () => console.log("NiuBision cloud on " + PORT));
