import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { tmpHome, fakePhoto, naturalImage, neonImage, mockOpenAI, CRITIC_OK } from "./helpers.mjs";

let dir;
const ENV = { OPENAI_API_KEY: "sk-test-SECRET-123", OPENAI_IMAGE_MODEL: "gpt-image-test" };
const BRIEF = { campaign: "mantenimiento_segunda_residencia", type: "editorial", source_images: [], channel: "instagram", aspect_ratio: "4:5", headline: "Tu propiedad cuidada aunque tú no estés", cta: "Envíame fotos y ubicación", location: "Alcanar", use_real_work: false };
before(() => { dir = tmpHome(); });
const NOW = "2026-10-19T10:00:00.000Z";

test("brief: valida tipos, localidades reales, texto sin patrones prohibidos y fotos reales solo con use_real_work", async () => {
  const { normalizeBrief } = await import("../lib/visual/brief.mjs");
  const { save } = await import("../lib/store.mjs");
  save("assets", [
    { id: "real1", origin: "real", kind: "image", jobId: "j1", sourcePath: "/x.jpg", status: "READY" },
    { id: "brand1", origin: "graphic", kind: "image", sourcePath: "/b.png", status: "READY" }
  ]);
  save("jobs", [{ id: "j1", status: "READY", locationId: "la-rapita", locationConfirmed: true, history: [] }]);
  const ok = normalizeBrief(BRIEF);
  assert.deepEqual(ok.problems, []); assert.equal(ok.mode, "generate"); assert.equal(ok.brief.location, "Alcanar");
  const bad = (patch) => normalizeBrief({ ...BRIEF, ...patch }).problems.join("|");
  assert.match(bad({ location: "Atlantida" }), /inexistente/);
  assert.match(bad({ location: "Tortosa" }), /zonas de servicio principales/);
  assert.match(bad({ headline: "Desbroce desde 50 euros" }), /patron prohibido/);
  assert.match(bad({ type: "retrato" }), /type debe ser/);
  assert.match(bad({ aspect_ratio: "7:3" }), /aspect_ratio/);
  assert.match(bad({ source_images: ["real1"] }), /fotos reales como referencia/);
  assert.equal(normalizeBrief({ ...BRIEF, source_images: ["brand1"] }).mode, "reference");
  assert.match(bad({ use_real_work: true }), /exige source_images/);
  assert.match(bad({ use_real_work: true, source_images: ["brand1"] }), /no es una fotografia real/);
  assert.match(bad({ use_real_work: true, source_images: ["real1"], location: "Alcanar" }), /no esta confirmada/);
  assert.deepEqual(normalizeBrief({ ...BRIEF, use_real_work: true, source_images: ["real1"], location: "La Ràpita" }).problems.filter((p) => /localidad|location/.test(p)), []);
});

test("entorno: modelo y clave solo por variables; DALL·E rechazado; tamanos y presupuesto", async () => {
  const oa = await import("../lib/visual/openai.mjs");
  assert.throws(() => oa.readEnv({}), /OPENAI_IMAGE_MODEL/);
  assert.throws(() => oa.readEnv({ OPENAI_IMAGE_MODEL: "gpt-image-test" }), /OPENAI_API_KEY/);
  assert.throws(() => oa.readEnv({ ...ENV, OPENAI_IMAGE_MODEL: "dall-e-3" }), /DALL/);
  assert.equal(oa.readEnv({ ...ENV, OPENAI_IMAGE_MODEL: "dall-e-3", OPENAI_IMAGE_ALLOW_LEGACY: "1" }).model, "dall-e-3");
  assert.equal(oa.sizeMode("gpt-image-1"), "fixed"); assert.equal(oa.sizeMode("gpt-image-2"), "flexible");
  assert.deepEqual(oa.validateSize([1088, 1360], "flexible"), []);
  assert.ok(oa.validateSize([1000, 1000], "flexible").length);
  assert.ok(oa.validateSize([1024, 576], "flexible").some((p) => /pixeles/.test(p)));
  assert.deepEqual(oa.chooseGenerationSize("4:5", "fixed"), [1024, 1536]);
  assert.equal(oa.estimateCost({ quality: "medium", width: 1024, height: 1024, n: 2 }), 0.1);
  const plan = oa.planBudget({ quality: "high", width: 1088, height: 1360, variants: 10, now: NOW });
  assert.ok(plan.variants < 10 && plan.costUsd <= 2, JSON.stringify(plan));
  const { save, load } = await import("../lib/store.mjs");
  const before = load("ledger");
  save("ledger", [...before, { at: NOW, costUsd: 19.99, model: "gpt-image-test", op: "generate", briefId: "x", n: 1 }]);
  assert.throws(() => oa.planBudget({ quality: "medium", width: 1024, height: 1024, variants: 2, now: NOW }), /Presupuesto agotado/);
  save("ledger", before);
});

test("generateEditorialImage: 2 variantes, puntua, selecciona la valida, guarda la descartada y registra metadatos", async () => {
  const { generateEditorialImage } = await import("../lib/visual/index.mjs");
  const { load } = await import("../lib/store.mjs");
  const mock = mockOpenAI({ generations: [await neonImage(), await naturalImage(3)] });
  const r = await generateEditorialImage(BRIEF, { fetchImpl: mock.fetchImpl, env: ENV, now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(mock.calls.length, 2);
  const body = JSON.parse(mock.calls[0].init.body);
  assert.equal(body.model, "gpt-image-test"); assert.equal(body.size, "1088x1360"); assert.equal(body.output_format, "png");
  assert.ok(!/Tu propiedad|Env[ií]ame|logotipo de Aitor/i.test(body.prompt.replace(/sin logotipos[^;]*/g, "")), "el prompt no lleva titular ni CTA");
  assert.match(body.prompt, /sin texto/);
  assert.equal(mock.calls[0].init.headers.Authorization, "Bearer " + ENV.OPENAI_API_KEY);
  // salidas
  for (const [f, w, h] of [["feed", 1080, 1350], ["story", 1080, 1920]]) { const m = await sharp(r.outputs[f]).metadata(); assert.deepEqual([m.width, m.height], [w, h]); }
  assert.match(r.outputs.feed, /assets[\\/]marketing[\\/]2026[\\/]10[\\/]feed/);
  assert.ok(fs.existsSync(r.outputs.composed));
  assert.equal(r.discarded.length, 1); assert.match(r.discarded[0].file, /rejected/); assert.ok(r.discarded[0].reasons.some((x) => /saturacion|tecnologico/.test(x)));
  assert.equal(r.disclosure, "Ilustración"); assert.equal(r.disclosureClass, "D-photoreal"); assert.equal(r.aiGenerated, true); assert.equal(r.autoPublish, false);
  // registro por activo
  const assets = load("assets").filter((a) => a.briefId === r.briefId);
  const feed = assets.find((a) => a.format === "feed");
  for (const k of ["id", "prompt", "source", "model", "timestamp", "campaign", "type", "format", "channel", "published", "hash"]) assert.ok(feed[k] !== undefined && feed[k] !== null || k === "published", "falta " + k);
  assert.equal(feed.published, false); assert.equal(feed.origin, "generated"); assert.equal(feed.model, "gpt-image-test");
  assert.ok(assets.some((a) => a.status === "REJECTED" && a.reasons?.length));
  assert.ok(fs.existsSync(feed.sourcePath + ".json"));
  // coste registrado y clave jamas escrita
  assert.equal(load("ledger").length, 2);
  const all = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : all.push(path.join(d, e.name))));
  walk(process.env.MK_HOME);
  for (const f of all.filter((x) => /\.(json|txt|md)$/.test(x))) assert.ok(!fs.readFileSync(f, "utf8").includes("SECRET"), "clave en " + f);
});

test("sin ninguna variante valida: falla, no compone y deja todo en rejected", async () => {
  const { generateEditorialImage } = await import("../lib/visual/index.mjs");
  const mock = mockOpenAI({ generations: [await neonImage(), await neonImage(), await neonImage()] });
  const r = await generateEditorialImage({ ...BRIEF, campaign: "solo_neon" }, { fetchImpl: mock.fetchImpl, env: ENV, now: NOW });
  assert.equal(r.ok, false); assert.equal(r.discarded.length, 3, "2 pedidas + 1 extra dentro del limite"); assert.deepEqual(r.outputs, {});
});

test("dry-run: no llama a la API, devuelve prompts y coste estimado", async () => {
  const { runBrief } = await import("../lib/visual/index.mjs");
  let called = 0;
  const r = await runBrief({ ...BRIEF, campaign: "dry" }, { dryRun: true, env: { OPENAI_IMAGE_MODEL: "gpt-image-test" }, fetchImpl: async () => { called++; }, now: NOW });
  assert.equal(r.dryRun, true); assert.equal(called, 0); assert.equal(r.prompts.length, 2); assert.ok(r.plan.costUsd > 0);
  assert.notEqual(r.prompts[0], r.prompts[1], "las variantes cambian de composicion");
});

test("errores de la API: reintenta 429, no reintenta cuota agotada y no filtra la clave", async () => {
  const oa = await import("../lib/visual/openai.mjs");
  let n = 0;
  const flaky = async () => (++n < 3 ? { ok: false, status: 429, json: async () => ({ error: { message: "slow down" } }) } : { ok: true, status: 200, json: async () => ({ data: [{ b64_json: (await naturalImage(1, 64, 64)).toString("base64") }] }) });
  const r = await oa.generate({ prompt: "x", size: [1024, 1024] }, { fetchImpl: flaky, env: ENV, wait: async () => {} });
  assert.equal(n, 3); assert.equal(r.images.length, 1);
  const quota = mockOpenAI({ failWith: { status: 429, error: { code: "insufficient_quota", message: `sin saldo para ${ENV.OPENAI_API_KEY}` } } });
  await assert.rejects(oa.generate({ prompt: "x", size: [1024, 1024] }, { fetchImpl: quota.fetchImpl, env: ENV, wait: async () => {} }), (e) => { assert.equal(e.code, "insufficient_quota"); assert.ok(!e.message.includes("SECRET")); return true; });
  assert.equal(quota.calls.length, 1);
});

test("composicion programatica: logotipo oficial y texto (CTA en naranja de marca) sobre el fondo", async () => {
  const { composeFinal } = await import("../lib/visual/compose.mjs");
  const bg = await naturalImage(5);
  const out = await sharp(await composeFinal(bg, { ...BRIEF, headline: "Tu propiedad cuidada", cta: "Envíame fotos y ubicación", location: "Alcanar" }, "feed")).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = out.info;
  assert.deepEqual([width, height], [1080, 1350]);
  const px = (x, y) => [...out.data.subarray((y * width + x) * channels, (y * width + x) * channels + 3)];
  // placa blanca del logotipo (abajo-izquierda) y caja naranja del CTA
  const logoZone = Array.from({ length: 40 }, (_, i) => px(110 + i, 1260));
  assert.ok(logoZone.some(([r, g, b]) => r > 235 && g > 235 && b > 235), "logotipo/placa blanca");
  let orange = 0;
  for (let y = 900; y < 1230; y += 6) for (let x = 100; x < 980; x += 20) { const [r, g, b] = px(x, y); if (Math.abs(r - 196) < 12 && Math.abs(g - 77) < 12 && Math.abs(b - 10) < 14) orange++; }
  assert.ok(orange > 20, "caja de CTA en naranja de marca");
});

test("foto real: compone texto/logotipo SIN llamar a la API y conserva los pixeles de la foto", async () => {
  const { editRealWorkImage } = await import("../lib/visual/index.mjs");
  const { save } = await import("../lib/store.mjs");
  const red = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg({ quality: 95 }).toFile(path.join(dir, "real.jpg")).then(() => path.join(dir, "real.jpg"));
  save("assets", [{ id: "realA", origin: "real", kind: "image", jobId: "j9", sourcePath: red, role: "after", status: "READY", sha256: "r".repeat(64) }]);
  save("jobs", [{ id: "j9", status: "READY", locationId: "alcanar", locationConfirmed: true, history: [] }]);
  const mock = mockOpenAI();
  const r = await editRealWorkImage({ campaign: "caso_real", type: "editorial", source_images: ["realA"], channel: "instagram", aspect_ratio: "4:5", headline: "Resultado real", location: "Alcanar", use_real_work: true }, { fetchImpl: mock.fetchImpl, env: {}, now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(mock.calls.length, 0); assert.equal(r.aiGenerated, false); assert.equal(r.disclosure, null);
  const { data, info } = await sharp(r.outputs.feed).raw().toBuffer({ resolveWithObject: true });
  const i = (300 * info.width + 540) * info.channels; // zona alta y central: sin velo ni texto
  assert.ok(data[i] > 180 && data[i + 1] < 60, "pixel de la foto real intacto");
  const { load } = await import("../lib/store.mjs");
  const reg = load("assets").filter((a) => a.briefId === r.briefId);
  assert.ok(reg.every((a) => a.origin === "real" && a.jobId === "j9"));
  assert.ok(fs.readdirSync(path.join(path.dirname(path.dirname(r.outputs.feed)), "originals")).some((f) => f.startsWith("caso_real")));
});

test("foto real + ampliar lienzo: el modelo solo rellena margenes; si toca la foto se rechaza", async () => {
  const { editRealWorkImage } = await import("../lib/visual/index.mjs");
  const brief = { campaign: "ampliar", type: "editorial", source_images: ["realA"], channel: "instagram", aspect_ratio: "9:16", headline: "Resultado", location: "Alcanar", use_real_work: true, edit: { operation: "extend_canvas" } };
  const fill = (tamper) => async (init) => {
    const canvas = await sharp(Buffer.from(await init.body.get("image[]").arrayBuffer())).ensureAlpha().toBuffer();
    const meta = await sharp(canvas).metadata();
    let img = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: { r: 90, g: 130, b: 90 } } }).composite([{ input: canvas }]).png().toBuffer();
    if (tamper) img = await sharp(img).composite([{ input: await sharp({ create: { width: meta.width, height: Math.round(meta.height * 0.4), channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer(), left: 0, top: Math.round(meta.height * 0.3) }]).png().toBuffer();
    return img;
  };
  const good = mockOpenAI({ edits: [fill(false)] });
  const r = await editRealWorkImage(brief, { fetchImpl: good.fetchImpl, env: ENV, now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.fidelity < 10); assert.equal(r.aiGenerated, true); assert.equal(r.disclosure, "Ampliada con IA");
  assert.match(good.calls[0].url, /images\/edits/);
  const bad = mockOpenAI({ edits: [fill(true)] });
  const r2 = await editRealWorkImage({ ...brief, campaign: "ampliar2" }, { fetchImpl: bad.fetchImpl, env: ENV, now: NOW });
  assert.equal(r2.ok, false); assert.match(r2.error, /modifico la parte real/);
});

test("validateImage: acepta una imagen natural y rechaza saturacion extrema y desenfoque", async () => {
  const { validateImage } = await import("../lib/visual/index.mjs");
  assert.equal((await validateImage(await naturalImage(8))).ok, true);
  const neon = await validateImage(await neonImage());
  assert.equal(neon.ok, false); assert.ok(neon.reasons.some((r) => /saturacion|tecnologico/.test(r)));
  const blurry = await sharp(await naturalImage(9)).blur(25).png().toBuffer();
  assert.ok((await validateImage(blurry)).reasons.some((r) => /blanda|plastica/.test(r)));
});

test("infografia exige puntos; carrusel crea cubierta + puntos + cierre con texto programatico", async () => {
  const { generateInfographicVisual, generateCarouselAssets } = await import("../lib/visual/index.mjs");
  await assert.rejects(generateInfographicVisual({ ...BRIEF, campaign: "info", type: "infographic" }, { env: ENV, fetchImpl: mockOpenAI().fetchImpl }), /points/);
  const pts = [{ t: "Fotos y ubicación", b: "Nos cuentas qué necesitas." }, { t: "Valoración", b: "Te decimos cómo lo plantearíamos." }];
  const info = await generateInfographicVisual({ ...BRIEF, campaign: "info", type: "infographic", points: pts }, { env: ENV, fetchImpl: mockOpenAI({ generations: [await naturalImage(11), await naturalImage(12)] }).fetchImpl, now: NOW });
  assert.equal(info.ok, true, JSON.stringify(info));
  const car = await generateCarouselAssets({ ...BRIEF, campaign: "carr", type: "carousel", points: pts }, { env: ENV, fetchImpl: mockOpenAI({ generations: [await naturalImage(13), await naturalImage(14)] }).fetchImpl, now: NOW });
  assert.equal(car.ok, true, JSON.stringify(car));
  assert.equal(car.outputs.slides.length, 4);
  for (const f of car.outputs.slides) { const m = await sharp(f).metadata(); assert.deepEqual([m.width, m.height], [1080, 1350]); }
});

test("adjuntar a una pieza: solo imagen generada/grafica, con etiqueta de transparencia; nunca a trabajos ni con fotos reales", async () => {
  const { attachToPiece } = await import("../lib/visual/index.mjs");
  const { load, save } = await import("../lib/store.mjs");
  const { lintPiece } = await import("../lib/guardrails.mjs");
  const { renderPiece } = await import("../lib/assets.mjs");
  const { generateEditorialImage } = await import("../lib/visual/index.mjs");
  const gen = await generateEditorialImage({ ...BRIEF, campaign: "para_adjuntar" }, { fetchImpl: mockOpenAI({ generations: [await naturalImage(31), await naturalImage(32)] }).fetchImpl, env: ENV, now: NOW });
  assert.equal(gen.ok, true, JSON.stringify(gen));
  const feedAsset = load("assets").find((a) => a.format === "feed" && a.origin === "generated" && a.status === "READY" && a.briefId === gen.briefId);
  const piece = { id: "p_ev", kind: "evergreen", type: "single", channels: ["instagram", "facebook"], scheduledFor: "2026-10-19", status: "SCHEDULED", assetIds: [], template: "navy", copy: { tag: "Consejo", headline: "Tu propiedad cuidada", slides: [{ t: "Con visitas", b: "Fotos del resultado." }], captions: { instagram: "Texto\n\nEnvíanos fotos.\n\n#AitorSoluciones", facebook: "Texto\n\nEnvíanos fotos." }, hashtagsByChannel: { instagram: ["#AitorSoluciones"], facebook: [] }, zones: [], alt: "x" } };
  save("pieces", [piece, { id: "p_work", kind: "work", jobId: "j9", channels: ["instagram"], status: "SCHEDULED", copy: piece.copy, assetIds: [] }]);
  assert.throws(() => attachToPiece("p_work", [feedAsset.id]), /trabajo real/);
  assert.throws(() => attachToPiece("p_ev", ["realA"]), /foto real/);
  const storyAsset = load("assets").find((a) => a.format === "story" && a.briefId === gen.briefId);
  const p = attachToPiece("p_ev", [feedAsset.id, storyAsset.id]);
  // la transparencia va dentro de la imagen, no en el texto: el pie no se toca
  assert.ok(!/creada con IA/.test(p.copy.captions.facebook));
  assert.equal(p.visual.aiGenerated, true); assert.equal(p.visual.labelApplied, true); assert.deepEqual(p.visual.models, ["gpt-image-test"]);
  const ctx = () => ({ assets: load("assets"), jobs: load("jobs") });
  // sin critico visual la imagen no es autoPublish: exige aprobacion humana
  assert.ok(lintPiece(load("pieces").find((x) => x.id === "p_ev"), ctx()).some((x) => /no paso el critico visual/.test(x)));
  const { approveAsset } = await import("../lib/visual/index.mjs");
  approveAsset(feedAsset.id, "aitor"); approveAsset(storyAsset.id, "aitor");
  assert.deepEqual(lintPiece(load("pieces").find((x) => x.id === "p_ev"), ctx()).filter((x) => /etiqueta|critico/.test(x)), []);
  // una imagen generada fotorrealista cuya etiqueta no se aplico es un error
  const assets = load("assets"); assets.find((a) => a.id === feedAsset.id).labelApplied = false; save("assets", assets);
  assert.ok(lintPiece(load("pieces").find((x) => x.id === "p_ev"), ctx()).some((x) => /necesita la etiqueta "Ilustración"/.test(x)));
  assets.find((a) => a.id === feedAsset.id).labelApplied = true; save("assets", assets);
  const r = await renderPiece(load("pieces").find((x) => x.id === "p_ev"), { root: path.join(dir, "render-visual") });
  const feed = r.files.find((f) => f.format === "feed");
  assert.deepEqual([feed.width, feed.height], [1080, 1350]); assert.match(feed.file, /feed\.jpg$/);
});

test("cola de briefs (task runner): procesa, mueve a done/failed y la cola de Instagram sale en JPEG", async () => {
  const { runBriefQueue } = await import("../lib/visual/index.mjs");
  const { home } = await import("../lib/paths.mjs");
  const bdir = path.join(home(), "briefs"); fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, "a.json"), JSON.stringify({ ...BRIEF, campaign: "cola_ok" }));
  fs.writeFileSync(path.join(bdir, "b.json"), JSON.stringify({ ...BRIEF, campaign: "cola_mala", location: "Atlantida" }));
  const mock = mockOpenAI({ generations: [await naturalImage(21), await naturalImage(22)] });
  const res = await runBriefQueue({ fetchImpl: mock.fetchImpl, env: ENV, now: NOW });
  assert.deepEqual(res.map((r) => [r.brief, r.ok]), [["a.json", true], ["b.json", false]]);
  assert.ok(fs.existsSync(path.join(bdir, "done", "a.json")) && fs.existsSync(path.join(bdir, "failed", "b.json")));
  const { buildQueue } = await import("../lib/publish.mjs");
  const { save } = await import("../lib/store.mjs");
  save("pieces", [{ id: "p_ig", kind: "evergreen", type: "single", channels: ["instagram"], scheduledFor: "2026-10-19", time: "10:00", status: "SCHEDULED", assetIds: [], template: "navy", manualGraphic: { by: "test", reason: "prueba JPEG", at: "x" }, copy: { tag: "Consejo", headline: "Titular", slides: [{ t: "A", b: "B" }], captions: { instagram: "Texto" }, hashtagsByChannel: { instagram: [] }, zones: [], alt: "x" } }]);
  const q = await buildQueue({ today: "2026-10-19", ahead: 1 });
  const post = JSON.parse(fs.readFileSync(path.join(q[0].dir, "post.json"), "utf8"));
  assert.ok(post.files.every((f) => /\.jpg$/.test(f)), JSON.stringify(post.files));
});

// ---------- critico visual, transparencia y direccion visual ----------
const VENV = { ...ENV, OPENAI_VISION_MODEL: "vision-test" };
const bad = (extra = {}) => ({ ...CRITIC_OK, score: 45, publishable: false, ai_look: 8, visual_errors: ["manos deformes"], ...extra });

test("critico visual: pasa el fondo y la pieza final; autoPublish true, notas guardadas y coste del critico en el ledger", async () => {
  const { generateEditorialImage } = await import("../lib/visual/index.mjs");
  const { load } = await import("../lib/store.mjs");
  const mock = mockOpenAI({ generations: [await naturalImage(41), await naturalImage(42)] });
  const r = await generateEditorialImage({ ...BRIEF, campaign: "critico_ok" }, { fetchImpl: mock.fetchImpl, env: VENV, now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.autoPublish, true); assert.equal(r.selected.reviewed, "critic"); assert.equal(r.selected.critic.model, "vision-test");
  const crit = mock.calls.filter((c) => c.url.endsWith("/responses"));
  assert.equal(crit.length, 4, "fondo + pieza final por variante");
  const bodies = crit.map((c) => JSON.parse(c.init.body));
  assert.ok(bodies.every((b) => b.model === "vision-test"));
  assert.ok(bodies.some((b) => /pieza FINAL ya compuesta/.test(b.input[0].content[0].text)), "revisa la pieza compuesta");
  assert.ok(bodies.some((b) => /solo el fondo generado/.test(b.input[0].content[0].text)));
  assert.ok(bodies.every((b) => b.input[0].content[1].image_url.startsWith("data:image/")));
  const feed = load("assets").find((a) => a.briefId === r.briefId && a.format === "feed");
  assert.equal(feed.autoPublish, true); assert.equal(feed.critic.score, 90); assert.equal(feed.aiGenerated, true); assert.equal(feed.labelApplied, true);
  assert.ok(load("ledger").some((l) => l.op === "critic-final" && l.briefId === r.briefId));
});

test("critico visual: si rechaza una variante la descarta con los motivos y elige la otra", async () => {
  const { generateEditorialImage } = await import("../lib/visual/index.mjs");
  const mock = mockOpenAI({ generations: [await naturalImage(51), await naturalImage(52)], responses: [bad(), CRITIC_OK, CRITIC_OK] });
  const r = await generateEditorialImage({ ...BRIEF, campaign: "critico_descarta" }, { fetchImpl: mock.fetchImpl, env: VENV, now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.discarded.length, 1);
  assert.ok(r.discarded[0].reasons.some((x) => /manos deformes/.test(x)) && r.discarded[0].reasons.some((x) => /parece imagen de IA/.test(x)));
  assert.match(r.discarded[0].file, /rejected/);
});

test("critico visual: si fallan las 2 variantes genera una tercera dentro del limite y, si tampoco, falla sin componer", async () => {
  const { generateEditorialImage } = await import("../lib/visual/index.mjs");
  const m1 = mockOpenAI({ generations: [await naturalImage(61), await naturalImage(62), await naturalImage(63)], responses: [bad(), bad(), CRITIC_OK, CRITIC_OK] });
  const r1 = await generateEditorialImage({ ...BRIEF, campaign: "critico_extra" }, { fetchImpl: m1.fetchImpl, env: VENV, now: NOW });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(m1.calls.filter((c) => c.url.endsWith("/images/generations")).length, 3);
  assert.equal(r1.discarded.length, 2);
  const m2 = mockOpenAI({ generations: [await naturalImage(64), await naturalImage(65), await naturalImage(66), await naturalImage(67)], responses: [bad(), bad(), bad()] });
  const r2 = await generateEditorialImage({ ...BRIEF, campaign: "critico_agota" }, { fetchImpl: m2.fetchImpl, env: VENV, now: NOW });
  assert.equal(r2.ok, false); assert.equal(m2.calls.filter((c) => c.url.endsWith("/images/generations")).length, 3, "nunca mas del maximo de variantes"); assert.deepEqual(r2.outputs, {});
});

test("critico visual: texto mal situado en la pieza final es motivo de rechazo", async () => {
  const { generateEditorialImage } = await import("../lib/visual/index.mjs");
  const mock = mockOpenAI({ generations: [await naturalImage(71), await naturalImage(72)], responses: [CRITIC_OK, { ...CRITIC_OK, text_placement_ok: false, mobile_legible: false }, CRITIC_OK, CRITIC_OK] });
  const r = await generateEditorialImage({ ...BRIEF, campaign: "critico_texto" }, { fetchImpl: mock.fetchImpl, env: VENV, now: NOW });
  assert.equal(r.ok, true);
  assert.ok(r.discarded[0].reasons.some((x) => /texto mal situado/.test(x)) && r.discarded[0].reasons.some((x) => /movil/.test(x)));
});

test("transparencia: ilustracion e infografia sin etiqueta, fotorrealismo con Ilustración, foto real sin IA; siempre se registra aiGenerated, modelo, prompt y fecha", async () => {
  const { generateIllustration } = await import("../lib/visual/index.mjs");
  const { disclosureFor } = await import("../lib/visual/prompts.mjs");
  const { load } = await import("../lib/store.mjs");
  assert.deepEqual(disclosureFor({ type: "illustration" }, "generate"), { aiGenerated: true, label: null, class: "C-illustration" });
  assert.equal(disclosureFor({ type: "editorial" }, "generate").label, "Ilustración");
  assert.equal(disclosureFor({ type: "background" }, "generate").label, "Ilustración");
  assert.equal(disclosureFor({ type: "real_work", edit: { operation: "compose" } }, "real").aiGenerated, false);
  const r = await generateIllustration({ ...BRIEF, campaign: "ilustracion_sin_etiqueta", type: "illustration", elements: ["herramientas", "siluetas"] }, { fetchImpl: mockOpenAI({ generations: [await naturalImage(81), await naturalImage(82)] }).fetchImpl, env: ENV, now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.disclosure, null); assert.equal(r.aiGenerated, true); assert.equal(r.disclosureClass, "C-illustration");
  const a = load("assets").find((x) => x.briefId === r.briefId && x.format === "feed");
  assert.equal(a.aiGenerated, true); assert.equal(a.labelApplied, false); assert.equal(a.model, "gpt-image-test"); assert.ok(a.prompt && a.timestamp);
  assert.match(a.prompt, /siluetas de una persona trabajando, sin rostro/); assert.match(a.prompt, /Ilustracion editorial de revista/);
});

test("direccion visual: herramientas, manos y siluetas solo en ilustracion; nunca personas ni trabajos falsos en el prompt fotorrealista", async () => {
  const { normalizeBrief } = await import("../lib/visual/brief.mjs");
  const { buildPrompt } = await import("../lib/visual/prompts.mjs");
  const probs = (patch) => normalizeBrief({ ...BRIEF, ...patch }).problems.join("|");
  assert.match(probs({ elements: ["manos"] }), /solo en ilustracion/);
  assert.match(probs({ elements: ["dragon"] }), /no existe/);
  assert.deepEqual(normalizeBrief({ ...BRIEF, type: "illustration", elements: ["herramientas", "manos", "siluetas", "maquinaria", "vegetacion"] }).problems, []);
  const photo = buildPrompt({ ...BRIEF, type: "editorial", elements: [] }, 0), illus = buildPrompt({ ...BRIEF, type: "illustration", elements: ["herramientas"] }, 0);
  assert.match(photo, /sin personas ni rostros visibles ni manos/); assert.match(photo, /no es un antes\/despues ni una obra real/);
  assert.match(illus, /tijeras de podar/); assert.match(illus, /nadie que pueda pasar por Aitor/); assert.match(illus, /que se vea de inmediato que es una ilustracion/);
  assert.ok(!/sin herramientas ni maquinaria visibles/.test(illus));
});

test("etiqueta discreta: Ilustración se dibuja en la esquina inferior derecha y la pieza sin etiqueta no la lleva", async () => {
  const { composeFinal } = await import("../lib/visual/compose.mjs");
  const bg = await naturalImage(91);
  const withL = await sharp(await composeFinal(bg, { ...BRIEF, label: "Ilustración" }, "feed")).raw().toBuffer({ resolveWithObject: true });
  const without = await sharp(await composeFinal(bg, { ...BRIEF }, "feed")).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = withL.info;
  let diff = 0, outside = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * channels; const d = Math.abs(withL.data[i] - without.data[i]) + Math.abs(withL.data[i + 1] - without.data[i + 1]); if (d > 12) { if (x > width * 0.6 && y > height * 0.9) diff++; else outside++; } }
  assert.ok(diff > 150, "etiqueta visible abajo a la derecha"); assert.equal(outside, 0, "no toca nada mas");
});
