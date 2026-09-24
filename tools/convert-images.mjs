// Convierte los HEIC reales seleccionados (fotos antes/despues de trabajos)
// a WebP optimizado. heic-convert decodifica el HEIC via WASM (no depende
// de codecs del sistema operativo, por eso funciona igual en local que en
// un build de Netlify). sharp redimensiona y codifica a WebP.
import fs from "node:fs/promises";
import path from "node:path";
import convert from "heic-convert";
import sharp from "sharp";

const SRC_DIR = "D:\\NEGOCIOS Y IA\\AITOR SOLUCIONES\\fotos antes y despues";
const OUT_DIR = path.resolve("src/assets/img");

// [ficheroOrigen, nombreSalida, anchoMax]
const MAP = [
  ["IMG_4946.HEIC", "jardin-olivos-antes.webp", 1200],
  ["IMG_4947.HEIC", "jardin-olivos-despues.webp", 1200],
  ["IMG_4948.HEIC", "jardin-olivos-terraza-antes.webp", 1200],
  ["IMG_4949.HEIC", "jardin-olivos-terraza-despues.webp", 1200],
  ["IMG_4954.HEIC", "jardin-olivos-caseta-antes.webp", 1200],
  ["IMG_4958.HEIC", "jardin-olivos-caseta-despues.webp", 1200],
  ["IMG_4973.HEIC", "parcela-agricola-antes.webp", 1200],
  ["IMG_4977.HEIC", "parcela-agricola-despues.webp", 1200],
  ["IMG_4976.HEIC", "parcela-agricola-proceso.webp", 1200],
  ["IMG_5166.HEIC", "solar-urbano-antes.webp", 1200],
  ["IMG_5172.HEIC", "solar-urbano-despues.webp", 1200],
  ["IMG_5178.HEIC", "solar-urbano-despues-amplio.webp", 1200],
];

await fs.mkdir(OUT_DIR, { recursive: true });

for (const [srcName, outName, width] of MAP) {
  const inputBuffer = await fs.readFile(path.join(SRC_DIR, srcName));
  const jpegBuffer = await convert({ buffer: inputBuffer, format: "JPEG", quality: 0.92 });
  const image = sharp(jpegBuffer).rotate().resize({ width, withoutEnlargement: true });
  const outPath = path.join(OUT_DIR, outName);
  await image.webp({ quality: 78 }).toFile(outPath);
  const meta = await sharp(outPath).metadata();
  console.log(`${outName}: ${meta.width}x${meta.height}`);
}

console.log("Conversión completada.");
