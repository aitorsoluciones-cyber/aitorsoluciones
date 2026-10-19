// Rutas del sistema de marketing. El estado operativo (banco de contenidos, cola,
// metricas) vive FUERA de git (repo publico): MK_HOME o marketing/_state.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MK_DIR = path.join(REPO, "marketing");
export const home = () => path.resolve(process.env.MK_HOME || path.join(MK_DIR, "_state"));
export const stateFile = (name) => path.join(home(), name);
export const outDir = (...p) => path.join(home(), "out", ...p);
export const queueDir = (...p) => path.join(home(), "queue", ...p);
export const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch (e) { if (e.code === "ENOENT" && fallback !== undefined) return fallback; throw e; }
};
// config.json (en git) + <estado>/config.local.json (fuera de git: ids de carpetas de Drive, etc.), fusionados en profundidad.
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? merge(a[k], v) : v; return a; };
export const config = () => merge(readJson(path.join(MK_DIR, "config.json")), readJson(path.join(home(), "config.local.json"), {}));
export const siteData = (name) => readJson(path.join(REPO, "src", "_data", name));
export const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });
