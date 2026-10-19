// Carpetas de salida (assets/marketing/YYYY/MM/...) y registro de metadatos por activo.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { home, ensureDir } from "../paths.mjs";
import { load, save, nowIso } from "../store.mjs";

export const SUBDIRS = ["originals", "generated", "composed", "stories", "feed", "gbp", "web", "rejected"];

// Fuera de src/ y de git: lo publicado sale por la cola, nunca por la carpeta publica de la web.
export function outputRoot(now = nowIso()) {
  const [y, m] = now.slice(0, 7).split("-");
  const root = path.join(home(), "assets", "marketing", y, m);
  for (const s of SUBDIRS) ensureDir(path.join(root, s));
  return root;
}

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function writeFile(dir, name, buf) { const f = path.join(dir, name); ensureDir(path.dirname(f)); fs.writeFileSync(f, buf); return f; }

// meta: { prompt, source, model, campaign, type, format, channel, origin, derivedFrom, jobId, status, briefId, score, review, ... }
export async function registerAsset(file, meta = {}) {
  const buf = fs.readFileSync(file);
  const hash = sha256(buf);
  const assets = load("assets");
  const existing = assets.find((a) => a.sha256 === hash);
  if (existing) return { asset: existing, duplicate: true };
  const m = await sharp(buf).metadata();
  const asset = {
    id: "a_" + hash.slice(0, 12), sha256: hash, hash, kind: "image", origin: meta.origin || "generated", sourcePath: file, name: path.basename(file),
    jobId: meta.jobId ?? null, role: meta.role || "other", bytes: buf.length, width: m.width, height: m.height, needsDownload: false,
    status: meta.status || "READY", createdAt: nowIso(), history: [],
    prompt: meta.prompt ?? null, source: meta.source ?? "openai", model: meta.model ?? null, timestamp: nowIso(), campaign: meta.campaign ?? null,
    type: meta.type ?? null, format: meta.format ?? null, channel: meta.channel ?? null, published: false,
    ...(meta.derivedFrom ? { derivedFrom: meta.derivedFrom } : {}), ...(meta.briefId ? { briefId: meta.briefId } : {}), ...(meta.score != null ? { score: meta.score } : {}),
    ...(meta.review ? { review: meta.review } : {}), ...(meta.reasons ? { reasons: meta.reasons } : {}), ...(meta.edited ? { edited: true } : {}), ...(meta.fidelity != null ? { fidelity: meta.fidelity } : {})
  };
  assets.push(asset);
  save("assets", assets);
  fs.writeFileSync(file + ".json", JSON.stringify(asset, null, 2) + "\n");
  return { asset, duplicate: false };
}

export function markPublished(assetId) {
  const assets = load("assets");
  const a = assets.find((x) => x.id === assetId);
  if (a) { a.published = true; save("assets", assets); }
}
