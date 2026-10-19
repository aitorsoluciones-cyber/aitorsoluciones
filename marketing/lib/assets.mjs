// Generador de activos: fotos reales preservadas (solo recorte y marco de marca) + graficos educativos propios.
// Nunca se genera una fotografia de un trabajo: los graficos son tipograficos y se etiquetan origin:"graphic".
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { REPO, config, outDir, ensureDir } from "./paths.mjs";
import { load, findById } from "./store.mjs";
import { readPhoto } from "./media.mjs";

export const SIZES = { feed: [1080, 1350], story: [1080, 1920], gbp: [1200, 900] };
export const TEMPLATES = ["navy", "cream", "orange", "grid"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "Arial, Helvetica, sans-serif";

export function wrapText(text, maxChars) {
  const lines = [];
  let cur = "";
  for (const w of String(text).split(/\s+/)) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
const textBlock = (lines, x, y, size, lh, fill, weight = 400, extra = "") =>
  lines.map((l, i) => `<text x="${x}" y="${y + i * lh}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${esc(l)}</text>`).join("");
const charsFor = (width, size) => Math.max(8, Math.floor(width / (size * 0.56)));

const rect = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
let logoCache;
async function logoPlate(h) {
  logoCache ||= fs.readFileSync(path.join(REPO, config().brand.logo));
  const logo = await sharp(logoCache).resize({ height: h - 16 }).png().toBuffer();
  const m = await sharp(logo).metadata();
  const w = m.width + 24;
  return { w, h, buf: await sharp({ create: { width: w, height: h, channels: 4, background: "#ffffff" } }).composite([{ input: logo, left: 12, top: 8 }]).png().toBuffer() };
}

// ---------- graficos tipograficos ----------
const PALETTES = {
  navy: (c) => ({ bg: c.navy, title: c.white, body: "#dce6f0", tag: c.orangeLight, accent: c.orangeLight, chip: c.orange }),
  cream: (c) => ({ bg: c.cream, title: c.navy, body: c.ink, tag: c.orange, accent: c.orange, chip: c.navy }),
  orange: (c) => ({ bg: c.orange, title: c.white, body: "#fff4ec", tag: c.navy, accent: c.navy, chip: c.navy }),
  grid: (c) => ({ bg: c.navy2, title: c.white, body: "#dce6f0", tag: c.orangeLight, accent: c.orangeLight, chip: c.orange })
};

function decoration(template, w, h, p) {
  if (template === "navy") return `<polygon points="0,0 ${w * 0.34},0 ${w * 0.29},26 0,26" fill="${p.accent}"/>`;
  if (template === "cream") return rect(0, 0, 22, h, p.accent);
  if (template === "orange") return `<polygon points="${w},0 ${w},${h * 0.3} ${w * 0.7},0" fill="rgba(7,30,59,0.18)"/>`;
  let grid = "";
  for (let x = 0; x <= w; x += 90) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>`;
  for (let y = 0; y <= h; y += 90) grid += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>`;
  return grid + rect(70, 0, 110, 14, p.accent);
}

// kind: cover | point | cta | single. size: feed | story | gbp
export async function renderGraphic({ template = "navy", kind = "point", tag = "", title = "", body = "", index, total, size = "feed" }) {
  const c = config().brand.colors;
  const [w, h] = SIZES[size];
  const p = PALETTES[template](c);
  const story = size === "story";
  const padX = 90;
  const top = story ? 420 : size === "gbp" ? 90 : 300;
  const bottomReserve = story ? 360 : size === "gbp" ? 130 : 190;
  const tSize = kind === "cover" || kind === "single" ? (size === "gbp" ? 66 : 84) : size === "gbp" ? 56 : 72;
  const bSize = size === "gbp" ? 34 : 42;
  const maxW = w - padX * 2;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rect(0, 0, w, h, p.bg)}${decoration(template, w, h, p)}`;
  let y = top;
  if (tag) {
    const tagText = tag.toUpperCase();
    const tw = Math.min(maxW, tagText.length * 24 + 56);
    svg += rect(padX, y - 44, tw, 62, p.chip, 'rx="8"') + `<text x="${padX + 28}" y="${y}" font-family="${FONT}" font-size="34" font-weight="700" fill="#ffffff" letter-spacing="2">${esc(tagText)}</text>`;
    y += 110;
  }
  const tLines = wrapText(title, charsFor(maxW, tSize)).slice(0, 6);
  svg += textBlock(tLines, padX, y + tSize * 0.6, tSize, Math.round(tSize * 1.12), p.title, 700);
  y += tLines.length * Math.round(tSize * 1.12) + 40;
  if (kind === "point" || kind === "single") {
    svg += rect(padX, y, 140, 10, p.accent);
    y += 70;
    const bLines = wrapText(body, charsFor(maxW, bSize)).slice(0, size === "gbp" ? 5 : 9);
    svg += textBlock(bLines, padX, y + bSize * 0.6, bSize, Math.round(bSize * 1.4), p.body, 400);
  }
  if (kind === "cta") {
    const cta = config().brand.cta;
    const lines = wrapText(cta, charsFor(maxW, 56));
    svg += textBlock(lines, padX, y + 60, 56, 74, p.accent === p.title ? p.title : p.accent, 700);
    svg += textBlock([config().brand.phoneDisplay, config().brand.web], padX, y + 60 + lines.length * 74 + 70, 44, 62, p.body, 400);
  }
  if (index && total) svg += `<text x="${w - padX}" y="${h - bottomReserve + 70}" text-anchor="end" font-family="${FONT}" font-size="34" font-weight="700" fill="${p.tag}">${index}/${total}</text>`;
  const foot = story ? 200 : 110;
  svg += rect(0, h - foot, w, foot, "rgba(0,0,0,0)");
  svg += `<text x="${w - padX}" y="${h - foot / 2 + 12}" text-anchor="end" font-family="${FONT}" font-size="30" fill="${p.body}">${esc(config().brand.web)}</text></svg>`;
  const plate = await logoPlate(story ? 96 : 80);
  return sharp(Buffer.from(svg)).composite([{ input: plate.buf, left: padX, top: h - foot / 2 - plate.h / 2 + (story ? -20 : 0) }]).png().toBuffer();
}

// ---------- fotografias reales (se preservan; solo recorte y marco de marca) ----------
const chip = (text, fill) => {
  const w = text.length * 22 + 48;
  return { w, svg: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="58"><rect width="${w}" height="58" rx="8" fill="${fill}"/><text x="${w / 2}" y="40" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#fff" letter-spacing="2">${esc(text)}</text></svg>`) };
};

async function brandBand(w, h) {
  const c = config().brand.colors;
  const plate = await logoPlate(h - 24);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${c.navy}"/><text x="${w - 40}" y="${h / 2 + 11}" text-anchor="end" font-family="${FONT}" font-size="30" fill="#dce6f0">${esc(config().brand.web)}</text></svg>`);
  return sharp(svg).composite([{ input: plate.buf, left: 36, top: 12 }]).png().toBuffer();
}

const cover = (buf, w, h, position = "centre") => sharp(buf).resize(w, h, { fit: "cover", position }).toBuffer();

export async function photoFeed(photo, { label } = {}) {
  const [w, h] = SIZES.feed;
  const img = await cover(photo, w, h - 120);
  const layers = [{ input: img, left: 0, top: 0 }, { input: await brandBand(w, 120), left: 0, top: h - 120 }];
  if (label) { const c = chip(label, label === "DESPUÉS" ? config().brand.colors.orange : config().brand.colors.navy); layers.push({ input: c.svg, left: 32, top: 32 }); }
  return sharp({ create: { width: w, height: h, channels: 3, background: config().brand.colors.navy } }).composite(layers).png().toBuffer();
}

export async function photoStory(photo, { label } = {}) {
  const [w, h] = SIZES.story;
  const c = config().brand;
  const img = await cover(photo, w, 1440);
  const bottom = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="320"><rect width="${w}" height="320" fill="${c.colors.navy}"/>${textBlock(wrapText(c.cta, 30), 60, 120, 52, 66, "#ffffff", 700)}<text x="60" y="270" font-family="${FONT}" font-size="36" fill="#dce6f0">${esc(c.phoneDisplay)} · ${esc(c.web)}</text></svg>`);
  const layers = [{ input: await brandBand(w, 160), left: 0, top: 0 }, { input: img, left: 0, top: 160 }, { input: bottom, left: 0, top: 1600 }];
  if (label) { const ch = chip(label, label === "DESPUÉS" ? c.colors.orange : c.colors.navy); layers.push({ input: ch.svg, left: 32, top: 190 }); }
  return sharp({ create: { width: w, height: h, channels: 3, background: c.colors.navy } }).composite(layers).png().toBuffer();
}

export async function photoGbp(photo) {
  const [w, h] = SIZES.gbp;
  return sharp(photo).resize(w, h, { fit: "cover" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

export async function beforeAfterFeed(before, after) {
  const [w, h] = SIZES.feed;
  const bh = h - 120;
  const c = config().brand.colors;
  const [b, a] = await Promise.all([cover(before, w / 2, bh), cover(after, w / 2, bh)]);
  const l1 = chip("ANTES", c.navy), l2 = chip("DESPUÉS", c.orange);
  return sharp({ create: { width: w, height: h, channels: 3, background: c.navy } }).composite([
    { input: b, left: 0, top: 0 }, { input: a, left: w / 2, top: 0 },
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="6" height="${bh}"><rect width="6" height="${bh}" fill="#fff"/></svg>`), left: w / 2 - 3, top: 0 },
    { input: l1.svg, left: 24, top: 24 }, { input: l2.svg, left: w / 2 + 24, top: 24 },
    { input: await brandBand(w, 120), left: 0, top: h - 120 }
  ]).png().toBuffer();
}

export async function beforeAfterStory(before, after) {
  const [w, h] = SIZES.story;
  const c = config().brand;
  const [b, a] = await Promise.all([cover(before, w, 720), cover(after, w, 720)]);
  const bottom = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="320"><rect width="${w}" height="320" fill="${c.colors.navy}"/>${textBlock(wrapText(c.cta, 30), 60, 120, 52, 66, "#ffffff", 700)}<text x="60" y="270" font-family="${FONT}" font-size="36" fill="#dce6f0">${esc(c.phoneDisplay)} · ${esc(c.web)}</text></svg>`);
  const l1 = chip("ANTES", c.colors.navy), l2 = chip("DESPUÉS", c.colors.orange);
  return sharp({ create: { width: w, height: h, channels: 3, background: c.colors.navy } }).composite([
    { input: await brandBand(w, 160), left: 0, top: 0 }, { input: b, left: 0, top: 160 }, { input: a, left: 0, top: 880 }, { input: bottom, left: 0, top: 1600 },
    { input: l1.svg, left: 28, top: 188 }, { input: l2.svg, left: 28, top: 908 }
  ]).png().toBuffer();
}

export async function webThumbs(photo) {
  return {
    480: await sharp(photo).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(),
    800: await sharp(photo).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer()
  };
}

// Factor de ampliacion necesario para llenar el formato (avisa de fotos pequenas; no se rehace nada).
export const upscaleFactor = (width, height, size) => Math.max(SIZES[size][0] / width, (SIZES[size][1] - 120) / height);

// ---------- pieza completa ----------
const write = (dir, name, buf) => { const f = path.join(dir, name); ensureDir(path.dirname(f)); fs.writeFileSync(f, buf); return f; };

export async function renderPiece(piece, { assets = load("assets"), jobs = load("jobs"), root = outDir(piece.id) } = {}) {
  const files = [];
  const add = async (name, buf, format) => { const f = write(root, name, buf); const m = await sharp(f).metadata(); files.push({ file: f, format, width: m.width, height: m.height }); };
  const warnings = [];
  const c = piece.copy || {};
  const wants = (fmt) => (piece.channels || []).some((ch) => config().channels[ch].formats.includes(fmt));
  if (piece.kind === "work") {
    const job = findById(jobs, piece.jobId);
    const mine = piece.assetIds.map((id) => findById(assets, id));
    const before = mine.find((a) => a?.role === "before" && a.kind === "image");
    const after = mine.find((a) => a?.role === "after" && a.kind === "image") || mine.find((a) => a?.kind === "image");
    if (!after) throw new Error(`La pieza ${piece.id} no tiene foto 'despues'`);
    const [afterBuf, beforeBuf] = await Promise.all([readPhoto(after.sourcePath), before ? readPhoto(before.sourcePath) : null]);
    for (const a of [after, before].filter(Boolean)) if (upscaleFactor(a.width, a.height, "feed") > 1.4) warnings.push(`${a.id}: foto pequena (${a.width}x${a.height}), ampliacion ${upscaleFactor(a.width, a.height, "feed").toFixed(2)}x`);
    if (wants("feed")) await add("feed.png", beforeBuf ? await beforeAfterFeed(beforeBuf, afterBuf) : await photoFeed(afterBuf, { label: "DESPUÉS" }), "feed");
    if (wants("story")) await add("story.png", beforeBuf ? await beforeAfterStory(beforeBuf, afterBuf) : await photoStory(afterBuf, { label: "DESPUÉS" }), "story");
    if (wants("carousel")) {
      const slides = [await photoFeed(afterBuf, { label: "DESPUÉS" })];
      if (beforeBuf) slides.push(await photoFeed(beforeBuf, { label: "ANTES" }), await beforeAfterFeed(beforeBuf, afterBuf));
      slides.push(await renderGraphic({ template: piece.template, kind: "point", tag: "Qué hicimos", title: job.title || "Trabajo realizado", body: job.notes || "", size: "feed" }));
      slides.push(await renderGraphic({ template: piece.template, kind: "cta", title: "¿Tienes algo parecido?", size: "feed" }));
      for (let i = 0; i < slides.length; i++) await add(`carousel/${String(i + 1).padStart(2, "0")}.png`, slides[i], "carousel");
    }
    if (wants("gbp")) await add("gbp.jpg", await photoGbp(afterBuf), "gbp");
    const t = await webThumbs(afterBuf);
    await add("web-480.webp", t[480], "web-thumb"); await add("web-800.webp", t[800], "web-thumb");
  } else {
    const tpl = piece.template || "navy";
    const slides = c.slides || [];
    const single = piece.type === "single" || slides.length <= 1;
    if (single) {
      const s = slides[0] || {};
      const common = { template: tpl, kind: "single", tag: c.tag, title: c.headline || s.t, body: s.b ? (c.headline ? `${s.t}. ${s.b}` : s.b) : "" };
      if (wants("feed")) await add("feed.png", await renderGraphic({ ...common, size: "feed" }), "feed");
      if (wants("story")) await add("story.png", await renderGraphic({ ...common, size: "story" }), "story");
      if (wants("gbp")) await add("gbp.png", await renderGraphic({ ...common, size: "gbp" }), "gbp");
    } else {
      const all = [{ kind: "cover", title: c.headline, tag: c.tag }, ...slides.map((s) => ({ kind: "point", tag: c.tag, title: s.t, body: s.b })), { kind: "cta", title: "¿Hablamos?", tag: "" }];
      if (wants("carousel") || wants("feed")) for (let i = 0; i < all.length; i++) await add(`carousel/${String(i + 1).padStart(2, "0")}.png`, await renderGraphic({ template: tpl, ...all[i], index: i + 1, total: all.length, size: "feed" }), "carousel");
      if (wants("story")) await add("story.png", await renderGraphic({ template: tpl, ...all[0], size: "story" }), "story");
      if (wants("gbp")) await add("gbp.png", await renderGraphic({ template: tpl, kind: "single", tag: c.tag, title: c.headline, body: slides.map((s) => s.t).join(" · "), size: "gbp" }), "gbp");
      if (wants("feed")) await add("feed.png", fs.readFileSync(path.join(root, "carousel", "01.png")), "feed");
    }
  }
  return { files, warnings, dir: root };
}
