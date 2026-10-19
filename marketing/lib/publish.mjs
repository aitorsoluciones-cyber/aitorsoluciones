// Cola de publicacion. Sin API/conector disponible (caso actual) todo queda en queue/READY_TO_PUBLISH listo para publicar
// en un minuto; con credenciales (variables de entorno) y MK_ALLOW_PUBLISH=1 los adaptadores publican solos.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { load, save, nowIso, findById } from "./store.mjs";
import { queueDir, ensureDir, outDir, config } from "./paths.mjs";
import { renderPiece } from "./assets.mjs";
import { transition } from "./states.mjs";
import { setJobStatus } from "./jobs.mjs";

const copyInto = async (dir, src, name, jpeg = false) => {
  if (jpeg && /\.png$/i.test(name)) { name = name.replace(/\.png$/i, ".jpg"); ensureDir(path.dirname(path.join(dir, name))); fs.writeFileSync(path.join(dir, name), await sharp(src).jpeg({ quality: 92, mozjpeg: true }).toBuffer()); return name; }
  ensureDir(path.dirname(path.join(dir, name))); fs.copyFileSync(src, path.join(dir, name)); return name;
};

// Ficheros que corresponden a cada canal.
export function filesForChannel(channel, renderDir, piece) {
  const p = (...x) => path.join(renderDir, ...x);
  const has = (f) => fs.existsSync(p(f));
  const pick = (base) => [base + ".png", base + ".jpg"].find(has) || null;
  const out = { main: [], extra: [] };
  if (channel === "instagram") {
    const carousel = fs.existsSync(p("carousel")) ? fs.readdirSync(p("carousel")).sort().map((f) => "carousel/" + f) : [];
    if (piece.kind === "work") { if (pick("feed")) out.main.push(pick("feed")); out.extra.push(...carousel); }
    else if (carousel.length) out.main.push(...carousel);
    else if (pick("feed")) out.main.push(pick("feed"));
    if (pick("story")) out.extra.push(pick("story"));
  } else if (channel === "facebook") { if (pick("feed")) out.main.push(pick("feed")); }
  else if (channel === "gbp") { if (pick("gbp") || has("gbp.jpg")) out.main.push(has("gbp.jpg") ? "gbp.jpg" : pick("gbp")); }
  return out;
}

// rebuild: rehace tambien lo ya preparado y aun sin publicar (p. ej. tras cambiar imagenes o formatos).
export async function buildQueue({ today, ahead = 3, rebuild = false, log = () => {} }) {
  const pieces = load("pieces");
  const assets = load("assets");
  const jobs = load("jobs");
  const limit = new Date(new Date(today + "T00:00:00Z").getTime() + ahead * 86400000).toISOString().slice(0, 10);
  const queued = [];
  if (rebuild) for (const piece of pieces.filter((p) => p.status === "SCHEDULED" && p.scheduledFor <= limit)) for (const ch of piece.channels) {
    if (piece.channelStatus?.[ch] !== "READY_TO_PUBLISH") continue;
    fs.rmSync(queueDir("READY_TO_PUBLISH", `${piece.scheduledFor}__${piece.id}__${ch}`), { recursive: true, force: true });
    delete piece.channelStatus[ch];
  }
  for (const piece of pieces.filter((p) => p.status === "SCHEDULED" && p.scheduledFor <= limit)) {
    const render = await renderPiece(piece, { assets, jobs, root: outDir(piece.id) });
    piece.render = { dir: render.dir, files: render.files.map((f) => path.relative(render.dir, f.file).split(path.sep).join("/")), warnings: render.warnings, at: nowIso() };
    piece.channelStatus ||= {};
    for (const ch of piece.channels) {
      if (["READY_TO_PUBLISH", "PUBLISHED"].includes(piece.channelStatus[ch])) continue;
      const dir = queueDir("READY_TO_PUBLISH", `${piece.scheduledFor}__${piece.id}__${ch}`);
      fs.rmSync(dir, { recursive: true, force: true });
      ensureDir(dir);
      const f = filesForChannel(ch, render.dir, piece);
      if (!f.main.length) throw new Error(`Sin activos para ${ch} en ${piece.id}`);
      const jpeg = ch === "instagram"; // la API de Instagram solo admite JPEG
      const main = [];
      for (const x of f.main) main.push(await copyInto(dir, path.join(render.dir, x), x, jpeg));
      const extra = [];
      for (const x of f.extra) extra.push(await copyInto(dir, path.join(render.dir, x), "extra/" + x, jpeg));
      const caption = piece.copy.captions[ch];
      fs.writeFileSync(path.join(dir, "caption.txt"), caption + "\n");
      fs.writeFileSync(path.join(dir, "alt.txt"), piece.copy.alt + "\n");
      const post = { pieceId: piece.id, channel: ch, scheduledFor: piece.scheduledFor, time: piece.time, kind: piece.kind, files: main, extra, caption, alt: piece.copy.alt, status: "READY_TO_PUBLISH", warnings: render.warnings,
        ...(ch === "gbp" ? { gbp: { topicType: "STANDARD", languageCode: "es", callToAction: { actionType: config().channels.gbp.ctaButton } } } : {}) };
      fs.writeFileSync(path.join(dir, "post.json"), JSON.stringify(post, null, 2) + "\n");
      fs.writeFileSync(path.join(dir, "PUBLICAR.md"), `# ${ch} · ${piece.scheduledFor} ${piece.time}\n\n1. Sube ${main.join(", ")} (en ese orden).\n2. Pega el texto de caption.txt.\n3. Texto alternativo: alt.txt.\n4. Cuando publiques: \`npm run mk -- published ${piece.id} ${ch} <url>\`\n`);
      piece.channelStatus[ch] = "READY_TO_PUBLISH";
      queued.push({ pieceId: piece.id, channel: ch, dir });
      log(`  cola: ${path.basename(dir)}`);
    }
  }
  save("pieces", pieces);
  return queued;
}

export function markPublished(pieceId, channel, url, date = nowIso().slice(0, 10)) {
  const pieces = load("pieces");
  const piece = findById(pieces, pieceId);
  if (!piece) throw new Error(`Pieza no encontrada: ${pieceId}`);
  if (!piece.channels.includes(channel)) throw new Error(`La pieza ${pieceId} no se publica en ${channel}`);
  if (!/^https?:\/\//.test(url || "")) throw new Error("Indica la URL real de la publicacion");
  piece.urls = { ...piece.urls, [channel]: url };
  piece.channelStatus = { ...piece.channelStatus, [channel]: "PUBLISHED" };
  piece.publishedAt = { ...piece.publishedAt, [channel]: date };
  if (piece.channels.every((ch) => piece.channelStatus[ch] === "PUBLISHED")) {
    transition(piece, "PUBLISHED", "publicada en todos los canales");
    if (piece.kind === "work") { try { setJobStatus(piece.jobId, "PUBLISHED"); } catch { /* ya publicado */ } }
  }
  save("pieces", pieces);
  const dir = queueDir("READY_TO_PUBLISH", `${piece.scheduledFor}__${piece.id}__${channel}`);
  if (fs.existsSync(dir)) {
    const done = queueDir("PUBLISHED", path.basename(dir));
    ensureDir(path.dirname(done));
    fs.rmSync(done, { recursive: true, force: true });
    fs.renameSync(dir, done);
  }
  return piece;
}

export function queueSummary() {
  const dir = queueDir("READY_TO_PUBLISH");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((name) => ({ name, ...JSON.parse(fs.readFileSync(path.join(dir, name, "post.json"), "utf8")) }));
}
