// API publica del motor visual (backend / task runner). Work produce un brief; estas funciones generan las piezas.
export {
  generateEditorialImage, editRealWorkImage, generateBackground, generateIllustration, generateInfographicVisual,
  generateCarouselAssets, resizeForChannels, applyBrandOverlay, applyLogo, applyText, validateImage, registerAsset, runBrief, BriefError
} from "./engine.mjs";
export { normalizeBrief } from "./brief.mjs";
export { buildPrompt } from "./prompts.mjs";
export { readEnv, estimateCost, spentThisMonth, ConfigError, ApiError } from "./openai.mjs";

import fs from "node:fs";
import path from "node:path";
import { home, ensureDir, queueDir } from "../paths.mjs";
import { runBrief } from "./engine.mjs";
import { load, save, findById, nowIso } from "../store.mjs";
import { locations, norm } from "../places.mjs";
import { config } from "../paths.mjs";

// Variables desde <estado>/.env (fuera de git) si no estan ya definidas en el entorno.
export function loadEnvFile(env = process.env) {
  const f = path.join(home(), ".env");
  if (!fs.existsSync(f)) return [];
  const set = [];
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && env[m[1]] === undefined) { env[m[1]] = m[2].replace(/^["']|["']$/g, ""); set.push(m[1]); }
  }
  return set;
}

// Cola de briefs: <estado>/briefs/*.json -> resultado en briefs/done|failed. Pensado para un task runner programado.
export async function runBriefQueue(ctx = {}) {
  const dir = path.join(home(), "briefs");
  ensureDir(path.join(dir, "done")); ensureDir(path.join(dir, "failed"));
  const results = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(dir, name);
    let out;
    try { out = await runBrief(JSON.parse(fs.readFileSync(file, "utf8")), ctx); } catch (e) { out = { ok: false, error: e.message }; }
    const dest = path.join(dir, out.ok ? "done" : "failed", name);
    fs.writeFileSync(dest.replace(/\.json$/, ".result.json"), JSON.stringify(out, null, 2) + "\n");
    if (!ctx.dryRun) fs.renameSync(file, dest);
    results.push({ brief: name, ok: out.ok, error: out.error, outputs: out.outputs });
  }
  return results;
}

// Vincula material visual (graficos/generados, nunca fotos reales) a una pieza evergreen. La transparencia ya va en la propia imagen
// (etiqueta "Ilustracion" solo cuando la imagen generada puede confundirse con una fotografia); aqui se registra el resumen.
export function attachToPiece(pieceId, assetIds) {
  const pieces = load("pieces"), assets = load("assets");
  const p = findById(pieces, pieceId);
  if (!p) throw new Error(`Pieza no encontrada: ${pieceId}`);
  if (p.kind === "work") throw new Error("Las piezas de trabajo real usan sus fotos reales; no se les adjunta imagen generada");
  const chosen = assetIds.map((id) => findById(assets, id));
  chosen.forEach((a, i) => { if (!a) throw new Error(`Material inexistente: ${assetIds[i]}`); if (a.origin === "real") throw new Error(`${a.id} es una foto real: no se adjunta a piezas evergreen`); if (a.status !== "READY") throw new Error(`${a.id} no esta READY`); });
  const gen = chosen.filter((a) => a.aiGenerated);
  p.visual = {
    assetIds, carousel: chosen.filter((a) => /^carousel-\d+$/.test(a.format || "")).sort((a, b) => parseInt(a.format.slice(9)) - parseInt(b.format.slice(9))).map((a) => a.id),
    formats: Object.fromEntries(chosen.filter((a) => ["feed", "story", "gbp"].includes(a.format)).map((a) => [a.format, a.id])),
    aiGenerated: gen.length > 0, models: [...new Set(gen.map((a) => a.model).filter(Boolean))], labelApplied: gen.some((a) => a.labelApplied), attachedAt: nowIso()
  };
  // Si la pieza ya estaba preparada en la cola con otra imagen (p. ej. el grafico tipografico), se rehace: nada publicado se toca.
  for (const ch of p.channels || []) {
    if (p.channelStatus?.[ch] !== "READY_TO_PUBLISH") continue;
    fs.rmSync(queueDir("READY_TO_PUBLISH", `${p.scheduledFor}__${p.id}__${ch}`), { recursive: true, force: true });
    delete p.channelStatus[ch];
  }
  delete p.render;
  p.visualState = chosen.every((a) => a.origin !== "generated" || a.autoPublish === true) ? "VISUAL_APPROVED" : "VISUAL_PENDING";
  save("pieces", pieces);
  return p;
}

// Aprobacion humana de un activo que no paso por el critico visual (autoPublish:false). Deja constancia de quien y cuando.
export function approveAsset(assetId, who = "humano") {
  const assets = load("assets");
  const a = findById(assets, assetId);
  if (!a) throw new Error(`Material inexistente: ${assetId}`);
  a.autoPublish = true; a.humanApproved = { by: who, at: nowIso() };
  save("assets", assets);
  const pieces = load("pieces");
  for (const p of pieces.filter((x) => (x.visual?.assetIds || []).includes(assetId))) if ((p.visual.assetIds || []).every((id) => findById(assets, id)?.autoPublish === true)) p.visualState = "VISUAL_APPROVED";
  save("pieces", pieces);
  return a;
}

// Brief para una pieza evergreen del plan: material/banco -> brief. El titular y el CTA son los de la pieza; nada se inventa.
export function briefFromPiece(piece, overrides = {}) {
  if (!piece || piece.kind === "work") throw new Error("briefFromPiece: solo piezas evergreen");
  const carousel = piece.type === "carousel" && (piece.copy?.slides || []).length > 1;
  const ig = (piece.channels || []).includes("instagram");
  const channel = ig ? "instagram" : (piece.channels || [])[0] || "facebook";
  const zone = (piece.copy?.zones || []).find((z) => locations().some((l) => l.isPriority && norm(l.name) === norm(z)));
  return {
    campaign: String(piece.id).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60),
    type: carousel ? "carousel" : "editorial", source_images: [], channel, channels: piece.channels || [channel], aspect_ratio: channel === "gbp" ? "4:3" : "4:5",
    ...(carousel ? { points: piece.copy.slides.map((s) => ({ t: s.t, b: s.b })), tag: piece.copy.tag } : {}),
    headline: piece.copy.headline, cta: config().brand.cta, location: zone || null, use_real_work: false, pieceId: piece.id, ...overrides
  };
}

// material/banco -> brief -> imagen -> pieza: genera la imagen de una pieza evergreen y la adjunta si el resultado es valido.
export async function runForPiece(pieceId, overrides = {}, ctx = {}) {
  const piece = findById(load("pieces"), pieceId);
  if (!piece) throw new Error(`Pieza no encontrada: ${pieceId}`);
  const r = await runBrief(briefFromPiece(piece, overrides), ctx);
  if (r.ok && !ctx.dryRun) {
    const assets = load("assets");
    attachToPiece(pieceId, r.assetIds.filter((id) => /^(feed|story|gbp|carousel-\d+)$/.test(findById(assets, id)?.format || "")));
  }
  return r;
}
