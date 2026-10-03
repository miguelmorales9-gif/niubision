// Browserless smoke for the full-test fixes. Does not boot the app and does not hit the network.
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
vm.runInContext(code + "\nglobalThis.__nb = { state, workView, homeView, lookupAccess, authLogin, peopleView, allRoutines, isProgramRestDay };\n", sandbox, { timeout: 8000 });
const nb = sandbox.__nb;

const fail = (m) => { console.error("FAIL", m); process.exitCode = 1; };
const INVALID = "Código no válido o aún no está pagado.";
const WRONG = "Clave incorrecta";

nb.state.role = "coach";
nb.state.clients = [{ id: "c1", name: "Ana", routine: "fuerza-4", plan: "Estándar", accessCode: "111111" }];
nb.state.settings.clientId = "c1";
nb.state.profile.level = "principiante";
nb.state.profile.routine = "fuerza-4";
const before = nb.state.clients[0].routine;
nb.workView();
if (nb.state.clients[0].routine !== before) fail("workView changed routine " + before + " -> " + nb.state.clients[0].routine);
else console.log("ok workView keeps", before);

nb.state.role = "client";
nb.state.profile.unlocked = true;
nb.state.profile.name = "Ana";
nb.state.profile.plan = "Estándar";
nb.state.history = [];
const restRt = nb.allRoutines().find((r) => r && r.daysPlan && r.daysPlan.length && nb.isProgramRestDay(r));
if (!restRt) fail("no rest routine for this weekday");
else {
  nb.state.profile.routine = restRt.id;
  const html = nb.homeView();
  if (html.includes("Entrenar ahora")) fail("rest day offers Entrenar ahora for " + restRt.id);
  else if (!html.includes("descanso")) fail("rest day copy missing");
  else console.log("ok rest day", restRt.id);
}

let lookupErr = null;
try { await nb.lookupAccess("123456"); }
catch (e) { lookupErr = e; }
if (!lookupErr || !lookupErr.nbNet) fail("lookupAccess did not throw network");
else if (String(lookupErr.message).includes(INVALID) || /no válido/i.test(String(lookupErr.message))) fail("lookup used invalid-code string");
else console.log("ok lookup network");

let authErr = null;
let authVal = "unset";
try { authVal = await nb.authLogin("coach", "0000"); }
catch (e) { authErr = e; }
if (authVal === null) fail("authLogin returned null on network failure (would show wrong PIN)");
else if (!authErr || !authErr.nbNet) fail("authLogin did not throw network");
else if (String(authErr.message).includes(WRONG)) fail("auth used wrong-PIN string");
else console.log("ok auth network");

nb.state.role = "coach";
nb.state.clients = [];
const gente = nb.peopleView();
if (!gente.includes("Todavía no hay gente")) fail("empty gente copy missing");
if (!gente.includes("<b>0</b><span>Activo</span>")) fail("activo chip not zero");
if (gente.includes("<b>3</b><span>Activo</span>")) fail("demo activo chip still present");
else console.log("ok gente zeros");

if (process.exitCode) process.exit(process.exitCode);
console.log("smoke ok");
