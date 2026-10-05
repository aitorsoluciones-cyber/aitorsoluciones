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

// Fotos de 800 px que van de LCP/comparador en movil: variante intermedia de 700 px
// (cubre 380 px CSS a DPR 1,75 con ~45% menos bytes que la de 800 px).
const MID_700 = ["rapita-antes", "rapita-despues"];
// Fotos que son LCP (hero de paginas locales/EN y comparadores de casos): ademas AVIF
// de 480, 630 (nativo a DPR 1,75 en el comparador movil), 700 y hasta 1000 px (-sm/-xm/-md/-lg) para <picture>; imageMeta.avif = true.
const AVIF_NAMES = ["rapita-antes", "rapita-despues", "jardin-olivos-antes", "jardin-olivos-despues", "solar-urbano-antes", "solar-urbano-despues", "alcanar-platja-despues", "hero-after"];

// Heros de paginas locales/EN: ademas recorte cuadrado (-sq-*) para viewports >= 412 px, donde el
// contenedor es >= 1:1 y object-fit:cover solo muestra la banda central: mismos pixeles visibles, ~28% menos bytes.
const AVIF_SQUARE = ["alcanar-platja-despues", "hero-after", "rapita-despues", "jardin-olivos-despues"];

// Fotos muy detalladas (hierba/hojas): -3 de calidad AVIF (SSIM 0,977 -> 0,970 a tamano real, indistinguible a 1:1).
const AVIF_QDELTA = { "jardin-olivos-antes": -3, "jardin-olivos-despues": -3 };

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
  } else if (MID_700.includes(name)) {
    const mdInfo = await sharp(buffer).resize({ width: 700 }).webp({ quality: 76, effort: 6 }).toFile(mdPath);
    entry.md = { w: mdInfo.width, h: mdInfo.height };
  } else {
    await fs.rm(mdPath, { force: true });
  }
  const dq = AVIF_QDELTA[name] || 0;
  // Miniatura AVIF (480 px, mismo recorte que la WebP) para las galerias: ~45% menos bytes.
  const smAvif = path.join(DIR, `${name}-sm.avif`);
  await sharp(buffer).resize({ width: 480, withoutEnlargement: true }).avif({ quality: 50 + dq, effort: 6 }).toFile(smAvif);
  await sharp(buffer).resize({ width: 400, withoutEnlargement: true }).avif({ quality: 50 + dq, effort: 6 }).toFile(path.join(DIR, `${name}-xs.avif`));
  // Marcador de posicion borroso (16 px, ~300 bytes en linea) para el comparador: mejora el Speed Index sin cambiar el resultado final.
  const lq = await sharp(buffer).resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
  entry.lqip = `data:image/webp;base64,${lq.toString("base64")}`;
  entry.smAvif = true;
  if (AVIF_NAMES.includes(name)) {
    await sharp(buffer).resize({ width: 630 }).avif({ quality: 45 + dq, effort: 6 }).toFile(path.join(DIR, `${name}-xm.avif`));
    await sharp(buffer).resize({ width: 700 }).avif({ quality: 45 + dq, effort: 6 }).toFile(path.join(DIR, `${name}-md.avif`));
    const lg = await sharp(buffer).resize({ width: 1000, withoutEnlargement: true }).avif({ quality: 45 + dq, effort: 6 }).toFile(path.join(DIR, `${name}-lg.avif`));
    entry.avif = { lg: lg.width };
    if (AVIF_SQUARE.includes(name)) {
      const side = Math.min(info.width, info.height);
      const sq = await sharp(buffer).extract({ left: Math.round((info.width - side) / 2), top: Math.round((info.height - side) / 2), width: side, height: side }).toBuffer();
      await sharp(sq).resize({ width: 480 }).avif({ quality: 50 + dq, effort: 6 }).toFile(path.join(DIR, `${name}-sq-sm.avif`));
      await sharp(sq).resize({ width: 668 }).avif({ quality: 45 + dq, effort: 6 }).toFile(path.join(DIR, `${name}-sq-xm.avif`));
      await sharp(sq).resize({ width: 700 }).avif({ quality: 45 + dq, effort: 6 }).toFile(path.join(DIR, `${name}-sq-md.avif`));
      await sharp(sq).resize({ width: 1000, withoutEnlargement: true }).avif({ quality: 45 + dq, effort: 6 }).toFile(path.join(DIR, `${name}-sq-lg.avif`));
      entry.avif.sq = true;
    }
  }
  meta[name] = entry;
  const kb = async (p) => Math.round((await fs.stat(p)).size / 1024);
  console.log(`${name}: ${info.width}x${info.height} (${await kb(src)} KB) | sm ${await kb(path.join(DIR, name + "-sm.webp"))} KB${entry.md ? " | md " + (await kb(mdPath)) + " KB" : ""}`);
}

await fs.writeFile(path.resolve("src/_data/imageMeta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log("Miniaturas y imageMeta.json generados.");
