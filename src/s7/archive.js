// The archive's registry and deposit texts, read from the pinned archive checkout.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE } from "./input.js";
import { norm } from "../validate.js";
import { blogPosts } from "./blog.js";

let REG = null;
export function registry() {
  if (!REG) REG = new Map(JSON.parse(readFileSync(join(ARCHIVE, "data/registry.json"), "utf8")).deposits.map((d) => [d.deposit_number, d]));
  return REG;
}
const TEXTS = new Map();
export function depText(dep) {
  if (TEXTS.has(dep)) return TEXTS.get(dep);
  if (typeof dep === "string" && dep.startsWith("blog:")) { const x = blogPosts().get(dep); const t = { text: x?.text || "", file: "data/blog-index.json" }; TEXTS.set(dep, t); return t; }
  const d = registry().get(dep);
  const fp = (d?.full_text_path || "").replace(/^\//, "");
  const p = join(ARCHIVE, fp);
  const t = fp && existsSync(p) ? { text: readFileSync(p, "utf8"), file: fp } : { text: "", file: null };
  TEXTS.set(dep, t);
  return t;
}
export const depMeta = (dep) => {
  if (typeof dep === "string" && dep.startsWith("blog:")) { const x = blogPosts().get(dep) || {}; return { dep, title: x.title, date: x.published, creator: "Lee Sharks (Mind Control Poems)", record: { kind: "blog post", title: x.title, url: x.url, published: x.published } }; }
  const d = registry().get(dep) || {}; return { dep, title: d.title, date: d.date, creator: d.creator, axn: d.axn, hex: d.hex };
};
export const depOrder = (a, b) => (typeof a === typeof b ? (a < b ? -1 : a > b ? 1 : 0) : typeof a === "number" ? -1 : 1);

// Paragraphs as non_traverse.py splits them, so a candidate's para index finds its paragraph.
export function paragraphs(text) {
  return text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// Verbatim check, after the validator's normalisation (NFC; apostrophes and quotation marks unified; whitespace
// collapsed). Returns the quote's offset in the NFC form of the source text, or -1.
const APOS = /[\u1fbd\u1fbf\u2019\u02bc'\u1ffe\u02bd]/, DQ = /[\u201c\u201d\u00ab\u00bb]/;
const MAPS = new WeakMap();
function normMap(text) {
  const key = { t: text };
  const src = text.normalize("NFC");
  let out = "", map = [], space = false;
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (/\s/.test(ch)) { if (!space && out.length) { out += " "; map.push(i); } space = true; continue; }
    space = false;
    if (APOS.test(ch)) ch = "\u2019"; else if (DQ.test(ch)) ch = '"';
    out += ch; map.push(i);
  }
  return { out, map };
}
const CACHE = new Map();
export function locate(text, quote) {
  if (!quote) return -1;
  const q = norm(quote).replace(/^["\u201c]|["\u201d]$/g, "").trim();
  if (!q) return -1;
  let m = CACHE.get(text);
  if (!m) { m = normMap(text); if (CACHE.size > 64) CACHE.clear(); CACHE.set(text, m); }
  const i = m.out.indexOf(q);
  return i < 0 ? -1 : m.map[i];
}
