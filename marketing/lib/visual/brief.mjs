// Creative brief: validacion, normalizacion y decision de modo (generar / editar foto real / solo componer).
import crypto from "node:crypto";
import { config } from "../paths.mjs";
import { load, findById } from "../store.mjs";
import { locations, locationById, norm } from "../places.mjs";
import { lintCopy } from "../guardrails.mjs";
import { style, isPhotoreal } from "./prompts.mjs";

export const TYPES = ["editorial", "illustration", "background", "infographic", "carousel", "real_work"];
export const CHANNELS = ["instagram", "facebook", "gbp", "web"];
export const RATIOS = ["4:5", "9:16", "1:1", "4:3", "16:9", "3:2", "2:3"];
export const REAL_OPS = ["compose", "enhance", "extend_canvas"];
const GENERATED_ORIGINS = new Set(["graphic", "generated", "brand"]);

const findLocation = (v) => (v ? locationById(v) || locations().find((l) => norm(l.name) === norm(v)) : null);

// Devuelve { brief, mode, problems }. Sin problemas => se puede ejecutar.
export function normalizeBrief(raw, { assets = load("assets"), jobs = load("jobs") } = {}) {
  const cfg = config();
  const problems = [];
  const b = {
    campaign: String(raw.campaign || "").trim(),
    type: raw.type,
    source_images: [...(raw.source_images || [])],
    channel: raw.channel,
    channels: [...new Set([raw.channel, ...(raw.channels || [])].filter(Boolean))],
    aspect_ratio: raw.aspect_ratio,
    headline: String(raw.headline || "").trim(),
    cta: String(raw.cta || cfg.brand.cta).trim(),
    location: raw.location || null,
    use_real_work: raw.use_real_work === true,
    points: raw.points || [],
    slides: raw.slides || null,
    elements: [...(raw.elements || [])],
    tag: raw.tag || "",
    template: raw.template || null,
    style_notes: raw.style_notes || "",
    edit: raw.edit || null,
    variants: raw.variants ?? cfg.imageEngine.defaults.variants,
    quality: raw.quality || cfg.imageEngine.defaults.quality
  };
  if (!/^[a-z0-9_-]+$/i.test(b.campaign)) problems.push("campaign obligatoria (letras, numeros, - y _)");
  if (b.use_real_work) b.type = "real_work";
  else if (!TYPES.includes(b.type) || b.type === "real_work") problems.push(`type debe ser uno de ${TYPES.filter((t) => t !== "real_work").join(", ")} (o use_real_work:true)`);
  if (!CHANNELS.includes(b.channel)) problems.push(`channel debe ser uno de ${CHANNELS.join(", ")}`);
  for (const c of b.channels) if (!CHANNELS.includes(c)) problems.push(`channels: ${c} no es un canal (${CHANNELS.join(", ")})`);
  if (!RATIOS.includes(b.aspect_ratio)) problems.push(`aspect_ratio debe ser uno de ${RATIOS.join(", ")}`);
  if (!b.headline) problems.push("headline obligatorio");
  if (!["cheap", "low", "medium", "high"].includes(b.quality) && b.quality !== "auto") problems.push("quality: low|medium|high|auto");
  // Elementos editoriales (herramientas, manos, siluetas, maquinaria): solo en ilustracion; en fotorrealismo se podria confundir con un trabajo real.
  const known = Object.keys(style().elements);
  for (const e of b.elements) {
    if (!known.includes(e)) problems.push(`elements: "${e}" no existe (${known.join(", ")})`);
    else if (e !== "vegetacion" && b.type && b.type !== "real_work" && isPhotoreal(b.type)) problems.push(`elements: "${e}" solo en ilustracion (type illustration/infographic/carousel), no en fotorrealismo`);
  }
  b.variants = Math.max(1, Math.min(Number(b.variants) || 1, cfg.imageEngine.defaults.maxVariants));

  // Material de entrada: foto real solo con use_real_work; para generar solo material de marca/grafico/generado.
  const srcAssets = b.source_images.map((id) => findById(assets, id));
  b.source_images.forEach((id, i) => { if (!srcAssets[i]) problems.push(`source_images: material inexistente ${id}`); });
  if (b.use_real_work) {
    if (!b.source_images.length) problems.push("use_real_work exige source_images (fotos reales del banco)");
    for (const a of srcAssets.filter(Boolean)) {
      if (a.origin !== "real") problems.push(`use_real_work: ${a.id} no es una fotografia real (${a.origin})`);
      if (a.needsDownload || !a.sourcePath) problems.push(`use_real_work: ${a.id} sin fichero local`);
    }
    if (b.edit?.operation && !REAL_OPS.includes(b.edit.operation)) problems.push(`edit.operation debe ser ${REAL_OPS.join("|")}`);
    b.edit = { operation: b.edit?.operation || "compose" };
  } else {
    for (const a of srcAssets.filter(Boolean)) if (!GENERATED_ORIGINS.has(a.origin)) problems.push(`para generar no se pueden usar fotos reales como referencia (${a.id}): se podria inventar un trabajo`);
    b.edit = null;
  }

  // Localidad: solo reales; con foto real, la confirmada del trabajo.
  let loc = null;
  if (b.location) {
    loc = findLocation(b.location);
    if (!loc) problems.push(`location inexistente (no se inventan localidades): ${b.location}`);
    else if (b.use_real_work) {
      const jobIds = new Set(srcAssets.filter(Boolean).map((a) => a.jobId));
      for (const j of [...jobIds].map((id) => findById(jobs, id)).filter(Boolean)) if (!(j.locationConfirmed && j.locationId === loc.id)) problems.push(`la localidad ${loc.name} no esta confirmada para el trabajo ${j.id}`);
    } else if (!loc.isPriority) problems.push(`en piezas generadas solo se nombran las zonas de servicio principales: ${loc.name}`);
    if (loc) b.location = loc.name;
  }
  const allowed = loc ? [loc.name] : [];
  for (const [field, text] of [["headline", b.headline], ["cta", b.cta], ...b.points.flatMap((p, i) => [[`points[${i}].t`, p.t], [`points[${i}].b`, p.b]])]) {
    if (text) for (const p of lintCopy(text, { allowedLocations: allowed })) problems.push(`${field}: ${p}`);
  }
  if (b.use_real_work && b.edit?.operation === "extend_canvas" && !srcAssets.length) problems.push("extend_canvas exige una foto");

  const mode = b.use_real_work ? "real" : b.source_images.length ? "reference" : "generate";
  b.id = crypto.createHash("sha1").update(JSON.stringify({ ...b, id: undefined })).digest("hex").slice(0, 10);
  return { brief: b, mode, problems };
}
