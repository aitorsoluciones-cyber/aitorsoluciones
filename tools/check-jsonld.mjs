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

const htmlFiles = await walk(SITE);
let errors = 0;
let blocks = 0;
for (const file of htmlFiles) {
  const html = await fs.readFile(file, "utf8");
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const m of matches) {
    blocks++;
    try {
      JSON.parse(m[1].trim());
    } catch (e) {
      console.log(`INVALID JSON-LD in ${path.relative(SITE, file)}: ${e.message}`);
      errors++;
    }
  }
}
console.log(`\nChecked ${blocks} JSON-LD blocks across ${htmlFiles.length} pages. ${errors} invalid.`);
process.exit(errors > 0 ? 1 : 0);
