// Interfaz para que Work/ChatGPT consuma la cola READY_TO_PUBLISH con sus conectores (Facebook organico, Instagram, Google Business Profile).
// Aqui NO hay credenciales ni llamadas a las plataformas: solo instrucciones listas (que conector, que herramienta, que datos, que URLs HTTPS)
// y la confirmacion posterior (`work done` / `work fail`). Los adaptadores API propios (adapters.mjs) quedan como alternativa, no como requisito.
import { load, save, nowIso, findById } from "./store.mjs";
import { config } from "./paths.mjs";
import { queueSummary, markPublished } from "./publish.mjs";

const SITE = () => `https://${config().brand.web}/`;

// Una publicacion de la cola -> acciones de conector. Los nombres de argumentos son orientativos: Work los adapta al esquema real de su herramienta.
function actionsFor(p, accounts) {
  const cfg = config().work.connectors[p.channel];
  const urls = p.publicUrls?.files || [], extra = p.publicUrls?.extra || [];
  const acc = accounts[p.channel] || {};
  const base = { connector: cfg.app, account: acc, caption: p.caption, alt_text: p.alt };
  if (p.channel === "facebook") return [{ ...base, tool: cfg.single, args: { page_id: acc.page_id, message: p.caption, image_url: urls[0], alt_text: p.alt } }];
  if (p.channel === "instagram") {
    const feed = urls.length > 1
      ? { ...base, tool: cfg.carousel, args: { ig_user_id: acc.ig_user_id, image_urls: urls, caption: p.caption } }
      : { ...base, tool: cfg.single, args: { ig_user_id: acc.ig_user_id, image_url: urls[0], caption: p.caption, alt_text: p.alt } };
    const story = (p.extra || []).map((f, i) => ({ f, url: extra[i] })).filter((x) => /story/i.test(x.f) && x.url);
    return [feed, ...story.map((s) => ({ connector: cfg.app, account: acc, tool: cfg.story, optional: true, args: { ig_user_id: acc.ig_user_id, image_url: s.url } }))];
  }
  if (p.channel === "gbp") return [{ ...base, tool: cfg.single, args: { location: acc.location, summary: p.caption, media_url: urls[0], call_to_action: { type: p.gbp?.callToAction?.actionType, url: SITE() } } }];
  return [];
}

// Publicaciones que Work debe hacer hoy (scheduledFor <= today + ahead). ready=false si aun no hay URLs publicas verificadas.
export function workQueue({ today, ahead = config().work.aheadDays ?? 0 } = {}) {
  const limit = new Date(new Date(today + "T00:00:00Z").getTime() + ahead * 86400000).toISOString().slice(0, 10);
  const accounts = config().work.accounts || {};
  const pieces = load("pieces");
  return queueSummary().filter((p) => p.scheduledFor <= limit).map((p) => {
    const ready = !!p.publicUrls?.files?.length;
    const piece = findById(pieces, p.pieceId);
    const missing = [];
    if (!ready) missing.push("sin URL publica verificada (npm run mk -- media publish)");
    if (p.channel === "instagram" && [...(p.publicUrls?.files || []), ...(p.publicUrls?.extra || [])].some((u) => !/\.jpe?g$/i.test(u))) missing.push("Instagram exige JPEG: reconstruye la cola (npm run mk -- queue --rebuild)");
    const acc = accounts[p.channel] || {};
    if (!Object.values(acc).some(Boolean)) missing.push(`sin cuenta configurada para ${p.channel} (work.accounts en config.local.json)`);
    return {
      id: `${p.pieceId}:${p.channel}`, pieceId: p.pieceId, channel: p.channel, scheduledFor: p.scheduledFor, time: p.time, kind: p.kind,
      ready: missing.length === 0, blockedBy: missing,
      caption: p.caption, alt_text: p.alt, imageUrls: p.publicUrls?.files || [], extraUrls: p.publicUrls?.extra || [],
      aiGenerated: !!piece?.visual?.aiGenerated, actions: missing.length === 0 ? actionsFor(p, accounts) : [],
      confirm: `npm run mk -- work done ${p.pieceId} ${p.channel} <url-de-la-publicacion>`, onError: `npm run mk -- work fail ${p.pieceId} ${p.channel} "<motivo>"`
    };
  });
}

export const workDone = (pieceId, channel, url, date) => markPublished(pieceId, channel, url, date);

export function workFail(pieceId, channel, reason) {
  const pieces = load("pieces");
  const piece = findById(pieces, pieceId);
  if (!piece) throw new Error(`Pieza no encontrada: ${pieceId}`);
  piece.channelErrors = { ...piece.channelErrors, [channel]: { reason: String(reason || "sin motivo"), at: nowIso() } };
  save("pieces", pieces);
  return piece;
}
