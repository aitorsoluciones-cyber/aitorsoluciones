// Estado visual de las piezas evergreen. Regla: SOLO se publica con un visual aprobado por el motor (OpenAI + critico) o con
// aprobacion humana. Nunca se vuelve automaticamente a las antiguas plantillas tipograficas.
//   VISUAL_APPROVED  imagen generada que paso el critico (o aprobada a mano) y cubre los formatos del canal -> puede ir a READY_TO_PUBLISH
//   VISUAL_PENDING   aun sin imagen valida (o sin revisar) -> no se encola
//   REJECTED         agotados los intentos -> NO se publica esa pieza hasta `mk visual retry`
//   MANUAL_GRAPHIC   excepcion manual explicita (`mk visual allow-graphic`) -> solo para emergencias
import fs from "node:fs";
import { load, save, findById, nowIso } from "./store.mjs";
import { config } from "./paths.mjs";

export const VISUAL = { APPROVED: "VISUAL_APPROVED", PENDING: "VISUAL_PENDING", REJECTED: "REJECTED", MANUAL: "MANUAL_GRAPHIC", NA: "N/A" };

export class VisualPendingError extends Error {
  constructor(pieceId, missing, state = VISUAL.PENDING) {
    super(`La pieza ${pieceId} no tiene imagen aprobada (${state}; faltan: ${missing.join(", ")}): no se publica con plantillas tipograficas`);
    this.code = "VISUAL_PENDING"; this.pieceId = pieceId; this.missing = missing; this.state = state;
  }
}

// Formatos que necesita una pieza evergreen segun sus canales (el feed de un carrusel sale de su portada).
export function neededFormats(piece) {
  const wants = (fmt) => (piece.channels || []).some((ch) => config().channels[ch]?.formats.includes(fmt));
  const slides = piece.copy?.slides || [];
  const single = piece.type === "single" || slides.length <= 1;
  return single ? ["feed", "story", "gbp"].filter(wants) : [...(wants("carousel") ? ["carousel"] : []), ...(wants("feed") && !wants("carousel") ? ["feed"] : []), ...["story", "gbp"].filter(wants)];
}
export function coveredFormats(piece, assets = load("assets")) {
  const ok = (id) => { const a = findById(assets, id); return !!(a && a.sourcePath && fs.existsSync(a.sourcePath)); };
  const cov = new Set(Object.entries(piece.visual?.formats || {}).filter(([, id]) => ok(id)).map(([f]) => f));
  if ((piece.visual?.carousel || []).length && piece.visual.carousel.every(ok)) { cov.add("carousel"); cov.add("feed"); }
  return cov;
}

// Estado calculado a partir de lo que la pieza referencia realmente (no se fia de una etiqueta guardada).
export function visualStateOf(piece, assets = load("assets")) {
  if (piece.kind === "work") return VISUAL.NA;
  if (piece.manualGraphic) return VISUAL.MANUAL;
  const ids = piece.visual?.assetIds || [];
  const recs = ids.map((id) => findById(assets, id));
  const okFiles = recs.length > 0 && recs.every((a) => a && a.sourcePath && fs.existsSync(a.sourcePath));
  const reviewed = recs.every((a) => a && (a.origin !== "generated" || a.autoPublish === true));
  const cov = coveredFormats(piece, assets);
  if (okFiles && reviewed && neededFormats(piece).every((f) => cov.has(f))) return VISUAL.APPROVED;
  return piece.visualState === VISUAL.REJECTED ? VISUAL.REJECTED : VISUAL.PENDING;
}

const mutate = (pieceId, fn) => {
  const pieces = load("pieces");
  const p = findById(pieces, pieceId);
  if (!p) throw new Error(`Pieza no encontrada: ${pieceId}`);
  fn(p);
  save("pieces", pieces);
  return p;
};

// Resultado de un intento de generar la imagen de una pieza. Tras `maxAttempts` fallos la pieza queda REJECTED (no se publica).
export function recordVisualAttempt(pieceId, { ok, reason = null, costUsd = 0 }) {
  const max = config().imageEngine.auto?.maxAttempts ?? 2;
  return mutate(pieceId, (p) => {
    p.visualAttempts = [...(p.visualAttempts || []), { at: nowIso(), ok: !!ok, reason, costUsd }];
    const fails = p.visualAttempts.filter((a) => !a.ok).length;
    p.visualState = ok ? visualStateOf(p) : fails >= max ? VISUAL.REJECTED : VISUAL.PENDING;
  });
}

export const retryVisual = (pieceId) => mutate(pieceId, (p) => { p.visualAttempts = []; p.visualState = VISUAL.PENDING; });

// Excepcion manual y explicita: permite renderizar esa pieza con las plantillas tipograficas antiguas. Queda registrada.
export const allowManualGraphic = (pieceId, by, reason) => {
  if (!by || !reason) throw new Error("allow-graphic exige quien lo autoriza (--by) y el motivo (--reason)");
  return mutate(pieceId, (p) => { p.manualGraphic = { by, reason, at: nowIso() }; });
};
