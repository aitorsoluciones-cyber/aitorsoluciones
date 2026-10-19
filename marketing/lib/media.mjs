// Lectura de imagenes (incluido HEIC), huellas (sha256/md5/aHash) y comparacion.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import sharp from "sharp";

export const IMAGE_EXT = new Set([".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".avif"]);
export const VIDEO_EXT = new Set([".mov", ".mp4", ".m4v"]);
export const kindOf = (file) => {
  const e = path.extname(file).toLowerCase();
  return IMAGE_EXT.has(e) ? "image" : VIDEO_EXT.has(e) ? "video" : null;
};

export function fileHashes(file) {
  return new Promise((resolve, reject) => {
    const sha = crypto.createHash("sha256");
    const md5 = crypto.createHash("md5");
    fs.createReadStream(file)
      .on("data", (c) => { sha.update(c); md5.update(c); })
      .on("error", reject)
      .on("end", () => resolve({ sha256: sha.digest("hex"), md5: md5.digest("hex") }));
  });
}

// Devuelve un Buffer legible por sharp (HEIC -> JPEG), con la orientacion EXIF aplicada.
export async function readPhoto(file) {
  const ext = path.extname(file).toLowerCase();
  let buf = fs.readFileSync(file);
  if (ext === ".heic" || ext === ".heif") {
    const { default: convert } = await import("heic-convert");
    buf = Buffer.from(await convert({ buffer: buf, format: "JPEG", quality: 0.92 }));
  }
  return sharp(buf, { failOn: "none" }).rotate().toBuffer();
}

export async function describePhoto(file) {
  const buf = await readPhoto(file);
  const meta = await sharp(buf).metadata();
  return { width: meta.width, height: meta.height, ahash: await aHash(buf), buf };
}

// aHash 8x8 (64 bits en hex): detecta casi-duplicados (recortes, recompresiones).
export async function aHash(buf) {
  const px = await sharp(buf).resize(8, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  let bits = "";
  for (const v of px) bits += v >= mean ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hamming(a, b) {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}
