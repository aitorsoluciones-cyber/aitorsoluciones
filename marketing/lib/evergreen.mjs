// Banco evergreen: temas reutilizables con varios enfoques. Siempre hay contenido aunque no haya trabajos nuevos.
import path from "node:path";
import { MK_DIR, readJson, config } from "./paths.mjs";
import { load, save } from "./store.mjs";
import { servedZones } from "./places.mjs";

export const CATEGORY_TAG = {
  desbroce: "Desbroce", poda: "Poda", jardineria: "Jardinería", consejo: "Consejo", faq: "Preguntas frecuentes",
  propiedades: "Propiedades", "segundas-residencias": "Segundas residencias", local: "Zona", estacional: "Temporada", mantenimiento: "Mantenimiento"
};

export const loadBank = () => readJson(path.join(MK_DIR, "bank", "evergreen.json")).topics;

export function isApproved(topic, approvals = load("approvals")) {
  return topic.reviewed === true || approvals[topic.id] === true;
}

export function approveTopic(id) {
  const t = loadBank().find((x) => x.id === id);
  if (!t) throw new Error(`Tema evergreen inexistente: ${id}`);
  const approvals = load("approvals");
  approvals[id] = true;
  save("approvals", approvals);
  return t;
}

const joinList = (a) => (a.length > 1 ? a.slice(0, -1).join(", ") + " y " + a.at(-1) : a[0] || "");

export function monthOf(dateStr) { return Number(dateStr.slice(5, 7)); }
export const inSeason = (topic, month) => !topic.months || topic.months.includes(month);

// Convierte un tema+enfoque en el texto final de la pieza (por canal), sin inventar nada.
export function buildCopy(topic, angle) {
  const cfg = config();
  const zones = servedZones();
  const usesZones = JSON.stringify(angle).includes("{{zones}}");
  const fill = (s) => String(s).replaceAll("{{zones}}", joinList(zones));
  const slides = (angle.slides || []).map((s) => ({ t: fill(s.t), b: fill(s.b) }));
  const headline = fill(angle.headline);
  const body = fill(angle.caption);
  const base = cfg.hashtags.base;
  const tags = [...new Set([...base, ...(cfg.hashtags[topic.category] || [])])];
  const hashtagsByChannel = {};
  const captions = {};
  for (const ch of Object.keys(cfg.channels)) {
    const max = cfg.channels[ch].hashtagsMax;
    hashtagsByChannel[ch] = tags.slice(0, max);
    const cta = ch === "gbp" ? `Llámanos al ${cfg.brand.phoneDisplay} o escríbenos por WhatsApp.` : `${cfg.brand.cta}.`;
    captions[ch] = [headline, "", body, "", cta, ...(hashtagsByChannel[ch].length ? ["", hashtagsByChannel[ch].join(" ")] : [])].join("\n");
  }
  return {
    tag: CATEGORY_TAG[topic.category] || "", headline, slides, captions, hashtagsByChannel, zones: usesZones ? zones : [],
    alt: `Gráfico informativo de Aitor Soluciones: ${headline}`
  };
}

export function listAvailable({ month, approvals = load("approvals"), bank = loadBank() } = {}) {
  return bank.filter((t) => isApproved(t, approvals) && (month == null || inSeason(t, month)));
}
