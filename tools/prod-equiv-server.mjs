// Servidor estatico minimo que aplica src/_headers (formato Netlify) tal
// cual, para auditar una version "equivalente a produccion" en local: sin
// el script de colaboracion de Netlify Preview, sin X-Robots-Tag noindex
// (que Netlify solo inyecta en deploy previews/branch deploys), pero CON
// las mismas cabeceras de seguridad/cache que _headers define para real.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const COMPRESSIBLE = new Set([".html", ".css", ".js", ".svg", ".xml", ".txt", ".webmanifest"]);

const ROOT = path.resolve("_site");
const PORT = process.env.PORT || 5055;

function parseHeadersFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const rules = [];
  let current = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (!raw.startsWith(" ") && !raw.startsWith("\t")) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
    } else if (current) {
      const idx = raw.indexOf(":");
      if (idx > -1) {
        current.headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
      }
    }
  }
  return rules;
}

function globToRegExp(pattern) {
  // Soporta '*' al final de un segmento (p.ej. /assets/img/*) y '/*' generico.
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + esc + "$");
}

const rules = parseHeadersFile(path.join("src", "_headers")).map((r) => ({
  ...r,
  re: globToRegExp(r.pattern),
}));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(ROOT, urlPath);
  if (urlPath.endsWith("/")) filePath = path.join(filePath, "index.html");
  if (!fs.existsSync(filePath) && fs.existsSync(filePath + ".html")) filePath += ".html";
  if (!fs.existsSync(filePath) && !path.extname(filePath)) {
    const asDir = path.join(ROOT, urlPath, "index.html");
    if (fs.existsSync(asDir)) filePath = asDir;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const notFound = path.join(ROOT, "404.html");
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : "Not found");
    return;
  }
  const ext = path.extname(filePath);
  const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
  for (const rule of rules) {
    if (rule.re.test(urlPath)) {
      for (const [k, v] of rule.headers) headers[k] = v;
    }
  }
  const body = fs.readFileSync(filePath);
  // gzip para texto cuando el cliente lo acepta, igual que la CDN de Netlify
  // en real: evita que la falta de compresion en este servidor de prueba
  // local distorsione metricas de rendimiento frente a produccion.
  const acceptsGzip = (req.headers["accept-encoding"] || "").includes("gzip");
  if (COMPRESSIBLE.has(ext) && acceptsGzip) {
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
    res.writeHead(200, headers);
    res.end(zlib.gzipSync(body));
  } else {
    res.writeHead(200, headers);
    res.end(body);
  }
});
server.keepAliveTimeout = 5000;

server.listen(PORT, () => console.log("prod-equiv server on http://localhost:" + PORT));
