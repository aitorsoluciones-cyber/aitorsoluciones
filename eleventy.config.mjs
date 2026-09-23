import fs from "node:fs";

const imageMeta = JSON.parse(fs.readFileSync("src/_data/imageMeta.json", "utf8"));

export default function (eleventyConfig) {
  eleventyConfig.addFilter("imgsrcset", (name) => {
    const m = imageMeta[name];
    if (!m) return `/assets/img/${name}.webp`;
    const parts = [`/assets/img/${name}-sm.webp ${m.sm.w}w`];
    if (m.md) parts.push(`/assets/img/${name}-md.webp ${m.md.w}w`);
    parts.push(`/assets/img/${name}.webp ${m.w}w`);
    return parts.join(", ");
  });
  eleventyConfig.addFilter("imgw", (name) => (imageMeta[name] ? imageMeta[name].w : 800));
  eleventyConfig.addFilter("imgh", (name) => (imageMeta[name] ? imageMeta[name].h : 1067));
  eleventyConfig.addFilter("imgsmw", (name) => (imageMeta[name] ? imageMeta[name].sm.w : 480));
  eleventyConfig.addFilter("imgsmh", (name) => (imageMeta[name] ? imageMeta[name].sm.h : 640));

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/manifest.webmanifest": "manifest.webmanifest" });
  eleventyConfig.addPassthroughCopy({ "src/service-worker.js": "service-worker.js" });
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });
  eleventyConfig.addPassthroughCopy({ "src/_headers": "_headers" });

  eleventyConfig.addFilter("waLink", (number, message) => {
    const cleaned = String(number).replace(/[^\d+]/g, "");
    return `https://wa.me/${cleaned.replace("+", "")}?text=${encodeURIComponent(message)}`;
  });

  eleventyConfig.addFilter("jsonify", (value) => JSON.stringify(value));

  eleventyConfig.addFilter("findById", (list, id) => (list || []).find((item) => item.id === id));

  eleventyConfig.addFilter("whereActive", (list) => (list || []).filter((item) => item.status === "active"));

  eleventyConfig.addFilter("pickByIds", (ids, list) =>
    (ids || []).map((id) => (list || []).find((item) => item.id === id)).filter(Boolean)
  );

  eleventyConfig.addFilter("casesByService", (cases, serviceId) =>
    (cases || []).filter((c) => c.status === "active" && c.serviceId === serviceId)
  );

  eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
}
