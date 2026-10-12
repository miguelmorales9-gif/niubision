// Usage: node cloud/migrate-kv-to-d1.mjs <kv-dump.json> <out.sql>
// Builds idempotent SQL (studios + entities projection + logs) from a full KV export.
import fs from "node:fs";
import { rowToSql } from "./db.js";
const [dumpPath, outPath] = process.argv.slice(2);
const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
const q = (v) => v == null ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const out = [];
let studios = 0, logs = 0;
for (const [key, { value }] of Object.entries(dump)) {
  if (key.startsWith("log:")) {
    const r = JSON.parse(value); const day = new Date(r.t).toISOString().slice(0, 10);
    out.push(`INSERT OR IGNORE INTO logs (h, day, t, n, src, kind, msg, stack, path, line, col, v, ua, country) VALUES (${[r.h, day, r.t, 1, r.src, r.kind, r.msg, r.stack, r.path, r.line || 0, r.col || 0, r.v, r.ua, r.country].map(q).join(", ")});`);
    logs++;
  } else if (key.startsWith("logday:") || key.startsWith("logd:")) {
    continue;
  } else {
    let row; try { row = JSON.parse(value); } catch (e) { console.error("skip non-JSON key", key); continue; }
    if (!row || typeof row !== "object" || !row.studioKey) { console.error("skip non-studio key", key); continue; }
    out.push(rowToSql(row)); studios++;
  }
}
fs.writeFileSync(outPath, out.join("\n") + "\n");
console.log(JSON.stringify({ studios, logs, bytes: fs.statSync(outPath).size }));
