// Ciclo automatico (lo que ejecutan las tareas programadas): ingesta -> plan -> imagenes -> QA -> cola -> URLs publicas -> cola para Work.
// Idempotente: se puede lanzar varias veces; no publica en plataformas (eso lo hace Work con sus conectores) ni toca main.
import { config } from "./paths.mjs";
import { load } from "./store.mjs";
import { ingestDir } from "./ingest.mjs";
import { plan } from "./planner.mjs";
import { runQa } from "./qa.mjs";
import { buildQueue } from "./publish.mjs";
import { publishMedia, pruneMedia } from "./media-host.mjs";
import { workQueue } from "./work.mjs";
import { runForPiece, loadEnvFile } from "./visual/index.mjs";
import { visualStateOf, recordVisualAttempt, VISUAL } from "./visual-state.mjs";
import { cleanup } from "./cleanup.mjs";

const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

// opts: { today, pieceId?, quality?, visuals?, media?, prune?, ahead?, dryRun?, log, fetchImpl? }
export async function runAutomation(opts = {}) {
  const log = opts.log || (() => {});
  const today = opts.today;
  const cfg = config();
  const auto = cfg.imageEngine.auto || {};
  const report = { today, steps: [], errors: [], warnings: [] };
  const step = (name, data) => { report.steps.push({ step: name, ...data }); log(`[${name}] ${data.summary || ""}`); };
  loadEnvFile();

  // 1. ingesta del espejo local de Drive (Work deja ahi lo que descarga) si esta configurado
  if (cfg.inbox.localMirror) {
    try { const s = await ingestDir(cfg.inbox.localMirror, { origin: "drive" }); step("ingesta", { summary: `${s.files} ficheros, ${s.added} nuevos, ${s.newJobs.length} trabajos NEW`, added: s.added }); }
    catch (e) { report.errors.push("ingesta: " + e.message); }
  } else step("ingesta", { summary: "sin carpeta local configurada (Work usa `mk drive receive`)", skipped: true });

  // 2. planificador (colchon >= minBufferWeeks)
  const p = plan({ today, dryRun: !!opts.dryRun });
  step("plan", { summary: `+${p.created.length} piezas · colchon ${p.after.weeksCovered}/${p.after.weeks} semanas`, created: p.created.length, shortages: p.shortages });
  if (p.shortages.length) report.warnings.push("sin material seguro para: " + p.shortages.join(", "));

  // 3. imagenes de las piezas evergreen proximas que aun no tienen (motor visual)
  if (opts.visuals !== false && auto.enabled !== false) {
    const horizon = addDays(today, auto.aheadDays ?? 7);
    const assetsNow = load("assets");
    const due = load("pieces").filter((x) => x.status === "SCHEDULED" && x.kind === "evergreen" && ![VISUAL.APPROVED, VISUAL.MANUAL].includes(visualStateOf(x, assetsNow)) && (x.visualState !== VISUAL.REJECTED || opts.retry) && (opts.pieceId ? x.id === opts.pieceId : x.scheduledFor <= horizon) && x.channels.some((c) => ["instagram", "facebook", "gbp"].includes(c)));
    const results = [];
    for (const piece of due.slice(0, opts.pieceId ? 1 : auto.maxPerRun ?? 2)) {
      if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_IMAGE_MODEL) { report.warnings.push("imagenes omitidas: falta OPENAI_API_KEY u OPENAI_IMAGE_MODEL"); break; }
      try {
        const r = await runForPiece(piece.id, { quality: opts.quality || auto.quality || "medium", variants: auto.variants || 2 }, { dryRun: !!opts.dryRun, log, fetchImpl: opts.fetchImpl, now: opts.now });
        results.push({ pieceId: piece.id, ok: r.ok, costUsd: r.costUsd, autoPublish: r.autoPublish, outputs: r.outputs, error: r.error });
        if (!opts.dryRun) {
          const after = recordVisualAttempt(piece.id, { ok: r.ok, reason: r.ok ? (r.autoPublish ? null : "sin critico: pendiente de aprobacion humana") : r.error, costUsd: r.costUsd });
          if (after.visualState === VISUAL.REJECTED) report.warnings.push(`${piece.id}: visual REJECTED tras ${after.visualAttempts.length} intentos; NO se publica (mk visual retry ${piece.id})`);
          else if (after.visualState !== VISUAL.APPROVED) report.warnings.push(`${piece.id}: VISUAL_PENDING (${r.ok ? "falta aprobacion humana" : r.error}); se reintentara en la proxima ejecucion; NO se publica con plantillas antiguas`);
        }
      } catch (e) {
        if (e.constructor?.name === "ConfigError") { report.warnings.push(`${piece.id}: ${e.message}`); break; }
        const after = opts.dryRun ? null : recordVisualAttempt(piece.id, { ok: false, reason: e.message });
        report.warnings.push(`${piece.id}: error generando la imagen (${e.message}); ` + (after?.visualState === VISUAL.REJECTED ? `visual REJECTED tras ${after.visualAttempts.length} intentos; NO se publica (mk visual retry ${piece.id})` : "VISUAL_PENDING; NO se publica con plantillas antiguas"));
      }
    }
    step("imagenes", { summary: `${results.filter((r) => r.ok).length}/${due.length} generadas`, results });
  }

  // 4. QA
  const qa = await runQa({ today });
  report.errors.push(...qa.errors);
  step("qa", { summary: `${qa.errors.length} errores · ${qa.warnings.length} avisos`, warnings: qa.warnings });

  // 5. cola READY_TO_PUBLISH
  const ahead = opts.ahead ?? 2;
  if (!qa.errors.length) {
    const q = await buildQueue({ today, ahead, rebuild: !!opts.rebuild });
    step("cola", { summary: `${q.length} publicaciones nuevas en READY_TO_PUBLISH`, queued: q.length });
  } else report.warnings.push("cola no generada: corrige los errores de QA");

  // 6. URLs publicas
  if (opts.media !== false) {
    try {
      const m = await publishMedia({ today, ahead, fetchImpl: opts.fetchImpl, log });
      step("media", { summary: `${m.published.length} piezas con URL publica verificada${m.failed.length ? ` · ${m.failed.length} con error` : ""}`, base: m.base, failed: m.failed });
      for (const f of m.failed) report.errors.push(`media ${f.name}: ${f.errors.map((e) => e.error).join("; ")}`);
    } catch (e) { report.errors.push("media: " + e.message); }
  }

  // 7. limpieza semanal de URLs antiguas
  if (opts.prune) { try { const r = await cleanup({ apply: true, today, media: opts.media !== false, log }); step("limpieza", { summary: `${r.deleted.files} ficheros y ${r.deleted.mediaDirs} piezas de media retirados; ${r.orphans.length} activos huerfanos`, report: r.counts }); } catch (e) { report.warnings.push("limpieza: " + e.message); } }

  // 8. lo que Work debe publicar hoy
  report.work = workQueue({ today });
  step("work", { summary: `${report.work.filter((w) => w.ready).length} listas para publicar por Work, ${report.work.filter((w) => !w.ready).length} bloqueadas` });
  report.ok = report.errors.length === 0;
  return report;
}
