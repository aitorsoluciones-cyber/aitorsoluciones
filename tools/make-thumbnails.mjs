// Genera variantes responsive de las fotos reales antes/despues ya convertidas
// a WebP: "-sm" (480px) y, cuando el original supera 800px, "-md" (800px).
// Escribe src/_data/imageMeta.json con las dimensiones reales para width/height
// y srcset correctos.
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";

const DIR = path.resolve("src/assets/img");

const BASE_NAMES = [
  "hero-before", "hero-after",
  "rapita-antes", "rapita-despues",
  "rapita-campo-antes", "rapita-campo-despues",
  "rapita-olivo-antes", "rapita-olivo-despues",
  "alcanar-platja-antes", "alcanar-platja-despues",
  "work2-before", "work2-after",
  "work3-before", "work3-after",
  "jardin-olivos-antes", "jardin-olivos-despues",
  "jardin-olivos-terraza-antes", "jardin-olivos-terraza-despues",
  "jardin-olivos-caseta-antes", "jardin-olivos-caseta-despues",
  "parcela-agricola-antes", "parcela-agricola-despues", "parcela-agricola-proceso",
  "solar-urbano-antes", "solar-urbano-despues", "solar-urbano-despues-amplio",
];

const meta = {};

for (const name of BASE_NAMES) {
  const src = path.join(DIR, `${name}.webp`);
  try {
    await fs.access(src);
  } catch {
    console.log(`SKIP (no existe): ${name}.webp`);
    continue;
  }
  const buffer = await fs.readFile(src);
  const info = await sharp(buffer).metadata();
  const entry = { w: info.width, h: info.height, sm: { w: 480 }, md: null };

  const smInfo = await sharp(buffer).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(DIR, `${name}-sm.webp`));
  entry.sm = { w: smInfo.width, h: smInfo.height };

  const mdPath = path.join(DIR, `${name}-md.webp`);
  if (info.width > 800) {
    const mdInfo = await sharp(buffer).resize({ width: 800 }).webp({ quality: 74 }).toFile(mdPath);
    entry.md = { w: mdInfo.width, h: mdInfo.height };
  } else {
    await fs.rm(mdPath, { force: true });
  }
  meta[name] = entry;
  const kb = async (p) => Math.round((await fs.stat(p)).size / 1024);
  console.log(`${name}: ${info.width}x${info.height} (${await kb(src)} KB) | sm ${await kb(path.join(DIR, name + "-sm.webp"))} KB${entry.md ? " | md " + (await kb(mdPath)) + " KB" : ""}`);
}

await fs.writeFile(path.resolve("src/_data/imageMeta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log("Miniaturas y imageMeta.json generados.");
