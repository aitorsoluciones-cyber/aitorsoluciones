// URLs HTTPS publicas para las piezas de la cola (Instagram y Google Business exigen una URL, no un fichero).
// Rama huerfana `media` del mismo repositorio: no comparte historial con main, no entra en el build de la web y no llena el repo principal.
// Se trabaja en un clon propio (<estado>/media-repo): jamas se toca el arbol de trabajo del proyecto. Sin secretos: usa las credenciales de git ya
// configuradas en la maquina. Las URLs son estables (raw.githubusercontent.com/<owner>/<repo>/media/...) y devuelven el JPEG/PNG directamente.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { home, ensureDir, config, REPO } from "./paths.mjs";
import { queueSummary } from "./publish.mjs";

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export const mediaRepoDir = () => path.join(home(), "media-repo");

// Remoto donde vive la rama media: MK_MEDIA_REMOTE (pruebas) > config.media.remote > origin del proyecto.
export const remoteOf = () => process.env.MK_MEDIA_REMOTE || config().media.remote || git(["remote", "get-url", "origin"], REPO);

// owner/repo del remoto (https o ssh).
export function repoSlug(remote = remoteOf()) {
  const m = remote.match(/github\.com[:/]+([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!m) throw new Error(`No reconozco el remoto origin como GitHub: ${remote}`);
  return { owner: m[1], repo: m[2], remote };
}

export function baseUrl(cfg = config().media) {
  if (process.env.MK_MEDIA_BASE_URL) return process.env.MK_MEDIA_BASE_URL.replace(/\/?$/, "/");
  if (cfg.provider === "netlify") return `https://${cfg.branch}--${cfg.netlifySite}.netlify.app/`;
  const { owner, repo } = repoSlug();
  return `https://raw.githubusercontent.com/${owner}/${repo}/${cfg.branch}/`;
}

const README = `# Medios temporales de marketing

Esta rama NO es la web. Contiene las imagenes de las publicaciones programadas (Instagram, Facebook, Google Business) en una URL publica
para que las plataformas puedan descargarlas. Se purga automaticamente; no editar a mano.
`;
const NETLIFY = `# Solo se usa si el sitio sirve esta rama (branch deploys). Sin build: se publica tal cual.
[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Robots-Tag = "noindex, nofollow"
    Cache-Control = "public, max-age=3600"
`;

// Clon de trabajo de la rama media; la crea (huerfana) si no existe en origin.
export function ensureRepo({ log = () => {} } = {}) {
  const cfg = config().media;
  const dir = mediaRepoDir();
  const remote = remoteOf();
  if (fs.existsSync(path.join(dir, ".git"))) {
    try { git(["fetch", "origin", cfg.branch], dir); git(["reset", "--hard", `origin/${cfg.branch}`], dir); } catch { /* aun no existe en origin */ }
    return dir;
  }
  ensureDir(path.dirname(dir));
  const exists = git(["ls-remote", "--heads", remote, cfg.branch], REPO).length > 0;
  if (exists) { git(["clone", "--branch", cfg.branch, "--single-branch", "--depth", "1", remote, dir], path.dirname(dir)); return dir; }
  log(`  creando rama huerfana ${cfg.branch}`);
  ensureDir(dir);
  git(["init", "-q"], dir);
  git(["checkout", "-q", "--orphan", cfg.branch], dir);
  git(["remote", "add", "origin", remote], dir);
  fs.writeFileSync(path.join(dir, "README.md"), README);
  fs.writeFileSync(path.join(dir, "netlify.toml"), NETLIFY);
  fs.writeFileSync(path.join(dir, "robots.txt"), "User-agent: *\nDisallow: /\n");
  git(["add", "-A"], dir);
  git(["-c", "user.name=Aitor Soluciones Marketing", "-c", "user.email=marketing@aitorsoluciones.invalid", "commit", "-q", "-m", "media: rama inicial (medios temporales de marketing)"], dir);
  git(["push", "-q", "-u", "origin", cfg.branch], dir);
  return dir;
}

const commit = (dir, msg) => {
  git(["add", "-A"], dir);
  if (!git(["status", "--porcelain"], dir)) return false;
  git(["-c", "user.name=Aitor Soluciones Marketing", "-c", "user.email=marketing@aitorsoluciones.invalid", "commit", "-q", "-m", msg], dir);
  return true;
};
const push = (dir, branch, force = false) => {
  try { git(["push", "-q", ...(force ? ["--force"] : []), "origin", branch], dir); }
  catch { git(["pull", "--rebase", "-q", "origin", branch], dir); git(["push", "-q", "origin", branch], dir); }
};

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

// Comprueba que la URL devuelve la imagen directamente (200, image/*, mismos bytes). Reintenta mientras la CDN se actualiza.
export async function verifyUrl(url, file, { tries = 8, delayMs = 2500, fetchImpl = fetch } = {}) {
  let last = "sin respuesta";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchImpl(url, { redirect: "follow" });
      const type = r.headers.get("content-type") || "";
      if (r.ok && /^image\//i.test(type)) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (crypto.createHash("sha256").update(buf).digest("hex") === sha(file)) return { ok: true, url, status: r.status, contentType: type, bytes: buf.length };
        last = "los bytes no coinciden con el fichero local";
      } else last = `HTTP ${r.status} ${type}`;
    } catch (e) { last = e.message; }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, delayMs));
  }
  return { ok: false, url, error: last };
}

// Publica los ficheros de las piezas READY_TO_PUBLISH (programadas hasta today+ahead) y escribe publicUrls en su post.json.
export async function publishMedia({ today, ahead = 3, log = () => {}, verify = true, fetchImpl = fetch, verifyTries = 8, verifyDelayMs = 2500 } = {}) {
  const cfg = config().media;
  const limit = new Date(new Date(today + "T00:00:00Z").getTime() + ahead * 86400000).toISOString().slice(0, 10);
  const items = queueSummary().filter((p) => p.scheduledFor <= limit && !(p.publicUrls && p.publicUrls.files?.length));
  const result = { published: [], failed: [], base: null, commit: null };
  if (!items.length) return result;
  const dir = ensureRepo({ log });
  const base = baseUrl(cfg);
  result.base = base;
  const plan = [];
  for (const p of items) {
    const qdir = path.join(home(), "queue", "READY_TO_PUBLISH", p.name);
    const files = p.files.map((f) => ({ src: path.join(qdir, f), name: f }));
    const extra = (p.extra || []).map((f) => ({ src: path.join(qdir, f), name: f }));
    // La ruta lleva la huella del contenido: si la imagen cambia, la URL cambia (la CDN cachea las URLs unos minutos) y la antigua se retira.
    const h8 = crypto.createHash("sha256").update([...files, ...extra].map((f) => sha(f.src)).join(":")).digest("hex").slice(0, 8);
    const monthDir = path.join(dir, cfg.prefix, p.scheduledFor.slice(0, 7));
    if (fs.existsSync(monthDir)) for (const old of fs.readdirSync(monthDir)) if (old === p.name || old.startsWith(p.name + "__")) fs.rmSync(path.join(monthDir, old), { recursive: true, force: true });
    const rel = `${cfg.prefix}/${p.scheduledFor.slice(0, 7)}/${p.name}__${h8}`;
    for (const f of [...files, ...extra]) { const to = path.join(dir, rel, f.name); ensureDir(path.dirname(to)); fs.copyFileSync(f.src, to); f.url = base + enc(`${rel}/${f.name}`); }
    plan.push({ p, qdir, rel, files, extra });
  }
  const changed = commit(dir, `media: ${plan.length} piezas (${plan.map((x) => x.p.name).slice(0, 3).join(", ")}${plan.length > 3 ? "…" : ""})`);
  if (changed) push(dir, cfg.branch);
  result.commit = git(["rev-parse", "--short", "HEAD"], dir);
  for (const x of plan) {
    const checks = [];
    if (verify) for (const f of [...x.files, ...x.extra]) checks.push(await verifyUrl(f.url, f.src, { fetchImpl, tries: verifyTries, delayMs: verifyDelayMs }));
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) { result.failed.push({ name: x.p.name, errors: bad }); continue; }
    const postFile = path.join(x.qdir, "post.json");
    const post = JSON.parse(fs.readFileSync(postFile, "utf8"));
    post.publicUrls = { files: x.files.map((f) => f.url), extra: x.extra.map((f) => f.url), verifiedAt: verify ? new Date().toISOString() : null, expiresAfterDays: cfg.retentionDays };
    fs.writeFileSync(postFile, JSON.stringify(post, null, 2) + "\n");
    result.published.push({ name: x.p.name, urls: post.publicUrls });
    log(`  url: ${post.publicUrls.files[0]}`);
  }
  return result;
}

// Limpieza: borra de la rama media las carpetas con fecha anterior a la retencion. squash=true reescribe la rama con un solo commit
// (libera el historial de las imagenes borradas; fuerza el push de ESTA rama huerfana, nunca de main).
export function pruneMedia({ today, days, squash = false, log = () => {} } = {}) {
  const cfg = config().media;
  const keep = days ?? cfg.retentionDays;
  const cutoff = new Date(new Date(today + "T00:00:00Z").getTime() - keep * 86400000).toISOString().slice(0, 10);
  const dir = ensureRepo({ log });
  const root = path.join(dir, cfg.prefix);
  const removed = [];
  if (fs.existsSync(root)) {
    for (const month of fs.readdirSync(root)) {
      const mdir = path.join(root, month);
      if (!fs.statSync(mdir).isDirectory()) continue;
      for (const name of fs.readdirSync(mdir)) { if (/^\d{4}-\d{2}-\d{2}__/.test(name) && name.slice(0, 10) < cutoff) { fs.rmSync(path.join(mdir, name), { recursive: true, force: true }); removed.push(name); } }
      if (!fs.readdirSync(mdir).length) fs.rmSync(mdir, { recursive: true, force: true });
    }
  }
  let committed = false;
  if (removed.length) { committed = commit(dir, `media: purga de ${removed.length} piezas anteriores a ${cutoff}`); }
  if (squash && (committed || removed.length === 0)) {
    git(["checkout", "-q", "--orphan", "squash-tmp"], dir);
    git(["add", "-A"], dir);
    git(["-c", "user.name=Aitor Soluciones Marketing", "-c", "user.email=marketing@aitorsoluciones.invalid", "commit", "-q", "-m", "media: estado compactado"], dir);
    git(["branch", "-M", cfg.branch], dir);
    push(dir, cfg.branch, true);
  } else if (committed) push(dir, cfg.branch);
  return { cutoff, removed };
}
