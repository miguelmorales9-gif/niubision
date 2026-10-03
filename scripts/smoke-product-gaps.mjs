// Browserless smoke for the five product gaps. Does not boot the app and does not hit the network.
import { readFileSync } from "fs";
import vm from "vm";

const code = readFileSync(new URL("../app/app.js", import.meta.url), "utf8").replace(/\nboot\(\);\s*$/, "\n");
const mem = {};
const ls = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
const el = () => ({
  innerHTML: "", style: {}, hidden: false, value: "", textContent: "",
  classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  setAttribute(){}, getAttribute(){ return ""; }, addEventListener(){}, removeEventListener(){},
  appendChild(){}, remove(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
  focus(){}, select(){}, dataset: {}
});
const document = {
  getElementById: () => el(),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => el(),
  addEventListener(){},
  body: el(),
  documentElement: el()
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 16),
  cancelAnimationFrame: clearTimeout,
  URL, URLSearchParams, TextEncoder, TextDecoder, AbortController,
  atob, btoa, Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp,
  Map, Set, parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent,
  crypto: globalThis.crypto,
  fetch: async () => { throw new Error("failed to fetch"); },
  localStorage: ls,
  sessionStorage: ls,
  navigator: { userAgent: "Mozilla/5.0", onLine: true, language: "es" },
  location: { search: "", hash: "", href: "https://niubision.com/", pathname: "/", origin: "https://niubision.com" },
  history: { replaceState(){}, pushState(){} },
  document,
  matchMedia: () => ({ matches: false, addEventListener(){} })
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + "\nglobalThis.__nb = { state, accessStateHtml, sessionProofHtml, pedirBriefHtml, pedirStatusLabel, planProgressHtml, pricesView, programasView, openPedirBeats, paraTiPick, todayKey, requestProgram };\n", sandbox, { timeout: 8000 });
const nb = sandbox.__nb;
const fail = (m) => { console.error("FAIL", m); process.exitCode = 1; };

nb.state.role = "guest";
nb.state.profile = { name: "", plan: "", unlocked: false, phone: "" };
nb.state.clients = [];
nb.state.payments = [];
nb.state._pendingLead = null;
nb.state.waiver = null;
nb.state.health = null;
nb.state.contracts = [];
let html = nb.accessStateHtml();
if (!html.includes("Cómo recuperar el código")) fail("recover state missing: " + html.slice(0, 180));
else if (!html.includes("data-access=\"recuperar\"")) fail("recover id missing");
else console.log("ok access recover");

nb.state.profile = { name: "Ana Ruiz", plan: "Estándar", unlocked: false, phone: "7875550101" };
nb.state._pendingLead = { id: "c1", name: "Ana Ruiz", phone: "7875550101", unpaid: true, plan: "Estándar" };
nb.state.clients = [nb.state._pendingLead];
nb.state.payments = [{ id: "p1", status: "iniciado", name: "Ana Ruiz", clientId: "c1", method: "ath" }];
html = nb.accessStateHtml();
if (!html.includes("Pago pendiente")) fail("pago pendiente missing");
else if (/c[oó]digo enviado/i.test(html)) fail("pago state also says codigo enviado");
else console.log("ok access pago pendiente");

nb.state.clients[0].accessCode = "123456";
nb.state.clients[0].unpaid = false;
nb.state.profile.accessCode = "123456";
html = nb.accessStateHtml();
if (!html.includes("Código enviado")) fail("codigo enviado missing");
else if (!html.includes("relevo")) fail("legal reminder missing on code state");
else console.log("ok access codigo enviado");

nb.state.videos = [];
nb.state.history = [];
const ses = { items: [{ name: "Sentadilla", exId: "Goblet_Squat", sets: [{ w: "100", r: "8", done: true }, { w: "", r: "", done: false }] }] };
html = nb.sessionProofHtml(ses);
if (/video enviado/i.test(html)) fail("session without video says video enviado");
else if (!html.includes("100")) fail("logged load missing");
else if (!html.includes("Al día") && !html.includes("Sin conexión")) fail("sync signal missing");
else console.log("ok session proof without video");

nb.state.videos = [{ id: "v1", date: nb.todayKey(), status: "enviado", exercise: "Sentadilla", clientId: "c1" }];
html = nb.sessionProofHtml(ses);
if (!/Video enviado/.test(html)) fail("confirmed video did not say Video enviado");
else console.log("ok video enviado only when sent");

html = nb.pedirBriefHtml({});
if (!html.includes("Objetivo") || !html.includes("Días") || !html.includes("Equipo") || !html.includes("Molestia")) fail("short pedir fields missing");
else if (/Ver plantillas|prog-card|Empezar este/.test(html)) fail("pedir brief looks like the catalog");
else console.log("ok pedir short form");
const src = nb.openPedirBeats.toString();
if (!src.includes("pedirBriefHtml") || !src.includes("Pedido corto")) fail("openPedirBeats is not the short form");
else if (/progOpenCatalog|Ver plantillas/.test(src)) fail("pedir opens the catalog");
else console.log("ok pedir entry is not the catalog");

nb.state.role = "client";
nb.state.profile.unlocked = true;
nb.state.profile.level = "principiante";
nb.state.profile.routine = "full-inicio";
nb.state.programRequests = [{
  id: "pr1", status: "pending", name: "Ana Ruiz", clientId: "c1", accessCode: "123456",
  objetivo: "Fuerza", dias: "3", equipo: "Gimnasio", molestia: "rodilla",
  routineId: "", routineName: "Pedido · Fuerza"
}];
html = nb.programasView();
if (!html.includes("Para ti")) fail("para ti missing");
else if (!html.includes("data-pedir-status=\"pedido\"")) fail("pedido status missing");
else if (!html.includes("Ver fichas") && !html.includes("Vista compacta")) fail("compact toggle missing");
else if (nb.pedirStatusLabel("approved") !== "aprobado" || nb.pedirStatusLabel("ignored") !== "rechazado") fail("status labels");
else console.log("ok programas compact + para ti + pedido");

const pick = nb.paraTiPick();
if (!pick || !pick.id) fail("para ti pick empty");
else console.log("ok para ti", pick.id);

nb.state.role = "guest";
nb.state.profile = { name: "", plan: "", unlocked: false };
nb.state.payments = [];
nb.state.clients = [];
nb.state._pendingLead = null;
nb.state.waiver = null;
nb.state.contracts = [];
html = nb.planProgressHtml();
if (!html.includes("Paso actual: Pago")) fail("progress did not name Pago: " + html);
else if (!html.includes('aria-label="Pago, relevo, contrato, código, Hoy"')) fail("progress order missing Contrato: " + html);
else if (!html.includes("→")) fail("progress line missing arrows");
else console.log("ok progress pago + order");
nb.state.profile = { name: "Ana Ruiz", plan: "Estándar", unlocked: false };
nb.state.payments = [{ status: "iniciado", name: "Ana Ruiz", clientId: "c9" }];
html = nb.planProgressHtml();
if (!html.includes("Paso actual: Relevo")) fail("progress did not name Relevo");
else console.log("ok progress relevo");
const no = { q1: "no", q2: "no", q3: "no", q4: "no", q5: "no", q6: "no", q7: "no" };
nb.state.waiver = { name: "Ana Ruiz", date: "2026-10-02", signature: "waiver" };
nb.state.health = { name: "Ana Ruiz", date: "2026-10-02", phone: "7875550101", emer: "Luis 7875550102", ...no };
nb.state.contracts = [{ name: "Ana Ruiz", plan: "Estándar", date: "2026-10-02", signature: "" }];
html = nb.planProgressHtml();
if (!html.includes("Paso actual: Contrato")) fail("unsigned contract did not remain current");
else console.log("ok progress unsigned contract");
nb.state.contracts[0].signature = "data:image/png;base64,signed";
html = nb.planProgressHtml();
if (!html.includes("Paso actual: Código")) fail("signed contract did not advance to Código");
else console.log("ok progress signed contract");
html = nb.pricesView();
if (/Empezar este (plan|camino)/.test(html)) fail("equal start CTAs still in prices");
else if (!html.includes("Paso actual:")) fail("prices missing progress line");
else console.log("ok prices one progress line");

if (process.exitCode) process.exit(process.exitCode);
console.log("smoke ok");
