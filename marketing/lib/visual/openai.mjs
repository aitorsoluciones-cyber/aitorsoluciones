// Cliente de la OpenAI Images API (solo backend / task runner). La clave y el modelo salen EXCLUSIVAMENTE de variables
// de entorno (OPENAI_API_KEY, OPENAI_IMAGE_MODEL); nunca se escriben en ficheros ni en logs. El fetch es inyectable (pruebas).
import { config } from "../paths.mjs";
import { load, save, nowIso } from "../store.mjs";

const API = "https://api.openai.com/v1";

export class ConfigError extends Error {}
export class ApiError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.status = status; this.code = code; }
}

export function readEnv(env = process.env, { needKey = true } = {}) {
  const model = (env.OPENAI_IMAGE_MODEL || "").trim();
  const key = (env.OPENAI_API_KEY || "").trim();
  if (!model) throw new ConfigError("Falta OPENAI_IMAGE_MODEL (modelo GPT Image vigente; no se fija en el codigo)");
  if (/^dall-e/i.test(model) && env.OPENAI_IMAGE_ALLOW_LEGACY !== "1") throw new ConfigError("DALL·E no es el modelo principal: usa un modelo GPT Image (OPENAI_IMAGE_MODEL). Solo se admite con OPENAI_IMAGE_ALLOW_LEGACY=1");
  if (needKey && !key) throw new ConfigError("Falta OPENAI_API_KEY (definela como variable de entorno o en el .env fuera de git)");
  return { key, model, visionModel: (env.OPENAI_VISION_MODEL || "").trim() || null };
}

// ---------- tamanos ----------
export const sizeMode = (model, env = process.env) => env.OPENAI_IMAGE_SIZE_MODE || (/gpt-image-1/i.test(model) ? "fixed" : "flexible");

export function validateSize([w, h], mode = "flexible") {
  const s = config().imageEngine.sizes;
  if (mode === "fixed") return s.fixedFallback.includes(`${w}x${h}`) ? [] : [`tamano ${w}x${h} no admitido por este modelo (${s.fixedFallback.join(", ")})`];
  const p = [];
  if (w % s.flexibleMultiple || h % s.flexibleMultiple) p.push(`los lados deben ser multiplos de ${s.flexibleMultiple}`);
  if (Math.max(w, h) > s.maxSide) p.push(`lado mayor > ${s.maxSide}`);
  if (Math.max(w, h) / Math.min(w, h) > s.maxRatio) p.push(`ratio > ${s.maxRatio}:1`);
  if (w * h < s.minPixels || w * h > s.maxPixels) p.push(`pixeles fuera de ${s.minPixels}..${s.maxPixels}`);
  return p;
}

export function chooseGenerationSize(aspect, mode = "flexible") {
  const e = config().imageEngine;
  if (mode === "fixed") {
    const [a, b] = aspect.split(":").map(Number);
    const r = a / b;
    return (r > 1.2 ? [1536, 1024] : r < 0.85 ? [1024, 1536] : [1024, 1024]);
  }
  const size = e.generationSize[aspect];
  if (!size) throw new ConfigError(`Sin tamano de generacion para ${aspect}`);
  return size;
}

// ---------- coste ----------
export function estimateCost({ quality = "medium", width, height, n = 1 }) {
  const e = config().imageEngine;
  const per = e.costUsdPer1024Square[quality === "auto" ? "medium" : quality];
  if (per == null) throw new ConfigError(`Calidad sin tarifa: ${quality}`);
  return +(per * ((width * height) / (1024 * 1024)) * n).toFixed(4);
}

const monthKey = (d) => d.slice(0, 7);
export const spentThisMonth = (now = nowIso(), ledger = load("ledger")) => ledger.filter((l) => monthKey(l.at) === monthKey(now)).reduce((a, l) => a + l.costUsd, 0);

// Reduce las variantes hasta que el brief cabe en el presupuesto; falla si ni una cabe.
export function planBudget({ quality, width, height, variants, now = nowIso() }) {
  const e = config().imageEngine;
  const spent = spentThisMonth(now);
  for (let n = variants; n >= 1; n--) {
    const cost = estimateCost({ quality, width, height, n });
    if (cost <= e.perBriefBudgetUsd && spent + cost <= e.monthlyBudgetUsd) return { variants: n, costUsd: cost, spentUsd: +spent.toFixed(4) };
  }
  throw new ConfigError(`Presupuesto agotado: este mes ${spent.toFixed(2)} $ de ${e.monthlyBudgetUsd} $ (maximo por brief ${e.perBriefBudgetUsd} $)`);
}

export function recordCost({ costUsd, model, op, briefId, n }) {
  const ledger = load("ledger");
  ledger.push({ at: nowIso(), costUsd, model, op, briefId, n });
  save("ledger", ledger);
}

// ---------- llamadas ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s, key) => (key ? String(s).split(key).join("sk-***") : String(s));

async function call(url, init, { fetchImpl, key, retries = 3, wait = sleep }) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${key}` } });
    if (res.ok) return res.json();
    const body = await res.json().catch(() => ({}));
    const err = body.error || {};
    last = new ApiError(redact(`OpenAI ${res.status}${err.code ? " " + err.code : ""}: ${err.message || "error"}`, key), { status: res.status, code: err.code });
    if (![429, 500, 502, 503, 504].includes(res.status) || err.code === "insufficient_quota") throw last;
    await wait(Math.min(30000, 1500 * 2 ** attempt));
  }
  throw last;
}

const decode = (data) => (data.data || []).map((d) => Buffer.from(d.b64_json, "base64"));

export async function generate({ prompt, size, quality = "medium", n = 1, format = "png", moderation }, { fetchImpl = fetch, env = process.env, wait } = {}) {
  const { key, model } = readEnv(env);
  const body = { model, prompt, size: `${size[0]}x${size[1]}`, quality, n, output_format: format, ...(moderation ? { moderation } : {}) };
  const data = await call(`${API}/images/generations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, { fetchImpl, key, wait });
  return { images: decode(data), model };
}

// images: [{ buf, name, mime }]; mask: Buffer PNG con alfa (transparente = editable), mismas dimensiones que la primera imagen.
export async function edit({ prompt, images, mask, size, quality = "medium", n = 1, format = "png" }, { fetchImpl = fetch, env = process.env, wait } = {}) {
  const { key, model } = readEnv(env);
  const form = new FormData();
  form.set("model", model); form.set("prompt", prompt); form.set("size", `${size[0]}x${size[1]}`); form.set("quality", quality); form.set("n", String(n)); form.set("output_format", format);
  for (const im of images) form.append("image[]", new Blob([im.buf], { type: im.mime || "image/png" }), im.name || "image.png");
  if (mask) form.set("mask", new Blob([mask], { type: "image/png" }), "mask.png");
  const data = await call(`${API}/images/edits`, { method: "POST", body: form }, { fetchImpl, key, wait });
  return { images: decode(data), model };
}

// Critico visual opcional (OPENAI_VISION_MODEL). Devuelve { score, flags, notes } o null si no esta configurado.
export async function critique(buf, criteriaPrompt, { fetchImpl = fetch, env = process.env, wait } = {}) {
  const { key, visionModel } = readEnv(env);
  if (!visionModel) return null;
  const body = { model: visionModel, input: [{ role: "user", content: [{ type: "input_text", text: criteriaPrompt }, { type: "input_image", image_url: `data:image/png;base64,${buf.toString("base64")}` }] }] };
  const data = await call(`${API}/responses`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, { fetchImpl, key, wait });
  const text = data.output_text || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const j = JSON.parse(m[0]); return { score: Number(j.score) || 0, flags: Array.isArray(j.flags) ? j.flags : [], notes: String(j.notes || "") }; } catch { return null; }
}
