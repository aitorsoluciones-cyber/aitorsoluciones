// Operativa: Drive -> pipeline, URLs publicas (rama media), interfaz para Work y ciclo automatico. Todo con repos y APIs locales/simuladas.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpHome, fakePhoto, naturalImage, mockOpenAI } from "./helpers.mjs";

let dir;
before(() => { dir = tmpHome(); });
const md5 = (f) => crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex");
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

test("Drive -> pipeline: el fichero descargado por Work se enlaza al registro del manifiesto, con integridad (md5), sin descarga manual", async () => {
  const { ingestManifest, receiveFiles, pendingDownloads, itemsFromDir } = await import("../lib/ingest.mjs");
  const { load } = await import("../lib/store.mjs");
  const dl = path.join(dir, "descargas");
  const f1 = path.join(dl, "IMG_1.jpg"), f2 = path.join(dl, "IMG_2.jpg");
  await fakePhoto(f1, 11); await fakePhoto(f2, 12);
  ingestManifest([{ driveId: "D_AAAAAAAAAAAAAAAAAAAAAAAA", name: "IMG_1.jpg", path: "Aitor Soluciones/00_NUEVOS_TRABAJOS/Poda en Alcanar/IMG_1.jpg", md5: md5(f1), size: fs.statSync(f1).size }]);
  assert.equal(pendingDownloads().length, 1);
  assert.equal(pendingDownloads()[0].driveId, "D_AAAAAAAAAAAAAAAAAAAAAAAA");
  // descarga corrupta: md5 distinto
  const bad = await receiveFiles([{ file: f2, driveId: "D_AAAAAAAAAAAAAAAAAAAAAAAA" }]);
  assert.equal(bad.attached, 0); assert.match(bad.errors[0].error, /md5 distinto/);
  assert.equal(pendingDownloads().length, 1, "sigue pendiente");
  const ok = await receiveFiles([{ file: f1, driveId: "D_AAAAAAAAAAAAAAAAAAAAAAAA" }]);
  assert.equal(ok.attached, 1, JSON.stringify(ok));
  const a = load("assets").find((x) => x.driveId === "D_AAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(a.needsDownload, false); assert.ok(fs.existsSync(a.sourcePath)); assert.match(a.sourcePath, /inbox[\\/]drive/); assert.ok(a.width > 0 && a.ahash && a.sha256);
  assert.equal(pendingDownloads().length, 0);
  // mismo fichero otra vez: duplicado
  assert.equal((await receiveFiles([{ file: f1, driveId: "D_AAAAAAAAAAAAAAAAAAAAAAAA" }])).duplicates.length, 1);
  // fichero de un driveId desconocido: crea el registro (trabajo NEW) y lo enlaza; sin driveId: error claro
  const unk = await receiveFiles([{ file: f2, driveId: "D_BBBBBBBBBBBBBBBBBBBBBBBB", path: "00_NUEVOS_TRABAJOS/Desbroce Vinaros/IMG_2.jpg" }]);
  assert.equal(unk.created, 1); assert.equal(unk.attached, 1);
  const f3 = path.join(dl, "x", "IMG_3.jpg"); await fakePhoto(f3, 13);
  assert.match((await receiveFiles([{ file: f3 }])).errors[0].error, /indica driveId/);
  // carpeta con "<driveId>__nombre"
  const f4 = path.join(dl, "D_CCCCCCCCCCCCCCCCCCCCCCCC__IMG_4.jpg"); await fakePhoto(f4, 14);
  const items = itemsFromDir(dl).filter((i) => /IMG_4/.test(i.file));
  assert.equal(items[0].driveId, "D_CCCCCCCCCCCCCCCCCCCCCCCC"); assert.equal(items[0].name, "IMG_4.jpg");
});

// Cola de prueba: una publicacion preparada en READY_TO_PUBLISH.
function queueItem(name, post, files) {
  const q = path.join(process.env.MK_HOME, "queue", "READY_TO_PUBLISH", name);
  fs.mkdirSync(q, { recursive: true });
  for (const [f, buf] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(q, f)), { recursive: true }); fs.writeFileSync(path.join(q, f), buf); }
  fs.writeFileSync(path.join(q, "post.json"), JSON.stringify({ kind: "evergreen", time: "10:00", status: "READY_TO_PUBLISH", alt: "alt", caption: "texto", ...post }, null, 2));
  return q;
}

test("URL publica: sube a la rama huerfana media, devuelve la imagen directamente (200, image/*, mismos bytes), cambia la URL si cambia la imagen y se purga", async () => {
  const media = await import("../lib/media-host.mjs");
  const bare = path.join(dir, "origin.git");
  git(["init", "-q", "--bare", bare], dir);
  process.env.MK_MEDIA_REMOTE = bare; process.env.MK_MEDIA_BASE_URL = "https://media.test/";
  const img1 = await naturalImage(5, 600, 750), img2 = await naturalImage(6, 600, 750);
  const q = queueItem("2026-10-19__p_url__instagram", { pieceId: "p_url", channel: "instagram", scheduledFor: "2026-10-19", files: ["feed.jpg"], extra: ["extra/story.jpg"] }, { "feed.jpg": img1, "extra/story.jpg": img2 });
  // servidor simulado: sirve lo que hay en el clon de la rama media (equivale a raw.githubusercontent.com)
  const serve = (url, init, over = {}) => {
    const rel = decodeURIComponent(url.replace("https://media.test/", ""));
    const f = path.join(media.mediaRepoDir(), rel);
    if (!fs.existsSync(f)) return { ok: false, status: 404, headers: new Map([["content-type", "text/plain"]]), arrayBuffer: async () => Buffer.alloc(0) };
    const buf = over.bytes || fs.readFileSync(f);
    return { ok: true, status: 200, headers: new Map([["content-type", over.type || "image/jpeg"]]), arrayBuffer: async () => buf };
  };
  const r = await media.publishMedia({ today: "2026-10-19", ahead: 0, fetchImpl: async (u, i) => serve(u, i) });
  assert.equal(r.failed.length, 0, JSON.stringify(r.failed)); assert.equal(r.published.length, 1);
  const post = JSON.parse(fs.readFileSync(path.join(q, "post.json"), "utf8"));
  assert.match(post.publicUrls.files[0], /^https:\/\/media\.test\/m\/2026-10\/2026-10-19__p_url__instagram__[0-9a-f]{8}\/feed\.jpg$/);
  assert.match(post.publicUrls.extra[0], /\/extra\/story\.jpg$/); assert.ok(post.publicUrls.verifiedAt);
  // la rama media existe en origin, es huerfana (sin historial de main) y contiene el fichero
  assert.ok(git(["ls-tree", "-r", "--name-only", "media"], bare).split("\n").some((x) => /feed\.jpg$/.test(x)));
  assert.equal(git(["rev-list", "--count", "media"], bare), "2");
  // idempotente: sin cambios no vuelve a publicar
  assert.equal((await media.publishMedia({ today: "2026-10-19", ahead: 0, fetchImpl: async (u, i) => serve(u, i) })).published.length, 0);
  // si la imagen cambia -> URL nueva (la CDN cachea) y la antigua desaparece de la rama
  const oldUrl = post.publicUrls.files[0];
  fs.writeFileSync(path.join(q, "feed.jpg"), img2); delete post.publicUrls; fs.writeFileSync(path.join(q, "post.json"), JSON.stringify(post));
  const r2 = await media.publishMedia({ today: "2026-10-19", ahead: 0, fetchImpl: async (u, i) => serve(u, i) });
  const newUrl = r2.published[0].urls.files[0];
  assert.notEqual(newUrl, oldUrl);
  assert.equal(git(["ls-tree", "-r", "--name-only", "media"], bare).split("\n").filter((x) => /feed\.jpg$/.test(x)).length, 1);
  // la URL que devuelve otra cosa (HTML, 404, bytes distintos) se detecta
  const p3 = JSON.parse(fs.readFileSync(path.join(q, "post.json"), "utf8")); delete p3.publicUrls; fs.writeFileSync(path.join(q, "post.json"), JSON.stringify(p3));
  const bad = await media.publishMedia({ today: "2026-10-19", ahead: 0, verifyTries: 2, verifyDelayMs: 5, fetchImpl: async (u, i) => serve(u, i, { type: "text/html" }) });
  assert.equal(bad.failed.length, 1); assert.match(bad.failed[0].errors[0].error, /text\/html/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(q, "post.json"), "utf8")).publicUrls, undefined, "no se marca como publica si no se puede verificar");
  // purga: lo anterior a la retencion se retira de la rama
  const pr = media.pruneMedia({ today: "2026-12-31", days: 30 });
  assert.deepEqual(pr.removed.length, 1);
  assert.equal(git(["ls-tree", "-r", "--name-only", "media"], bare).split("\n").some((x) => /feed\.jpg$/.test(x)), false);
  delete process.env.MK_MEDIA_REMOTE; delete process.env.MK_MEDIA_BASE_URL;
});

test("Work: la cola se traduce en acciones de conector (Facebook, Instagram feed/carrusel/story, GBP) y se confirma con work done / work fail", async () => {
  const { save, load } = await import("../lib/store.mjs");
  const { workQueue, workDone, workFail } = await import("../lib/work.mjs");
  fs.writeFileSync(path.join(process.env.MK_HOME, "config.local.json"), JSON.stringify({ work: { accounts: { facebook: { page_id: "PAGE1" }, instagram: { ig_user_id: "IG1" }, gbp: { location: "locations/1" } } } }));
  for (const d of fs.readdirSync(path.join(process.env.MK_HOME, "queue", "READY_TO_PUBLISH"))) fs.rmSync(path.join(process.env.MK_HOME, "queue", "READY_TO_PUBLISH", d), { recursive: true, force: true });
  const U = (n) => `https://media.test/m/${n}`;
  const base = { scheduledFor: "2026-10-19", kind: "evergreen" };
  queueItem("2026-10-19__p_w__facebook", { ...base, pieceId: "p_w", channel: "facebook", files: ["feed.jpg"], extra: [], publicUrls: { files: [U("fb.jpg")], extra: [] } }, {});
  queueItem("2026-10-19__p_w__instagram", { ...base, pieceId: "p_w", channel: "instagram", files: ["carousel/01.jpg", "carousel/02.jpg"], extra: ["extra/story.jpg"], publicUrls: { files: [U("c1.jpg"), U("c2.jpg")], extra: [U("s.jpg")] } }, {});
  queueItem("2026-10-19__p_w__gbp", { ...base, pieceId: "p_w", channel: "gbp", files: ["gbp.jpg"], extra: [], gbp: { callToAction: { actionType: "LEARN_MORE" } }, publicUrls: { files: [U("g.jpg")], extra: [] } }, {});
  queueItem("2026-10-19__p_w2__instagram", { ...base, pieceId: "p_w2", channel: "instagram", files: ["feed.png"], extra: [], publicUrls: { files: [U("x.png")], extra: [] } }, {});
  queueItem("2026-10-19__p_w3__instagram", { ...base, pieceId: "p_w3", channel: "instagram", files: ["feed.jpg"], extra: [] }, {});
  queueItem("2026-10-25__p_w4__facebook", { ...base, scheduledFor: "2026-10-25", pieceId: "p_w4", channel: "facebook", files: ["feed.jpg"], extra: [], publicUrls: { files: [U("f4.jpg")], extra: [] } }, {});
  const mk = (id, extra = {}) => ({ id, kind: "evergreen", channels: ["facebook", "instagram", "gbp"], scheduledFor: "2026-10-19", status: "SCHEDULED", copy: {}, channelStatus: {}, ...extra });
  save("pieces", [mk("p_w", { visual: { aiGenerated: true } }), mk("p_w2"), mk("p_w3"), mk("p_w4", { scheduledFor: "2026-10-25" })]);
  const items = workQueue({ today: "2026-10-19", ahead: 0 });
  const by = (id) => items.find((i) => i.id === id);
  assert.equal(items.length, 5, "lo programado para el 25 no es de hoy");
  assert.equal(by("p_w:facebook").actions[0].tool, "create_photo_post");
  assert.deepEqual(by("p_w:facebook").actions[0].args, { page_id: "PAGE1", message: "texto", image_url: U("fb.jpg"), alt_text: "alt" });
  const ig = by("p_w:instagram").actions;
  assert.equal(ig[0].tool, "create_carousel_post"); assert.deepEqual(ig[0].args.image_urls, [U("c1.jpg"), U("c2.jpg")]); assert.equal(ig[0].args.ig_user_id, "IG1");
  assert.equal(ig[1].tool, "create_story"); assert.equal(ig[1].args.image_url, U("s.jpg")); assert.equal(ig[1].optional, true);
  assert.equal(by("p_w:gbp").actions[0].tool, "create_local_post"); assert.equal(by("p_w:gbp").actions[0].args.location, "locations/1"); assert.equal(by("p_w:gbp").actions[0].args.call_to_action.type, "LEARN_MORE");
  assert.equal(by("p_w:facebook").aiGenerated, true); assert.equal(by("p_w:facebook").ready, true);
  assert.equal(by("p_w2:instagram").ready, false); assert.match(by("p_w2:instagram").blockedBy.join(), /JPEG/); assert.deepEqual(by("p_w2:instagram").actions, []);
  assert.equal(by("p_w3:instagram").ready, false); assert.match(by("p_w3:instagram").blockedBy.join(), /URL publica/);
  assert.equal(workQueue({ today: "2026-10-19", ahead: 6 }).length, 6);
  // fallo registrado sin perder la publicacion; confirmacion mueve a PUBLISHED
  workFail("p_w", "instagram", "token caducado");
  assert.equal(load("pieces").find((p) => p.id === "p_w").channelErrors.instagram.reason, "token caducado");
  workDone("p_w", "facebook", "https://facebook.com/post/1", "2026-10-19");
  assert.equal(load("pieces").find((p) => p.id === "p_w").channelStatus.facebook, "PUBLISHED");
  assert.equal(workQueue({ today: "2026-10-19", ahead: 0 }).some((i) => i.id === "p_w:facebook"), false, "lo publicado sale de la cola");
});

test("ciclo automatico: plan -> imagen (OpenAI simulada) -> QA -> cola -> work; sin critico exige aprobacion humana y no encola", async () => {
  const { runAutomation } = await import("../lib/automation.mjs");
  const { load, save } = await import("../lib/store.mjs");
  const { approveAsset } = await import("../lib/visual/index.mjs");
  fs.rmSync(path.join(process.env.MK_HOME, "queue"), { recursive: true, force: true });
  save("pieces", []); save("assets", []); save("jobs", []);
  const plan = (await import("../lib/planner.mjs")).plan({ today: "2026-10-19" });
  assert.ok(plan.created.length > 0);
  const piece = load("pieces").filter((p) => p.kind === "evergreen" && p.channels.includes("instagram")).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
  assert.ok(piece, "hay una pieza evergreen para instagram");
  const env = { OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "gpt-image-test" };
  Object.assign(process.env, env);
  const gens = [];
  for (let i = 0; i < 6; i++) gens.push(await naturalImage(100 + i));
  const m = mockOpenAI({ generations: gens });
  const days = Math.max(0, Math.round((new Date(piece.scheduledFor) - new Date("2026-10-19")) / 86400000));
  const r = await runAutomation({ today: "2026-10-19", pieceId: piece.id, quality: "low", ahead: days, media: false, fetchImpl: m.fetchImpl, now: "2026-10-19T10:00:00.000Z" });
  const vis = r.steps.find((s) => s.step === "imagenes");
  assert.equal(vis.results[0].ok, true, JSON.stringify(vis));
  assert.ok(load("pieces").find((p) => p.id === piece.id).visual.aiGenerated);
  assert.ok(r.errors.some((e) => /no paso el critico visual/.test(e)), "sin critico: aprobacion humana " + JSON.stringify(r.errors));
  assert.equal(r.steps.find((s) => s.step === "cola"), undefined, "no se encola con errores de QA");
  // aprobacion humana -> sigue el ciclo
  for (const id of load("pieces").find((p) => p.id === piece.id).visual.assetIds) approveAsset(id, "aitor");
  const r2 = await runAutomation({ today: "2026-10-19", visuals: false, media: false, ahead: days });
  assert.equal(r2.errors.length, 0, JSON.stringify(r2.errors));
  const queued = r2.steps.find((s) => s.step === "cola");
  assert.ok(queued.queued > 0);
  const w = r2.work; // aun no hay URL publica (media:false): bloqueada con motivo claro
  assert.ok(w.every((x) => x.ready === false && /URL publica/.test(x.blockedBy.join())));
  for (const k of Object.keys(env)) delete process.env[k];
});
