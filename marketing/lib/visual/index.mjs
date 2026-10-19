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
import { home, ensureDir } from "../paths.mjs";
import { runBrief } from "./engine.mjs";
import { load, save, findById } from "../store.mjs";
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

// Vincula material visual (graficos/generados, nunca fotos reales) a una pieza evergreen; anade la etiqueta de transparencia.
export function attachToPiece(pieceId, assetIds) {
  const pieces = load("pieces"), assets = load("assets");
  const p = findById(pieces, pieceId);
  if (!p) throw new Error(`Pieza no encontrada: ${pieceId}`);
  if (p.kind === "work") throw new Error("Las piezas de trabajo real usan sus fotos reales; no se les adjunta imagen generada");
  const chosen = assetIds.map((id) => findById(assets, id));
  chosen.forEach((a, i) => { if (!a) throw new Error(`Material inexistente: ${assetIds[i]}`); if (a.origin === "real") throw new Error(`${a.id} es una foto real: no se adjunta a piezas evergreen`); if (a.status !== "READY") throw new Error(`${a.id} no esta READY`); });
  p.visual = { assetIds, formats: Object.fromEntries(chosen.filter((a) => ["feed", "story", "gbp"].includes(a.format)).map((a) => [a.format, a.id])) };
  const note = config().imageEngine.disclosure.generated;
  if (chosen.some((a) => a.origin === "generated")) {
    for (const ch of Object.keys(p.copy.captions)) {
      const cap = p.copy.captions[ch];
      if (cap.includes(note)) continue;
      const at = cap.lastIndexOf("\n\n#");
      p.copy.captions[ch] = at > -1 ? cap.slice(0, at) + "\n\n" + note + cap.slice(at) : cap + "\n\n" + note;
    }
  }
  save("pieces", pieces);
  return p;
}
