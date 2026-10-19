import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { tmpHome, fakePhoto } from "./helpers.mjs";

let dir;
before(() => { dir = tmpHome(); });

test("estados: transiciones validas e invalidas", async () => {
  const { transition, canTransition, STATES } = await import("../lib/states.mjs");
  assert.deepEqual(STATES, ["NEW", "REVIEWED", "READY", "SCHEDULED", "PUBLISHED", "ARCHIVED", "REJECTED"]);
  const e = { status: "NEW" };
  transition(e, "REVIEWED"); transition(e, "READY"); transition(e, "SCHEDULED"); transition(e, "PUBLISHED");
  assert.equal(e.history.length, 4);
  assert.throws(() => transition({ status: "NEW" }, "PUBLISHED"), /no permitida/);
  assert.equal(canTransition("REJECTED", "READY"), false);
});

test("guardarrailes de texto: precios, garantias, resenas y localidades no confirmadas", async () => {
  const { lintCopy } = await import("../lib/guardrails.mjs");
  assert.ok(lintCopy("Desbroce desde 50 euros").length);
  assert.ok(lintCopy("Trabajo garantizado 100%").length);
  assert.ok(lintCopy("Tenemos más de 10 años de experiencia").length);
  assert.ok(lintCopy("Trabajamos en Vinaròs", { allowedLocations: [] }).some((p) => /no confirmada/.test(p)));
  assert.deepEqual(lintCopy("Trabajamos en Vinaròs", { allowedLocations: ["Vinaròs"] }), []);
  assert.ok(lintCopy("Hemos trabajado en Villanueva del Fantasma").some((p) => /no reconocida/.test(p)));
  assert.deepEqual(lintCopy("Base en Les Cases d'Alcanar. Escríbenos por WhatsApp."), []);
});

test("repeticiones: mismo enfoque nunca; otro enfoque tras enfriamiento; reutilizacion deliberada", async () => {
  const { canUse } = await import("../lib/repeat.mjs");
  const usage = [{ kind: "topic", id: "t1", channel: "instagram", angle: "a", date: "2026-01-01" }];
  assert.equal(canUse({ kind: "topic", id: "t1", channel: "instagram", angle: "a", now: "2026-02-01" }, usage).ok, false);
  assert.equal(canUse({ kind: "topic", id: "t1", channel: "instagram", angle: "b", now: "2026-01-20" }, usage).ok, false);
  assert.equal(canUse({ kind: "topic", id: "t1", channel: "instagram", angle: "b", now: "2026-03-01" }, usage).ok, true);
  assert.equal(canUse({ kind: "topic", id: "t1", channel: "instagram", angle: "a", now: "2026-03-01" }, usage).ok, false);
  assert.equal(canUse({ kind: "topic", id: "t1", channel: "instagram", angle: "a", now: "2026-06-01", deliberate: true }, usage).ok, true);
  assert.equal(canUse({ kind: "topic", id: "otro", channel: "instagram", angle: "a", now: "2026-01-02" }, usage).ok, true);
});

test("ingesta: detecta trabajos, antes/despues, servicio, localidad propuesta, duplicados y similares", async () => {
  const { ingestDir } = await import("../lib/ingest.mjs");
  const { load } = await import("../lib/store.mjs");
  const inbox = path.join(dir, "inbox");
  await fakePhoto(path.join(inbox, "2026-10-12_desbroce_alcanar-platja", "antes", "IMG_1.jpg"), 1);
  await fakePhoto(path.join(inbox, "2026-10-12_desbroce_alcanar-platja", "despues", "IMG_2.jpg"), 2);
  fs.copyFileSync(path.join(inbox, "2026-10-12_desbroce_alcanar-platja", "antes", "IMG_1.jpg"), path.join(inbox, "copia-IMG_1.jpg"));
  fs.mkdirSync(path.join(inbox, "2026-10-14_poda_jardin"), { recursive: true });
  fs.writeFileSync(path.join(inbox, "2026-10-14_poda_jardin", "video.mov"), "no-es-un-video-real");
  const s = await ingestDir(inbox, { origin: "upload" });
  assert.equal(s.errors.length, 0, JSON.stringify(s.errors));
  assert.equal(s.added, 3);
  assert.equal(s.duplicates.length, 1);
  assert.equal(s.newJobs.length, 2);
  const jobs = load("jobs"), assets = load("assets");
  const job = jobs.find((j) => j.key.includes("desbroce"));
  assert.equal(job.serviceId, "desbroce-parcelas");
  assert.equal(job.locationCandidate, "alcanar");
  assert.equal(job.locationConfirmed, false);
  assert.equal(job.status, "NEW");
  assert.deepEqual(assets.filter((a) => a.jobId === job.id).map((a) => a.role).sort(), ["after", "before"]);
  assert.equal(assets.find((a) => a.kind === "video").role, "video");
  const again = await ingestDir(inbox, { origin: "upload" });
  assert.equal(again.added, 0);
  assert.equal(again.duplicates.length, 4);
});

test("ingesta por manifiesto de Drive: registra sin descargar y evita duplicados", async () => {
  const { ingestManifest } = await import("../lib/ingest.mjs");
  const { load } = await import("../lib/store.mjs");
  const entries = [
    { driveId: "DRV1", name: "IMG_5642.HEIC", path: "00_NUEVOS_TRABAJOS/IMG_5642.HEIC", size: "4164647", createdTime: "2026-10-19T19:29:42Z" },
    { driveId: "DRV2", name: "notas.pdf", path: "00_NUEVOS_TRABAJOS/notas.pdf" }
  ];
  const s = ingestManifest(entries);
  assert.equal(s.added, 1); assert.deepEqual(s.skipped, ["notas.pdf"]);
  assert.equal(ingestManifest(entries).added, 0);
  const a = load("assets").find((x) => x.driveId === "DRV1");
  assert.equal(a.needsDownload, true); assert.equal(a.status, "NEW");
});

test("revision de trabajos: localidades reales, confirmacion humana y requisitos de READY", async () => {
  const { reviewJob } = await import("../lib/jobs.mjs");
  const { load } = await import("../lib/store.mjs");
  const job = load("jobs").find((j) => j.key.includes("desbroce"));
  assert.throws(() => reviewJob(job.id, { locationId: "atlantida" }), /no se inventan localidades/);
  assert.throws(() => reviewJob(job.id, { confirmLocation: true }), /--location/);
  assert.throws(() => reviewJob(job.id, { serviceId: "limpieza-apartamentos-turisticos" }), /no activo/);
  reviewJob(job.id, { status: "REVIEWED" });
  assert.throws(() => reviewJob(job.id, { status: "READY" }), /falta titulo/);
  reviewJob(job.id, { title: "Parcela despejada", locationId: "alcanar", confirmLocation: true, notes: "Desbroce y despeje de accesos." });
  const done = reviewJob(job.id, { status: "READY" });
  assert.equal(done.status, "READY"); assert.equal(done.locationConfirmed, true);
  assert.ok(load("assets").filter((a) => a.jobId === job.id).every((a) => a.status === "READY"));
});

test("trabajos sin foto 'despues' o con material no real no pueden ser READY", async () => {
  const { assertReady } = await import("../lib/jobs.mjs");
  const job = { id: "j", title: "x", serviceId: "desbroce-parcelas" };
  assert.throws(() => assertReady(job, [{ kind: "image", role: "before", origin: "real" }]), /after/);
  assert.throws(() => assertReady(job, [{ kind: "image", role: "after", origin: "graphic" }]), /reales/);
});

test("evergreen: temas aprobados y copia por canal sin localidades fuera de la lista", async () => {
  const { loadBank, buildCopy, isApproved } = await import("../lib/evergreen.mjs");
  const bank = loadBank();
  assert.ok(bank.length >= 20);
  const zona = bank.find((t) => t.id === "local-zona");
  const c = buildCopy(zona, zona.angles[0]);
  assert.ok(c.zones.includes("Vinaròs"));
  assert.ok(c.captions.gbp.includes("603 207 780"));
  assert.equal(c.hashtagsByChannel.gbp.length, 0);
  assert.ok(c.hashtagsByChannel.instagram.length <= 8);
  assert.equal(isApproved(bank.find((t) => t.id === "reglamento-municipal"), {}), false);
  assert.equal(isApproved(bank.find((t) => t.id === "reglamento-municipal"), { "reglamento-municipal": true }), true);
});
