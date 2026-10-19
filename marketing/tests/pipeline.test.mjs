import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { tmpHome, fakePhoto } from "./helpers.mjs";

let dir;
const TODAY = "2026-10-19"; // lunes
before(() => { dir = tmpHome(); });

async function seedJob({ id = "job_t1", seeds = [11, 12], locationId = "alcanar", confirmed = true } = {}) {
  const { load, save } = await import("../lib/store.mjs");
  const photos = path.join(dir, "photos");
  const jobs = load("jobs"), assets = load("assets");
  jobs.push({ id, key: id, origin: "upload", title: "Parcela despejada", status: "READY", serviceId: "desbroce-parcelas", locationId, locationConfirmed: confirmed, notes: "Desbroce y despeje de accesos.", history: [] });
  for (const [i, role] of ["before", "after"].entries()) {
    const f = await fakePhoto(path.join(photos, `${id}-${role}.jpg`), seeds[i]);
    assets.push({ id: `a_${id}_${role}`, sha256: `${id}${role}`.padEnd(64, "0"), kind: "image", origin: "real", sourcePath: f, jobId: id, role, status: "READY", width: 1600, height: 1200, history: [] });
  }
  save("jobs", jobs); save("assets", assets);
  return id;
}

test("huecos: lunes y miercoles publican; viernes solo prepara", async () => {
  const { slotsFor } = await import("../lib/planner.mjs");
  const slots = slotsFor(TODAY, 2);
  assert.deepEqual(slots.map((s) => s.day + (s.channels.length ? "+" : "-")), ["mon+", "wed+", "fri-", "mon+", "wed+", "fri-"]);
});

test("planificador: sin trabajos nuevos rellena 4 semanas con evergreen seguro, sin repetir ni encadenar categoria/plantilla", async () => {
  const { plan, bufferStatus } = await import("../lib/planner.mjs");
  const { lintPiece } = await import("../lib/guardrails.mjs");
  const r = plan({ today: TODAY, weeks: 4 });
  assert.equal(r.created.length, 8);
  assert.equal(r.after.ok, true); assert.equal(r.after.weeksCovered, 4);
  assert.deepEqual(r.shortages, []);
  assert.ok(r.created.every((p) => p.kind === "evergreen"));
  const keys = r.created.map((p) => p.topicId);
  assert.equal(new Set(keys).size, keys.length, "tema repetido");
  for (let i = 1; i < r.created.length; i++) {
    assert.notEqual(r.created[i].template, r.created[i - 1].template, "plantilla repetida seguida");
    assert.notEqual(r.created[i].category, r.created[i - 1].category, "categoria repetida seguida");
  }
  for (const p of r.created) assert.deepEqual(lintPiece(p, { assets: [], jobs: [] }), []);
  // no replanifica lo ya cubierto
  assert.equal(plan({ today: TODAY, weeks: 4 }).created.length, 0);
  assert.equal(bufferStatus(TODAY).ok, true);
});

test("planificador: una semana mas adelante repone el colchon y respeta el enfriamiento por tema", async () => {
  const { plan } = await import("../lib/planner.mjs");
  const { load } = await import("../lib/store.mjs");
  const r = plan({ today: "2026-10-26", weeks: 4 });
  assert.equal(r.created.length, 2);
  const all = load("pieces");
  const byTopic = Object.groupBy(all, (p) => p.topicId);
  for (const [t, ps] of Object.entries(byTopic)) assert.equal(ps.length, 1, `tema ${t} usado dos veces en 5 semanas`);
});

test("cancelar libera el hueco y el uso del material", async () => {
  const { cancelPiece, bufferStatus } = await import("../lib/planner.mjs");
  const { load } = await import("../lib/store.mjs");
  const p = load("pieces").find((x) => x.status === "SCHEDULED");
  const topicUses = load("usage").filter((u) => u.pieceId === p.id).length;
  assert.ok(topicUses > 0);
  cancelPiece(p.id);
  assert.equal(load("usage").filter((u) => u.pieceId === p.id).length, 0);
  assert.ok(bufferStatus(TODAY).missing.length >= 1);
});

test("un trabajo real revisado entra en el lunes (max 1 por semana) y su pieza usa solo fotos reales de ese trabajo", async () => {
  const { plan } = await import("../lib/planner.mjs");
  const { load } = await import("../lib/store.mjs");
  await seedJob();
  const r = plan({ today: TODAY, weeks: 4 });
  const work = load("pieces").filter((p) => p.kind === "work" && p.status === "SCHEDULED");
  assert.equal(work.length, 1);
  assert.equal(work[0].jobId, "job_t1");
  assert.equal(new Date(work[0].scheduledFor + "T00:00:00Z").getUTCDay(), 1);
  assert.deepEqual(work[0].assetIds.sort(), ["a_job_t1_after", "a_job_t1_before"]);
  assert.match(work[0].copy.captions.instagram, /en Alcanar/);
  assert.equal(load("jobs").find((j) => j.id === "job_t1").status, "SCHEDULED");
  assert.ok(r.after.ok);
});

test("un trabajo con localidad sin confirmar nunca nombra la localidad", async () => {
  const { buildWorkCopy } = await import("../lib/planner.mjs");
  const job = { title: "Jardín cuidado", serviceId: "mantenimiento-jardines", locationId: "alcanar", locationConfirmed: false, notes: "Siega y recorte." };
  const c = buildWorkCopy(job, "antes-despues");
  assert.ok(!/Alcanar/.test(c.captions.instagram.replace("#LesCasesDAlcanar", "")));
  assert.equal(buildWorkCopy(job, "zona"), null);
});

test("guardarrail: pieza evergreen con foto real o trabajo con grafico se rechazan", async () => {
  const { lintPiece } = await import("../lib/guardrails.mjs");
  const assets = [{ id: "r1", origin: "real", jobId: "x" }, { id: "g1", origin: "graphic", jobId: "job_t1" }];
  const jobs = [{ id: "job_t1", status: "READY", locationConfirmed: true, locationId: "alcanar" }];
  const copy = { headline: "H", captions: { instagram: "texto" }, hashtagsByChannel: { instagram: [] }, slides: [] };
  assert.ok(lintPiece({ kind: "evergreen", channels: ["instagram"], assetIds: ["r1"], copy }, { assets, jobs }).some((p) => /solo graficos/.test(p)));
  assert.ok(lintPiece({ kind: "work", jobId: "job_t1", channels: ["instagram"], assetIds: ["g1"], copy }, { assets, jobs }).some((p) => /prohibido en trabajos/.test(p)));
  assert.ok(lintPiece({ kind: "work", jobId: "nope", channels: ["instagram"], assetIds: [], copy }, { assets, jobs }).some((p) => /sin trabajo/.test(p)));
});

test("generador de activos: medidas exactas de feed, story, carrusel, gbp y miniaturas web", async () => {
  const { renderPiece } = await import("../lib/assets.mjs");
  const { load } = await import("../lib/store.mjs");
  const piece = load("pieces").find((p) => p.kind === "work");
  const r = await renderPiece({ ...piece, channels: ["instagram", "facebook", "gbp"] }, { root: path.join(dir, "render-work") });
  const dims = Object.fromEntries(r.files.map((f) => [path.relative(r.dir, f.file).split(path.sep).join("/"), `${f.width}x${f.height}`]));
  assert.equal(dims["feed.png"], "1080x1350");
  assert.equal(dims["story.png"], "1080x1920");
  assert.equal(dims["gbp.jpg"], "1200x900");
  assert.equal(dims["carousel/01.png"], "1080x1350");
  assert.ok(Object.keys(dims).filter((k) => k.startsWith("carousel/")).length >= 4);
  assert.ok(dims["web-480.webp"].startsWith("480x") && dims["web-800.webp"].startsWith("800x"));
  const ev = load("pieces").find((p) => p.kind === "evergreen" && p.type === "carousel");
  const e = await renderPiece(ev, { root: path.join(dir, "render-ev") });
  assert.ok(e.files.some((f) => f.format === "carousel" && f.width === 1080 && f.height === 1350));
  assert.ok(e.files.some((f) => f.format === "story" && f.height === 1920));
});

test("la foto real se conserva: el antes/despues usa los pixeles de las fotos (sin regenerarlas)", async () => {
  const { beforeAfterFeed } = await import("../lib/assets.mjs");
  const a = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
  const b = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#00ff00" } }).jpeg().toBuffer();
  const out = await sharp(await beforeAfterFeed(a, b)).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...out.data.subarray((y * out.info.width + x) * out.info.channels, (y * out.info.width + x) * out.info.channels + 3)];
  const [r1, , ] = px(270, 700); const [, g2] = px(810, 700);
  assert.ok(r1 > 200, "mitad izquierda = foto antes (rojo)");
  assert.ok(g2 > 200, "mitad derecha = foto despues (verde)");
});

test("cola READY_TO_PUBLISH: ficheros por canal, texto y paso a publicado con URL real", async () => {
  const { buildQueue, markPublished, queueSummary } = await import("../lib/publish.mjs");
  const { load } = await import("../lib/store.mjs");
  const q = await buildQueue({ today: TODAY, ahead: 3 });
  assert.ok(q.length >= 3);
  for (const item of q) {
    const post = JSON.parse(fs.readFileSync(path.join(item.dir, "post.json"), "utf8"));
    assert.equal(post.status, "READY_TO_PUBLISH");
    assert.ok(post.files.every((f) => fs.existsSync(path.join(item.dir, f))));
    assert.ok(fs.readFileSync(path.join(item.dir, "caption.txt"), "utf8").length > 20);
  }
  const first = load("pieces").find((p) => p.channelStatus?.instagram === "READY_TO_PUBLISH" && p.channelStatus?.facebook);
  assert.throws(() => markPublished(first.id, "instagram", "no-es-url"), /URL real/);
  markPublished(first.id, "instagram", "https://www.instagram.com/p/xyz/");
  let p = load("pieces").find((x) => x.id === first.id);
  assert.equal(p.status, "SCHEDULED");
  markPublished(first.id, "facebook", "https://www.facebook.com/123");
  p = load("pieces").find((x) => x.id === first.id);
  assert.equal(p.status, "PUBLISHED");
  if (p.kind === "work") assert.equal(load("jobs").find((j) => j.id === p.jobId).status, "PUBLISHED");
  assert.ok(queueSummary().length < q.length);
});

test("adaptadores: sin credenciales o sin MK_ALLOW_PUBLISH solo se encola; con ambos publican (fetch simulado)", async () => {
  const { publishQueue, channelStatus } = await import("../lib/adapters.mjs");
  const { buildQueue } = await import("../lib/publish.mjs");
  await buildQueue({ today: "2026-10-26", ahead: 3 });
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: "123", post_id: "1_2", name: "accounts/1/locations/2/localPosts/3" }) }; };
  assert.deepEqual(Object.keys(channelStatus({})), ["facebook", "instagram", "gbp"]);
  const dry = await publishQueue({ fetchImpl, env: {}, dryRun: true });
  assert.ok(dry.every((r) => r.action === "queued")); assert.equal(calls.length, 0);
  const noFlag = await publishQueue({ fetchImpl, env: { FB_PAGE_ID: "1", FB_PAGE_TOKEN: "t" }, dryRun: false });
  assert.ok(noFlag.every((r) => r.action === "queued")); assert.equal(calls.length, 0);
  const env = { MK_ALLOW_PUBLISH: "1", FB_PAGE_ID: "PAGE", FB_PAGE_TOKEN: "tok", IG_USER_ID: "IG", IG_TOKEN: "tok2", GBP_ACCOUNT: "A", GBP_LOCATION: "L", GBP_TOKEN: "tok3", MK_MEDIA_BASE_URL: "https://media.example.com/q" };
  const live = await publishQueue({ fetchImpl, env, dryRun: false });
  assert.ok(live.some((r) => r.action === "published"), JSON.stringify(live));
  assert.ok(calls.some((c) => c.url.includes("/PAGE/photos")));
  assert.ok(calls.some((c) => c.url.includes("/IG/media")));
  assert.ok(calls.some((c) => c.url.includes("localPosts") && JSON.parse(c.init.body).media[0].sourceUrl.startsWith("https://media.example.com/q/")));
  assert.ok(calls.every((c) => !JSON.stringify(c.init?.body || "").includes("undefined")));
});
