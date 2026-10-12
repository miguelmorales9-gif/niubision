// Code-split app.js (behavior-preserving): move every top-level function that is NOT reachable
// from load-time code / boot() / render()'s pre-gate path / renderGate() into a lazy views chunk.
// render() waits for the chunk (nbLoadData) before calling viewBody/header/nav/afterPaint.
// Usage: node split-app.cjs <app.js in/out> <views.js out>   (needs acorn + acorn-walk on NODE_PATH)
const fs = require("fs");
const acorn = require("acorn");
const walk = require("acorn-walk");
const [inP, outViews] = process.argv.slice(2);
const src = fs.readFileSync(inP, "utf8");
const ast = acorn.parse(src, { ecmaVersion: "latest" });
const fns = new Map();
const roots = [];
for (const n of ast.body) {
  if (n.type === "FunctionDeclaration") {
    if (fns.has(n.id.name)) throw new Error("duplicate function " + n.id.name);
    fns.set(n.id.name, n);
  } else roots.push(n);
}
const GATED = new Set(["viewBody", "header", "nav", "afterPaint"]); // only called by render() after the gate
for (const g of GATED) if (!fns.has(g)) throw new Error("missing gated fn " + g);
const refs = (node) => { const s = new Set(); walk.full(node, (x) => { if (x.type === "Identifier" && fns.has(x.name)) s.add(x.name); }); return s; };
// GATED names may only be referenced from render()
for (const [name, f] of fns) {
  if (name === "render") continue;
  for (const r of refs(f)) if (GATED.has(r) && !GATED.has(name)) throw new Error(name + " references gated " + r + " outside render()");
}
for (const r of roots) for (const x of refs(r)) if (GATED.has(x)) throw new Error("top-level code references gated " + x);
const keep = new Set();
const q = ["boot", "render", "renderGate", "nbLoadData", "nbDataReady"];
roots.forEach((r) => refs(r).forEach((n) => q.push(n)));
while (q.length) {
  const n = q.pop();
  if (keep.has(n) || GATED.has(n)) continue;
  keep.add(n);
  refs(fns.get(n)).forEach((m) => { if (!keep.has(m)) q.push(m); });
}
const moved = [...fns.entries()].filter(([n]) => !keep.has(n)).map(([, f]) => f).sort((a, b) => a.start - b.start);
let core = "";
let last = 0;
for (const f of moved) { core += src.slice(last, f.start); last = f.end; }
core += src.slice(last);
const views = moved.map((f) => src.slice(f.start, f.end)).join("\n") + "\nwindow.__nbViews = 1;\n";
fs.writeFileSync(inP, core);
fs.writeFileSync(outViews, views);
console.log(JSON.stringify({ functions: fns.size, kept: keep.size, moved: moved.length, coreBytes: core.length, viewsBytes: views.length }));
