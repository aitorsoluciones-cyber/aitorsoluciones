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
