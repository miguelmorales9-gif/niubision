import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";

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

// Optional static site (combo parity with Cloudflare Pages rules in combo/build-combo.sh):
// NB_STATIC=/tmp/nb-combo node server.mjs  -> / landing, /app/ app, /app -> /app/ 301,
// /index.html -> / 308, /app/index.html -> /app/ 308, 404.html, no-cache sw.js + manifests.
// Unset NB_STATIC = API-only behaviour (unchanged).
const STATIC = process.env.NB_STATIC || "";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".woff2": "font/woff2" };
const API_PATHS = new Set(["/health", "/studio", "/redeem", "/state"]);
function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const p = decodeURIComponent(url.pathname);
  if (API_PATHS.has(p)) return false;
  const q = url.search;
  const redirect = (code, to) => { res.writeHead(code, { Location: to + q }); res.end(); return true; };
  if (p === "/app") return redirect(301, "/app/");
  if (p === "/index.html") return redirect(308, "/");
  if (p === "/app/index.html") return redirect(308, "/app/");
  let rel = normalize(p).replace(/^(\.\.[\/\\])+/, "");
  let file = join(STATIC, rel);
  if (!file.startsWith(STATIC)) return false;
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!p.endsWith("/")) return redirect(308, p + "/");
    file = join(file, "index.html");
  }
  let code = 200;
  if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
  if (!existsSync(file)) { file = join(STATIC, "404.html"); code = 404; if (!existsSync(file)) return false; }
  const ext = extname(file);
  const headers = { "Content-Type": MIME[ext] || "application/octet-stream", "X-Content-Type-Options": "nosniff" };
  if (/\/(sw\.js|manifest\.webmanifest)$/.test(file) || ext === ".html") headers["Cache-Control"] = "no-cache";
  else headers["Cache-Control"] = "public, max-age=0, must-revalidate";
  if (/sw\.js$/.test(file)) headers["Service-Worker-Allowed"] = "/";
  let body = readFileSync(file);
  const ae = String(req.headers["accept-encoding"] || "");
  if (/\.(html|js|css|json|webmanifest|svg|txt|xml)$/.test(file) && body.length > 1024) {
    if (/\bbr\b/.test(ae)) { body = brotliCompressSync(body); headers["Content-Encoding"] = "br"; }
    else if (/gzip/.test(ae)) { body = gzipSync(body); headers["Content-Encoding"] = "gzip"; }
    headers["Vary"] = "Accept-Encoding";
  }
  headers["Content-Length"] = body.length;
  res.writeHead(code, headers);
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  const db = load();
  const url = new URL(req.url, "http://localhost");
  if (STATIC && serveStatic(req, res, url)) return;
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
