// QA del sistema: datos, rutas, duplicados, metadatos, guardarrailes, banco evergreen y (opcional) la web.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import sharp from "sharp";
import { REPO, config } from "./paths.mjs";
import { load, findById } from "./store.mjs";
import { STATES } from "./states.mjs";
import { lintPiece, lintCopy } from "./guardrails.mjs";
import { loadBank, buildCopy } from "./evergreen.mjs";
import { bufferStatus } from "./planner.mjs";
import { SIZES } from "./assets.mjs";
import { locationById, services } from "./places.mjs";

const EXPECTED = { feed: SIZES.feed, story: SIZES.story, gbp: SIZES.gbp, carousel: SIZES.feed };

export function checkBank() {
  const errors = [];
  const bank = loadBank();
  const ids = new Set();
  for (const t of bank) {
    if (ids.has(t.id)) errors.push(`tema duplicado: ${t.id}`);
    ids.add(t.id);
    if (!t.angles || t.angles.length < 2) errors.push(`${t.id}: necesita al menos 2 enfoques (reutilizacion con otro enfoque)`);
    for (const s of t.services || []) if (!services().some((x) => x.id === s)) errors.push(`${t.id}: servicio inexistente o no activo ${s}`);
    const angleIds = new Set();
    for (const a of t.angles || []) {
      if (angleIds.has(a.id)) errors.push(`${t.id}: enfoque duplicado ${a.id}`);
      angleIds.add(a.id);
      if (!a.headline || !a.caption || !(a.slides || []).length) errors.push(`${t.id}/${a.id}: faltan titular, texto o diapositivas`);
      if (a.type === "carousel" && a.slides.length < 3) errors.push(`${t.id}/${a.id}: un carrusel necesita >= 3 diapositivas`);
      const copy = buildCopy(t, a);
      const piece = { kind: "evergreen", channels: Object.keys(config().channels), assetIds: [], copy };
      for (const p of lintPiece(piece, { assets: [], jobs: [] })) errors.push(`${t.id}/${a.id}: ${p}`);
    }
  }
  return errors;
}

export async function checkState({ today }) {
  const errors = [], warnings = [];
  const assets = load("assets"), jobs = load("jobs"), pieces = load("pieces"), usage = load("usage");
  const shas = new Map();
  for (const a of assets) {
    if (!STATES.includes(a.status)) errors.push(`material ${a.id}: estado desconocido ${a.status}`);
    if (!["real", "graphic"].includes(a.origin)) errors.push(`material ${a.id}: origin debe ser real|graphic`);
    if (a.sha256) { if (shas.has(a.sha256)) errors.push(`duplicado exacto: ${a.id} = ${shas.get(a.sha256)}`); shas.set(a.sha256, a.id); }
    if (!a.sha256 && !a.driveId) errors.push(`material ${a.id}: sin huella ni driveId`);
    if (!a.needsDownload && a.sourcePath && !fs.existsSync(a.sourcePath)) errors.push(`material ${a.id}: fichero inexistente ${a.sourcePath}`);
    if (!findById(jobs, a.jobId)) errors.push(`material ${a.id}: trabajo inexistente ${a.jobId}`);
    if (a.nearDuplicateOf) warnings.push(`material ${a.id}: similar a ${a.nearDuplicateOf} (revisar)`);
  }
  const low = assets.filter((a) => a.quality === "web-800").length;
  if (low) warnings.push(`${low} materiales proceden de la web (800 px): sirven, pero conviene el original para feed/story`);
  for (const j of jobs) {
    if (!STATES.includes(j.status)) errors.push(`trabajo ${j.id}: estado desconocido`);
    if (j.locationConfirmed && !(j.locationId && locationById(j.locationId))) errors.push(`trabajo ${j.id}: localidad confirmada pero inexistente`);
    if (j.locationId && !locationById(j.locationId)) errors.push(`trabajo ${j.id}: localidad inventada ${j.locationId}`);
    if (j.serviceId && !services().some((s) => s.id === j.serviceId)) errors.push(`trabajo ${j.id}: servicio inexistente ${j.serviceId}`);
  }
  const slots = new Map();
  for (const p of pieces) {
    if (!STATES.includes(p.status)) errors.push(`pieza ${p.id}: estado desconocido`);
    for (const ch of p.channels || []) if (!config().channels[ch]) errors.push(`pieza ${p.id}: canal desconocido ${ch}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.scheduledFor || "")) errors.push(`pieza ${p.id}: scheduledFor no valido`);
    if (p.status !== "ARCHIVED" && p.status !== "REJECTED") {
      if (p.slot && slots.has(p.slot)) errors.push(`pieza ${p.id}: hueco duplicado ${p.slot} (con ${slots.get(p.slot)})`);
      if (p.slot) slots.set(p.slot, p.id);
      for (const problem of lintPiece(p, { assets, jobs })) errors.push(`pieza ${p.id}: ${problem}`);
      if (!p.copy?.alt) errors.push(`pieza ${p.id}: falta texto alternativo`);
    }
    if (p.render) for (const f of p.render.files) {
      const full = path.join(p.render.dir, f);
      if (!fs.existsSync(full)) { errors.push(`pieza ${p.id}: falta ${f}`); continue; }
      const base = f.split("/")[0].replace(/\..*$/, "");
      const exp = EXPECTED[base];
      if (exp) { const m = await sharp(full).metadata(); if (m.width !== exp[0] || m.height !== exp[1]) errors.push(`pieza ${p.id}: ${f} mide ${m.width}x${m.height}, esperado ${exp.join("x")}`); }
      for (const w of p.render.warnings || []) warnings.push(`pieza ${p.id}: ${w}`);
    }
  }
  const seen = new Map();
  for (const u of usage) { const k = `${u.kind}|${u.id}|${u.angle}`; if (seen.has(k) && seen.get(k) !== u.pieceId) warnings.push(`reutilizacion: ${u.kind} ${u.id} (${u.angle}) usado en piezas distintas`); seen.set(k, u.pieceId); }
  const buf = bufferStatus(today);
  if (!buf.ok) (buf.weeksCovered < 1 ? errors : warnings).push(`colchon de contenido: ${buf.weeksCovered}/${buf.weeks} semanas cubiertas (${buf.missing.length} huecos libres)`);
  return { errors, warnings };
}

// ---------- QA de la web (solo si el cambio toca la web) ----------
const npm = (...a) => execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", a, { cwd: REPO, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });

export function checkWebData() {
  const errors = [];
  const cases = JSON.parse(fs.readFileSync(path.join(REPO, "src/_data/workCases.json"), "utf8").replace(/^﻿/, ""));
  const meta = JSON.parse(fs.readFileSync(path.join(REPO, "src/_data/imageMeta.json"), "utf8").replace(/^﻿/, ""));
  const slugs = new Set();
  for (const c of cases) {
    if (slugs.has(c.slug)) errors.push(`slug duplicado ${c.slug}`);
    slugs.add(c.slug);
    if (c.locationId && !locationById(c.locationId)) errors.push(`${c.id}: localidad inexistente ${c.locationId}`);
    for (const n of [c.before, c.after, ...(c.gallery || []).flatMap((g) => [g.before, g.after])]) {
      if (!n) continue;
      if (!fs.existsSync(path.join(REPO, "src/assets/img", n + ".webp"))) errors.push(`${c.id}: falta src/assets/img/${n}.webp`);
      if (!meta[n]) errors.push(`${c.id}: ${n} sin entrada en imageMeta.json (ejecuta make-thumbnails)`);
    }
  }
  return errors;
}

export async function checkWeb({ urls = ["/", "/trabajos/"], lighthouse = true, log = () => {} } = {}) {
  const errors = [], warnings = [];
  errors.push(...checkWebData());
  log("build + check ...");
  try { npm("run", "build"); npm("run", "check"); } catch (e) { errors.push("build/check fallido: " + (e.stdout || e.message).toString().split("\n").slice(-6).join(" | ")); return { errors, warnings }; }
  const server = spawn("node", ["tools/prod-equiv-server.mjs"], { cwd: REPO, env: { ...process.env, PORT: "5077" }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const { responsiveCheck } = await import("./cdp.mjs");
    log("responsive 320/390/768/1280 ...");
    errors.push(...(await responsiveCheck(urls.map((u) => "http://localhost:5077" + u))));
    if (lighthouse) {
      for (const u of urls) {
        log("lighthouse " + u);
        const out = path.join(REPO, `.mk-lh-${Date.now()}.json`);
        try {
          execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["lighthouse", "http://localhost:5077" + u, "--quiet", "--chrome-flags=--headless", "--output=json", `--output-path=${out}`], { cwd: REPO, shell: process.platform === "win32", stdio: "ignore", timeout: 180000 });
        } catch { /* lighthouse devuelve error al limpiar el perfil en Windows; el JSON se escribe igual */ }
        if (fs.existsSync(out)) {
          const r = JSON.parse(fs.readFileSync(out, "utf8")); fs.rmSync(out);
          const sc = Object.fromEntries(["performance", "accessibility", "best-practices", "seo"].map((k) => [k, Math.round(r.categories[k].score * 100)]));
          if (sc.accessibility < 100) errors.push(`${u}: accesibilidad ${sc.accessibility} (se exige 100)`);
          if (sc["best-practices"] < 100) errors.push(`${u}: best practices ${sc["best-practices"]}`);
          if (sc.seo < 100) errors.push(`${u}: SEO ${sc.seo}`);
          if (sc.performance < 95) warnings.push(`${u}: rendimiento ${sc.performance} (objetivo >= 95)`);
        } else warnings.push(`${u}: Lighthouse no disponible`);
      }
    }
  } catch (e) { errors.push("QA web: " + e.message); }
  finally { server.kill(); }
  return { errors, warnings };
}

export async function runQa({ today, web = false, urls, lighthouse = true, log = () => {} }) {
  const errors = [], warnings = [];
  errors.push(...checkBank());
  const st = await checkState({ today });
  errors.push(...st.errors); warnings.push(...st.warnings);
  if (web) { const w = await checkWeb({ urls, lighthouse, log }); errors.push(...w.errors); warnings.push(...w.warnings); }
  return { errors, warnings, ok: errors.length === 0 };
}
