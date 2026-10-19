// Pipeline de entrada: carpeta local (espejo de Drive o archivo historico) o manifiesto del conector de Drive.
// Detecta carpetas nuevas, imagenes, videos, antes/despues, servicio, localidad (propuesta, no confirmada) y duplicados.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { load, save, nowIso } from "./store.mjs";
import { config, home, ensureDir } from "./paths.mjs";
import { kindOf, fileHashes, describePhoto, hamming } from "./media.mjs";
import { matchLocation, matchService, norm } from "./places.mjs";

const BEFORE = ["antes", "before", "pre"];
const AFTER = ["despues", "after", "post", "resultado"];

export function parseContext(parts, fileName, kind) {
  const hay = [...parts, fileName].join(" ");
  const tokens = norm(hay).split(" ");
  let role = kind === "video" ? "video" : "work";
  if (tokens.some((t) => BEFORE.includes(t))) role = "before";
  else if (tokens.some((t) => AFTER.includes(t))) role = "after";
  const date = (hay.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/) || []).slice(1, 4).join("-") || null;
  const loc = matchLocation(parts.join(" "));
  return { role, date, serviceId: matchService(parts.join(" ")), locationCandidate: loc ? loc.id : null };
}

export const jobIdFor = (origin, key) => "job_" + crypto.createHash("sha1").update(origin + ":" + key).digest("hex").slice(0, 8);

function ensureJob(jobs, origin, key, ctx, extra = {}) {
  const id = jobIdFor(origin, key);
  let job = jobs.find((j) => j.id === id);
  if (!job) {
    job = {
      id, key, origin, title: null, status: "NEW", serviceId: ctx.serviceId, locationCandidate: ctx.locationCandidate,
      locationId: null, locationConfirmed: false, date: ctx.date, webCaseId: null, notes: "", createdAt: nowIso(), history: [], ...extra
    };
    jobs.push(job);
    job.isNew = true;
  } else {
    job.serviceId ||= ctx.serviceId;
    job.locationCandidate ||= ctx.locationCandidate;
    job.date ||= ctx.date;
  }
  return job;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || /^(thumbs\.db|desktop\.ini)$/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (kindOf(full)) out.push(full);
  }
  return out;
}

export async function ingestDir(root, { origin = "upload", log = () => {} } = {}) {
  const cfg = config();
  const assets = load("assets");
  const jobs = load("jobs");
  const summary = { root, origin, files: 0, added: 0, duplicates: [], similar: [], newJobs: [], attached: 0, errors: [] };
  const bySha = new Map(assets.filter((a) => a.sha256).map((a) => [a.sha256, a]));
  const byMd5 = new Map(assets.filter((a) => a.md5).map((a) => [a.md5, a]));

  for (const file of walk(root)) {
    summary.files++;
    try {
      const rel = path.relative(root, file).split(path.sep);
      const kind = kindOf(file);
      const { sha256, md5 } = await fileHashes(file);
      const known = bySha.get(sha256);
      if (known) { summary.duplicates.push({ file, of: known.id }); continue; }
      const drive = byMd5.get(md5);
      if (drive && drive.needsDownload) { // ya registrado desde Drive: se enlaza el fichero local
        Object.assign(drive, { sha256, sourcePath: file, needsDownload: false });
        bySha.set(sha256, drive); summary.attached++; continue;
      }
      const folders = rel.slice(0, -1);
      const jobKey = folders.length ? folders[0] : "lote-" + fs.statSync(file).mtime.toISOString().slice(0, 10);
      const ctx = parseContext(folders, path.basename(file), kind);
      const job = ensureJob(jobs, origin, jobKey, ctx);
      if (job.isNew) { summary.newJobs.push(job.id); delete job.isNew; }
      const a = {
        id: "a_" + sha256.slice(0, 12), sha256, md5, kind, origin: "real", source: origin, sourcePath: file,
        name: path.basename(file), jobId: job.id, role: ctx.role, bytes: fs.statSync(file).size,
        status: "NEW", createdAt: nowIso(), history: [], needsDownload: false
      };
      if (kind === "image") {
        const d = await describePhoto(file);
        Object.assign(a, { width: d.width, height: d.height, ahash: d.ahash });
        const near = assets.find((o) => o.ahash && o.jobId !== job.id && hamming(o.ahash, a.ahash) <= cfg.reuse.nearDuplicateHamming);
        if (near) { a.nearDuplicateOf = near.id; summary.similar.push({ file, of: near.id }); }
      }
      assets.push(a); bySha.set(sha256, a); byMd5.set(md5, a); summary.added++;
      log(`  + ${a.id} ${a.role} ${rel.join("/")}`);
    } catch (e) { summary.errors.push({ file, error: e.message }); }
  }
  save("assets", assets); save("jobs", jobs);
  const scans = load("scans");
  scans.push({ at: nowIso(), root, origin, files: summary.files, added: summary.added, newJobs: summary.newJobs });
  save("scans", scans);
  return summary;
}

// Manifiesto generado desde el conector de Drive: [{ driveId, name, path, mimeType, size, md5?, createdTime? }]
export function ingestManifest(entries) {
  const assets = load("assets");
  const jobs = load("jobs");
  const summary = { files: entries.length, added: 0, duplicates: [], newJobs: [], skipped: [] };
  const byDrive = new Set(assets.map((a) => a.driveId).filter(Boolean));
  const byMd5 = new Map(assets.filter((a) => a.md5).map((a) => [a.md5, a]));
  for (const e of entries) {
    const kind = kindOf(e.name);
    if (!kind) { summary.skipped.push(e.name); continue; }
    if (byDrive.has(e.driveId)) { summary.duplicates.push({ file: e.name, of: e.driveId }); continue; }
    if (e.md5 && byMd5.has(e.md5)) { summary.duplicates.push({ file: e.name, of: byMd5.get(e.md5).id }); continue; }
    const parts = String(e.path || "").split("/").filter(Boolean);
    const folders = parts.slice(0, -1).filter((p) => !/^00_NUEVOS_TRABAJOS$/i.test(p) && !/^Aitor Soluciones$/i.test(p));
    const day = (e.createdTime || nowIso()).slice(0, 10);
    const jobKey = folders[0] || "lote-" + day;
    const ctx = parseContext(folders, e.name, kind);
    const job = ensureJob(jobs, "drive", jobKey, { ...ctx, date: ctx.date || day });
    if (job.isNew) { summary.newJobs.push(job.id); delete job.isNew; }
    assets.push({
      id: "a_d" + crypto.createHash("sha1").update(e.driveId).digest("hex").slice(0, 11), sha256: null, md5: e.md5 || null, driveId: e.driveId,
      kind, origin: "real", source: "drive", sourcePath: null, needsDownload: true, name: e.name, jobId: job.id, role: ctx.role,
      driveFolder: parts.find((p) => Object.values(config().drive.folders).some((f) => f.name === p)) || null,
      bytes: Number(e.size) || null, status: "NEW", createdAt: nowIso(), history: []
    });
    summary.added++;
  }
  save("assets", assets); save("jobs", jobs);
  const scans = load("scans");
  scans.push({ at: nowIso(), root: "drive-manifest", origin: "drive", files: entries.length, added: summary.added, newJobs: summary.newJobs });
  save("scans", scans);
  return summary;
}

// Siembra el banco con los casos reales ya publicados en la web (localidad ya confirmada por estar publicada).
export async function importWebCases({ repo }) {
  const cases = JSON.parse(fs.readFileSync(path.join(repo, "src/_data/workCases.json"), "utf8").replace(/^﻿/, ""));
  const assets = load("assets");
  const jobs = load("jobs");
  const added = [];
  for (const c of cases.filter((x) => x.status === "active")) {
    const id = jobIdFor("web", c.id);
    if (jobs.find((j) => j.id === id)) continue;
    jobs.push({
      id, key: c.id, origin: "web", title: c.title, status: "READY", serviceId: c.serviceId, locationCandidate: c.locationId,
      locationId: c.locationId || null, locationConfirmed: !!c.locationId, date: null, webCaseId: c.id, notes: c.whatWeDid || "",
      createdAt: nowIso(), history: [{ from: "NEW", to: "READY", at: nowIso(), note: "importado de workCases.json (publicado en la web)" }]
    });
    for (const [role, name] of [["before", c.before], ["after", c.after]]) {
      const file = path.join(repo, "src/assets/img", name + ".webp");
      if (!fs.existsSync(file)) continue;
      const { sha256, md5 } = await fileHashes(file);
      if (assets.find((a) => a.sha256 === sha256)) continue;
      const d = await describePhoto(file);
      assets.push({
        id: "a_" + sha256.slice(0, 12), sha256, md5, kind: "image", origin: "real", source: "web", sourcePath: file, name: name + ".webp",
        jobId: id, role, bytes: fs.statSync(file).size, width: d.width, height: d.height, ahash: d.ahash,
        quality: d.width < 1000 ? "web-800" : "web-1200", status: "READY", createdAt: nowIso(), history: [], needsDownload: false
      });
    }
    added.push(id);
  }
  save("assets", assets); save("jobs", jobs);
  return { added };
}

// Empareja originales de alta resolucion (archivo/Drive) con las fotos ya publicadas en la web (800 px) por huella aHash.
// Sin --apply solo lista las parejas (hay que comprobarlas a ojo); con apply, la foto web pasa a usar el original.
export function linkOriginals({ apply = false, maxDistance = 4 } = {}) {
  const assets = load("assets");
  const pairs = [];
  for (const hi of assets.filter((a) => a.kind === "image" && a.source !== "web" && a.ahash && a.sourcePath && a.nearDuplicateOf && a.status === "NEW")) {
    const web = assets.find((a) => a.id === hi.nearDuplicateOf);
    if (!web || web.source !== "web" || !web.ahash) continue;
    const d = hamming(hi.ahash, web.ahash);
    const sameRatio = Math.abs(hi.width / hi.height - web.width / web.height) < 0.02;
    if (d <= maxDistance && sameRatio && hi.width > web.width * 1.5) pairs.push({ original: hi.id, originalName: hi.name, web: web.id, webName: web.name, distance: d });
  }
  if (apply) {
    for (const p of pairs) {
      const hi = assets.find((a) => a.id === p.original), web = assets.find((a) => a.id === p.web);
      Object.assign(web, { sourcePath: hi.sourcePath, width: hi.width, height: hi.height, quality: "original", originalAssetId: hi.id });
      hi.status = "ARCHIVED"; hi.linkedTo = web.id;
      hi.history = [...(hi.history || []), { from: "NEW", to: "ARCHIVED", at: nowIso(), note: `original de ${web.id}` }];
    }
    save("assets", assets);
  }
  return pairs;
}

// ---------- Drive -> pipeline sin descarga manual ----------
// Work descarga el fichero (raw/streaming) con su conector de Drive y lo deja en cualquier carpeta local; aqui se enlaza con su
// registro (manifiesto) o se crea el registro, se verifica la integridad (md5 de Drive) y se copia al almacen estable del estado.
export const pendingDownloads = () => load("assets").filter((a) => a.needsDownload).map((a) => ({ assetId: a.id, driveId: a.driveId, name: a.name, bytes: a.bytes, md5: a.md5, jobId: a.jobId, driveFolder: a.driveFolder }));

const safeName = (s) => String(s).replace(/[^\w.\-]+/g, "_");

// items: [{ file, driveId?, name?, path?, md5?, createdTime? }]. opts.move borra el original tras copiarlo.
export async function receiveFiles(items, { move = false, log = () => {} } = {}) {
  const dest = path.join(home(), "inbox", "drive");
  ensureDir(dest);
  const cfg = config();
  const summary = { received: 0, attached: 0, created: 0, duplicates: [], errors: [], assetIds: [] };
  for (const it of items) {
    try {
      const src = path.resolve(it.file);
      if (!fs.existsSync(src)) throw new Error("no existe el fichero");
      const kind = kindOf(src);
      if (!kind) throw new Error("tipo de fichero no admitido");
      summary.received++;
      const { sha256, md5 } = await fileHashes(src);
      let assets = load("assets");
      const known = assets.find((a) => a.sha256 === sha256);
      if (known) { summary.duplicates.push({ file: src, of: known.id }); continue; }
      let rec = (it.driveId && assets.find((a) => a.driveId === it.driveId)) || assets.find((a) => a.needsDownload && a.md5 && a.md5 === md5);
      if (rec && rec.md5 && rec.md5 !== md5) throw new Error(`md5 distinto al de Drive (${rec.md5} != ${md5}): descarga incompleta o corrupta`);
      if (!rec) {
        if (!it.driveId) throw new Error("fichero desconocido: indica driveId (o ingesta primero el manifiesto)");
        ingestManifest([{ driveId: it.driveId, name: it.name || path.basename(src), path: it.path, size: fs.statSync(src).size, md5, createdTime: it.createdTime }]);
        assets = load("assets");
        rec = assets.find((a) => a.driveId === it.driveId);
        summary.created++;
      }
      if (!rec) throw new Error("no se pudo registrar el fichero");
      const target = path.join(dest, `${rec.driveId || sha256.slice(0, 8)}__${safeName(rec.name)}`);
      if (path.resolve(target) !== src) fs.copyFileSync(src, target);
      Object.assign(rec, { sha256, md5, sourcePath: target, needsDownload: false, bytes: fs.statSync(target).size });
      if (kind === "image") {
        const d = await describePhoto(target);
        Object.assign(rec, { width: d.width, height: d.height, ahash: d.ahash });
        const near = assets.find((o) => o.id !== rec.id && o.ahash && o.jobId !== rec.jobId && hamming(o.ahash, rec.ahash) <= cfg.reuse.nearDuplicateHamming);
        if (near) rec.nearDuplicateOf = near.id;
      }
      save("assets", assets);
      if (move && path.resolve(target) !== src) fs.rmSync(src, { force: true });
      summary.attached++; summary.assetIds.push(rec.id);
      log(`  + ${rec.id} ${rec.name}`);
    } catch (e) { summary.errors.push({ file: it.file, error: e.message }); }
  }
  return summary;
}

// Carpeta con ficheros descargados: el driveId se toma de "<driveId>__<nombre>" o de un mapa opcional [{file|name, driveId, path, md5}].
export function itemsFromDir(dir, map = []) {
  const byName = new Map(map.map((m) => [path.basename(m.file || m.name || ""), m]));
  return walk(path.resolve(dir)).map((file) => {
    const base = path.basename(file), m = byName.get(base) || {};
    const pre = base.match(/^([A-Za-z0-9_-]{20,})__(.+)$/);
    return { file, driveId: m.driveId || (pre && pre[1]) || undefined, name: m.name || (pre && pre[2]) || base, path: m.path, md5: m.md5 };
  });
}
