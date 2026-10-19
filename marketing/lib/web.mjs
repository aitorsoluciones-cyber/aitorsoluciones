// Mecanismo seguro para llevar un trabajo real a la web: rama -> build/check -> QA -> push (Deploy Preview) -> PR.
// Nunca toca main ni produccion; nunca cambia URLs existentes, SEO estructural ni el diseno: solo anade datos
// (src/_data/workCases.json) e imagenes, y la plantilla ya existente los muestra.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { REPO } from "./paths.mjs";
import { load, save, findById } from "./store.mjs";
import { readPhoto } from "./media.mjs";
import { locationById, services, norm } from "./places.mjs";

const read = (f) => fs.readFileSync(f, "utf8");
const readJsonBom = (f) => JSON.parse(read(f).replace(/^﻿/, ""));
const writeJsonKeepBom = (f, data) => { const bom = read(f).startsWith("﻿") ? "﻿" : ""; fs.writeFileSync(f, bom + JSON.stringify(data, null, 2) + "\n"); };

export const slugify = (s) => norm(s).replace(/\s+/g, "-").slice(0, 60);

// Valida un caso nuevo contra los datos reales del sitio. Devuelve la lista de problemas (vacia = valido).
export function validateCase(entry, { existing, hasPage }) {
  const p = [];
  if (!entry.title) p.push("falta titulo");
  if (!entry.slug || !/^[a-z0-9-]+$/.test(entry.slug)) p.push("slug no valido");
  if (existing.some((c) => c.slug === entry.slug || c.id === entry.id)) p.push(`el slug/id ya existe: ${entry.slug} (no se cambian URLs existentes)`);
  if (existing.some((c) => norm(c.title) === norm(entry.title))) p.push("ya hay un caso con ese titulo");
  if (!services().some((s) => s.id === entry.serviceId)) p.push(`servicio inexistente o no activo: ${entry.serviceId}`);
  if (!locationById(entry.locationId)) p.push(`localidad inexistente: ${entry.locationId}`);
  for (const id of entry.relatedServiceIds || []) if (!services().some((s) => s.id === id)) p.push(`servicio relacionado inexistente: ${id}`);
  if (!entry.before || !entry.after) p.push("faltan fotos antes/despues");
  if (!entry.whatWeDid) p.push("falta 'whatWeDid' (que se hizo)");
  if (hasPage) {
    if (!entry.problem || entry.problem.length < 60) p.push("una pagina propia exige 'problem' de al menos 60 caracteres (nada de paginas finas)");
    if ((entry.whatWeDid || "").length < 40) p.push("una pagina propia exige 'whatWeDid' de al menos 40 caracteres");
  }
  return p;
}

export function buildCaseEntry(job, { slug, hasPage = false, problem, conditions, related = [], featured = false, gallery = [] }) {
  const s = slug || slugify(job.title);
  const entry = {
    id: s, slug: s, hasPage, status: "active", title: job.title, serviceId: job.serviceId, locationId: job.locationId,
    before: `${s}-antes`, after: `${s}-despues`, ...(problem ? { problem } : {}), whatWeDid: job.notes || "", ...(conditions ? { conditions } : {}),
    ...(related.length ? { relatedServiceIds: related } : {}), ...(featured ? { featured: true } : {}), ...(gallery.length ? { gallery } : {})
  };
  return entry;
}

const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).trim();
const npm = (...a) => execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", a, { cwd: REPO, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });

async function writeWebImage(assetId, name, assets) {
  const a = findById(assets, assetId);
  if (!a?.sourcePath || a.origin !== "real") throw new Error(`El material ${assetId} no es una foto real con fichero local`);
  const buf = await readPhoto(a.sourcePath);
  const dest = path.join(REPO, "src/assets/img", name + ".webp");
  if (fs.existsSync(dest)) throw new Error(`Ya existe src/assets/img/${name}.webp`);
  await sharp(buf).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 78 }).toFile(dest);
  return dest;
}

// opts: { slug, hasPage, problem, conditions, related, featured, galleryPairs:[[beforeId,afterId]], noPush, dryRun, log }
export async function proposeCase(jobId, opts = {}) {
  const log = opts.log || (() => {});
  const jobs = load("jobs");
  const assets = load("assets");
  const job = findById(jobs, jobId);
  if (!job) throw new Error(`Trabajo no encontrado: ${jobId}`);
  if (!["READY", "SCHEDULED", "PUBLISHED"].includes(job.status)) throw new Error("El trabajo debe estar READY (revisado) antes de llevarlo a la web");
  if (!job.locationConfirmed) throw new Error("La localidad debe estar confirmada por una persona antes de publicarla en la web");
  const photos = assets.filter((a) => a.jobId === jobId && a.kind === "image");
  const before = photos.find((a) => a.role === "before"), after = photos.find((a) => a.role === "after");
  if (!before || !after) throw new Error("Hacen falta una foto 'before' y una 'after'");
  const casesFile = path.join(REPO, "src/_data/workCases.json");
  const cases = readJsonBom(casesFile);
  const entry = buildCaseEntry(job, opts);
  const galleryPairs = (opts.galleryPairs || []).map(([b, a]) => ({ b, a }));
  if (galleryPairs.length) entry.gallery = galleryPairs.map((_, i) => ({ before: `${entry.slug}-g${i + 1}-antes`, after: `${entry.slug}-g${i + 1}-despues` }));
  const problems = validateCase(entry, { existing: cases, hasPage: !!opts.hasPage });
  if (problems.length) throw new Error("Caso no valido:\n - " + problems.join("\n - "));
  if (git("status", "--porcelain")) throw new Error("El arbol de trabajo de git no esta limpio; confirma o guarda tus cambios antes");

  const branch = `marketing/caso-${entry.slug}`;
  const base = git("rev-parse", "--abbrev-ref", "HEAD");
  git("checkout", "-b", branch);
  log(`rama ${branch} (desde ${base})`);
  try {
    const names = [];
    names.push([before.id, entry.before], [after.id, entry.after]);
    galleryPairs.forEach((p, i) => names.push([p.b, `${entry.slug}-g${i + 1}-antes`], [p.a, `${entry.slug}-g${i + 1}-despues`]));
    for (const [id, name] of names) { await writeWebImage(id, name, assets); log(`  imagen ${name}.webp`); }
    const extra = path.join(REPO, "src/_data/marketingImages.json");
    const list = fs.existsSync(extra) ? readJsonBom(extra) : [];
    writeJsonKeepBom(extra, [...new Set([...list, ...names.map((n) => n[1])])]);
    execFileSync("node", ["tools/make-thumbnails.mjs"], { cwd: REPO, stdio: "ignore", env: { ...process.env, MK_ONLY: names.map((n) => n[1]).join(",") } });
    cases.push(entry);
    writeJsonKeepBom(casesFile, cases);
    if (opts.hasPage) { // una pagina nueva anade 1 URL al sitemap: se actualiza la comprobacion SEO de forma explicita
      const seo = path.join(REPO, "tools/check-seo.mjs");
      const t = read(seo);
      fs.writeFileSync(seo, t.replace(/const EXPECTED_SITEMAP = (\d+);/, (_, n) => `const EXPECTED_SITEMAP = ${Number(n) + 1};`));
    }
    log("build + check ...");
    npm("run", "build"); npm("run", "check");
    const files = git("status", "--porcelain").split("\n").map((l) => l.slice(3));
    const report = { branch, files, entry, pr: null };
    if (opts.dryRun) return report;
    git("add", "src/_data/workCases.json", "src/_data/marketingImages.json", "src/_data/imageMeta.json", "src/assets/img", ...(opts.hasPage ? ["tools/check-seo.mjs"] : []));
    git("commit", "-m", `Caso real: ${entry.title}\n\nAnadido desde el banco de marketing (trabajo ${jobId}). Localidad confirmada.`);
    if (!opts.noPush) {
      git("push", "-u", "origin", branch);
      const body = `Caso real añadido desde el banco de marketing.\n\n- Trabajo: ${entry.title} (${entry.locationId})\n- Página propia: ${opts.hasPage ? "sí (+1 URL en sitemap)" : "no (solo galería de /trabajos/)"}\n- Sin cambios de diseño, URLs existentes ni SEO estructural.\n- Comprobado: build, check, QA de marketing.\n\nRevisar en el Deploy Preview antes de fusionar.`;
      report.pr = execFileSync("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", `Caso real: ${entry.title}`, "--body", body], { cwd: REPO, encoding: "utf8" }).trim();
    }
    job.webCaseId = entry.id; job.webPr = report.pr;
    save("jobs", jobs);
    git("checkout", base);
    return report;
  } catch (e) {
    // El arbol estaba limpio al empezar: se descarta todo lo de esta ejecucion y se vuelve a la rama de partida.
    try { git("checkout", "--", "."); git("clean", "-fd"); git("checkout", base); git("branch", "-D", branch); } catch { /* limpieza manual */ }
    throw e;
  }
}
