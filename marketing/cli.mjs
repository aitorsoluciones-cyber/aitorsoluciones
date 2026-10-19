#!/usr/bin/env node
// Marketing autonomo de Aitor Soluciones. Uso: npm run mk -- <comando> [opciones]   (ver marketing/README.md)
import fs from "node:fs";
import path from "node:path";
import { REPO, MK_DIR, config, home } from "./lib/paths.mjs";
import { load, save } from "./lib/store.mjs";
import { STATES } from "./lib/states.mjs";
import { ingestDir, ingestManifest, importWebCases, linkOriginals, pendingDownloads, receiveFiles, itemsFromDir } from "./lib/ingest.mjs";
import { publishMedia, pruneMedia, baseUrl, verifyUrl } from "./lib/media-host.mjs";
import { workQueue, workDone, workFail } from "./lib/work.mjs";
import { runAutomation } from "./lib/automation.mjs";
import { listJobs, reviewJob, setJobStatus } from "./lib/jobs.mjs";
import { loadBank, approveTopic, isApproved } from "./lib/evergreen.mjs";
import { plan, bufferStatus, cancelPiece } from "./lib/planner.mjs";
import { buildQueue, markPublished, queueSummary } from "./lib/publish.mjs";
import { publishQueue, channelStatus } from "./lib/adapters.mjs";
import { addMetric, importCsv, recordResult, summary as reportSummary, METRICS } from "./lib/report.mjs";
import { exportAll, drivePlan } from "./lib/exporter.mjs";
import { proposeCase } from "./lib/web.mjs";
import { runQa } from "./lib/qa.mjs";
import { runBrief, runBriefQueue, loadEnvFile, attachToPiece, approveAsset, runForPiece, readEnv, estimateCost, spentThisMonth, BriefError } from "./lib/visual/index.mjs";

function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2), next = argv[i + 1];
      const v = next === undefined || next.startsWith("--") ? true : (i++, next);
      flags[k] = k in flags ? [].concat(flags[k], v) : v;
    } else pos.push(a);
  }
  return { pos, flags };
}
const today = (f) => (typeof f.today === "string" ? f.today : new Date().toISOString().slice(0, 10));
const list = (v) => (v === undefined ? [] : [].concat(v));
const out = (s = "") => console.log(s);

const COMMANDS = {
  async init() {
    fs.mkdirSync(home(), { recursive: true });
    const r = await importWebCases({ repo: REPO });
    out(`Estado en ${home()}`);
    out(`Casos reales de la web importados al banco: ${r.added.length}`);
  },

  async ingest({ pos, flags }) {
    const log = (m) => out(m);
    let s;
    if (flags.manifest) s = ingestManifest(JSON.parse(fs.readFileSync(flags.manifest, "utf8")));
    else {
      const dir = pos[0] || config().inbox.localMirror;
      if (!dir) throw new Error("Indica la carpeta: ingest <carpeta> (espejo local de 00_NUEVOS_TRABAJOS o archivo historico) o --manifest <json>");
      s = await ingestDir(path.resolve(dir), { origin: flags.origin || "upload", log: flags.verbose ? log : () => {} });
    }
    out(`Ficheros: ${s.files} · nuevos: ${s.added} · duplicados exactos: ${s.duplicates.length} · similares: ${(s.similar || []).length} · trabajos nuevos: ${s.newJobs.length}`);
    for (const j of s.newJobs) out(`  NUEVO ${j}`);
    for (const d of s.duplicates.slice(0, 10)) out(`  duplicado ${path.basename(d.file)} = ${d.of}`);
    for (const e of s.errors || []) out(`  ERROR ${e.file}: ${e.error}`);
    out("Siguiente: npm run mk -- jobs --status NEW  (revisar y confirmar servicio/localidad)");
  },

  "link-originals"({ flags }) {
    const pairs = linkOriginals({ apply: !!flags.apply });
    pairs.forEach((p) => out(`${p.originalName} -> ${p.webName} (distancia ${p.distance})`));
    out(pairs.length ? (flags.apply ? "Aplicado: las fotos de la web usan ahora el original de alta resolucion" : "Revisa las parejas a ojo y repite con --apply") : "Sin parejas");
  },

  jobs({ flags }) {
    for (const j of listJobs({ status: flags.status })) {
      const photos = j.assets.filter((a) => a.kind === "image"), vids = j.assets.length - photos.length;
      out(`${j.id}  ${j.status.padEnd(9)} ${(j.title || j.key).slice(0, 44).padEnd(44)} svc=${j.serviceId || "?"} loc=${j.locationConfirmed ? j.locationId : (j.locationCandidate ? j.locationCandidate + "?" : "-")} fotos=${photos.length} (antes ${photos.filter((a) => a.role === "before").length}/despues ${photos.filter((a) => a.role === "after").length}) videos=${vids}`);
    }
  },

  review({ pos, flags }) {
    const roles = Object.fromEntries(list(flags.role).map((r) => r.split("=")));
    const j = reviewJob(pos[0], { title: flags.title, notes: flags.notes, serviceId: flags.service, locationId: flags.location, confirmLocation: !!flags["confirm-location"], status: flags.status, note: flags.note, roles });
    out(`${j.id} -> ${j.status} · localidad ${j.locationConfirmed ? "confirmada: " + j.locationId : "NO confirmada"}`);
  },

  reject({ pos }) { out(`${setJobStatus(pos[0], "REJECTED").status}`); },
  archive({ pos }) { out(`${setJobStatus(pos[0], "ARCHIVED").status}`); },

  evergreen({ pos }) {
    const [sub, id] = pos;
    if (sub === "approve") { approveTopic(id); return out(`Tema ${id} aprobado`); }
    const approvals = load("approvals");
    for (const t of loadBank()) out(`${isApproved(t, approvals) ? "OK " : "PEND"} ${t.id.padEnd(30)} ${t.category.padEnd(20)} meses=${t.months ? t.months.join(",") : "todos"} enfoques=${t.angles.map((a) => a.id).join("/")}`);
  },

  plan({ flags }) {
    const r = plan({ today: today(flags), weeks: Number(flags.weeks) || undefined, dryRun: !!flags["dry-run"], allowReuse: !!flags["allow-reuse"] });
    for (const p of r.created) out(`  ${p.scheduledFor} ${p.time}  ${p.kind.padEnd(9)} ${(p.topicId || p.jobId).padEnd(28)} [${p.angle}] ${p.channels.join("+")}  plantilla=${p.template}`);
    out(`Colchon: ${r.after.weeksCovered}/${r.after.weeks} semanas · huecos libres: ${r.after.missing.length}${flags["dry-run"] ? " (simulacion, nada guardado)" : ""}`);
    if (r.shortages.length) out(`SIN MATERIAL SEGURO para: ${r.shortages.join(", ")} -> ampliar marketing/bank/evergreen.json o subir trabajos nuevos`);
  },

  cancel({ pos }) { out(`${cancelPiece(pos[0]).id} cancelada; hueco y registro de uso liberados`); },

  async queue({ flags }) {
    const q = await buildQueue({ today: today(flags), ahead: Number(flags.ahead) || 3, rebuild: !!flags.rebuild, log: out });
    out(`En cola READY_TO_PUBLISH: ${q.length} publicaciones nuevas (${queueSummary().length} en total)`);
  },

  published({ pos }) { const p = markPublished(pos[0], pos[1], pos[2]); out(`${p.id} ${pos[1]} publicada · estado pieza: ${p.status}`); },

  async publish({ flags }) {
    const r = await publishQueue({ dryRun: !flags.live, log: out });
    for (const x of r) out(`  ${x.name}: ${x.action}${x.reason ? " (" + x.reason + ")" : ""}${x.url ? " " + x.url : ""}${x.error ? " ERROR " + x.error : ""}`);
  },

  report({ pos, flags }) {
    const [sub] = pos;
    if (sub === "add") { addMetric({ period: flags.period, metric: flags.metric, value: flags.value, source: flags.source, note: flags.note }); return out("registrada"); }
    if (sub === "import") return out(`${importCsv(fs.readFileSync(flags.file, "utf8"))} filas importadas`);
    if (sub === "result") { recordResult(pos[1], { reach: flags.reach, clicks: flags.clicks, note: flags.note }); return out("resultado registrado"); }
    if (sub === "metrics") return Object.entries(METRICS).forEach(([k, v]) => out(`${k.padEnd(18)} ${v}`));
    const s = reportSummary({ today: today(flags), weeks: Number(flags.weeks) || 4 });
    out(`Ventana ${s.window.from} .. ${s.window.to}`);
    for (const [m, v] of Object.entries(s.metrics)) out(`  ${m.padEnd(18)} ${String(v.now).padStart(6)}  (antes ${v.before}, ${v.delta >= 0 ? "+" : ""}${v.delta})`);
    out(`Publicaciones en la ventana: ${s.publications.inWindow} (trabajos ${s.publications.byKind.work}, evergreen ${s.publications.byKind.evergreen}) · alcance registrado: ${s.reach}`);
  },

  async web({ pos, flags }) {
    if (pos[0] !== "propose-case") throw new Error("Uso: web propose-case <jobId> [--slug x] [--page --problem '...'] [--related a,b] [--featured] [--dry-run] [--no-push]");
    const pairs = list(flags["gallery-pair"]).map((p) => p.split(":"));
    const r = await proposeCase(pos[1], { slug: flags.slug, hasPage: !!flags.page, problem: flags.problem, conditions: flags.conditions, related: flags.related ? String(flags.related).split(",") : [], featured: !!flags.featured, galleryPairs: pairs, dryRun: !!flags["dry-run"], noPush: !!flags["no-push"], log: out });
    out(`Rama ${r.branch} · archivos: ${r.files.length}${r.pr ? "\nPR: " + r.pr : ""}`);
    if (flags["dry-run"]) out("dry-run: cambios SIN commitear en la rama; revisa y luego 'git checkout main && git branch -D " + r.branch + "' o repite sin --dry-run");
  },

  // Motor visual (OpenAI Images API). Clave y modelo SOLO por entorno: OPENAI_API_KEY, OPENAI_IMAGE_MODEL.
  async visual({ pos, flags }) {
    loadEnvFile();
    const [sub, arg] = pos;
    const ctx = { dryRun: !!flags["dry-run"], noCritic: !!flags["no-critic"], log: out };
    const show = (r) => {
      if (r.dryRun) { out(`DRY-RUN brief ${r.briefId} · modo ${r.mode} · modelo ${r.model || "(sin definir)"} · tamano ${r.size ? r.size.join("x") : "-"} · ${r.plan?.variants ?? 0} variantes · coste estimado ${r.plan?.costUsd ?? 0} $`); (r.prompts || []).forEach((p, i) => out(`--- prompt variante ${i + 1} ---\n${p}`)); return; }
      out(`${r.ok ? "OK" : "FALLO"} brief ${r.briefId} · ${r.mode}${r.operation ? "/" + r.operation : ""} · coste ${r.costUsd ?? 0} $${r.error ? " · " + r.error : ""}`);
      for (const [k, v] of Object.entries(r.outputs || {})) out(`  ${k}: ${Array.isArray(v) ? v.length + " diapositivas" : v}`);
      out(`  IA: ${r.aiGenerated ? "si" : "no"}${r.disclosure ? ` · etiqueta "${r.disclosure}" dentro de la imagen` : " · sin etiqueta"} · revision ${r.selected?.critic ? "critico visual (nota " + r.selected.critic.score + ")" : "solo programatica"} · autoPublish ${r.autoPublish}`);
      for (const d of r.discarded || []) out(`  descartada: ${path.basename(d.file)} (${d.reasons.join("; ")})`);
      if (!r.ok) process.exitCode = 2;
    };
    try {
      if (sub === "env") {
        const have = (k) => (process.env[k] ? "definida" : "NO definida");
        out(`OPENAI_API_KEY ${have("OPENAI_API_KEY")} · OPENAI_IMAGE_MODEL ${process.env.OPENAI_IMAGE_MODEL || "NO definida"} · OPENAI_VISION_MODEL ${process.env.OPENAI_VISION_MODEL || "no definida (solo puntuacion por pixeles)"}`);
        const b = config().imageEngine;
        return out(`Gasto este mes: ${spentThisMonth().toFixed(2)} $ de ${b.monthlyBudgetUsd} $ (maximo por brief ${b.perBriefBudgetUsd} $)`);
      }
      if (sub === "cost" && !arg) { const b = config().imageEngine; return out(`Gasto este mes: ${spentThisMonth().toFixed(4)} $ de ${b.monthlyBudgetUsd} $ (maximo por brief ${b.perBriefBudgetUsd} $)`); }
      if (sub === "approve") { const a = approveAsset(arg, flags.by || "humano"); return out(`${a.id}: aprobado para autoPublish`); }
      const over = { ...(flags.quality ? { quality: flags.quality } : {}), ...(flags.variants ? { variants: Number(flags.variants) } : {}) };
      if (sub === "for-piece") return show(await runForPiece(arg, over, ctx));
      if (sub === "run" || sub === "cost") return show(await runBrief({ ...JSON.parse(fs.readFileSync(arg, "utf8")), ...over }, { ...ctx, dryRun: ctx.dryRun || sub === "cost" }));
      if (sub === "batch") { for (const r of await runBriefQueue(ctx)) out(`${r.ok ? "OK   " : "FALLO"} ${r.brief} ${r.error || ""}`); return; }
      if (sub === "attach") { const p = attachToPiece(arg, pos.slice(2)); return out(`${p.id}: imagen adjunta (${Object.keys(p.visual.formats).join(", ") || "sin formatos"})`); }
      if (sub === "estimate") { const [w, h] = String(arg).split("x").map(Number); return out(`${estimateCost({ quality: flags.quality || "medium", width: w, height: h, n: Number(flags.n) || 1 })} $`); }
      throw new Error("Uso: visual env | run <brief.json> [--dry-run] [--no-critic] | cost <brief.json> | batch | attach <pieceId> <assetId..> | for-piece <pieceId> [--quality low --variants 2] | approve <assetId> | estimate WxH --quality q");
    } catch (e) {
      if (e instanceof BriefError) { out("ERROR " + e.message); process.exitCode = 1; } else throw e;
    }
  },

  async qa({ flags }) {
    const r = await runQa({ today: today(flags), web: !!flags.web, urls: flags.urls ? String(flags.urls).split(",").map((u) => "/" + u.replace(/^.*?\/Git\//, "").replace(/^\//, "")) : undefined, lighthouse: !flags["no-lighthouse"], log: out });
    for (const w of r.warnings) out("aviso  " + w);
    for (const e of r.errors) out("ERROR  " + e);
    out(`QA: ${r.errors.length} errores · ${r.warnings.length} avisos`);
    if (!r.ok) process.exitCode = 1;
  },

  export() { for (const f of exportAll()) out(f); },
  "drive-plan"() { const a = drivePlan(); a.forEach((x) => out(`mover ${x.name} (${x.driveId}) -> ${x.moveTo}`)); if (!a.length) out("Nada que mover"); },

  status({ flags }) {
    const t = today(flags);
    const count = (name) => Object.fromEntries(STATES.map((s) => [s, load(name).filter((x) => x.status === s).length]).filter(([, n]) => n));
    out(`Material:  ${JSON.stringify(count("assets"))}`);
    out(`Trabajos:  ${JSON.stringify(count("jobs"))}`);
    out(`Piezas:    ${JSON.stringify(count("pieces"))}`);
    const b = bufferStatus(t);
    out(`Colchon:   ${b.weeksCovered}/${b.weeks} semanas · huecos libres ${b.missing.length}${b.ok ? "" : "  <- ejecutar: npm run mk -- plan"}`);
    out(`Cola:      ${queueSummary().length} publicaciones READY_TO_PUBLISH`);
    for (const [ch, s] of Object.entries(channelStatus())) out(`Canal ${ch.padEnd(9)} ${s.live ? "publicacion automatica ACTIVA" : "cola manual (faltan: " + s.missing.join(", ") + ")"}`);
  },

  // Rutina semanal: lunes/miercoles/viernes (ver config.cadence).
  // URLs HTTPS publicas de la cola (Instagram y Google Business las exigen). Rama huerfana 'media' del repo; sin secretos.
  async media({ pos, flags }) {
    const [sub] = pos;
    if (sub === "publish") {
      const r = await publishMedia({ today: today(flags), ahead: flags.ahead !== undefined ? Number(flags.ahead) : 3, log: out, verify: !flags["no-verify"] });
      out(`URLs publicas: ${r.published.length} piezas OK${r.failed.length ? ` · ${r.failed.length} CON ERROR` : ""} · base ${r.base || "-"}${r.commit ? " · commit " + r.commit : ""}`);
      for (const p of r.published) out(`  ${p.name}\n    ${p.urls.files.join("\n    ")}`);
      for (const x of r.failed) { out(`  ERROR ${x.name}: ${x.errors.map((e) => e.url + " -> " + e.error).join("; ")}`); process.exitCode = 1; }
      return;
    }
    if (sub === "prune") { const r = pruneMedia({ today: today(flags), days: flags.days ? Number(flags.days) : undefined, squash: !!flags.squash, log: out }); return out(`Retiradas ${r.removed.length} piezas anteriores a ${r.cutoff}${flags.squash ? " (rama compactada)" : ""}`); }
    if (sub === "url") return out(baseUrl());
    throw new Error("Uso: media publish [--ahead N] [--no-verify] | prune [--days N] [--squash] | url");
  },

  // Interfaz de Work: lee la cola con sus conectores y confirma la publicacion.
  work({ pos, flags }) {
    const [sub] = pos;
    if (!sub || sub === "next") {
      const items = workQueue({ today: today(flags), ahead: flags.ahead !== undefined ? Number(flags.ahead) : undefined }).filter((i) => (flags.all ? true : i.ready || flags.blocked));
      if (flags.human) { for (const i of items) out(`${i.scheduledFor} ${i.time || ""} ${i.channel.padEnd(9)} ${i.pieceId} ${i.ready ? "LISTA" : "BLOQUEADA: " + i.blockedBy.join("; ")}`); if (!items.length) out("Nada que publicar"); return; }
      return out(JSON.stringify({ today: today(flags), items }, null, 2));
    }
    if (sub === "done") { const p = workDone(pos[1], pos[2], pos[3]); return out(`${p.id} ${pos[2]} publicada · estado pieza: ${p.status}`); }
    if (sub === "fail") { workFail(pos[1], pos[2], pos.slice(3).join(" ")); return out("error registrado; la pieza sigue en READY_TO_PUBLISH"); }
    throw new Error("Uso: work next [--human] [--all] [--ahead N] | done <pieceId> <canal> <url> | fail <pieceId> <canal> <motivo>");
  },

  // Drive -> pipeline sin descarga manual: Work descarga (raw/streaming) y entrega el fichero local.
  async drive({ pos, flags }) {
    const [sub, arg] = pos;
    if (sub === "pending") { const p = pendingDownloads(); return out(flags.human ? p.map((x) => `${x.driveId} ${x.name} ${x.bytes || "?"} B`).join("\n") || "Nada pendiente de descargar" : JSON.stringify(p, null, 2)); }
    if (sub === "receive") {
      if (!arg) throw new Error("Uso: drive receive <fichero|carpeta> [--drive-id ID] [--name N] [--path \"00_NUEVOS_TRABAJOS/Trabajo/IMG.HEIC\"] [--map mapa.json] [--move]");
      const full = path.resolve(arg);
      const map = flags.map ? JSON.parse(fs.readFileSync(flags.map, "utf8")) : [];
      const items = fs.statSync(full).isDirectory() ? itemsFromDir(full, map) : [{ file: full, driveId: flags["drive-id"], name: flags.name, path: flags.path, md5: flags.md5 }];
      const r = await receiveFiles(items, { move: !!flags.move, log: out });
      out(`Recibidos ${r.received} · enlazados ${r.attached} (nuevos registros ${r.created}) · duplicados ${r.duplicates.length} · errores ${r.errors.length}`);
      for (const e of r.errors) { out(`  ERROR ${e.file}: ${e.error}`); process.exitCode = 1; }
      return;
    }
    throw new Error("Uso: drive pending [--human] | receive <fichero|carpeta> [...]");
  },

  // Ciclo automatico (lo que lanzan las tareas programadas). No publica en plataformas.
  async auto({ pos, flags }) {
    const [sub = "run"] = pos;
    if (sub !== "run") throw new Error("Uso: auto run [--quality low] [--no-visuals] [--no-media] [--prune] [--dry-run]");
    const r = await runAutomation({ today: today(flags), quality: flags.quality, visuals: !flags["no-visuals"], media: !flags["no-media"], prune: !!flags.prune, dryRun: !!flags["dry-run"], log: out });
    for (const w of r.warnings) out("aviso  " + w);
    for (const e of r.errors) out("ERROR  " + e);
    out(`Ciclo ${r.ok ? "OK" : "CON ERRORES"} · publicables por Work hoy: ${r.work.filter((x) => x.ready).length}`);
    if (!r.ok) process.exitCode = 1;
  },

  // Prueba E2E: material/banco -> brief -> OpenAI Images -> seleccion -> composicion -> critico -> QA -> URL publica -> READY_TO_PUBLISH.
  async e2e({ flags }) {
    const t = today(flags);
    plan({ today: t });
    const pieces = load("pieces");
    const piece = flags.piece ? pieces.find((p) => p.id === flags.piece) : pieces.filter((p) => p.status === "SCHEDULED" && p.kind === "evergreen" && !p.visual && p.channels.includes("instagram")).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
    if (!piece) throw new Error("No hay pieza evergreen programada sin imagen");
    const days = Math.max(0, Math.round((new Date(piece.scheduledFor) - new Date(t)) / 86400000));
    out(`E2E con ${piece.id} (${piece.scheduledFor}, ${piece.channels.join("+")}) · tema ${piece.topicId}`);
    const r = await runAutomation({ today: t, pieceId: piece.id, quality: flags.quality || "low", ahead: days, prune: false, log: out });
    const after = load("pieces").find((p) => p.id === piece.id);
    const work = r.work.filter((w) => w.pieceId === piece.id);
    for (const w of r.warnings) out("aviso  " + w);
    for (const e of r.errors) out("ERROR  " + e);
    out(JSON.stringify({ piece: piece.id, visual: after.visual || null, readyToPublish: after.channelStatus || {}, work: work.map((w) => ({ channel: w.channel, ready: w.ready, blockedBy: w.blockedBy, imageUrls: w.imageUrls, extraUrls: w.extraUrls, tools: w.actions.map((a) => a.tool) })) }, null, 2));
    if (!r.ok) process.exitCode = 1;
  },

  async week({ flags }) {
    const t = today(flags);
    const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(t + "T00:00:00Z").getUTCDay()];
    const slot = config().cadence.slots.find((s) => s.day === (flags.day || day));
    out(`== ${t} (${flags.day || day}) · ${slot ? slot.role : "sin tarea programada"}`);
    const qa = await runQa({ today: t });
    qa.errors.forEach((e) => out("ERROR  " + e));
    const r = plan({ today: t });
    out(`Planificador: +${r.created.length} piezas · colchon ${r.after.weeksCovered}/${r.after.weeks} semanas`);
    if (slot && slot.channels.length || flags.day === "fri") { const q = await buildQueue({ today: t, ahead: 2, log: out }); out(`Cola: ${q.length} nuevas, ${queueSummary().length} pendientes de publicar`); }
    COMMANDS.status({ flags });
  }
};

const { pos, flags } = parse(process.argv.slice(2));
const cmd = pos.shift();
if (!cmd || !COMMANDS[cmd]) {
  out("Comandos: " + Object.keys(COMMANDS).join(", ") + "\nVer marketing/README.md");
  process.exit(cmd ? 1 : 0);
}
try { await COMMANDS[cmd]({ pos, flags }); } catch (e) { console.error("ERROR: " + e.message); process.exit(1); }
