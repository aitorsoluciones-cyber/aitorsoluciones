// Sin fallback tipografico automatico, estados visuales, auditoria/limpieza de activos y sincronizacion de la rama media.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { tmpHome, naturalImage, neonImage, mockOpenAI } from "./helpers.mjs";

let dir;
before(() => { dir = tmpHome(); });
const NOW = new Date("2026-10-20T12:00:00Z").getTime();
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const home = () => process.env.MK_HOME;
const png = async (seed) => naturalImage(seed, 120, 150);
const put = async (rel, seed) => { const f = path.join(home(), "assets", "marketing", "2026", "10", rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, await png(seed)); fs.writeFileSync(f + ".json", "{}"); return f; };
const fileSha = (p) => (p && fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);
const rec = (id, file, o = {}) => ({ id, sha256: fileSha(file) || id.padEnd(64, "0"), origin: "generated", source: "openai", status: "READY", kind: "image", sourcePath: file, needsDownload: false, createdAt: iso(3), campaign: "evergreen_ok", history: [], ...o });
const age = (p, days) => { const t = new Date(NOW - days * 86400000); fs.utimesSync(p, t, t); };

test("sin fallback tipografico: la pieza evergreen sin visual aprobado no se encola; REJECTED tras los intentos; retry y excepcion manual explicita", async () => {
  const { save, load } = await import("../lib/store.mjs");
  const { visualStateOf, recordVisualAttempt, retryVisual, allowManualGraphic, VISUAL } = await import("../lib/visual-state.mjs");
  const { buildQueue } = await import("../lib/publish.mjs");
  const { renderPiece } = await import("../lib/assets.mjs");
  const piece = { id: "p_nv", kind: "evergreen", type: "single", channels: ["instagram"], scheduledFor: "2026-10-20", time: "10:00", status: "SCHEDULED", assetIds: [], template: "navy", copy: { tag: "Consejo", headline: "Titular", slides: [{ t: "A", b: "B" }], captions: { instagram: "Texto" }, hashtagsByChannel: { instagram: [] }, zones: [], alt: "x" } };
  save("pieces", [piece]); save("assets", []);
  assert.equal(visualStateOf(piece), VISUAL.PENDING);
  const q = await buildQueue({ today: "2026-10-20", ahead: 1 });
  assert.equal(q.length, 0); assert.equal(q.skipped[0].pieceId, "p_nv");
  const qroot0 = path.join(home(), "queue", "READY_TO_PUBLISH"); assert.ok(!fs.existsSync(qroot0) || fs.readdirSync(qroot0).length === 0, "nada en cola");
  assert.equal(load("pieces")[0].visualState, VISUAL.PENDING);
  assert.equal(recordVisualAttempt("p_nv", { ok: false, reason: "rechazada" }).visualState, VISUAL.PENDING);
  assert.equal(recordVisualAttempt("p_nv", { ok: false, reason: "rechazada" }).visualState, VISUAL.REJECTED, "agotados los intentos");
  assert.equal(visualStateOf(load("pieces")[0]), VISUAL.REJECTED);
  assert.equal((await buildQueue({ today: "2026-10-20", ahead: 1 })).length, 0);
  assert.equal(load("pieces")[0].visualState, VISUAL.REJECTED, "no se reabre solo");
  assert.equal(retryVisual("p_nv").visualState, VISUAL.PENDING);
  assert.throws(() => allowManualGraphic("p_nv"), /exige quien/);
  allowManualGraphic("p_nv", "aitor", "emergencia: sin saldo en OpenAI");
  assert.equal(visualStateOf(load("pieces")[0]), VISUAL.MANUAL);
  assert.ok((await renderPiece(load("pieces")[0], { root: path.join(dir, "r-manual") })).files.length > 0);
  const q2 = await buildQueue({ today: "2026-10-20", ahead: 1 });
  assert.equal(q2.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(q2[0].dir, "post.json"), "utf8")).renderer, "manual-graphic");
  fs.rmSync(path.join(home(), "queue"), { recursive: true, force: true });
});

test("QA: cola con render antiguo, evergreen en cola sin visual aprobado y referencias rotas son errores", async () => {
  const { save } = await import("../lib/store.mjs");
  const { checkState } = await import("../lib/qa.mjs");
  const copy = { tag: "T", headline: "Titular", slides: [{ t: "A", b: "B" }], captions: { instagram: "Texto" }, hashtagsByChannel: { instagram: [] }, zones: [], alt: "x" };
  const piece = { id: "p_q", kind: "evergreen", type: "single", channels: ["instagram"], scheduledFor: "2026-10-20", status: "SCHEDULED", assetIds: [], copy, channelStatus: { instagram: "READY_TO_PUBLISH" }, visual: { assetIds: ["a_roto"] } };
  save("pieces", [piece]); save("assets", [rec("a_roto", path.join(dir, "no-existe.png"))]); save("jobs", []);
  const q = path.join(home(), "queue", "READY_TO_PUBLISH", "2026-10-20__p_q__instagram");
  fs.mkdirSync(q, { recursive: true }); fs.writeFileSync(path.join(q, "post.json"), JSON.stringify({ pieceId: "p_q", channel: "instagram", files: ["feed.jpg"], extra: [] })); // sin renderer
  const { errors } = await checkState({ today: "2026-10-20" });
  const text = errors.join("\n");
  assert.match(text, /referencia rota al activo visual a_roto/);
  assert.match(text, /en READY_TO_PUBLISH sin visual aprobado/);
  assert.match(text, /render antiguo/);
  assert.match(text, /falta feed\.jpg/);
  fs.rmSync(path.join(home(), "queue"), { recursive: true, force: true });
});

test("ciclo automatico: si OpenAI/critico rechazan o falla la API, la pieza queda VISUAL_PENDING y luego REJECTED; nunca usa plantillas antiguas", async () => {
  const { runAutomation } = await import("../lib/automation.mjs");
  const { save, load } = await import("../lib/store.mjs");
  const { plan } = await import("../lib/planner.mjs");
  save("pieces", []); save("assets", []); save("jobs", []);
  plan({ today: "2026-10-19" });
  const piece = load("pieces").filter((p) => p.kind === "evergreen" && p.channels.includes("instagram")).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
  Object.assign(process.env, { OPENAI_API_KEY: "k", OPENAI_IMAGE_MODEL: "gpt-image-test" });
  const days = Math.max(0, Math.round((new Date(piece.scheduledFor) - new Date("2026-10-19")) / 86400000));
  const neon = [await neonImage(), await neonImage(), await neonImage(), await neonImage(), await neonImage(), await neonImage()];
  const run = (fetchImpl) => runAutomation({ today: "2026-10-19", pieceId: piece.id, quality: "low", ahead: days, media: false, fetchImpl, now: "2026-10-19T10:00:00.000Z" });
  const r1 = await run(mockOpenAI({ generations: [...neon] }).fetchImpl);
  assert.equal(load("pieces").find((p) => p.id === piece.id).visualState, "VISUAL_PENDING");
  assert.ok(r1.warnings.some((w) => /VISUAL_PENDING/.test(w) && /plantillas antiguas/.test(w)), JSON.stringify([r1.warnings, r1.errors, r1.steps.map((s) => s.step + ":" + s.summary)]));
  const failing = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "boom" } }) });
  const r2 = await run(failing);
  const p2 = load("pieces").find((p) => p.id === piece.id);
  assert.equal(p2.visualState, "REJECTED"); assert.equal(p2.visualAttempts.length, 2); assert.ok(r2.warnings.some((w) => /REJECTED/.test(w) && /NO se publica/.test(w)));
  assert.equal(r2.work.filter((w) => w.pieceId === piece.id).length, 0);
  const qd = path.join(home(), "queue", "READY_TO_PUBLISH");
  assert.ok(!fs.existsSync(qd) || !fs.readdirSync(qd).some((n) => n.includes(piece.id)), "no hay cola de esa pieza");
  // una pieza REJECTED no se reintenta sola
  let calls = 0; await run(async () => { calls++; return failing(); });
  assert.equal(calls, 0);
  for (const k of ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL"]) delete process.env[k];
});

test("auditoria y limpieza: clasifica, borra obsoletos/pruebas/duplicados/temporales y conserva reales, vigentes, publicados y metadatos de rejected", async () => {
  const { save, load } = await import("../lib/store.mjs");
  const { audit, cleanup } = await import("../lib/cleanup.mjs");
  fs.rmSync(path.join(home(), "queue"), { recursive: true, force: true });
  const f = {
    feed: await put("feed/ok-feed.jpg", 1), raw: await put("generated/ok-raw.png", 2), orphan: await put("feed/orphan-feed.jpg", 3), test: await put("feed/prueba_x-feed.jpg", 4),
    rejOld: await put("rejected/old.png", 5), rejNew: await put("rejected/new.png", 6), real: await put("originals/real.jpg", 7), pub: await put("feed/pub-feed.jpg", 8), unreg: await put("feed/sin-registro.jpg", 9)
  };
  const dupSrc = await put("feed/dup-original.jpg", 10); const dupCopy = path.join(home(), "assets", "marketing", "2026", "10", "feed", "dup-copia.jpg"); fs.copyFileSync(dupSrc, dupCopy);
  const sha = (p) => require_sha(p);
  function require_sha(p) { return execFileSync(process.execPath, ["-e", `console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))`, p], { encoding: "utf8" }).trim(); }
  save("assets", [
    rec("a_feed", f.feed, { derivedFrom: ["a_raw"] }), rec("a_raw", f.raw), rec("a_orphan", f.orphan, { createdAt: iso(3) }), rec("a_test", f.test, { campaign: "prueba_x" }),
    rec("a_rejold", f.rejOld, { status: "REJECTED", createdAt: iso(9), prompt: "p", reasons: ["parece IA"] }), rec("a_rejnew", f.rejNew, { status: "REJECTED", createdAt: iso(1) }),
    rec("a_real", f.real, { origin: "real", source: "archive", jobId: "j" }), rec("a_pub", f.pub), rec("a_dup", dupSrc, { sha256: sha(dupSrc) })
  ]);
  save("pieces", [
    { id: "p_live", kind: "evergreen", status: "SCHEDULED", channels: ["instagram"], scheduledFor: "2026-10-22", visual: { assetIds: ["a_feed", "a_dup"] }, channelStatus: { instagram: "READY_TO_PUBLISH" } },
    { id: "p_old", kind: "evergreen", status: "SCHEDULED", channels: ["instagram"], scheduledFor: "2026-10-21", channelStatus: { instagram: "READY_TO_PUBLISH" } },
    { id: "p_done", kind: "evergreen", status: "PUBLISHED", channels: ["instagram"], scheduledFor: "2026-10-10", visual: { assetIds: ["a_pub"] } }
  ]);
  const qd = (n, post) => { const d = path.join(home(), "queue", "READY_TO_PUBLISH", n); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "feed.jpg"), "x"); if (post) fs.writeFileSync(path.join(d, "post.json"), JSON.stringify(post)); };
  qd("2026-10-22__p_live__instagram", { pieceId: "p_live", channel: "instagram", renderer: "v2" });
  qd("2026-10-21__p_old__instagram", { pieceId: "p_old", channel: "instagram" }); // render antiguo
  fs.mkdirSync(path.join(home(), "queue", "PUBLISHED", "2026-10-10__p_done__instagram"), { recursive: true }); fs.writeFileSync(path.join(home(), "queue", "PUBLISHED", "2026-10-10__p_done__instagram", "feed.jpg"), "x");
  const outOld = path.join(home(), "out", "p_old"); fs.mkdirSync(outOld, { recursive: true }); fs.writeFileSync(path.join(outOld, "feed.png"), "x"); age(outOld, 2);
  const tmp = path.join(dir, "fake-tmp"); fs.mkdirSync(path.join(tmp, "mk-test-viejo"), { recursive: true }); fs.writeFileSync(path.join(tmp, "mk-test-viejo", "x.txt"), "x"); fs.mkdirSync(path.join(tmp, "mk-test-nuevo"), { recursive: true }); fs.mkdirSync(path.join(tmp, "otra-cosa"), { recursive: true });
  age(path.join(tmp, "mk-test-viejo"), 1); fs.utimesSync(path.join(tmp, "mk-test-nuevo"), new Date(NOW), new Date(NOW));
  for (const p of Object.values(f)) age(p, 0); // reciente salvo lo que ya trae createdAt antiguo
  const a = audit({ today: "2026-10-20", now: NOW, tmpDir: tmp });
  const cls = (name) => a.items.find((i) => i.path.endsWith(name))?.class;
  assert.equal(cls("ok-feed.jpg"), "KEEP"); assert.equal(cls("ok-raw.png"), "KEEP", "el fondo original de una pieza vigente se conserva");
  assert.equal(cls("orphan-feed.jpg"), "DELETE_OBSOLETE"); assert.equal(cls("prueba_x-feed.jpg"), "DELETE_TEST");
  assert.equal(cls("old.png"), "DELETE_OBSOLETE"); assert.equal(cls("new.png"), "KEEP");
  assert.equal(cls("real.jpg"), "SOURCE_REAL"); assert.equal(cls("pub-feed.jpg"), "PUBLISHED_HISTORY");
  assert.equal(cls("sin-registro.jpg"), "DELETE_OBSOLETE"); assert.equal(cls("dup-copia.jpg"), "DELETE_DUPLICATE");
  assert.equal(cls("2026-10-22__p_live__instagram"), "KEEP"); assert.equal(cls("2026-10-21__p_old__instagram"), "DELETE_OBSOLETE");
  assert.equal(cls("2026-10-10__p_done__instagram"), "PUBLISHED_HISTORY"); assert.equal(cls("p_old"), "DELETE_OBSOLETE");
  assert.equal(cls("mk-test-viejo"), "DELETE_TEST"); assert.equal(cls("mk-test-nuevo"), undefined, "reciente: no se toca"); assert.equal(cls("otra-cosa"), undefined);
  assert.deepEqual(a.orphans.sort(), ["a_orphan", "a_test"].sort());
  // simulacion: no borra nada
  const dry = await cleanup({ apply: false, today: "2026-10-20", now: NOW, tmpDir: tmp, media: false });
  assert.ok(fs.existsSync(f.orphan) && dry.deleted.files === 0);
  // aplicar
  const r = await cleanup({ apply: true, today: "2026-10-20", now: NOW, tmpDir: tmp, media: false });
  for (const gone of [f.orphan, f.test, f.rejOld, f.unreg, dupCopy, outOld, path.join(tmp, "mk-test-viejo"), path.join(home(), "queue", "READY_TO_PUBLISH", "2026-10-21__p_old__instagram"), f.orphan + ".json"]) assert.equal(fs.existsSync(gone), false, gone);
  for (const kept of [f.feed, f.raw, f.rejNew, f.real, f.pub, dupSrc, path.join(home(), "queue", "READY_TO_PUBLISH", "2026-10-22__p_live__instagram"), path.join(home(), "queue", "PUBLISHED", "2026-10-10__p_done__instagram"), path.join(tmp, "mk-test-nuevo"), path.join(tmp, "otra-cosa")]) assert.equal(fs.existsSync(kept), true, kept);
  assert.ok(r.deleted.duplicates >= 1 && r.deleted.tests >= 2 && r.deleted.obsolete >= 3, JSON.stringify(r.deleted));
  const recs = load("assets");
  assert.equal(recs.find((x) => x.id === "a_orphan"), undefined); assert.equal(recs.find((x) => x.id === "a_test"), undefined);
  const rj = recs.find((x) => x.id === "a_rejold");
  assert.equal(rj.fileDeleted, true); assert.equal(rj.sourcePath, null); assert.equal(rj.prompt, "p"); assert.deepEqual(rj.reasons, ["parece IA"]); assert.ok(rj.sha256);
  assert.ok(recs.find((x) => x.id === "a_real") && recs.find((x) => x.id === "a_feed"));
  const pieces = load("pieces");
  assert.equal(pieces.find((p) => p.id === "p_old").channelStatus.instagram, undefined, "la cola borrada deja de constar");
  assert.equal(pieces.find((p) => p.id === "p_live").channelStatus.instagram, "READY_TO_PUBLISH");
  assert.equal(r.orphans.length, 0);
  assert.ok(fs.existsSync(path.join(home(), "cleanup", "2026-10-20.json")));
  // idempotente
  const again = await cleanup({ apply: true, today: "2026-10-20", now: NOW, tmpDir: tmp, media: false });
  assert.equal(again.deleted.files, 0);
});

test("rama media: deja solo lo pendiente o reciente, compacta el historial y no toca main", async () => {
  const media = await import("../lib/media-host.mjs");
  const { cleanup } = await import("../lib/cleanup.mjs");
  const { save } = await import("../lib/store.mjs");
  save("assets", []); save("pieces", [{ id: "p_b", kind: "evergreen", status: "SCHEDULED", channels: ["instagram"], scheduledFor: "2026-10-22", channelStatus: { instagram: "READY_TO_PUBLISH" } }]);
  fs.rmSync(path.join(home(), "queue"), { recursive: true, force: true });
  const bare = path.join(dir, "origin2.git");
  git(["init", "-q", "--bare", bare], dir);
  // main simulado en el remoto para comprobar que no cambia
  const seed = path.join(dir, "seed"); fs.mkdirSync(seed); git(["init", "-q"], seed); git(["checkout", "-q", "-b", "main"], seed); fs.writeFileSync(path.join(seed, "a.txt"), "a");
  git(["add", "."], seed); git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "main"], seed); git(["push", "-q", bare, "main"], seed);
  const mainBefore = git(["rev-parse", "main"], bare);
  process.env.MK_MEDIA_REMOTE = bare; process.env.MK_MEDIA_BASE_URL = "https://media.test/";
  const mk = async (n, seed2, sched) => { const d = path.join(home(), "queue", "READY_TO_PUBLISH", n); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "feed.jpg"), await naturalImage(seed2, 200, 250)); fs.writeFileSync(path.join(d, "post.json"), JSON.stringify({ pieceId: n.split("__")[1], channel: "instagram", scheduledFor: sched, files: ["feed.jpg"], extra: [], status: "READY_TO_PUBLISH", renderer: "v2" })); };
  await mk("2026-10-21__p_a__instagram", 1, "2026-10-21"); await mk("2026-10-22__p_b__instagram", 2, "2026-10-22");
  const serve = async (url) => { const f = path.join(media.mediaRepoDir(), decodeURIComponent(url.replace("https://media.test/", ""))); return fs.existsSync(f) ? { ok: true, status: 200, headers: new Map([["content-type", "image/jpeg"]]), arrayBuffer: async () => fs.readFileSync(f) } : { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => Buffer.alloc(0) }; };
  const r1 = await media.publishMedia({ today: "2026-10-20", ahead: 3, fetchImpl: serve, verifyTries: 1 });
  assert.equal(r1.published.length, 2);
  // una publicacion queda obsoleta (cola borrada) y se suma una subida mas para tener historial
  fs.rmSync(path.join(home(), "queue", "READY_TO_PUBLISH", "2026-10-21__p_a__instagram"), { recursive: true, force: true });
  assert.ok(Number(git(["rev-list", "--count", "media"], bare)) >= 2);
  const r = await cleanup({ apply: true, today: "2026-10-20", now: NOW, tmpDir: path.join(dir, "no-tmp") });
  assert.equal(r.media.error, undefined, JSON.stringify(r.media));
  assert.equal(r.media.removed.length, 1); assert.equal(r.media.kept.length, 1); assert.equal(r.media.squashed, true); assert.equal(r.deleted.mediaDirs, 1);
  const files = git(["ls-tree", "-r", "--name-only", "media"], bare).split("\n");
  assert.ok(files.some((x) => /p_b__instagram__/.test(x)) && !files.some((x) => /p_a__instagram__/.test(x)));
  assert.equal(git(["rev-list", "--count", "media"], bare), "1", "historial compactado");
  assert.equal(git(["rev-parse", "main"], bare), mainBefore, "main intacto");
  // la URL conservada sigue sirviendo la imagen
  const kept = JSON.parse(fs.readFileSync(path.join(home(), "queue", "READY_TO_PUBLISH", "2026-10-22__p_b__instagram", "post.json"), "utf8")).publicUrls.files[0];
  const v = await media.verifyUrl(kept, path.join(home(), "queue", "READY_TO_PUBLISH", "2026-10-22__p_b__instagram", "feed.jpg"), { fetchImpl: serve, tries: 1 });
  assert.equal(v.ok, true);
  delete process.env.MK_MEDIA_REMOTE; delete process.env.MK_MEDIA_BASE_URL;
});

test("registro cuyo fichero fue sustituido por otra variante se desvincula sin borrar el fichero ajeno", async () => {
  const { save, load } = await import("../lib/store.mjs");
  const { repairRecords } = await import("../lib/cleanup.mjs");
  const f = await put("rejected/colision.png", 77);
  save("assets", [rec("a_stale", f, { status: "REJECTED", sha256: "9".repeat(64) }), rec("a_ok", await put("feed/bien.jpg", 78))]);
  assert.equal(repairRecords(), 1);
  const a = load("assets");
  assert.equal(a.find((x) => x.id === "a_stale").fileDeleted, true); assert.equal(a.find((x) => x.id === "a_stale").sourcePath, null);
  assert.ok(fs.existsSync(f), "el fichero (de otra variante) no se borra");
  assert.equal(a.find((x) => x.id === "a_ok").fileDeleted, undefined);
});
