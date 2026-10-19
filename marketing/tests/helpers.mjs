import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

export function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mk-test-"));
  process.env.MK_HOME = path.join(dir, "state");
  return dir;
}

// Foto sintetica (no representa ningun trabajo): degradado + formas segun la semilla, para huellas distintas.
export async function fakePhoto(file, seed = 1, { width = 1600, height = 1200 } = {}) {
  const shapes = [];
  for (let i = 0; i < 6; i++) {
    const x = (seed * 97 + i * 211) % width, y = (seed * 53 + i * 137) % height, r = 60 + ((seed + i) * 31) % 160;
    shapes.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${(seed * 47 + i * 60) % 360},70%,${30 + ((seed + i) * 13) % 50}%)"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="${seed % 2}" y1="0" x2="${1 - (seed % 2)}" y2="1"><stop offset="0" stop-color="hsl(${seed * 29 % 360},50%,35%)"/><stop offset="1" stop-color="hsl(${(seed * 29 + 120) % 360},60%,65%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shapes.join("")}</svg>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(file);
  return file;
}

// Imagen "natural" sintetica (tonos tierra/verde con ruido y asimetria): supera los umbrales de calidad.
export async function naturalImage(seed = 1, width = 1088, height = 1360) {
  const raw = Buffer.alloc(width * height * 3);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    const sky = y < height * (0.3 + 0.1 * Math.sin(x / 90 + seed));
    const n = (rnd() - 0.5) * 70;
    raw[i] = Math.max(0, Math.min(255, (sky ? 150 : 95 + (x * 40) / width) + n));
    raw[i + 1] = Math.max(0, Math.min(255, (sky ? 175 : 120 + (y * 30) / height) + n));
    raw[i + 2] = Math.max(0, Math.min(255, (sky ? 205 : 70) + n));
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

// Imagen con exceso de saturacion y tono cian/violeta (look tecnologico): debe rechazarse.
export async function neonImage(width = 1088, height = 1360) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g"><stop offset="0" stop-color="#00f0ff"/><stop offset="1" stop-color="#8a00ff"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// fetch simulado de la API de imagenes y del critico (Responses): colas de respuestas por endpoint.
export const CRITIC_OK = { score: 90, ai_look: 2, brand_fit: 8, commercial_appeal: 8, visual_errors: [], composition_breathes: true, text_placement_ok: true, mobile_legible: true, publishable: true, flags: [], notes: "ok" };
export function mockOpenAI({ generations = [], edits = [], responses = [], failWith } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (failWith) return { ok: false, status: failWith.status, json: async () => ({ error: failWith.error }) };
    if (url.endsWith("/responses")) {
      const r = responses.length ? responses.shift() : CRITIC_OK;
      return { ok: true, status: 200, json: async () => ({ output_text: typeof r === "string" ? r : JSON.stringify(r) }) };
    }
    const queue = url.endsWith("/images/generations") ? generations : edits;
    const item = queue.shift();
    const buf = typeof item === "function" ? await item(init) : item;
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: buf.toString("base64") }] }) };
  };
  return { fetchImpl, calls };
}
