// Estados del material y de las piezas, y carpetas de Drive asociadas.
import { config } from "./paths.mjs";

export const STATES = ["NEW", "REVIEWED", "READY", "SCHEDULED", "PUBLISHED", "ARCHIVED", "REJECTED"];

const TRANSITIONS = {
  NEW: ["REVIEWED", "REJECTED", "ARCHIVED"],
  REVIEWED: ["READY", "NEW", "REJECTED", "ARCHIVED"],
  READY: ["SCHEDULED", "REVIEWED", "ARCHIVED", "REJECTED"],
  SCHEDULED: ["PUBLISHED", "READY", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  REJECTED: ["NEW", "ARCHIVED"],
  ARCHIVED: ["NEW"]
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

export function transition(entity, to, note) {
  if (!STATES.includes(to)) throw new Error(`Estado desconocido: ${to}`);
  if (entity.status === to) return entity;
  if (!canTransition(entity.status, to)) throw new Error(`Transicion no permitida: ${entity.status} -> ${to}`);
  entity.history = [...(entity.history || []), { from: entity.status, to, at: new Date().toISOString(), note: note || "" }];
  entity.status = to;
  return entity;
}

// Carpeta de Drive que le corresponde a un estado (para el plan de movimientos).
export function driveFolderFor(status) {
  const c = config().drive;
  const key = c.stateFolder[status];
  return key ? c.folders[key] : null;
}
