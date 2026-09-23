// Comprobaciones SEO/estructura sobre _site: un H1 por pagina, title y
// description unicos, canonica correcta, hreflang reciproco, sitemap y robots.
import fs from "node:fs/promises";
import path from "node:path";

const SITE = path.resolve("_site");
const DOMAIN = "https://aitorsoluciones.com";
const EXPECTED_SITEMAP = 22;
const NOINDEX = ["/gracias/", "/404.html", "/mantenimiento-fincas-alcanar/", "/offline.html"];

async function walk(dir) {
  let out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(full));
    else if (e.name.endsWith(".html")) out.push(full);
  }
  return out;
}
const urlOf = (file) => {
  const rel = "/" + path.relative(SITE, file).replaceAll("\\", "/");
  return rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel;
};
const first = (html, re) => (html.match(re) || [])[1];

let errors = 0;
let warnings = 0;
const fail = (m) => { console.log("ERROR  " + m); errors++; };
const warn = (m) => { console.log("aviso  " + m); warnings++; };

const files = await walk(SITE);
const seenTitle = new Map();
const seenDesc = new Map();
const pages = {};

for (const file of files) {
  const url = urlOf(file);
  const html = await fs.readFile(file, "utf8");
  const title = first(html, /<title>([^<]*)<\/title>/);
  const desc = first(html, /<meta name="description" content="([^"]*)"/);
  const robots = first(html, /<meta name="robots" content="([^"]*)"/);
  const canonical = first(html, /<link rel="canonical" href="([^"]*)"/);
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  pages[url] = { html, title, desc, robots, canonical };

  if (h1s !== 1) fail(`${url}: ${h1s} H1 (debe haber 1)`);
  if (!title) fail(`${url}: sin <title>`);
  if (url !== "/offline.html" && !desc) fail(`${url}: sin meta description`);
  if (!robots) fail(`${url}: sin meta robots`);

  const indexable = !NOINDEX.includes(url);
  if (indexable) {
    if (!/index,follow/.test(robots || "")) fail(`${url}: deberia ser indexable y robots="${robots}"`);
    if (canonical !== DOMAIN + url) fail(`${url}: canonical "${canonical}" != "${DOMAIN + url}"`);
    if (seenTitle.has(title)) fail(`${url}: title duplicado con ${seenTitle.get(title)}`);
    if (seenDesc.has(desc)) fail(`${url}: description duplicada con ${seenDesc.get(desc)}`);
    seenTitle.set(title, url);
    seenDesc.set(desc, url);
    if (title && title.length > 70) warn(`${url}: title de ${title.length} caracteres (puede truncarse)`);
    if (desc && desc.length > 165) warn(`${url}: description de ${desc.length} caracteres (puede truncarse)`);
  } else if (!/noindex/.test(robots || "")) {
    fail(`${url}: deberia ser noindex y robots="${robots}"`);
  }
}

// hreflang reciproco home <-> ingles
const hreflangs = (html) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`).sort().join("|");
const home = pages["/"];
const en = pages["/en/property-maintenance/"];
if (!home || !en) fail("faltan home o pagina inglesa");
else {
  const a = hreflangs(home.html);
  const b = hreflangs(en.html);
  if (!a.includes(`es=${DOMAIN}/`) || !a.includes(`en=${DOMAIN}/en/property-maintenance/`)) fail("hreflang de la home incompleto: " + a);
  if (a !== b) fail(`hreflang no reciproco entre home y ingles:\n  home: ${a}\n  en:   ${b}`);
}

// sitemap
const sitemap = await fs.readFile(path.join(SITE, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (locs.length !== EXPECTED_SITEMAP) fail(`sitemap con ${locs.length} URLs (se esperaban ${EXPECTED_SITEMAP})`);
for (const bad of NOINDEX) if (locs.includes(DOMAIN + bad)) fail(`sitemap contiene ${bad}`);
for (const loc of locs) {
  const p = loc.replace(DOMAIN, "");
  if (!pages[p]) fail(`sitemap apunta a una pagina que no existe: ${loc}`);
}
if (new Set(locs).size !== locs.length) fail("sitemap con URLs duplicadas");

// robots.txt
const robotsTxt = await fs.readFile(path.join(SITE, "robots.txt"), "utf8");
if (!robotsTxt.includes(`Sitemap: ${DOMAIN}/sitemap.xml`)) fail("robots.txt sin la linea Sitemap");

console.log(`\nPaginas HTML: ${files.length} · URLs en sitemap: ${locs.length} · errores: ${errors} · avisos: ${warnings}`);
process.exit(errors ? 1 : 0);
