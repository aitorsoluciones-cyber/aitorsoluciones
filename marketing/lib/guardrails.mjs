// Guardarrailes: nada falso, nada inventado, nada masivo. Se aplican al texto y a las piezas antes de planificar y de publicar.
import { config } from "./paths.mjs";
import { load, findById } from "./store.mjs";
import { locations, norm } from "./places.mjs";

const PLACE_RE = /\ben ([A-ZÁÉÍÓÚÀÈÒÇ][\wÀ-ÿ'’]+(?: (?:de |del |la |el |les |l'|d')?[A-ZÁÉÍÓÚÀÈÒÇ][\wÀ-ÿ'’]+)*)/g;

// ctx.allowedLocations: nombres de localidades que esta pieza puede mencionar (confirmadas).
export function lintCopy(text, ctx = {}) {
  const cfg = config().guardrails;
  const problems = [];
  for (const p of cfg.forbiddenPatterns) {
    const m = text.match(new RegExp(p, "i"));
    if (m) problems.push(`patron prohibido "${m[0]}"`);
  }
  const known = new Map(locations().map((l) => [norm(l.name), l.name]));
  const allowed = new Set((ctx.allowedLocations || []).map(norm));
  const ignore = new Set(cfg.placeIgnore.map(norm));
  for (const m of text.matchAll(PLACE_RE)) {
    const n = norm(m[1]);
    if (ignore.has(n)) continue;
    if (known.has(n)) { if (!allowed.has(n)) problems.push(`localidad no confirmada para esta pieza: ${m[1]}`); }
    else if (m[1].split(" ").length <= 3) problems.push(`posible localidad no reconocida: ${m[1]}`);
  }
  // cualquier localidad real nombrada sin "en" delante tambien debe estar permitida
  for (const [n, name] of known) {
    if (ignore.has(n)) continue;
    if (new RegExp(`(^| )${n}( |$)`).test(norm(text)) && !allowed.has(n)) problems.push(`localidad no confirmada para esta pieza: ${name}`);
  }
  return [...new Set(problems)];
}

export function lintHashtags(channel, hashtags) {
  const max = config().channels[channel]?.hashtagsMax ?? 0;
  return hashtags.length > max ? [`${channel}: ${hashtags.length} hashtags (max ${max})`] : [];
}

// La pieza es coherente con su origen: los trabajos usan solo fotos reales de su trabajo; lo evergreen solo graficos.
export function lintPiece(piece, { assets = load("assets"), jobs = load("jobs") } = {}) {
  const problems = [];
  const text = [piece.copy?.headline, ...Object.values(piece.copy?.captions || {}), ...(piece.copy?.slides || []).flatMap((s) => [s.t, s.b])].filter(Boolean).join("\n");
  const allowed = [];
  if (piece.kind === "work") {
    if (piece.visual) problems.push("las piezas de trabajo real no admiten imagen generada");
    const job = findById(jobs, piece.jobId);
    if (!job) problems.push("pieza de trabajo sin trabajo asociado");
    else {
      if (job.status === "REJECTED") problems.push("el trabajo fue rechazado");
      if (job.locationConfirmed && job.locationId) allowed.push(locations().find((l) => l.id === job.locationId)?.name);
      const mine = (piece.assetIds || []).map((id) => findById(assets, id));
      if (mine.some((a) => !a)) problems.push("material inexistente en el banco");
      for (const a of mine.filter(Boolean)) {
        if (a.origin !== "real") problems.push(`el material ${a.id} no es fotografia real (${a.origin}); prohibido en trabajos`);
        if (a.jobId !== job.id) problems.push(`el material ${a.id} no pertenece a ese trabajo`);
      }
    }
  } else {
    const ids = [...(piece.assetIds || []), ...(piece.visual?.assetIds || [])];
    for (const id of ids) {
      const a = findById(assets, id);
      if (a && a.origin === "real") problems.push(`pieza ${piece.kind} con foto real ${id}: solo graficos o imagenes generadas (no se presentan fotos como trabajos)`);
    }
    // Transparencia sin deteriorar el marketing: solo la imagen generada que puede parecer una fotografia lleva etiqueta DENTRO de la imagen.
    // Automatizacion completa: la imagen generada debe haber pasado el critico visual (o la aprobacion humana).
    for (const id of ids) {
      const a = findById(assets, id);
      if (!a?.aiGenerated) continue;
      if (a.disclosure && !a.labelApplied) problems.push(`el activo ${id} necesita la etiqueta "${a.disclosure}" dentro de la imagen`);
      if (config().imageEngine?.critic?.requireForAuto !== false && a.autoPublish === false) problems.push(`el activo ${id} no paso el critico visual: requiere aprobacion humana (mk visual approve ${id})`);
    }
    if (piece.copy?.zones) allowed.push(...piece.copy.zones);
  }
  problems.push(...lintCopy(text, { allowedLocations: allowed.filter(Boolean) }));
  for (const ch of piece.channels || []) {
    const max = config().channels[ch]?.captionMax;
    const cap = piece.copy?.captions?.[ch] || "";
    if (!cap) problems.push(`${ch}: falta texto`);
    if (max && cap.length > max) problems.push(`${ch}: texto de ${cap.length} caracteres (max ${max})`);
    problems.push(...lintHashtags(ch, piece.copy?.hashtagsByChannel?.[ch] || []));
  }
  return problems;
}
