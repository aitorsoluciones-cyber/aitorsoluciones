// Planificador semanal. Lunes: produccion + primera publicacion. Miercoles: segunda revision + publicacion.
// Viernes: cierre y preparacion de la semana siguiente (se ejecuta `plan` y se repone hasta 4 semanas de colchon).
import { config, siteData } from "./paths.mjs";
import { load, save, newId, nowIso } from "./store.mjs";
import { transition } from "./states.mjs";
import { listAvailable, buildCopy, inSeason, monthOf, loadBank } from "./evergreen.mjs";
import { TEMPLATES } from "./assets.mjs";
import { canUse, recordUse, lastUse } from "./repeat.mjs";
import { lintPiece } from "./guardrails.mjs";
import { locationById, services, norm } from "./places.mjs";
import { setJobStatus } from "./jobs.mjs";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekKey = (d) => { const x = new Date(d + "T00:00:00Z"); const wd = (x.getUTCDay() + 6) % 7; return addDays(d, -wd); }; // lunes de esa semana

export function slotsFor(from, weeks, cfg = config()) {
  const out = [];
  const end = addDays(from, weeks * 7);
  for (let d = from; d < end; d = addDays(d, 1)) {
    const day = DAYS[new Date(d + "T00:00:00Z").getUTCDay()];
    for (const s of cfg.cadence.slots.filter((x) => x.day === day)) out.push({ date: d, day, time: s.time, role: s.role, channels: s.channels, key: `${d}#${day}` });
  }
  return out;
}

export function bufferStatus(today, weeks = config().cadence.minBufferWeeks, pieces = load("pieces")) {
  const slots = slotsFor(today, weeks).filter((s) => s.channels.length);
  const filled = new Set(pieces.filter((p) => ["SCHEDULED", "READY", "PUBLISHED"].includes(p.status)).map((p) => p.slot));
  const missing = slots.filter((s) => !filled.has(s.key));
  // semanas completas consecutivas desde la actual
  let covered = 0;
  for (let w = 0; w < weeks; w++) {
    const wk = addDays(weekKey(today), 7 * w);
    const need = slots.filter((s) => weekKey(s.date) === wk);
    if (need.length && need.every((s) => filled.has(s.key))) covered++; else break;
  }
  return { weeks, needed: slots.length, filled: slots.length - missing.length, missing, weeksCovered: covered, ok: missing.length === 0 };
}

const SERVICE_NAME = () => Object.fromEntries(services().map((s) => [s.id, s.name]));
const WORK_ANGLES = ["antes-despues", "que-hicimos", "zona"];

export function buildWorkCopy(job, angle) {
  const cfg = config();
  const loc = job.locationConfirmed && job.locationId ? locationById(job.locationId)?.name : null;
  const svc = SERVICE_NAME()[job.serviceId] || "Trabajo";
  const title = job.title;
  let body;
  if (angle === "antes-despues") body = `${title}${loc && !norm(title).includes(norm(loc)) ? ` en ${loc}` : ""}: antes y después del trabajo.`;
  else if (angle === "que-hicimos") { if (!job.notes) return null; body = `${title}. Qué hicimos: ${job.notes}`; }
  else { if (!loc) return null; body = `${svc} en ${loc}: fotografías reales del resultado.`; }
  const headline = angle === "que-hicimos" ? `Qué hicimos: ${title}` : title;
  const tags = [...new Set([...cfg.hashtags.base, ...(cfg.hashtags[job.serviceId?.startsWith("desbroce") ? "desbroce" : job.serviceId?.startsWith("poda") ? "poda" : "jardineria"] || [])])];
  const captions = {}, hashtagsByChannel = {};
  for (const ch of Object.keys(cfg.channels)) {
    hashtagsByChannel[ch] = tags.slice(0, cfg.channels[ch].hashtagsMax);
    const cta = ch === "gbp" ? `Llámanos al ${cfg.brand.phoneDisplay} o escríbenos por WhatsApp.` : `${cfg.brand.cta}.`;
    captions[ch] = [body, "", cta, ...(hashtagsByChannel[ch].length ? ["", hashtagsByChannel[ch].join(" ")] : [])].join("\n");
  }
  return { tag: "Trabajo real", headline, slides: [], captions, hashtagsByChannel, zones: [], alt: `Fotografía real: ${title}${loc ? ` (${loc})` : ""}` };
}

function pickTemplate(pieces, avoid = []) {
  const recent = pieces.filter((p) => p.template).sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1)).map((p) => p.template);
  const last = recent.at(-1);
  const counts = Object.fromEntries(TEMPLATES.map((t) => [t, recent.filter((x) => x === t).length]));
  return [...TEMPLATES].filter((t) => t !== last && !avoid.includes(t)).sort((a, b) => counts[a] - counts[b])[0] || TEMPLATES[0];
}

// Elige contenido para un hueco; devuelve la pieza o null si no hay material seguro.
function choose(slot, { pieces, jobs, assets, usage, weekWork, prevCategories, deliberate }) {
  const cfg = config();
  const month = monthOf(slot.date);
  const mkPiece = (kind, fields, copy) => ({
    id: newId("p"), kind, channels: slot.channels, scheduledFor: slot.date, time: slot.time, slot: slot.key, template: pickTemplate(pieces),
    copy, status: "SCHEDULED", createdAt: nowIso(), history: [{ from: "NEW", to: "SCHEDULED", at: nowIso(), note: "planificador" }], urls: {}, results: {}, ...fields
  });
  // 1) trabajo real (maximo configurado por semana; preferentemente el primer hueco de la semana)
  if (slot.day === "mon" && (weekWork.get(weekKey(slot.date)) || 0) < cfg.cadence.maxWorkPiecesPerWeek) {
    const candidates = jobs.filter((j) => ["READY", "SCHEDULED", "PUBLISHED"].includes(j.status) && j.title).map((j) => ({ j, ph: assets.filter((a) => a.jobId === j.id && a.kind === "image" && !a.needsDownload && a.sourcePath) }))
      .filter(({ ph }) => ph.some((a) => a.role === "after"))
      .sort((a, b) => (lastUse("job", a.j.id, usage) || "") < (lastUse("job", b.j.id, usage) || "") ? -1 : 1);
    for (const { j, ph } of candidates) {
      for (const angle of WORK_ANGLES) {
        if (!slot.channels.every((ch) => canUse({ kind: "job", id: j.id, channel: ch, angle, now: slot.date, deliberate }, usage).ok)) continue;
        const copy = buildWorkCopy(j, angle);
        if (!copy) continue;
        const ids = [ph.find((a) => a.role === "before"), ph.find((a) => a.role === "after")].filter(Boolean).map((a) => a.id);
        const piece = mkPiece("work", { jobId: j.id, angle, type: "work", assetIds: ids }, copy);
        if (!lintPiece(piece, { assets, jobs }).length) return { piece, uses: [{ kind: "job", id: j.id, angle }] };
      }
    }
  }
  // 2) evergreen: de temporada primero, evitando repetir categoria seguida y material usado
  const bank = listAvailable({ month: null });
  const ranked = bank.map((t) => ({ t, season: t.months && inSeason(t, month) ? 0 : t.months ? 2 : 1, recentCat: prevCategories.includes(t.category) ? 1 : 0, last: lastUse("topic", t.id, usage) || "" }))
    .sort((a, b) => a.season - b.season || a.recentCat - b.recentCat || (a.last < b.last ? -1 : a.last > b.last ? 1 : 0));
  for (const { t, season } of ranked) {
    if (season === 2) continue; // fuera de temporada: nunca
    for (const angle of t.angles) {
      if (!slot.channels.every((ch) => canUse({ kind: "topic", id: t.id, channel: ch, angle: angle.id, now: slot.date, deliberate }, usage).ok)) continue;
      const copy = buildCopy(t, angle);
      const piece = mkPiece("evergreen", { topicId: t.id, angle: angle.id, type: angle.type, category: t.category, assetIds: [] }, copy);
      if (!lintPiece(piece, { assets, jobs }).length) return { piece, uses: [{ kind: "topic", id: t.id, angle: angle.id }] };
    }
  }
  return null;
}

export function plan({ today, weeks = config().cadence.minBufferWeeks, dryRun = false, allowReuse = false } = {}) {
  const pieces = load("pieces");
  const jobs = load("jobs");
  const assets = load("assets");
  const usage = load("usage");
  const status = bufferStatus(today, weeks, pieces);
  const created = [];
  const shortages = [];
  const weekWork = new Map();
  for (const p of pieces.filter((x) => x.kind === "work" && x.status !== "ARCHIVED")) weekWork.set(weekKey(p.scheduledFor), (weekWork.get(weekKey(p.scheduledFor)) || 0) + 1);
  const prevCats = pieces.filter((p) => p.category).sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1)).slice(-2).map((p) => p.category);
  for (const slot of status.missing) {
    const ctx = { pieces: [...pieces, ...created], jobs, assets, usage, weekWork, prevCategories: prevCats.slice(-2), deliberate: false };
    let pick = choose(slot, ctx);
    if (!pick && allowReuse) pick = choose(slot, { ...ctx, deliberate: true });
    if (!pick) { shortages.push(slot.key); continue; }
    created.push(pick.piece);
    if (pick.piece.category) prevCats.push(pick.piece.category);
    if (pick.piece.kind === "work") weekWork.set(weekKey(slot.date), (weekWork.get(weekKey(slot.date)) || 0) + 1);
    for (const u of pick.uses) for (const ch of slot.channels) usage.push({ kind: u.kind, id: u.id, channel: ch, angle: u.angle, pieceId: pick.piece.id, date: slot.date });
  }
  if (!dryRun && created.length) {
    save("pieces", [...pieces, ...created]); save("usage", usage);
    for (const p of created.filter((x) => x.kind === "work")) { try { setJobStatus(p.jobId, "SCHEDULED", "planificado"); } catch { /* ya SCHEDULED/PUBLISHED */ } }
  }
  return { created, shortages, before: status, after: bufferStatus(today, weeks, [...pieces, ...created]) };
}

// Cancelar una pieza libera el hueco y el registro de uso (para poder reutilizar el material).
export function cancelPiece(id, note = "cancelada") {
  const pieces = load("pieces");
  const p = pieces.find((x) => x.id === id);
  if (!p) throw new Error(`Pieza no encontrada: ${id}`);
  if (p.status === "PUBLISHED") throw new Error("Una pieza publicada no se cancela; archivala");
  transition(p, "ARCHIVED", note);
  p.slot = null;
  save("pieces", pieces);
  save("usage", load("usage").filter((u) => u.pieceId !== id));
  return p;
}
