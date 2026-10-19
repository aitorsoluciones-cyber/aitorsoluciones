// Adaptadores de publicacion (Facebook, Instagram, Google Business Profile).
// Ninguno esta conectado hoy: sin credenciales (y sin MK_ALLOW_PUBLISH=1) solo informan de que la pieza sigue en
// queue/READY_TO_PUBLISH. Los adaptadores usan las APIs oficiales y estan cubiertos por pruebas con un fetch simulado;
// no se han probado contra las cuentas reales (faltan credenciales).
import fs from "node:fs";
import path from "node:path";
import { queueSummary, markPublished } from "./publish.mjs";
import { queueDir } from "./paths.mjs";

const GRAPH = "https://graph.facebook.com/v21.0";
const need = (env, keys) => keys.filter((k) => !env[k]);
const publicUrl = (env, postDir, file) => `${env.MK_MEDIA_BASE_URL.replace(/\/$/, "")}/${path.basename(postDir)}/${file}`;
async function ok(res, what) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`${what}: ${res.status} ${JSON.stringify(body.error || body)}`);
  return body;
}

export const ADAPTERS = {
  facebook: {
    env: ["FB_PAGE_ID", "FB_PAGE_TOKEN"],
    async publish(post, dir, { fetchImpl, env }) {
      const form = new FormData();
      form.set("caption", post.caption);
      form.set("access_token", env.FB_PAGE_TOKEN);
      form.set("source", new Blob([fs.readFileSync(path.join(dir, post.files[0]))]), post.files[0]);
      const body = await ok(await fetchImpl(`${GRAPH}/${env.FB_PAGE_ID}/photos`, { method: "POST", body: form }), "Facebook");
      return `https://www.facebook.com/${body.post_id || body.id}`;
    }
  },
  instagram: {
    env: ["IG_USER_ID", "IG_TOKEN", "MK_MEDIA_BASE_URL"],
    async publish(post, dir, { fetchImpl, env }) {
      const call = async (pathPart, params) => ok(await fetchImpl(`${GRAPH}/${pathPart}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...params, access_token: env.IG_TOKEN }) }), "Instagram");
      let creation;
      if (post.files.length > 1) {
        const children = [];
        for (const f of post.files) children.push((await call(`${env.IG_USER_ID}/media`, { image_url: publicUrl(env, dir, f), is_carousel_item: true })).id);
        creation = (await call(`${env.IG_USER_ID}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: post.caption })).id;
      } else creation = (await call(`${env.IG_USER_ID}/media`, { image_url: publicUrl(env, dir, post.files[0]), caption: post.caption })).id;
      const pub = await call(`${env.IG_USER_ID}/media_publish`, { creation_id: creation });
      return `https://www.instagram.com/p/${pub.id}/`;
    }
  },
  gbp: {
    env: ["GBP_ACCOUNT", "GBP_LOCATION", "GBP_TOKEN", "MK_MEDIA_BASE_URL"],
    async publish(post, dir, { fetchImpl, env }) {
      const payload = { languageCode: "es", topicType: "STANDARD", summary: post.caption, callToAction: post.gbp?.callToAction, media: [{ mediaFormat: "PHOTO", sourceUrl: publicUrl(env, dir, post.files[0]) }] };
      const body = await ok(await fetchImpl(`https://mybusiness.googleapis.com/v4/accounts/${env.GBP_ACCOUNT}/locations/${env.GBP_LOCATION}/localPosts`, {
        method: "POST", headers: { Authorization: `Bearer ${env.GBP_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(payload)
      }), "Google Business Profile");
      return body.searchUrl || `https://business.google.com/posts/${body.name}`;
    }
  }
};

// Estado real de cada canal: que falta para publicar automaticamente.
export function channelStatus(env = process.env) {
  return Object.fromEntries(Object.entries(ADAPTERS).map(([ch, a]) => [ch, { missing: need(env, a.env), live: need(env, a.env).length === 0 && env.MK_ALLOW_PUBLISH === "1" }]));
}

export async function publishQueue({ fetchImpl = fetch, env = process.env, dryRun = true, log = () => {} } = {}) {
  const results = [];
  for (const post of queueSummary()) {
    const adapter = ADAPTERS[post.channel];
    const dir = queueDir("READY_TO_PUBLISH", post.name);
    const missing = need(env, adapter.env);
    if (dryRun || env.MK_ALLOW_PUBLISH !== "1" || missing.length) {
      results.push({ name: post.name, action: "queued", reason: dryRun ? "dry-run" : env.MK_ALLOW_PUBLISH !== "1" ? "MK_ALLOW_PUBLISH != 1" : `faltan: ${missing.join(", ")}` });
      continue;
    }
    try {
      const url = await adapter.publish(post, dir, { fetchImpl, env });
      markPublished(post.pieceId, post.channel, url);
      results.push({ name: post.name, action: "published", url });
      log(`  publicado ${post.name} -> ${url}`);
    } catch (e) { results.push({ name: post.name, action: "error", error: e.message }); }
  }
  return results;
}
