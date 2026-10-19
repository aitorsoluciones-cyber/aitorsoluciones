// Revision de trabajos: servicio, localidad (solo confirmada por una persona), pareja antes/despues y estados.
import { load, save, findById } from "./store.mjs";
import { transition } from "./states.mjs";
import { locationById, services } from "./places.mjs";

export function listJobs({ status } = {}) {
  const assets = load("assets");
  return load("jobs")
    .filter((j) => !status || j.status === status)
    .map((j) => ({ ...j, assets: assets.filter((a) => a.jobId === j.id) }));
}

// opts: { title, serviceId, locationId, confirmLocation, status, note, roles: { assetId: 'before'|'after'|'work' } }
export function reviewJob(jobId, opts = {}) {
  const jobs = load("jobs");
  const assets = load("assets");
  const job = findById(jobs, jobId);
  if (!job) throw new Error(`Trabajo no encontrado: ${jobId}`);
  if (opts.title) job.title = opts.title;
  if (opts.notes) job.notes = opts.notes;
  if (opts.serviceId) {
    if (!services().some((s) => s.id === opts.serviceId)) throw new Error(`Servicio inexistente o no activo: ${opts.serviceId}`);
    job.serviceId = opts.serviceId;
  }
  if (opts.locationId) {
    if (!locationById(opts.locationId)) throw new Error(`Localidad inexistente (no se inventan localidades): ${opts.locationId}`);
    job.locationId = opts.locationId;
  }
  if (opts.confirmLocation) {
    if (!job.locationId) throw new Error("Confirmar localidad exige indicar --location <id>");
    job.locationConfirmed = true;
  }
  for (const [assetId, role] of Object.entries(opts.roles || {})) {
    const a = findById(assets, assetId);
    if (!a || a.jobId !== jobId) throw new Error(`El material ${assetId} no pertenece a ${jobId}`);
    if (!["before", "after", "work", "video", "other"].includes(role)) throw new Error(`Rol no valido: ${role}`);
    a.role = role;
  }
  if (opts.status) {
    if (opts.status === "READY") assertReady(job, assets.filter((a) => a.jobId === jobId));
    transition(job, opts.status, opts.note);
    for (const a of assets.filter((x) => x.jobId === jobId && x.status !== "REJECTED")) {
      if (a.status !== opts.status) { try { transition(a, opts.status, "con el trabajo"); } catch { a.status = opts.status; } }
    }
  }
  save("jobs", jobs); save("assets", assets);
  return job;
}

// Un trabajo solo es READY con material real, una imagen "despues", servicio y titulo.
export function assertReady(job, jobAssets) {
  const photos = jobAssets.filter((a) => a.kind === "image");
  const problems = [];
  if (!job.title) problems.push("falta titulo");
  if (!job.serviceId) problems.push("falta servicio");
  if (!photos.some((a) => a.role === "after")) problems.push("falta una foto 'after' (despues)");
  if (photos.some((a) => a.origin !== "real")) problems.push("solo se admiten fotografias reales en trabajos");
  if (photos.some((a) => a.needsDownload)) problems.push("hay material sin descargar de Drive (sin fichero local)");
  if (problems.length) throw new Error(`Trabajo ${job.id} no puede pasar a READY: ${problems.join("; ")}`);
}

export function setAssetStatus(assetId, to, note) {
  const assets = load("assets");
  const a = findById(assets, assetId);
  if (!a) throw new Error(`Material no encontrado: ${assetId}`);
  transition(a, to, note);
  save("assets", assets);
  return a;
}

// Cambia el estado de un trabajo y lo refleja en su material (excepto el rechazado).
export function setJobStatus(jobId, to, note) {
  const jobs = load("jobs");
  const assets = load("assets");
  const job = findById(jobs, jobId);
  if (!job) throw new Error(`Trabajo no encontrado: ${jobId}`);
  if (job.status === to) return job;
  transition(job, to, note);
  for (const a of assets.filter((x) => x.jobId === jobId && x.status !== "REJECTED" && x.status !== to)) { try { transition(a, to, "con el trabajo"); } catch { a.status = to; } }
  save("jobs", jobs); save("assets", assets);
  return job;
}
