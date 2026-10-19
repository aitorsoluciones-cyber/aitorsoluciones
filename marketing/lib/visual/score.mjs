// Puntuacion y rechazo automatico de imagenes. Capa 1: metricas de pixeles (siempre). Capa 2: critico visual opcional
// (OPENAI_VISION_MODEL) que aplica los criterios de rechazo (personas deformadas, herramientas irreales, etc.).
import sharp from "sharp";
import { config } from "../paths.mjs";
import { style } from "./prompts.mjs";
import { critique } from "./openai.mjs";
import { criticPrompt } from "./prompts.mjs";

function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max / 255];
}

export async function metrics(buf) {
  const small = await sharp(buf).removeAlpha().resize(256, 256, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = small;
  let sat = 0, highSat = 0, tech = 0, lum = 0, lum2 = 0;
  const px = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const [h, s, v] = hsv(data[i], data[i + 1], data[i + 2]);
    sat += s; if (s > 0.8) highSat++;
    if (s > 0.45 && v > 0.5 && h >= 180 && h <= 290) tech++;
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum += y; lum2 += y * y;
  }
  const meanLum = lum / px;
  const contrast = Math.sqrt(Math.max(0, lum2 / px - meanLum * meanLum));
  // nitidez: desviacion tipica del laplaciano
  const lap = await sharp(buf).removeAlpha().greyscale().resize(512, 512, { fit: "inside" }).convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).raw().toBuffer();
  let m = 0, m2 = 0;
  for (const v of lap) { m += v; m2 += v * v; }
  m /= lap.length; const sharpness = Math.sqrt(Math.max(0, m2 / lap.length - m * m));
  // simetria especular (las IA tienden a escenas demasiado simetricas)
  const g = await sharp(buf).removeAlpha().greyscale().resize(64, 64, { fit: "fill" }).raw().toBuffer();
  let diff = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) diff += Math.abs(g[y * 64 + x] - g[y * 64 + (63 - x)]);
  const symmetry = 1 - diff / (64 * 32 * 255);
  return { meanSaturation: +(sat / px).toFixed(3), highSatShare: +(highSat / px).toFixed(3), techHueShare: +(tech / px).toFixed(3), meanLuma: +meanLum.toFixed(1), contrast: +contrast.toFixed(1), sharpness: +sharpness.toFixed(2), symmetry: +symmetry.toFixed(3) };
}

export function scoreMetrics(mt) {
  const t = config().imageEngine.thresholds;
  const reasons = [];
  let score = 100;
  if (mt.meanSaturation > t.maxMeanSaturation) { score -= Math.min(45, (mt.meanSaturation - t.maxMeanSaturation) * 220); reasons.push("exceso de saturacion"); }
  if (mt.meanSaturation > t.maxMeanSaturation + 0.12) reasons.push("hard:exceso de saturacion");
  if (mt.techHueShare > t.maxTechHueShare) { score -= Math.min(40, (mt.techHueShare - t.maxTechHueShare) * 200); reasons.push("look corporativo o tecnologico"); }
  if (mt.techHueShare > t.maxTechHueShare * 1.6) reasons.push("hard:look corporativo o tecnologico");
  if (mt.sharpness < t.minSharpness) { score -= 30; reasons.push("imagen blanda o plastica (estetica de IA evidente)"); }
  if (mt.sharpness < t.minSharpness * 0.5) reasons.push("hard:imagen blanda o plastica (estetica de IA evidente)");
  if (mt.contrast < t.minContrast) { score -= 15; reasons.push("contraste bajo"); }
  if (mt.symmetry > 0.965) { score -= 20; reasons.push("simetria artificial"); }
  if (mt.meanLuma < 40 || mt.meanLuma > 215) { score -= 15; reasons.push("exposicion extrema"); }
  return { score: Math.max(0, Math.round(score)), reasons };
}

// Veredicto del critico segun la rubrica: aprueba solo si es publicable, puntua alto y no parece IA ni tiene errores.
export function criticVerdict(c, stage) {
  const k = config().imageEngine.critic;
  const reasons = [];
  if (!c || c.error) return { reasons, pass: null };
  if (c.score < k.minScore) reasons.push(`critico: puntuacion ${c.score} < ${k.minScore}`);
  if (c.aiLook != null && c.aiLook > k.maxAiLook) reasons.push(`critico: parece imagen de IA (${c.aiLook}/10)`);
  if (c.visualErrors.length) reasons.push(...c.visualErrors.map((e) => `critico: ${e}`));
  if (!c.compositionBreathes) reasons.push("critico: la composicion no respira");
  if (stage === "final") { if (c.textPlacementOk === false) reasons.push("critico: texto mal situado"); if (c.mobileLegible === false) reasons.push("critico: no se entiende bien en movil"); }
  reasons.push(...c.flags.map((f) => `critico: ${f}`));
  if (!c.publishable && !reasons.length) reasons.push("critico: no la considera publicable");
  return { reasons, pass: reasons.length === 0 };
}

// opts: { width, height, stage: "background"|"final", critic: { fetchImpl, env } | null }. ok = sin rechazos duros, sin reparos del critico y score >= minimo.
// Con critico la nota final es la del critico (juicio visual) acotada por las metricas; sin critico la revision queda "programmatic-only".
export async function validateImage(buf, opts = {}) {
  const t = config().imageEngine.thresholds;
  const stage = opts.stage || "background";
  const reasons = [];
  const meta = await sharp(buf).metadata();
  if (opts.width && opts.height && (meta.width < opts.width * 0.5 || meta.height < opts.height * 0.5)) reasons.push(`resolucion insuficiente (${meta.width}x${meta.height})`);
  const mt = await metrics(buf);
  const sc = scoreMetrics(mt);
  let score = sc.score;
  reasons.push(...sc.reasons.filter((r) => r.startsWith("hard:")).map((r) => r.slice(5)));
  let criticResult = null;
  if (opts.critic) {
    try { criticResult = await critique(buf, criticPrompt(style().rejectCriteria, stage), opts.critic); } catch (e) { criticResult = { error: e.message }; }
    if (criticResult && !criticResult.error) {
      score = Math.round((score + criticResult.score) / 2);
      reasons.push(...criticVerdict(criticResult, stage).reasons);
    }
  }
  if (score < t.minScore) reasons.push(`puntuacion ${score} < ${t.minScore}`);
  const reviewed = criticResult && !criticResult.error ? "critic" : "programmatic-only";
  return { ok: reasons.length === 0, score, reasons: [...new Set(reasons)], metrics: mt, soft: sc.reasons.filter((r) => !r.startsWith("hard:")), critic: criticResult, reviewed, stage };
}

// Revision critica de la pieza ya compuesta (texto/CTA/logotipo por codigo). Sin critico devuelve null.
export async function reviewFinal(buf, critic) {
  if (!critic) return null;
  let c;
  try { c = await critique(buf, criticPrompt(style().rejectCriteria, "final"), critic); } catch (e) { c = { error: e.message }; }
  if (!c || c.error) return { critic: c, reasons: [], pass: null, score: null };
  const v = criticVerdict(c, "final");
  return { critic: c, reasons: v.reasons.map((r) => "pieza final: " + r), pass: v.pass, score: c.score };
}
