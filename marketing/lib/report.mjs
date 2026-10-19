// Informes: solo metricas utiles. Las de la web salen de GA4 (eventos generate_lead, whatsapp_click, phone_click).
import { load, save, newId } from "./store.mjs";

export const METRICS = {
  leads: "Solicitudes completadas (GA4 generate_lead)",
  whatsapp_clicks: "Clics en WhatsApp (GA4 whatsapp_click)",
  phone_clicks: "Clics en teléfono (GA4 phone_click)",
  form_submissions: "Formularios recibidos (Netlify Forms)",
  gsc_clicks: "Clics desde Google (Search Console)",
  gsc_impressions: "Impresiones en Google (Search Console)",
  gbp_views: "Visualizaciones del perfil de Google Business",
  gbp_calls: "Llamadas desde Google Business",
  gbp_directions: "Solicitudes de ruta desde Google Business",
  social_reach: "Alcance social (Instagram + Facebook)"
};

export function addMetric({ period, metric, value, source = "manual", note = "" }) {
  if (!METRICS[metric]) throw new Error(`Metrica no admitida: ${metric}. Admitidas: ${Object.keys(METRICS).join(", ")}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period) && !/^\d{4}-W\d{2}$/.test(period)) throw new Error("period debe ser YYYY-MM-DD (lunes de la semana) o YYYY-Www");
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) throw new Error("value debe ser un numero >= 0");
  const metrics = load("metrics");
  const dup = metrics.find((m) => m.period === period && m.metric === metric && m.source === source);
  if (dup) { dup.value = v; dup.note = note; } else metrics.push({ id: newId("m"), period, metric, value: v, source, note });
  save("metrics", metrics);
}

// CSV: period,metric,value,source
export function importCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim()));
  const head = rows.shift();
  if (head.join(",") !== "period,metric,value,source") throw new Error("Cabecera esperada: period,metric,value,source");
  let n = 0;
  for (const [period, metric, value, source] of rows) { addMetric({ period, metric, value, source: source || "csv" }); n++; }
  return n;
}

export function recordResult(pieceId, { reach, clicks, note }) {
  const pieces = load("pieces");
  const p = pieces.find((x) => x.id === pieceId);
  if (!p) throw new Error(`Pieza no encontrada: ${pieceId}`);
  p.results = { ...p.results, ...(reach != null ? { reach: Number(reach) } : {}), ...(clicks != null ? { clicks: Number(clicks) } : {}), ...(note ? { note } : {}) };
  save("pieces", pieces);
  return p;
}

const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const toDate = (period) => (/W\d{2}$/.test(period) ? isoWeekStart(period) : period);
function isoWeekStart(p) { const [y, w] = p.split("-W").map(Number); const j4 = new Date(Date.UTC(y, 0, 4)); const wd = (j4.getUTCDay() + 6) % 7; return addDays(j4.toISOString().slice(0, 10), -wd + (w - 1) * 7); }

export function summary({ today, weeks = 4 }) {
  const metrics = load("metrics");
  const start = addDays(today, -weeks * 7), prevStart = addDays(start, -weeks * 7);
  const sum = (m, from, to) => metrics.filter((x) => x.metric === m && toDate(x.period) >= from && toDate(x.period) < to).reduce((a, b) => a + b.value, 0);
  const pieces = load("pieces");
  const published = pieces.filter((p) => p.status === "PUBLISHED");
  const inWindow = published.filter((p) => Object.values(p.publishedAt || {}).some((d) => d >= start && d <= today));
  return {
    window: { from: start, to: today, weeks },
    metrics: Object.fromEntries(Object.keys(METRICS).map((m) => { const now = sum(m, start, addDays(today, 1)), before = sum(m, prevStart, start); return [m, { now, before, delta: now - before }]; })),
    publications: { total: published.length, inWindow: inWindow.length, byKind: Object.fromEntries(["work", "evergreen"].map((k) => [k, inWindow.filter((p) => p.kind === k).length])) },
    reach: inWindow.reduce((a, p) => a + (p.results?.reach || 0), 0)
  };
}
