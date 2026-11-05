import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

execFileSync("bash", ["scripts/build-split.sh"], { env: { ...process.env, NB_ENV: "production" }, stdio: "ignore" });
const web = readFileSync("dist/web/index.html", "utf8");
const app = readFileSync("dist/app/index.html", "utf8");
const ld = (s) => { const t = '<script type="application/ld+json">'; const i = s.indexOf(t + '{"@context"'); return JSON.parse(s.slice(i + t.length, s.indexOf("</script>", i))); };

test("web JSON-LD: un solo nodo para Workouts, precios reales", () => {
  const g = ld(web)["@graph"];
  const nfw = g.filter((n) => String(n.url || "").startsWith("https://workouts.niubision.app"));
  assert.equal(nfw.length, 1);
  assert.deepEqual(nfw[0].offers.map((o) => o.price), ["0", "11.14", "66.89", "143.84"]);
  const biz = g.find((n) => n["@id"] === "https://niubision.com/#business");
  const prices = biz.hasOfferCatalog.itemListElement.map((o) => o.price).filter(Boolean);
  for (const p of ["43.49", "108.16", "143.84", "219.66"]) assert.ok(prices.includes(p), p);
});

test("sin reseñas ni ratings inventados", () => {
  for (const s of [web, app]) assert.ok(!/aggregateRating|"Review"/.test(s));
});

test("app: un solo h1 y 404 real", () => {
  assert.equal((app.match(/<h1[\s>]/g) || []).length, 1);
  assert.ok(existsSync("dist/app/404.html"));
  const nf = readFileSync("dist/app/404.html", "utf8");
  assert.match(nf, /noindex/);
  assert.match(nf, /href="https:\/\/niubision\.app\/"/);
});

test("producción indexable, canonical propio", () => {
  assert.match(web, /<link rel="canonical" href="https:\/\/niubision\.com\/">/);
  assert.match(app, /<link rel="canonical" href="https:\/\/niubision\.app\/">/);
  assert.match(app, /content="index, follow/);
  assert.match(readFileSync("dist/app/robots.txt", "utf8"), /Sitemap: https:\/\/niubision\.app\/sitemap\.xml/);
});

test("Instagram @niubision: enlace accesible y en sameAs", () => {
  for (const s of [web, app]) {
    assert.match(s, /<a href="https:\/\/www\.instagram\.com\/niubision\/" target="_blank" rel="noopener[^"]*" aria-label="Instagram[^"]*"/);
  }
  const biz = ld(web)["@graph"].find((n) => n["@id"] === "https://niubision.com/#business");
  assert.ok(biz.sameAs.includes("https://www.instagram.com/niubision/"));
  assert.ok(readFileSync("app/app.js", "utf8").includes("Abrir Instagram"));
});

test("web: páginas legales en sitemap y dist", () => {
  const sm = readFileSync("dist/web/sitemap.xml", "utf8");
  for (const path of ["/cancelacion", "/privacidad", "/terminos"]) {
    assert.ok(sm.includes(`https://niubision.com${path}`), path);
    assert.ok(existsSync(`dist/web${path}.html`), path + ".html");
  }
  const priv = readFileSync("dist/web/privacidad.html", "utf8");
  const terms = readFileSync("dist/web/terminos.html", "utf8");
  for (const s of [priv, terms]) {
    assert.match(s, /NiuBision, nombre comercial de Miguel Morales/);
    assert.match(s, /Arecibo/);
    assert.match(s, /niubision@gmail\.com/);
    assert.match(s, /wa\.me\/17874544038/);
    assert.ok(!/Grabaciones|voz del coach|Fotos y video de cada/.test(s));
  }
  assert.match(priv, /Face ID \/ passkeys/);
  assert.match(terms, /Face ID \/ passkeys/);
  assert.match(priv, /9798-3322359/);
});
