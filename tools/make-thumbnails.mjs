// Genera variantes "-sm" (480px de ancho) de las fotos reales antes/despues
// ya convertidas a WebP, para usarlas en miniaturas de galeria (srcset) sin
// servir siempre la version de 1200px.
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

for (const name of BASE_NAMES) {
  const src = path.join(DIR, `${name}.webp`);
  const out = path.join(DIR, `${name}-sm.webp`);
  try {
    await fs.access(src);
  } catch {
    console.log(`SKIP (no existe): ${name}.webp`);
    continue;
  }
  const buffer = await fs.readFile(src);
  await sharp(buffer).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 72 }).toFile(out);
  const meta = await sharp(out).metadata();
  const kb = Math.round((await fs.stat(out)).size / 1024);
  console.log(`${name}-sm.webp: ${meta.width}x${meta.height} (${kb} KB)`);
}

console.log("Miniaturas generadas.");
