// Composicion PROGRAMATICA: velo, texto, CTA y logotipo oficial se anaden con codigo (ortografia, alineacion y marca
// garantizadas). El modelo nunca dibuja texto ni logotipos.
import sharp from "sharp";
import { config } from "../paths.mjs";
import { esc, FONT, wrapText, charsFor, logoPlate } from "../assets.mjs";

const cover = (buf, w, h, position = "centre") => sharp(buf).resize(w, h, { fit: "cover", position }).toBuffer();
const layer = (input, left, top) => ({ input, left: Math.round(left), top: Math.round(top) });

// Velo de legibilidad (degradado de la marca) sobre la zona donde ira el texto.
export async function applyBrandOverlay(buf, { width, height, mode = "bottom" } = {}) {
  const c = config().brand.colors;
  const stops = (y1, y2, a1, a2, id) => `<linearGradient id="${id}" x1="0" y1="${y1}" x2="0" y2="${y2}"><stop offset="0" stop-color="${c.navy}" stop-opacity="${a1}"/><stop offset="1" stop-color="${c.navy}" stop-opacity="${a2}"/></linearGradient>`;
  const bottom = `<rect x="0" y="${height * 0.38}" width="${width}" height="${height * 0.62}" fill="url(#b)"/>`;
  const top = `<rect x="0" y="0" width="${width}" height="${height * 0.22}" fill="url(#t)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${stops(0, 1, 0, 0.88, "b")}${stops(1, 0, 0, 0.55, "t")}</defs>${bottom}${mode === "both" ? top : ""}<rect x="0" y="${height - 10}" width="${width}" height="10" fill="${c.orange}"/></svg>`;
  return sharp(buf).composite([layer(Buffer.from(svg), 0, 0)]).toBuffer();
}

// Texto (titular, localidad y CTA) con tipografia de marca, dentro de zonas seguras. Disposicion de abajo arriba.
export async function applyText(buf, { width, height, headline, cta, location, format = "feed" } = {}) {
  const c = config().brand.colors;
  const story = format === "story";
  const padX = Math.round(width * 0.085);
  const maxW = width - padX * 2;
  const logoZone = story ? 380 : Math.round(height * 0.115); // la interfaz de Stories tapa los extremos
  const hSize = Math.round(width * (story ? 0.075 : 0.07));
  const lh = Math.round(hSize * 1.12);
  const lines = wrapText(headline, charsFor(maxW, hSize)).slice(0, 5);
  const ctaSize = Math.round(width * 0.036);
  const ctaLines = wrapText(cta, charsFor(maxW - 80, ctaSize)).slice(0, 2);
  const ctaH = ctaLines.length * Math.round(ctaSize * 1.3) + 44;
  let y = height - logoZone - 36;
  const parts = [];
  parts.push(`<rect x="${padX}" y="${y - ctaH}" width="${maxW}" height="${ctaH}" rx="14" fill="${c.orange}"/>`);
  ctaLines.forEach((l, i) => parts.push(`<text x="${padX + 40}" y="${y - ctaH + 22 + ctaSize * 1.05 + i * Math.round(ctaSize * 1.3)}" font-family="${FONT}" font-size="${ctaSize}" font-weight="700" fill="#ffffff">${esc(l)}</text>`));
  y -= ctaH + 34;
  const top = y - lines.length * lh;
  lines.forEach((l, i) => parts.push(`<text x="${padX}" y="${top + hSize * 0.85 + i * lh}" font-family="${FONT}" font-size="${hSize}" font-weight="700" fill="#ffffff">${esc(l)}</text>`));
  if (location) {
    const t = location.toUpperCase(), w = Math.min(maxW, t.length * Math.round(hSize * 0.36) + 56);
    parts.push(`<rect x="${padX}" y="${top - 74}" width="${w}" height="52" rx="8" fill="${c.navy}" fill-opacity="0.92"/><text x="${padX + 26}" y="${top - 38}" font-family="${FONT}" font-size="28" font-weight="700" fill="${c.orangeLight}" letter-spacing="2">${esc(t)}</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`;
  return sharp(buf).composite([layer(Buffer.from(svg), 0, 0)]).toBuffer();
}

// Logotipo OFICIAL desde el fichero de marca (config.brand.logo), nunca generado.
export async function applyLogo(buf, { width, height, format = "feed" } = {}) {
  const story = format === "story";
  const plate = await logoPlate(story ? 100 : Math.round(height * 0.075));
  const padX = Math.round(width * 0.085);
  const logoZone = story ? 380 : Math.round(height * 0.115);
  return sharp(buf).composite([layer(plate.buf, padX, height - logoZone + (logoZone - plate.h) / 2 - (story ? 120 : 8))]).toBuffer();
}

// Etiqueta de transparencia discreta (p. ej. "Ilustración") en la esquina inferior derecha, fuera de la zona del logotipo y de la interfaz de Stories.
export async function applyDisclosureLabel(buf, { width, height, label, format = "feed" } = {}) {
  if (!label) return buf;
  const size = Math.round(width * 0.022), w = Math.round(label.length * size * 0.62 + size * 1.6), h = Math.round(size * 1.9);
  const x = width - w - Math.round(width * 0.04), y = height - h - (format === "story" ? 270 : 34);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(h / 2)}" fill="#0b1b33" fill-opacity="0.55"/><text x="${x + w / 2}" y="${y + h / 2 + size * 0.35}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="600" fill="#ffffff" fill-opacity="0.92">${esc(label)}</text></svg>`;
  return sharp(buf).composite([layer(Buffer.from(svg), 0, 0)]).toBuffer();
}

// Pieza final: fondo + velo + texto + logotipo en el formato dado. format: feed | story | gbp | web
export async function composeFinal(background, brief, format = "feed") {
  const [w, h] = config().imageEngine.targets[format];
  let img = await cover(background, w, h);
  img = await applyBrandOverlay(img, { width: w, height: h, mode: format === "story" ? "both" : "bottom" });
  img = await applyText(img, { width: w, height: h, headline: brief.headline, cta: brief.cta, location: brief.location, format });
  img = await applyLogo(img, { width: w, height: h, format });
  img = await applyDisclosureLabel(img, { width: w, height: h, label: brief.label, format });
  return img;
}

// Tamanos que necesita cada canal a partir de una imagen base (cada uno se compone aparte: el texto depende de la proporcion).
export const FORMATS_BY_CHANNEL = { instagram: ["feed", "story"], facebook: ["feed"], gbp: ["gbp"], web: ["web"] };

export async function resizeForChannels(background, brief, channels = [brief.channel]) {
  const formats = [...new Set(channels.flatMap((c) => FORMATS_BY_CHANNEL[c] || []))];
  const out = {};
  for (const f of formats) out[f] = await composeFinal(background, brief, f);
  return out;
}

// Miniaturas web de una imagen final (WebP).
export async function webVariants(buf) {
  const out = {};
  for (const w of [480, 800, 1600]) out[w] = await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
  return out;
}

// Diapositiva infografica: fondo (generado o liso) + titulo + puntos, con texto programatico.
export async function composeInfographic(background, { title, points, tag = "" }, { width = 1080, height = 1350 } = {}) {
  const c = config().brand.colors;
  const img = await cover(background, width, height);
  const padX = Math.round(width * 0.09), maxW = width - padX * 2;
  const tSize = Math.round(width * 0.062), pSize = Math.round(width * 0.036);
  const tLines = wrapText(title, charsFor(maxW, tSize)).slice(0, 3);
  let y = Math.round(height * 0.14);
  const parts = [`<rect x="0" y="0" width="${width}" height="${height}" fill="${c.cream}" fill-opacity="0.78"/>`];
  if (tag) { parts.push(`<rect x="${padX}" y="${y - 44}" width="${tag.length * 22 + 56}" height="58" rx="8" fill="${c.navy}"/><text x="${padX + 28}" y="${y - 4}" font-family="${FONT}" font-size="32" font-weight="700" fill="#fff" letter-spacing="2">${esc(tag.toUpperCase())}</text>`); y += 90; }
  tLines.forEach((l, i) => parts.push(`<text x="${padX}" y="${y + tSize + i * Math.round(tSize * 1.12)}" font-family="${FONT}" font-size="${tSize}" font-weight="700" fill="${c.navy}">${esc(l)}</text>`));
  y += tLines.length * Math.round(tSize * 1.12) + 70;
  for (const [i, p] of points.slice(0, 5).entries()) {
    parts.push(`<circle cx="${padX + 24}" cy="${y - 10}" r="24" fill="${c.orange}"/><text x="${padX + 24}" y="${y + 1}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#fff">${i + 1}</text>`);
    parts.push(`<text x="${padX + 70}" y="${y}" font-family="${FONT}" font-size="${pSize + 4}" font-weight="700" fill="${c.ink}">${esc(p.t)}</text>`);
    const bl = wrapText(p.b || "", charsFor(maxW - 70, pSize)).slice(0, 3);
    bl.forEach((l, j) => parts.push(`<text x="${padX + 70}" y="${y + 44 + j * Math.round(pSize * 1.3)}" font-family="${FONT}" font-size="${pSize}" fill="${c.ink}">${esc(l)}</text>`));
    y += 44 + Math.max(1, bl.length) * Math.round(pSize * 1.3) + 56;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`;
  const base = await sharp(img).composite([layer(Buffer.from(svg), 0, 0)]).toBuffer();
  return applyLogo(base, { width, height, format: "feed" });
}

// Diapositiva de un punto (carrusel): fondo velado + numero + titulo + texto, todo programatico.
export async function composePointSlide(background, { n, total, title, body = "" }, { width = 1080, height = 1350 } = {}) {
  const c = config().brand.colors;
  const img = await cover(background, width, height);
  const padX = Math.round(width * 0.09), maxW = width - padX * 2;
  const tSize = Math.round(width * 0.07), bSize = Math.round(width * 0.04);
  const tLines = wrapText(title, charsFor(maxW, tSize)).slice(0, 4);
  const bLines = wrapText(body, charsFor(maxW, bSize)).slice(0, 7);
  let y = Math.round(height * 0.2);
  const parts = [`<rect width="${width}" height="${height}" fill="${c.navy}" fill-opacity="0.82"/>`, `<circle cx="${padX + 34}" cy="${y}" r="34" fill="${c.orange}"/><text x="${padX + 34}" y="${y + 12}" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="700" fill="#fff">${n}</text>`];
  if (total) parts.push(`<text x="${width - padX}" y="${y + 12}" text-anchor="end" font-family="${FONT}" font-size="30" font-weight="700" fill="${c.orangeLight}">${n}/${total}</text>`);
  y += 120;
  tLines.forEach((l, i) => parts.push(`<text x="${padX}" y="${y + i * Math.round(tSize * 1.12)}" font-family="${FONT}" font-size="${tSize}" font-weight="700" fill="#fff">${esc(l)}</text>`));
  y += tLines.length * Math.round(tSize * 1.12) + 30;
  parts.push(`<rect x="${padX}" y="${y}" width="140" height="10" fill="${c.orangeLight}"/>`);
  y += 70;
  bLines.forEach((l, i) => parts.push(`<text x="${padX}" y="${y + i * Math.round(bSize * 1.4)}" font-family="${FONT}" font-size="${bSize}" fill="#dce6f0">${esc(l)}</text>`));
  const base = await sharp(img).composite([layer(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`), 0, 0)]).toBuffer();
  return applyLogo(base, { width, height, format: "feed" });
}
