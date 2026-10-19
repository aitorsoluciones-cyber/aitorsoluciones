import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpHome } from "./helpers.mjs";

let dir;
before(() => { dir = tmpHome(); });

test("informes: solo metricas utiles, validacion, importacion CSV y comparativa", async () => {
  const { addMetric, importCsv, summary, METRICS } = await import("../lib/report.mjs");
  assert.deepEqual(Object.keys(METRICS), ["leads", "whatsapp_clicks", "phone_clicks", "form_submissions", "gsc_clicks", "gsc_impressions", "gbp_views", "gbp_calls", "gbp_directions", "social_reach"]);
  assert.throws(() => addMetric({ period: "2026-10-12", metric: "likes", value: 5 }), /no admitida/);
  assert.throws(() => addMetric({ period: "ayer", metric: "leads", value: 5 }), /period/);
  assert.throws(() => addMetric({ period: "2026-10-12", metric: "leads", value: -1 }), /numero/);
  addMetric({ period: "2026-10-12", metric: "leads", value: 3, source: "ga4" });
  addMetric({ period: "2026-10-12", metric: "leads", value: 4, source: "ga4" }); // actualiza, no duplica
  assert.equal(importCsv("period,metric,value,source\n2026-09-21,leads,2,ga4\n2026-10-19,whatsapp_clicks,9,ga4"), 2);
  const s = summary({ today: "2026-10-25", weeks: 4 });
  assert.equal(s.metrics.leads.now, 4);
  assert.equal(s.metrics.leads.before, 2);
  assert.equal(s.metrics.leads.delta, 2);
  assert.equal(s.metrics.whatsapp_clicks.now, 9);
});

test("web: un caso nuevo se valida contra los datos reales del sitio", async () => {
  const { validateCase, buildCaseEntry, slugify } = await import("../lib/web.mjs");
  const existing = [{ id: "finca-recuperada-la-rapita", slug: "finca-recuperada-la-rapita", title: "Finca recuperada en La Ràpita" }];
  const job = { title: "Parcela despejada en Alcanar", serviceId: "desbroce-parcelas", locationId: "alcanar", notes: "Desbroce completo y despeje de accesos de la parcela." };
  const entry = buildCaseEntry(job, {});
  assert.equal(entry.slug, "parcela-despejada-en-alcanar");
  assert.deepEqual(validateCase(entry, { existing, hasPage: false }), []);
  assert.ok(validateCase({ ...entry, slug: "finca-recuperada-la-rapita", id: "finca-recuperada-la-rapita" }, { existing, hasPage: false }).some((p) => /ya existe/.test(p)));
  assert.ok(validateCase({ ...entry, locationId: "atlantida" }, { existing, hasPage: false }).some((p) => /localidad inexistente/.test(p)));
  assert.ok(validateCase({ ...entry, serviceId: "pladur-pequenas-reformas" }, { existing, hasPage: false }).some((p) => /no activo/.test(p)));
  assert.ok(validateCase(entry, { existing, hasPage: true }).some((p) => /paginas finas|problem/.test(p)));
  const page = buildCaseEntry(job, { hasPage: true, problem: "Parcela con maleza alta y accesos cerrados que llevaba tiempo sin mantenerse." });
  assert.deepEqual(validateCase(page, { existing, hasPage: true }), []);
  assert.equal(slugify("Jardín con olivos, Alcanar!"), "jardin-con-olivos-alcanar");
});

test("web: los datos reales del sitio superan la comprobacion (imagenes, imageMeta, localidades)", async () => {
  const { checkWebData } = await import("../lib/qa.mjs");
  assert.deepEqual(checkWebData(), []);
});

test("QA: banco evergreen valido y estado limpio sin errores", async () => {
  const { checkBank, checkState } = await import("../lib/qa.mjs");
  assert.deepEqual(checkBank(), []);
  const st = await checkState({ today: "2026-10-19" });
  assert.ok(st.errors.every((e) => /colchon/.test(e)), JSON.stringify(st.errors));
});

test("QA: detecta duplicados, localidades inventadas, ficheros inexistentes y huecos repetidos", async () => {
  const { save } = await import("../lib/store.mjs");
  const { checkState } = await import("../lib/qa.mjs");
  save("jobs", [{ id: "j1", status: "READY", locationId: "atlantida", locationConfirmed: true, history: [] }]);
  save("assets", [
    { id: "a1", sha256: "x".repeat(64), origin: "real", status: "READY", jobId: "j1", sourcePath: path.join(dir, "no-existe.jpg") },
    { id: "a2", sha256: "x".repeat(64), origin: "real", status: "READY", jobId: "j1", needsDownload: true },
    { id: "a3", sha256: "y".repeat(64), origin: "ficticio", status: "READY", jobId: "j1", needsDownload: true }
  ]);
  const { errors } = await checkState({ today: "2026-10-19" });
  const text = errors.join("\n");
  assert.match(text, /duplicado exacto/);
  assert.match(text, /fichero inexistente/);
  assert.match(text, /localidad inventada|inexistente/);
  assert.match(text, /origin debe ser real\|graphic/);
});

test("exportacion CSV y plan de Drive", async () => {
  const { toCsv, exportAll, drivePlan } = await import("../lib/exporter.mjs");
  const { save } = await import("../lib/store.mjs");
  assert.equal(toCsv([{ a: 'x,"y"', b: 1 }], ["a", "b"]), 'a,b\n"x,""y""",1\n');
  save("assets", [{ id: "a1", driveId: "D1", name: "IMG.HEIC", status: "PUBLISHED" }, { id: "a2", driveId: "D2", name: "IMG2.HEIC", status: "NEW" }]);
  const files = exportAll();
  assert.ok(files.length === 5 && files.every((f) => fs.existsSync(f)));
  const plan = drivePlan();
  assert.deepEqual(plan.map((x) => x.moveTo).sort(), ["00_NUEVOS_TRABAJOS", "02_PUBLICADOS"]);
});

test("configuracion: carpetas de Drive, canales y cadencia coherentes", async () => {
  const { config } = await import("../lib/paths.mjs");
  const c = config();
  assert.equal(c.drive.folders.new.name, "00_NUEVOS_TRABAJOS");
  assert.deepEqual(Object.keys(c.drive.stateFolder).sort(), ["ARCHIVED", "NEW", "PUBLISHED", "READY", "REJECTED", "REVIEWED", "SCHEDULED"].sort());
  assert.ok(c.cadence.minBufferWeeks >= 4);
  assert.deepEqual(c.cadence.slots.map((s) => s.day), ["mon", "wed", "fri"]);
});
