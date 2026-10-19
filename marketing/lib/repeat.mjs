// Control de repeticiones: registro de uso por material/tema, enfoque (angulo) y canal.
import { load, save, nowIso } from "./store.mjs";
import { config } from "./paths.mjs";

const days = (a, b) => Math.floor((new Date(a) - new Date(b)) / 86400000);

// Reglas: mismo material + mismo enfoque: nunca (reutilizacion deliberada solo tras cooldownDays);
// mismo material con otro enfoque: solo tras newAngleCooldownDays desde el ultimo uso.
export function canUse({ kind, id, channel, angle, now = nowIso(), deliberate = false }, usage = load("usage")) {
  const r = config().reuse;
  const mine = usage.filter((u) => u.kind === kind && u.id === id);
  if (!mine.length) return { ok: true };
  const last = mine.map((u) => u.date).sort().at(-1);
  const since = days(now, last);
  if (mine.some((u) => u.angle === angle)) {
    if (deliberate && since >= r.cooldownDays) return { ok: true, reuse: true };
    return { ok: false, reason: `ya usado con el mismo enfoque (${angle}); reutilizacion deliberada solo tras ${r.cooldownDays} dias` };
  }
  if (since < r.newAngleCooldownDays) return { ok: false, reason: `usado hace ${since} dias; otro enfoque solo tras ${r.newAngleCooldownDays} dias` };
  if (r.requireNewAngle && !angle) return { ok: false, reason: "reutilizacion sin enfoque nuevo" };
  return { ok: true, reuse: true };
}

export function recordUse({ kind, id, channel, angle, pieceId, date }) {
  const usage = load("usage");
  usage.push({ kind, id, channel, angle: angle || null, pieceId: pieceId || null, date: date || nowIso().slice(0, 10) });
  save("usage", usage);
}

export const lastUse = (kind, id, usage = load("usage")) => usage.filter((u) => u.kind === kind && u.id === id).map((u) => u.date).sort().at(-1) || null;
