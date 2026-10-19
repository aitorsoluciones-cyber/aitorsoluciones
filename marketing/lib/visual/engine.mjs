// Motor visual: lee el brief, decide generar / editar foto real / solo componer, llama a la OpenAI Images API,
// puntua y selecciona variantes, compone texto+logotipo por codigo, crea los tamanos y registra metadatos.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "../paths.mjs";
import { load, findById, nowIso } from "../store.mjs";
import { readPhoto } from "../media.mjs";
import { normalizeBrief } from "./brief.mjs";
import { buildPrompt, buildExtendPrompt, disclosureFor } from "./prompts.mjs";
import * as oa from "./openai.mjs";
import { validateImage, reviewFinal } from "./score.mjs";
import { composeFinal, resizeForChannels, webVariants, composePointSlide, composeInfographic, FORMATS_BY_CHANNEL } from "./compose.mjs";
import { outputRoot, writeFile, registerAsset, sha256 } from "./registry.mjs";

export { validateImage, registerAsset, resizeForChannels };
export { applyBrandOverlay, applyLogo, applyText } from "./compose.mjs";

export class BriefError extends Error { constructor(problems) { super("Brief no valido:\n - " + problems.join("\n - ")); this.problems = problems; } }

const DIR_BY_FORMAT = { feed: "feed", story: "stories", gbp: "gbp", web: "web" };
const ctxOf = (c = {}) => ({ fetchImpl: c.fetchImpl || fetch, env: c.env || process.env, now: c.now || nowIso(), dryRun: !!c.dryRun, log: c.log || (() => {}), wait: c.wait, noCritic: !!c.noCritic });

function prepare(raw, ctx, allowedTypes) {
  const { brief, mode, problems } = normalizeBrief(raw);
  if (allowedTypes && !allowedTypes.includes(brief.type)) problems.push(`esta funcion no admite type ${brief.type}`);
  if (problems.length) throw new BriefError(problems);
  return { brief, mode };
}

const criticOf = (ctx) => (!ctx.noCritic && ctx.env.OPENAI_VISION_MODEL ? { fetchImpl: ctx.fetchImpl, env: ctx.env, wait: ctx.wait } : null);

// Resumen del critico que se guarda con cada activo.
const criticSummary = (v) => (v?.critic && !v.critic.error ? { model: v.critic.model, score: v.critic.score, aiLook: v.critic.aiLook, brandFit: v.critic.brandFit, commercialAppeal: v.critic.commercialAppeal, publishable: v.critic.publishable, notes: v.critic.notes } : null);

// Metadatos de transparencia y de revision que acompanan a cada activo registrado.
const metaExtra = (brief, mode, { verdict = null, final = null, autoPublish } = {}) => {
  const d = disclosureFor(brief, mode);
  return {
    aiGenerated: d.aiGenerated, disclosure: d.label, disclosureClass: d.class, labelApplied: !!d.label,
    critic: criticSummary(verdict), criticFinal: criticSummary(final),
    autoPublish: autoPublish ?? !!(verdict && verdict.reviewed === "critic" && final && final.pass !== false)
  };
};

// ---------- generacion de variantes + seleccion ----------
// previewFn(buf) -> pieza final compuesta; el critico la revisa ademas del fondo (texto bien situado, legible en movil...).
async function generateVariants(brief, mode, ctx, previewFn) {
  const { model, visionModel } = oa.readEnv(ctx.env, { needKey: !ctx.dryRun });
  const smode = oa.sizeMode(model, ctx.env);
  const size = oa.chooseGenerationSize(brief.aspect_ratio, smode);
  const sizeProblems = oa.validateSize(size, smode);
  if (sizeProblems.length) throw new oa.ConfigError(`Tamano ${size.join("x")} no valido: ${sizeProblems.join("; ")}`);
  const cfgE = config().imageEngine;
  const plan = oa.planBudget({ quality: brief.quality, width: size[0], height: size[1], variants: brief.variants, now: ctx.now });
  let ceiling = plan.variants;
  try { ceiling = oa.planBudget({ quality: brief.quality, width: size[0], height: size[1], variants: Math.max(brief.variants, cfgE.defaults.maxVariants), now: ctx.now }).variants; } catch { /* sin margen extra */ }
  const prompts = Array.from({ length: plan.variants }, (_, i) => buildPrompt(brief, i));
  if (ctx.dryRun) return { dryRun: true, model, size, plan, prompts, critic: !!visionModel && !ctx.noCritic };

  const root = outputRoot(ctx.now);
  const refs = brief.source_images.map((id) => findById(load("assets"), id));
  const critic = criticOf(ctx);
  const results = [];
  let spent = 0;
  const imgCost = oa.estimateCost({ quality: brief.quality, width: size[0], height: size[1], n: 1 });
  for (let i = 0; i < ceiling; i++) {
    // variantes solicitadas; solo se generan mas (dentro del presupuesto) si ninguna paso la revision
    if (i >= plan.variants && results.some((r) => r.verdict.ok)) break;
    const prompt = buildPrompt(brief, i);
    let res;
    if (mode === "reference") {
      res = await oa.edit({ prompt, images: refs.map((a) => ({ buf: fs.readFileSync(a.sourcePath), name: path.basename(a.sourcePath), mime: "image/png" })), size, quality: brief.quality, n: 1 }, ctx);
    } else res = await oa.generate({ prompt, size, quality: brief.quality, n: 1 }, ctx);
    oa.recordCost({ costUsd: imgCost, model, op: mode === "reference" ? "edit" : "generate", briefId: brief.id, n: 1 });
    spent += imgCost;
    const buf = res.images[0];
    const file = writeFile(path.join(root, "generated"), `${brief.campaign}-${brief.id}-v${i + 1}.png`, buf);
    const verdict = await validateImage(buf, { width: size[0], height: size[1], stage: "background", critic });
    if (critic) { oa.recordCost({ costUsd: cfgE.critic.costUsdPerCall, model: visionModel, op: "critic-background", briefId: brief.id, n: 1 }); spent += cfgE.critic.costUsdPerCall; }
    let final = null;
    if (verdict.ok && previewFn) {
      const preview = await previewFn(buf);
      final = await reviewFinal(preview, critic);
      if (critic) { oa.recordCost({ costUsd: cfgE.critic.costUsdPerCall, model: visionModel, op: "critic-final", briefId: brief.id, n: 1 }); spent += cfgE.critic.costUsdPerCall; }
      if (final && final.pass === false) { verdict.ok = false; verdict.reasons.push(...final.reasons); }
      if (final && final.score != null) verdict.score = Math.round((verdict.score + final.score) / 2);
    }
    results.push({ i, file, buf, prompt, verdict, final });
    ctx.log(`  variante ${i + 1}: puntuacion ${verdict.score} ${verdict.ok ? "OK" : "RECHAZADA: " + verdict.reasons.join("; ")}${verdict.reviewed === "critic" ? " (critico)" : ""}`);
  }
  const valid = results.filter((r) => r.verdict.ok).sort((a, b) => b.verdict.score - a.verdict.score);
  const chosen = valid[0] || null;
  const discarded = [];
  for (const r of results) {
    if (r === chosen) continue;
    const reason = r.verdict.ok ? ["valida pero no seleccionada"] : r.verdict.reasons;
    const dest = writeFile(path.join(root, "rejected"), path.basename(r.file), r.buf);
    fs.rmSync(r.file, { force: true });
    const { asset } = await registerAsset(dest, { origin: "generated", status: "REJECTED", prompt: r.prompt, model, campaign: brief.campaign, type: brief.type, channel: brief.channel, format: "raw", briefId: brief.id, score: r.verdict.score, reasons: reason, review: r.verdict.reviewed, extra: { aiGenerated: true, critic: criticSummary(r.verdict), criticFinal: criticSummary(r.final) } });
    discarded.push({ file: dest, reasons: reason, score: r.verdict.score, assetId: asset.id });
  }
  let rawAsset = null;
  if (chosen) rawAsset = (await registerAsset(chosen.file, { origin: "generated", status: "READY", prompt: chosen.prompt, model, campaign: brief.campaign, type: brief.type, channel: brief.channel, format: "raw", briefId: brief.id, score: chosen.verdict.score, review: chosen.verdict.reviewed, extra: metaExtra(brief, mode, chosen) })).asset;
  return { model, size, plan: { ...plan, costUsd: +spent.toFixed(4) }, chosen, rawAsset, discarded, results };
}

// Compone los formatos del canal sobre el fondo elegido y registra cada uno.
async function deliver(brief0, bg, ctx, { mode = "generate", model, derivedFrom, origin = "generated", prompt = null, jobId = null, edited = false, fidelity, review, score, chosen = null }) {
  const d = disclosureFor(brief0, mode);
  const brief = { ...brief0, label: d.label };
  const extra = metaExtra(brief0, mode, { verdict: chosen?.verdict, final: chosen?.final, autoPublish: mode === "real" ? true : undefined });
  const root = outputRoot(ctx.now);
  const channels = brief.channels?.length ? brief.channels : [brief.channel];
  const finals = await resizeForChannels(bg, brief, channels);
  const outputs = {};
  const assetIds = [];
  const primary = Object.keys(finals)[0];
  const base = `${brief.campaign}-${brief.id}`;
  const common = { origin, status: "READY", prompt, model, campaign: brief.campaign, type: brief.type, channel: brief.channel, briefId: brief.id, derivedFrom, jobId, edited, fidelity, review, score, extra };
  for (const [format, buf] of Object.entries(finals)) {
    const dir = path.join(root, DIR_BY_FORMAT[format]);
    let file;
    if (format === "web") {
      const v = await webVariants(buf);
      for (const [w, b] of Object.entries(v)) { const f = writeFile(dir, `${base}-${w}.webp`, b); const r = await registerAsset(f, { ...common, format: `web-${w}` }); assetIds.push(r.asset.id); }
      file = path.join(dir, `${base}-1600.webp`);
    } else {
      const jpg = await sharp(buf).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      file = writeFile(dir, `${base}-${format}.jpg`, jpg);
      const r = await registerAsset(file, { ...common, format });
      assetIds.push(r.asset.id);
    }
    outputs[format] = file;
    if (format === primary) { const master = writeFile(path.join(root, "composed"), `${base}-${format}.png`, buf); const r = await registerAsset(master, { ...common, format: `${format}-master` }); assetIds.push(r.asset.id); outputs.composed = master; }
  }
  return { outputs, assetIds, disclosure: d, autoPublish: extra.autoPublish };
}

const finish = (brief, mode, gen, delivered, ctx, extra = {}) => ({
  ok: true, briefId: brief.id, mode, type: brief.type, model: gen.model, aiGenerated: delivered.disclosure.aiGenerated, disclosure: delivered.disclosure.label, disclosureClass: delivered.disclosure.class,
  autoPublish: delivered.autoPublish, outputs: delivered.outputs, assetIds: delivered.assetIds,
  selected: gen.chosen ? { file: gen.chosen.file, score: gen.chosen.verdict.score, reviewed: gen.chosen.verdict.reviewed, critic: criticSummary(gen.chosen.verdict), criticFinal: criticSummary(gen.chosen.final) } : null,
  discarded: gen.discarded, costUsd: gen.plan.costUsd, ...extra
});

const noValid = (brief, mode, gen) => ({ ok: false, briefId: brief.id, mode, error: "ninguna variante supera los criterios de calidad", discarded: gen.discarded, costUsd: gen.plan.costUsd, outputs: {}, assetIds: [] });

// Pieza final de vista previa para el critico: el primer formato del canal compuesto con la etiqueta que corresponda.
const previewOf = (brief, mode) => (bg) => composeFinal(bg, { ...brief, label: disclosureFor(brief, mode).label }, FORMATS_BY_CHANNEL[brief.channel]?.[0] || "feed");

// ---------- A) imagen generada ----------
async function generated(raw, ctxIn, types) {
  const ctx = ctxOf(ctxIn);
  const { brief, mode } = prepare(raw, ctx, types);
  const gen = await generateVariants(brief, mode, ctx, previewOf(brief, mode));
  if (gen.dryRun) return { ok: true, dryRun: true, briefId: brief.id, mode, size: gen.size, model: gen.model, plan: gen.plan, prompts: gen.prompts, critic: gen.critic };
  if (!gen.chosen) return noValid(brief, mode, gen);
  const delivered = await deliver(brief, gen.chosen.buf, ctx, { mode, model: gen.model, derivedFrom: [gen.rawAsset.id], prompt: gen.chosen.prompt, review: gen.chosen.verdict.reviewed, score: gen.chosen.verdict.score, chosen: gen.chosen });
  return finish(brief, mode, gen, delivered, ctx);
}
export const generateEditorialImage = (brief, ctx) => generated(brief, ctx, ["editorial"]);
export const generateIllustration = (brief, ctx) => generated(brief, ctx, ["illustration"]);
export const generateBackground = (brief, ctx) => generated(brief, ctx, ["background"]);

export async function generateInfographicVisual(raw, ctxIn) {
  const ctx = ctxOf(ctxIn);
  const { brief, mode } = prepare(raw, ctx, ["infographic"]);
  if (!brief.points.length) throw new BriefError(["infographic exige points: [{t, b}]"]);
  const info = (bg) => composeInfographic(bg, { title: brief.headline, points: brief.points, tag: brief.tag }, { width: 1080, height: 1350 });
  const gen = await generateVariants(brief, mode, ctx, info);
  if (gen.dryRun) return { ok: true, dryRun: true, briefId: brief.id, mode, size: gen.size, model: gen.model, plan: gen.plan, prompts: gen.prompts, critic: gen.critic };
  if (!gen.chosen) return noValid(brief, mode, gen);
  const delivered = await deliver(brief, await info(gen.chosen.buf), ctx, { mode, model: gen.model, derivedFrom: [gen.rawAsset.id], prompt: gen.chosen.prompt, review: gen.chosen.verdict.reviewed, score: gen.chosen.verdict.score, chosen: gen.chosen });
  return finish(brief, mode, gen, delivered, ctx);
}

export async function generateCarouselAssets(raw, ctxIn) {
  const ctx = ctxOf(ctxIn);
  const { brief, mode } = prepare(raw, ctx, ["carousel"]);
  const gen = await generateVariants(brief, mode, ctx, previewOf(brief, mode));
  if (gen.dryRun) return { ok: true, dryRun: true, briefId: brief.id, mode, size: gen.size, model: gen.model, plan: gen.plan, prompts: gen.prompts, critic: gen.critic };
  if (!gen.chosen) return noValid(brief, mode, gen);
  const root = outputRoot(ctx.now);
  const [w, h] = config().imageEngine.targets.feed;
  const d = disclosureFor(brief, mode);
  const withLabel = { ...brief, label: d.label };
  const slides = [await composeFinal(gen.chosen.buf, withLabel, "feed")];
  const pts = brief.points.length ? brief.points : [];
  const crops = ["left", "centre", "right"];
  for (const [i, p] of pts.entries()) {
    const bg = await sharp(gen.chosen.buf).resize(w, h, { fit: "cover", position: crops[i % 3] }).toBuffer();
    slides.push(await composePointSlide(bg, { n: i + 1, total: pts.length, title: p.t, body: p.b }, { width: w, height: h }));
  }
  slides.push(await composeFinal(gen.chosen.buf, { ...withLabel, headline: "¿Hablamos?" }, "feed"));
  const extra = metaExtra(brief, mode, { verdict: gen.chosen.verdict, final: gen.chosen.final });
  const outputs = { slides: [] }, assetIds = [];
  for (const [i, s] of slides.entries()) {
    const file = writeFile(path.join(root, "feed"), `${brief.campaign}-${brief.id}-slide${String(i + 1).padStart(2, "0")}.jpg`, await sharp(s).jpeg({ quality: 92, mozjpeg: true }).toBuffer());
    const r = await registerAsset(file, { origin: "generated", status: "READY", prompt: gen.chosen.prompt, model: gen.model, campaign: brief.campaign, type: "carousel", channel: brief.channel, format: `carousel-${i + 1}`, briefId: brief.id, derivedFrom: [gen.rawAsset.id], review: gen.chosen.verdict.reviewed, score: gen.chosen.verdict.score, extra });
    outputs.slides.push(file); assetIds.push(r.asset.id);
  }
  return finish(brief, mode, gen, { outputs, assetIds, disclosure: d, autoPublish: extra.autoPublish }, ctx);
}

// ---------- B) edicion de foto real (fidelidad garantizada) ----------
// compose: solo texto/logotipo por codigo. enhance: ajuste suave de luz/color por codigo. extend_canvas: el modelo solo rellena
// margenes; los pixeles de la foto se vuelven a pegar tal cual y se rechaza si el modelo los reinterpreto.
const meanAbsDiff = async (a, b) => {
  const [x, y] = await Promise.all([sharp(a).removeAlpha().raw().toBuffer(), sharp(b).removeAlpha().raw().toBuffer()]);
  let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]);
  return d / x.length;
};

export async function editRealWorkImage(raw, ctxIn) {
  const ctx = ctxOf(ctxIn);
  const { brief, mode } = prepare(raw, ctx, ["real_work"]);
  const assets = load("assets");
  const src = findById(assets, brief.source_images[0]);
  const op = brief.edit.operation;
  const root = outputRoot(ctx.now);
  const photo = await readPhoto(src.sourcePath);
  const orig = writeFile(path.join(root, "originals"), `${brief.campaign}-${src.id}.jpg`, await sharp(photo).jpeg({ quality: 95 }).toBuffer());
  await registerAsset(orig, { origin: "real", status: "READY", source: "real-work", model: null, campaign: brief.campaign, type: "real_work", channel: brief.channel, format: "original", jobId: src.jobId, derivedFrom: [src.id], role: src.role });
  let bg = photo, fidelity = 0, model = null, cost = 0, plan = { costUsd: 0 };
  if (op === "enhance") {
    bg = await sharp(photo).modulate({ brightness: 1.03, saturation: 1.04 }).sharpen({ sigma: 0.6 }).toBuffer();
    fidelity = await meanAbsDiff(photo, bg);
    if (fidelity > 12) return { ok: false, briefId: brief.id, mode, error: `la mejora altera demasiado la foto (${fidelity.toFixed(1)})`, outputs: {}, assetIds: [], costUsd: 0 };
  }
  if (op === "extend_canvas") {
    const { model: m } = oa.readEnv(ctx.env, { needKey: !ctx.dryRun });
    model = m;
    const smode = oa.sizeMode(m, ctx.env);
    const size = oa.chooseGenerationSize(brief.aspect_ratio, smode);
    const meta = await sharp(photo).metadata();
    const scale = Math.min(size[0] / meta.width, size[1] / meta.height);
    const pw = Math.round(meta.width * scale), ph = Math.round(meta.height * scale);
    const left = Math.round((size[0] - pw) / 2), top = Math.round((size[1] - ph) / 2);
    const gapRatio = 1 - (pw * ph) / (size[0] * size[1]);
    if (gapRatio > 0.02) {
      plan = oa.planBudget({ quality: brief.quality, width: size[0], height: size[1], variants: 1, now: ctx.now });
      const placed = await sharp(photo).resize(pw, ph).png().toBuffer();
      const canvas = await sharp({ create: { width: size[0], height: size[1], channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: placed, left, top }]).png().toBuffer();
      const maskRaw = Buffer.alloc(size[0] * size[1] * 4, 0);
      for (let y = top; y < top + ph; y++) for (let x = left; x < left + pw; x++) maskRaw[(y * size[0] + x) * 4 + 3] = 255;
      const mask = await sharp(maskRaw, { raw: { width: size[0], height: size[1], channels: 4 } }).png().toBuffer();
      if (ctx.dryRun) return { ok: true, dryRun: true, briefId: brief.id, mode, operation: op, size, model, plan, prompts: [buildExtendPrompt()] };
      const res = await oa.edit({ prompt: buildExtendPrompt(), images: [{ buf: canvas, name: "photo.png" }], mask, size, quality: brief.quality, n: 1 }, ctx);
      oa.recordCost({ costUsd: plan.costUsd, model, op: "edit-extend", briefId: brief.id, n: 1 });
      const out = res.images[0];
      const region = await sharp(out).extract({ left, top, width: pw, height: ph }).toBuffer();
      fidelity = await meanAbsDiff(region, placed);
      if (fidelity > 10) {
        const rej = writeFile(path.join(root, "rejected"), `${brief.campaign}-${brief.id}-extend.png`, out);
        await registerAsset(rej, { origin: "real", status: "REJECTED", edited: true, prompt: buildExtendPrompt(), model, campaign: brief.campaign, type: "real_work", channel: brief.channel, format: "raw", briefId: brief.id, derivedFrom: [src.id], jobId: src.jobId, reasons: [`el modelo reinterpreto la foto (diferencia ${fidelity.toFixed(1)})`], fidelity });
        return { ok: false, briefId: brief.id, mode, error: "el modelo modifico la parte real de la foto: rechazado", fidelity, outputs: {}, assetIds: [], costUsd: plan.costUsd };
      }
      bg = await sharp(out).composite([{ input: placed, left, top }]).png().toBuffer(); // pixeles reales intactos
    }
  } else if (ctx.dryRun) return { ok: true, dryRun: true, briefId: brief.id, mode, operation: op, plan, prompts: [] };
  const delivered = await deliver(brief, bg, ctx, { mode: "real", model, derivedFrom: [src.id], origin: "real", jobId: src.jobId, edited: op !== "compose", fidelity: +fidelity.toFixed(2), review: "fidelity-guard" });
  return { ok: true, briefId: brief.id, mode, type: "real_work", operation: op, model, aiGenerated: delivered.disclosure.aiGenerated, disclosure: delivered.disclosure.label, disclosureClass: delivered.disclosure.class, autoPublish: delivered.autoPublish, fidelity: +fidelity.toFixed(2), outputs: delivered.outputs, assetIds: delivered.assetIds, discarded: [], costUsd: plan.costUsd };
}

// ---------- despachador ----------
export async function runBrief(raw, ctx = {}) {
  const c = ctxOf(ctx);
  const { brief } = normalizeBrief(raw);
  if (raw.use_real_work === true) return editRealWorkImage(raw, c);
  switch (brief.type) {
    case "editorial": return generateEditorialImage(raw, c);
    case "illustration": return generateIllustration(raw, c);
    case "background": return generateBackground(raw, c);
    case "infographic": return generateInfographicVisual(raw, c);
    case "carousel": return generateCarouselAssets(raw, c);
    default: return generated(raw, c, [brief.type]);
  }
}

export { FORMATS_BY_CHANNEL, sha256 };
