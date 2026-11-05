import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const BASE = process.env.NB_URL || "https://hybrid.niubision-ui-preview.pages.dev";
const findings = [];
const log = (s) => { findings.push(s); console.log(s); };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  locale: "es-PR"
});
const page = await ctx.newPage();
const netFails = [];
const consoleErr = [];
page.on("response", (r) => { if (r.status() >= 400) netFails.push(r.status() + " " + r.url()); });
page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text().slice(0, 160)); });

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}
async function bodyText() {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
}
async function wipe() {
  await page.evaluate(async () => {
    try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch (e) {}
    try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } catch (e) {}
    localStorage.clear(); sessionStorage.clear();
  });
}
async function holdToCover() {
  const logo = page.locator("#holdLogo");
  await logo.waitFor({ state: "visible", timeout: 20000 });
  // drive hold via page function — matches pointerdown path
  await page.evaluate(() => new Promise((resolve) => {
    const wrap = document.getElementById("holdLogo");
    if (!wrap) return resolve(false);
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true });
    wrap.dispatchEvent(down);
    setTimeout(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "touch" }));
      resolve(true);
    }, 2800);
  }));
  // intro can take up to ~7s
  try {
    await page.locator("#haveCode").waitFor({ state: "visible", timeout: 12000 });
  } catch (e) {
    log("hold wait: #haveCode not visible — splash still? " + (await bodyText()).slice(0, 120));
  }
}

await page.goto(BASE + "/?nocache=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
await wipe();
await page.goto(BASE + "/?nocache=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(500);
await shot("v5-01-splash.png");
log("SW: " + JSON.stringify(await page.evaluate(async () => ({
  sw: (await navigator.serviceWorker.getRegistrations()).map((r) => r.active && r.active.scriptURL),
  caches: await caches.keys()
}))));
log("Splash: " + (await bodyText()).slice(0, 160));
await holdToCover();
await shot("v5-02-cover.png");
log("Cover: " + (await bodyText()).slice(0, 240));
const entrar = await page.locator("#haveCode").count();
const planes = await page.locator("#seePlans").count();
const coach = await page.locator("#studioLock").count();
log(`Cover controls Entrar=${entrar} Planes=${planes} SoyCoach=${coach}`);
if (!entrar) log("FAIL: Cover CTAs missing after hold");
else {
  const order = await page.evaluate(() => {
    const a = document.querySelector("#haveCode");
    const b = document.querySelector("#seePlans");
    const c = document.querySelector("#studioLock");
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), rc = c.getBoundingClientRect();
    return { ok: rb.top >= ra.bottom - 4 && rc.top >= rb.bottom - 4, entrarY: ra.top, planesY: rb.top, coachY: rc.top };
  });
  log("Cover order Planes under Entrar: " + JSON.stringify(order));
}

// Demo hoy
await page.goto(BASE + "/?demo=hoy&nocache=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);
await shot("v5-03-demo-hoy.png");
let hoy = await bodyText();
log("Demo Hoy: " + hoy.slice(0, 300));
log(/Lleva días sin cerrar/i.test(hoy) ? "FAIL: false late" : "OK: no false late");
log("Welcome wall: " + (await page.locator("#welcomeDayone").count()));
log("Empezar: " + (await page.locator("#goLive").count()));
const metrics = await page.evaluate(() => ({
  sessionH: document.querySelector(".session-card-look")?.getBoundingClientRect().height,
  heroH: document.querySelector(".hoy-hero-hybrid")?.getBoundingClientRect().height,
  appH: document.getElementById("app")?.scrollHeight,
  brand: document.querySelector(".brand-tag-quiet")?.textContent || null,
  late: /Lleva días sin cerrar/i.test(document.body.innerText)
}));
log("Hoy metrics: " + JSON.stringify(metrics));
if (metrics.brand && /See the work/i.test(metrics.brand)) log("FAIL English header");
else log("OK header: " + metrics.brand);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
const still = await page.locator("#goLive").count();
log(still ? "OK: demo survives reload" : "FAIL: demo lost → " + (await bodyText()).slice(0, 100));
await shot("v5-04-reload-hoy.png");

if (still) {
  await page.locator("#goLive").click();
  await page.waitForTimeout(700);
  await shot("v5-05-session.png");
  log("Session: " + (await bodyText()).slice(0, 200));
}

// nav Programas
const navProg = page.locator('nav.nav button[data-view="programas"]');
if (await navProg.count()) {
  await navProg.click();
  await page.waitForTimeout(700);
  await shot("v5-06-programas.png");
  log("Programas: " + (await bodyText()).slice(0, 260));
  const deep = await page.evaluate(() => ({
    gate: document.querySelector(".prog-catalog-gate")?.innerText?.slice(0, 120) || null,
    tipo: [...document.querySelectorAll("#progKindSel option")].map((o) => o.textContent.trim()),
    pedirOther: !!document.querySelector("#progAskOther"),
    openCat: !!document.querySelector("#progOpenCatalog")
  }));
  log("Programas deep: " + JSON.stringify(deep));
  if (await page.locator("#progOpenCatalog").count()) {
    await page.locator("#progOpenCatalog").click();
    await page.waitForTimeout(600);
    await shot("v5-07-catalog.png");
    log("Catalog cards: " + (await page.locator(".prog-card").count()));
    const pedir = page.locator("[data-prog-pedir]").first();
    if (await pedir.count()) {
      await pedir.click();
      await page.waitForTimeout(600);
      await shot("v5-08-pedir.png");
      log("Pedir: " + (await bodyText()).slice(0, 180));
      // close modal if any
      const close = page.locator("#closeSheet");
      if (await close.count()) await close.click().catch(() => {});
    }
  }
} else log("FAIL: nav Programas missing");

for (const [view, file] of [["home", "v5-09-yo.png"], ["price", "v5-10-plan.png"]]) {
  const t = page.locator(`nav.nav button[data-view="${view}"]`);
  if (await t.count()) {
    await t.click();
    await page.waitForTimeout(500);
    await shot(file);
    log(view + ": " + (await bodyText()).slice(0, 140));
  }
}

// About English check via guest path if needed
const aboutEn = await page.evaluate(() => /See the work/i.test(document.body.innerText));
log(aboutEn ? "WARN: English still on current screen" : "OK: no English See the work on screen");

// Coach gate
await page.goto(BASE + "/?nocache=cg" + Date.now(), { waitUntil: "domcontentloaded" });
await wipe();
await page.goto(BASE + "/?nocache=cg2" + Date.now(), { waitUntil: "networkidle" });
await holdToCover();
if (await page.locator("#studioLock").count()) {
  await page.locator("#studioLock").click();
  await page.waitForTimeout(400);
  await shot("v5-11-coach-gate.png");
  log("Coach gate: " + (await bodyText()).slice(0, 200));
  log(`Coach fields pin=${await page.locator("#pinA").count()} go=${await page.locator("#pinGo").count()}`);
  log("COACH BLOCKER: no COACH_PIN in env — gate UI only, did not unlock. No prod mutation.");
} else log("FAIL: Soy coach missing after hold");

const badNet = netFails.filter((u) => !/favicon|ntfy|chrome-extension/.test(u)).slice(0, 10);
log("Net fails: " + (badNet.join(" || ") || "none"));
log("Console: " + (consoleErr.slice(0, 5).join(" || ") || "none"));
log("DONE");
fs.writeFileSync(path.join(OUT, "findings-v5.json"), JSON.stringify(findings, null, 2));
await browser.close();
