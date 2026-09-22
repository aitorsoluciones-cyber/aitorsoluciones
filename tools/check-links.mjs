import fs from "node:fs/promises";
import path from "node:path";

const SITE = path.resolve("_site");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(await walk(full));
    else if (e.name.endsWith(".html")) files.push(full);
  }
  return files;
}

function resolveTarget(href) {
  const clean = href.split("#")[0].split("?")[0];
  if (!clean || clean === "/") return path.join(SITE, "index.html");
  const p = path.join(SITE, clean);
  return p.endsWith(".html") ? p : path.join(p, "index.html");
}

const htmlFiles = await walk(SITE);
let brokenCount = 0;
const knownExternalPrefixes = ["http://", "https://", "mailto:", "tel:"];

for (const file of htmlFiles) {
  const html = await fs.readFile(file, "utf8");
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    if (knownExternalPrefixes.some((p) => href.startsWith(p))) continue;
    if (!href.startsWith("/")) continue;
    if (href.startsWith("/assets/") || href === "/manifest.webmanifest" || href === "/sitemap.xml" || href === "/robots.txt" || href.startsWith("/service-worker.js")) {
      const assetPath = path.join(SITE, href.split("?")[0]);
      try {
        await fs.access(assetPath);
      } catch {
        console.log(`MISSING ASSET: ${href}  (in ${path.relative(SITE, file)})`);
        brokenCount++;
      }
      continue;
    }
    const target = resolveTarget(href);
    try {
      await fs.access(target);
    } catch {
      console.log(`BROKEN LINK: ${href}  (in ${path.relative(SITE, file)})`);
      brokenCount++;
    }
  }
}

console.log(`\nChecked ${htmlFiles.length} pages. ${brokenCount} broken link(s)/asset(s).`);
process.exit(brokenCount > 0 ? 1 : 0);
