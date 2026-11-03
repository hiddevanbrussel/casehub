const fs = require("fs");
const path = require("path");

const ICON_DIR = path.join(__dirname, "..", "node_modules", "lucide-static", "icons");
const cache = new Map();

function load(name) {
  const slug = String(name || "").trim().toLowerCase();
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.includes("..")) return "";
  if (cache.has(slug)) return cache.get(slug);
  const file = path.join(ICON_DIR, `${slug}.svg`);
  let svg = "";
  try {
    svg = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch (err) {
    console.warn(`Lucide icon missing: ${slug}`);
  }
  cache.set(slug, svg);
  return svg;
}

function icon(name, opts = {}) {
  const svg = load(name);
  if (!svg) return "";
  const extra = String(opts.class || "").trim();
  const classes = extra ? `ico ${extra}` : "ico";
  const label = opts.label ? String(opts.label) : "";
  return svg.replace(/<svg\b([^>]*)>/, (_, attrs) => {
    let next = attrs.replace(/\sclass="[^"]*"/, "");
    next += ` class="${classes}"`;
    if (label) {
      next += ` role="img" aria-label="${escapeAttr(label)}"`;
    } else if (!/\baria-hidden=/.test(next)) {
      next += ` aria-hidden="true"`;
    }
    return `<svg${next}>`;
  });
}

function escapeAttr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

module.exports = { icon };
