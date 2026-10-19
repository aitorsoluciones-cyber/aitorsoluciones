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

test("web: anadir un caso conserva el formato y el contenido previo de workCases.json", async () => {
  const { appendCaseText } = await import("../lib/web.mjs");
  const repo = path.resolve(import.meta.dirname, "..", "..");
  const text = fs.readFileSync(path.join(repo, "src/_data/workCases.json"), "utf8");
  const out = appendCaseText(text, { id: "x", slug: "x", hasPage: false, status: "active", title: "T", serviceId: "desbroce-parcelas", locationId: "alcanar", before: "x-antes", after: "x-despues", whatWeDid: "ok", relatedServiceIds: ["a", "b"], gallery: [{ before: "g1", after: "g2" }] });
  const parsed = JSON.parse(out.replace(/^\uFEFF/, ""));
  const prev = JSON.parse(text.replace(/^\uFEFF/, ""));
  assert.equal(parsed.length, prev.length + 1);
  assert.deepEqual(parsed.slice(0, prev.length), prev);
  assert.ok(out.startsWith(text.slice(0, text.lastIndexOf("]")).trimEnd()), "el texto anterior no cambia");
});

test("originales de alta resolucion: se emparejan por huella y proporcion y solo se aplican bajo demanda", async () => {
  const { save, load } = await import("../lib/store.mjs");
  const { linkOriginals } = await import("../lib/ingest.mjs");
  save("assets", [
    { id: "web1", kind: "image", source: "web", ahash: "ffff0000ffff0000", width: 800, height: 1067, sourcePath: "/w.webp", status: "READY" },
    { id: "hi1", kind: "image", source: "archive", ahash: "ffff0000ffff0001", width: 3024, height: 4032, sourcePath: "/o.heic", nearDuplicateOf: "web1", status: "NEW" },
    { id: "web2", kind: "image", source: "web", ahash: "00ff00ff00ff00ff", width: 800, height: 1067, sourcePath: "/w2.webp", status: "READY" },
    { id: "hi2", kind: "image", source: "archive", ahash: "00ff00ff00ff00fe", width: 4032, height: 3024, sourcePath: "/o2.heic", nearDuplicateOf: "web2", status: "NEW" }
  ]);
  const pairs = linkOriginals({});
  assert.deepEqual(pairs.map((p) => p.web), ["web1"], "la de otra proporcion no se empareja");
  assert.equal(load("assets").find((a) => a.id === "web1").sourcePath, "/w.webp");
  linkOriginals({ apply: true });
  const a = load("assets");
  assert.equal(a.find((x) => x.id === "web1").sourcePath, "/o.heic");
  assert.equal(a.find((x) => x.id === "web1").quality, "original");
  assert.equal(a.find((x) => x.id === "hi1").status, "ARCHIVED");
});
