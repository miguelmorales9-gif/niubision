// Consulta servidor-a-servidor desde NFW: ¿este email tiene coaching activo en NiuBision?
// Firma: HMAC-SHA256(NFW_S2S_SECRET, `${ts}.${email}`) en hex; ts en ms, ventana ±5 min.
// Responde solo { active: bool } — nunca nombre, plan ni fechas.
import { clientGate } from "./status.js";

export const normEmail = (e) => String(e || "").trim().toLowerCase();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function s2sSign(secret, ts, email) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + "." + normEmail(email))));
}
function eq(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/** Coaching activo = misma regla estricta del panel: firmado + pago confirmado + plan vigente. */
export function coachingActiveFor(state, email, nowMs) {
  const e = normEmail(email);
  if (!e || !e.includes("@")) return false;
  return ((state && state.clients) || []).some((c) => c && normEmail(c.email) === e && clientGate(c, state, nowMs).status === "activo");
}

export async function handleS2S(req, env, loadState) {
  if (!env.NFW_S2S_SECRET) return { status: 503, body: { error: "s2s_no_configurado" } };
  let b = {}; try { b = await req.json(); } catch (_) {}
  const ts = Number(req.headers.get("x-nb-ts") || 0), sig = req.headers.get("x-nb-sig") || "";
  if (!ts || Math.abs(Date.now() - ts) > 5 * 60e3) return { status: 401, body: { error: "firma_vencida" } };
  if (!eq(await s2sSign(env.NFW_S2S_SECRET, ts, b.email), sig)) return { status: 401, body: { error: "firma_invalida" } };
  const state = await loadState();
  return { status: 200, body: { active: coachingActiveFor(state, b.email, Date.now()) } };
}
