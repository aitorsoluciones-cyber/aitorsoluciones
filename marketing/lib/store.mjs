// Almacen JSON minimo con escritura atomica. Colecciones: assets, jobs, pieces, usage, metrics, scans.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { stateFile, ensureDir, home } from "./paths.mjs";

export const COLLECTIONS = { assets: [], jobs: [], pieces: [], usage: [], metrics: [], scans: [], approvals: {} };

export function load(name) {
  try { return JSON.parse(fs.readFileSync(stateFile(name + ".json"), "utf8")); }
  catch (e) { if (e.code === "ENOENT") return structuredClone(COLLECTIONS[name] ?? []); throw e; }
}
export function save(name, data) {
  ensureDir(home());
  const file = stateFile(name + ".json");
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
export const today = () => new Date().toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString();
export const findById = (list, id) => list.find((x) => x.id === id);
