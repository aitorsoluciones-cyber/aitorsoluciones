// Mantenimiento: inventario y limpieza de activos para que no se acumule basura ni reaparezcan visuales obsoletos.
// NUNCA toca: fotografias reales (origin real), material de marca, textos, briefs, calendario, metricas, ledger ni piezas publicadas
// (PUBLISHED_HISTORY) salvo regla explicita. Los rejected conservan metadatos (prompt, motivo, hash) y pierden la imagen tras la retencion.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { home, config, queueDir, outDir, ensureDir } from "./paths.mjs";
import { load, save, nowIso } from "./store.mjs";
import { syncMedia } from "./media-host.mjs";

export const CLASSES = ["KEEP", "PUBLISHED_HISTORY", "SOURCE_REAL", "BRAND", "DELETE_OBSOLETE", "DELETE_TEST", "DELETE_DUPLICATE"];
const isDelete = (c) => c.startsWith("DELETE_");
const TEST_RE = /^(prueba|test|e2e|dev)[_-]|^mk-test/i;

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full)); else out.push(full);
  }
  return out;
};
const dirStats = (dir) => walk(dir).reduce((a, f) => ({ files: a.files + 1, bytes: a.bytes + fs.statSync(f).size }), { files: 0, bytes: 0 });
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const same = (a, b) => path.resolve(a) === path.resolve(b);

// Todo lo que las piezas vivas (y las publicadas) referencian: activos, sus derivados (fondo original) y rutas.
function references(pieces, assets) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const collect = (list) => {
    const ids = new Set();
    const add = (id) => { if (!id || ids.has(id)) return; ids.add(id); for (const d of byId.get(id)?.derivedFrom || []) add(d); };
    for (const p of list) for (const id of [...(p.assetIds || []), ...(p.visual?.assetIds || []), ...(p.visual?.carousel || []), ...Object.values(p.visual?.formats || {})]) add(id);
    return ids;
  };
  const live = pieces.filter((p) => !["PUBLISHED", "ARCHIVED", "REJECTED"].includes(p.status));
  return { active: collect(live), published: collect(pieces.filter((p) => p.status === "PUBLISHED")), livePieces: live };
}

export function audit({ today = nowIso().slice(0, 10), now = Date.now(), tmpDir = os.tmpdir(), tmpOnly = false } = {}) {
  const cfg = config().cleanup;
  const assets = load("assets"), pieces = load("pieces");
  const refs = references(pieces, assets);
  const byPath = new Map(assets.filter((a) => a.sourcePath).map((a) => [path.resolve(a.sourcePath), a]));
  const items = [];
  const push = (it) => items.push({ bytes: 0, files: 1, ...it });
  const ageMs = (a) => now - new Date(a.createdAt || a.timestamp || 0).getTime();
  const regSha = new Map(assets.filter((a) => a.sha256).map((a) => [a.sha256, a]));

  if (!tmpOnly) {
    // 1. activos del motor visual (assets/marketing/...)
    const seen = new Map();
    for (const file of walk(path.join(home(), "assets"))) {
      if (file.endsWith(".json")) continue; // el sidecar sigue a su imagen
      const bytes = fs.statSync(file).size;
      const rec = byPath.get(path.resolve(file));
      const base = { path: file, bytes, assetId: rec?.id || null, kind: "asset" };
      if (!rec) { const h = sha(file); const dup = regSha.get(h); push({ ...base, class: dup ? "DELETE_DUPLICATE" : "DELETE_OBSOLETE", reason: dup ? `copia de ${dup.id}` : "sin registro en el banco" }); continue; }
      if (rec.origin === "real") { push({ ...base, class: "SOURCE_REAL", reason: "fotografia real" }); continue; }
      if (rec.origin === "brand") { push({ ...base, class: "BRAND", reason: "material de marca" }); continue; }
      const test = TEST_RE.test(rec.campaign || "");
      if (rec.status === "REJECTED") {
        const old = ageMs(rec) > cfg.rejectedDays * 86400000;
        push({ ...base, class: test ? "DELETE_TEST" : old ? "DELETE_OBSOLETE" : "KEEP", reason: test ? "variante rechazada de una prueba" : old ? `rechazada hace mas de ${cfg.rejectedDays} dias (se conservan prompt y motivo)` : `rechazada, retencion ${cfg.rejectedDays} dias`, keepMetadata: true });
      } else if (refs.published.has(rec.id)) push({ ...base, class: "PUBLISHED_HISTORY", reason: "usado por una pieza publicada" });
      else if (refs.active.has(rec.id)) {
        const k = rec.sha256; // duplicado exacto entre dos rutas
        if (seen.has(k)) push({ ...base, class: "DELETE_DUPLICATE", reason: `duplicado de ${seen.get(k)}` }); else { seen.set(k, rec.id); push({ ...base, class: "KEEP", reason: "referenciado por una pieza vigente" }); }
      } else if (test) push({ ...base, class: "DELETE_TEST", reason: "activo de una prueba" });
      else if (ageMs(rec) < cfg.graceHours * 3600000) push({ ...base, class: "KEEP", reason: `reciente (< ${cfg.graceHours} h), puede estar en curso` });
      else push({ ...base, class: "DELETE_OBSOLETE", reason: "no referenciado por ninguna pieza" });
    }

    // 2. cola
    const livePiece = new Map(refs.livePieces.map((p) => [p.id, p]));
    const qready = queueDir("READY_TO_PUBLISH");
    if (fs.existsSync(qready)) for (const name of fs.readdirSync(qready)) {
      const dir = path.join(qready, name), st = dirStats(dir);
      let post = null; try { post = JSON.parse(fs.readFileSync(path.join(dir, "post.json"), "utf8")); } catch { /* sin post */ }
      const piece = post && livePiece.get(post.pieceId);
      const ok = piece && piece.channelStatus?.[post.channel] === "READY_TO_PUBLISH" && ["v2", "manual-graphic"].includes(post.renderer);
      push({ path: dir, kind: "queue", ...st, class: ok ? "KEEP" : "DELETE_OBSOLETE", reason: ok ? "publicacion vigente" : !post?.renderer ? "cola preparada con un render antiguo" : "pieza ya no vigente", pieceId: post?.pieceId, channel: post?.channel });
    }
    const qpub = queueDir("PUBLISHED");
    if (fs.existsSync(qpub)) for (const name of fs.readdirSync(qpub)) push({ path: path.join(qpub, name), kind: "queue", ...dirStats(path.join(qpub, name)), class: "PUBLISHED_HISTORY", reason: "publicada" });

    // 3. renders (regenerables desde la cola/el banco)
    const outRoot = outDir();
    if (fs.existsSync(outRoot)) for (const name of fs.readdirSync(outRoot)) {
      const dir = path.join(outRoot, name), st = dirStats(dir);
      const fresh = now - fs.statSync(dir).mtimeMs < 3600000;
      push({ path: dir, kind: "render", ...st, class: fresh ? "KEEP" : "DELETE_OBSOLETE", reason: fresh ? "render reciente" : "render regenerable (la copia vigente esta en la cola)", pieceId: name });
    }

    // 4. temporales del estado
    for (const f of [...walk(path.join(home(), "tmp")), ...(fs.existsSync(home()) ? fs.readdirSync(home()).filter((n) => /\.(tmp|bak)$/i.test(n)).map((n) => path.join(home(), n)) : [])]) push({ path: f, kind: "temp", bytes: fs.statSync(f).size, class: "DELETE_TEST", reason: "temporal" });
  }

  // 5. directorios temporales de pruebas del propio sistema
  if (fs.existsSync(tmpDir)) for (const name of fs.readdirSync(tmpDir)) {
    if (!/^mk-test-/.test(name)) continue;
    const dir = path.join(tmpDir, name);
    let st; try { st = fs.statSync(dir); } catch { continue; }
    if (now - st.mtimeMs < cfg.testTempHours * 3600000) continue;
    push({ path: dir, kind: "test-temp", ...dirStats(dir), class: "DELETE_TEST", reason: "directorio temporal de pruebas" });
  }

  const counts = Object.fromEntries(CLASSES.map((c) => [c, items.filter((i) => i.class === c).reduce((a, i) => ({ items: a.items + 1, files: a.files + i.files, bytes: a.bytes + i.bytes }), { items: 0, files: 0, bytes: 0 })]));
  // activos registrados que nadie referencia (con o sin fichero): huerfanos
  const orphans = assets.filter((a) => a.origin === "generated" && a.status !== "REJECTED" && !refs.active.has(a.id) && !refs.published.has(a.id)).map((a) => a.id);
  return { today, items, counts, orphans, refs };
}

// Aplica el inventario: borra lo DELETE_*, ajusta el banco y la cola, sincroniza la rama media. dryRun por defecto en el CLI.
// Registro generado cuyo fichero ya no es el suyo (otro contenido con el mismo nombre): se desvincula, nunca se borra el fichero ajeno.
export function repairRecords() {
  const assets = load("assets");
  let n = 0;
  for (const a of assets) {
    if (a.origin !== "generated" || !a.sourcePath || a.fileDeleted || !a.sha256 || !fs.existsSync(a.sourcePath)) continue;
    if (sha(a.sourcePath) !== a.sha256) { a.sourcePath = null; a.fileDeleted = true; a.deletedAt = nowIso(); a.deletedReason = "fichero sustituido por otra variante"; n++; }
  }
  if (n) save("assets", assets);
  return n;
}

export async function cleanup({ apply = false, today = nowIso().slice(0, 10), media = true, squash = true, tmpDir = os.tmpdir(), now = Date.now(), log = () => {} } = {}) {
  const repaired = apply ? repairRecords() : 0;
  const a = audit({ today, now, tmpDir });
  const del = a.items.filter((i) => isDelete(i.class));
  // seguridad: nada vigente ni publicado puede estar en la lista de borrado
  const protectedPaths = new Set(a.items.filter((i) => !isDelete(i.class)).map((i) => path.resolve(i.path)));
  for (const d of del) if (protectedPaths.has(path.resolve(d.path))) throw new Error(`Seguridad: ${d.path} figura a la vez como conservar y borrar`);
  const pieces = load("pieces"), assets = load("assets");
  const livePaths = new Set();
  for (const p of pieces.filter((x) => !["PUBLISHED", "ARCHIVED", "REJECTED"].includes(x.status))) for (const id of [...(p.visual?.assetIds || []), ...(p.assetIds || [])]) { const r = assets.find((x) => x.id === id); if (r?.sourcePath) livePaths.add(path.resolve(r.sourcePath)); }
  for (const d of del.filter((x) => x.kind === "asset")) if (livePaths.has(path.resolve(d.path))) throw new Error(`Seguridad: ${d.path} lo referencia una pieza vigente`);

  const result = { apply, today, repaired, counts: a.counts, deleted: { files: 0, dirs: 0, bytes: 0, duplicates: 0, tests: 0, obsolete: 0, mediaDirs: 0 }, orphans: a.orphans, media: null, items: del.map((d) => ({ class: d.class, kind: d.kind, path: d.path, reason: d.reason, files: d.files, bytes: d.bytes })) };
  if (!apply) return result;

  const freed = new Set();
  for (const d of del) {
    fs.rmSync(d.path, { recursive: true, force: true });
    if (d.kind === "asset") fs.rmSync(d.path + ".json", { force: true });
    result.deleted.files += d.files; result.deleted.bytes += d.bytes; if (d.kind !== "asset") result.deleted.dirs++;
    if (d.class === "DELETE_DUPLICATE") result.deleted.duplicates += d.files; else if (d.class === "DELETE_TEST") result.deleted.tests += d.files; else result.deleted.obsolete += d.files;
    if (d.assetId) freed.add(d.assetId);
    log(`  - ${d.class} ${d.path}`);
  }
  // banco: los rejected conservan metadatos (sin fichero); el resto de activos borrados deja de figurar
  const keepMeta = new Map(del.filter((d) => d.keepMetadata).map((d) => [d.assetId, d]));
  const next = [];
  for (const rec of assets) {
    if (!freed.has(rec.id)) { next.push(rec); continue; }
    if (keepMeta.has(rec.id)) next.push({ ...rec, sourcePath: null, fileDeleted: true, deletedAt: nowIso(), deletedReason: keepMeta.get(rec.id).reason });
  }
  save("assets", next);
  // piezas: colas y renders borrados dejan de constar
  const deletedQueue = del.filter((d) => d.kind === "queue"), deletedRender = new Set(del.filter((d) => d.kind === "render").map((d) => d.pieceId));
  const pcs = load("pieces");
  for (const p of pcs) {
    for (const q of deletedQueue) if (q.pieceId === p.id && q.channel && p.channelStatus?.[q.channel] === "READY_TO_PUBLISH") delete p.channelStatus[q.channel];
    if (deletedRender.has(p.id)) delete p.render;
  }
  save("pieces", pcs);
  // media: solo lo necesario para publicaciones pendientes o recientes
  if (media) {
    try { result.media = syncMedia({ today, squash, log }); result.deleted.mediaDirs = result.media.removed.length; }
    catch (e) { result.media = { error: e.message }; }
  }
  const dir = path.join(home(), "cleanup"); ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${today}.json`), JSON.stringify({ ...result, items: result.items.length > 400 ? result.items.slice(0, 400) : result.items }, null, 2) + "\n");
  for (const old of fs.readdirSync(dir).sort().slice(0, -(config().cleanup.keepReports || 10))) fs.rmSync(path.join(dir, old), { force: true });
  result.orphans = audit({ today, now, tmpDir }).orphans;
  return result;
}
