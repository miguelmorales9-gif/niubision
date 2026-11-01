// Estado de un cliente, derivado (nunca guardado): firma (relevo + contrato) y pago confirmado con período vigente.
// Pago confirmado = unpaid === false. Solo lo pone en false la confirmación (Stripe pagado, PayPal capturado,
// ATH confirmado por el coach). Registrarse, elegir plan, ATH iniciado o un checkout empezado/vencido NO cuentan.
const signedDoc = (d) => !!(d && typeof d === "object" && (String(d.signature || "").length > 0 || d.date));

export function isSigned(c, state) {
  if (!c) return false;
  const contracts = (state && state.contracts) || [];
  const waiver = signedDoc(c.waiver);
  const contract = signedDoc(c.contract) || contracts.some((k) => k && c.id && k.clientId === c.id && signedDoc(k));
  return waiver && contract;
}
export function isRevokedClient(c, state) {
  const rv = (state && state.revoked) || [];
  return rv.some((r) => r && ((c.id && String(r.clientId || "") === String(c.id)) || (/^\d{6}$/.test(String(r.code || "")) && String(r.code) === String(c.accessCode || ""))));
}
function dayKey(ms) {
  // America/Puerto_Rico = UTC-4, sin horario de verano.
  return new Date((ms == null ? Date.now() : ms) - 4 * 3600000).toISOString().slice(0, 10);
}
export function isPaidActive(c, state, nowMs) {
  if (!c || c.unpaid !== false || c.archived) return false;
  if (isRevokedClient(c, state)) return false;
  if (c.endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(c.endDate)) && String(c.endDate) < dayKey(nowMs)) return false;
  return true;
}
/** { signed, paid, status } con status: "pendiente de firma" | "pendiente de pago" | "vencido" | "activo". */
export function clientGate(c, state, nowMs) {
  const signed = isSigned(c, state);
  const paid = isPaidActive(c, state, nowMs);
  const expired = !!(c && c.unpaid === false && !paid && !isRevokedClient(c, state) && !c.archived);
  const status = !signed ? "pendiente de firma" : expired ? "vencido" : !paid ? "pendiente de pago" : "activo";
  return { signed, paid, status };
}
/** Avisos de entrenamiento (plan, sesión, recordatorio diario) solo para clientes firmados con pago vigente. */
export function canNotifyTraining(c, state, nowMs) {
  const g = clientGate(c, state, nowMs);
  return g.signed && g.paid;
}
export const SIGN_PROMPT = { title: "Falta su firma", body: "Firme el relevo y el contrato en NiuBision para activar su plan.", url: "/?view=price", tag: "nb-firma" };
