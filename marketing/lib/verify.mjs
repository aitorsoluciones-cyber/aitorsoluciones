// Verificacion de integridad tras una limpieza: huellas de los activos, referencias de las piezas, ficheros de la cola y URLs publicas.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { load, findById } from "./store.mjs";
import { queueDir } from "./paths.mjs";
import { visualStateOf, VISUAL } from "./visual-state.mjs";
import { verifyUrl } from "./media-host.mjs";

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

export async function verifyState({ urls = true, fetchImpl = fetch } = {}) {
  const r = { assets: { checked: 0, bad: [] }, references: { checked: 0, broken: [] }, queue: { items: 0, old: [], missing: [] }, urls: { checked: 0, bad: [] }, obsoleteInUse: [] };
  const assets = load("assets"), pieces = load("pieces");
  for (const a of assets) {
    if (!a.sourcePath || a.fileDeleted) continue;
    if (!fs.existsSync(a.sourcePath)) { r.assets.bad.push({ id: a.id, error: "fichero inexistente" }); continue; }
    r.assets.checked++;
    if (a.origin === "generated" && a.sha256 && sha(a.sourcePath) !== a.sha256) r.assets.bad.push({ id: a.id, error: "hash distinto" });
  }
  for (const p of pieces.filter((x) => x.status === "SCHEDULED")) {
    for (const id of [...(p.assetIds || []), ...(p.visual?.assetIds || [])]) {
      r.references.checked++;
      const a = findById(assets, id);
      if (!a || !a.sourcePath || !fs.existsSync(a.sourcePath)) r.references.broken.push({ piece: p.id, asset: id });
    }
    if (p.kind === "evergreen" && p.manualGraphic) r.obsoleteInUse.push({ piece: p.id, why: "plantilla tipografica por excepcion manual" });
    if (p.kind === "evergreen" && Object.values(p.channelStatus || {}).includes("READY_TO_PUBLISH") && ![VISUAL.APPROVED, VISUAL.MANUAL].includes(visualStateOf(p, assets))) r.obsoleteInUse.push({ piece: p.id, why: "en cola sin visual aprobado" });
  }
  const root = queueDir("READY_TO_PUBLISH");
  if (fs.existsSync(root)) for (const name of fs.readdirSync(root)) {
    r.queue.items++;
    const dir = path.join(root, name);
    const post = JSON.parse(fs.readFileSync(path.join(dir, "post.json"), "utf8"));
    if (!["v2", "manual-graphic"].includes(post.renderer)) r.queue.old.push(name);
    const local = [...post.files, ...(post.extra || [])];
    for (const f of local) if (!fs.existsSync(path.join(dir, f))) r.queue.missing.push(`${name}/${f}`);
    if (urls && post.publicUrls) {
      const remote = [...post.publicUrls.files, ...(post.publicUrls.extra || [])];
      for (const [i, u] of remote.entries()) { r.urls.checked++; const v = await verifyUrl(u, path.join(dir, local[i]), { fetchImpl, tries: 3 }); if (!v.ok) r.urls.bad.push({ url: u, error: v.error }); }
    } else if (urls) r.urls.bad.push({ url: name, error: "sin URL publica" });
  }
  r.ok = !r.assets.bad.length && !r.references.broken.length && !r.queue.old.length && !r.queue.missing.length && !r.urls.bad.length && !r.obsoleteInUse.length;
  return r;
}
