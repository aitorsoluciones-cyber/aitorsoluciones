// Exporta el banco a CSV (para abrirlo o importarlo en Google Sheets) y genera el plan de movimientos en Drive.
import fs from "node:fs";
import path from "node:path";
import { load } from "./store.mjs";
import { home, ensureDir } from "./paths.mjs";
import { driveFolderFor } from "./states.mjs";

const cell = (v) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows, cols) => [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";

const COLS = {
  assets: ["id", "kind", "origin", "role", "jobId", "status", "name", "width", "height", "sha256", "driveId", "needsDownload", "nearDuplicateOf", "createdAt"],
  jobs: ["id", "title", "serviceId", "locationId", "locationConfirmed", "status", "date", "origin", "webCaseId"],
  pieces: ["id", "kind", "topicId", "jobId", "angle", "channels", "scheduledFor", "status", "template", "urls", "results"],
  usage: ["kind", "id", "channel", "angle", "pieceId", "date"],
  metrics: ["period", "metric", "value", "source", "note"]
};

export function exportAll() {
  const dir = path.join(home(), "export");
  ensureDir(dir);
  const files = [];
  for (const [name, cols] of Object.entries(COLS)) {
    const f = path.join(dir, name + ".csv");
    fs.writeFileSync(f, "﻿" + toCsv(load(name), cols));
    files.push(f);
  }
  return files;
}

// Acciones de Drive pendientes: mover cada archivo a la carpeta que corresponde a su estado.
export function drivePlan() {
  const actions = [];
  for (const a of load("assets").filter((x) => x.driveId)) {
    const target = driveFolderFor(a.status);
    if (target && a.driveFolder !== target.name) actions.push({ driveId: a.driveId, name: a.name, status: a.status, moveTo: target.name, folderId: target.id });
  }
  return actions;
}
