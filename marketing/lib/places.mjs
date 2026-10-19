// Localidades y servicios reales del sitio (src/_data). Nada se inventa: lo que no esta aqui no existe.
import { siteData } from "./paths.mjs";

export const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const locations = () => siteData("locations.json");
export const services = () => siteData("services.json").filter((s) => s.status === "active");
export const locationById = (id) => locations().find((l) => l.id === id);

export function matchLocation(text) {
  const n = ` ${norm(text)} `;
  // la mas larga primero: "les cases d alcanar" antes que "alcanar"
  const list = [...locations()].sort((a, b) => b.name.length - a.name.length);
  return list.find((l) => n.includes(` ${norm(l.name)} `)) || null;
}

const SERVICE_KEYWORDS = [
  ["desbroce-parcelas", ["desbroce", "desbrozar", "parcela", "maleza"]],
  ["poda-mantenimiento-exterior", ["poda", "podar", "tala"]],
  ["mantenimiento-jardines", ["jardin", "cesped", "seto", "setos"]],
  ["mantenimiento-segundas-residencias", ["segunda residencia", "segundas residencias"]],
  ["limpieza-viviendas", ["limpieza vivienda", "limpieza casa"]],
  ["pintura", ["pintura", "pintar"]],
  ["reparaciones-hogar", ["reparacion", "reparaciones"]],
  ["mantenimiento-propiedades", ["mantenimiento propiedad", "propiedades"]]
];
export function matchService(text) {
  const n = norm(text);
  const active = new Set(services().map((s) => s.id));
  for (const [id, words] of SERVICE_KEYWORDS) if (active.has(id) && words.some((w) => n.includes(norm(w)))) return id;
  return null;
}

// Zonas servidas que pueden nombrarse en contenido local (las prioritarias del sitio).
export const servedZones = () => locations().filter((l) => l.isPriority).map((l) => l.name);
