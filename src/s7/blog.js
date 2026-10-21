// The blog (Mind Control Poems) as an archive corpus beside the registry's deposits. The archive's own index holds each
// post's text (data/blog-index.json). A post that the blog–deposit map assigns to a deposit is carried by that deposit
// and is not scanned again; every other post is scanned with the entity's strings, as the D pass scans deposit texts.
// Candidates are keyed "blog:<url>". Medium is indexed by metadata only (data/medium-seed.json) and is not scanned.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE } from "./input.js";
import { sha256 } from "../util.js";

let POSTS = null, INDEX_SHA = null;
export function blogPosts() {
  if (POSTS) return POSTS;
  const p = join(ARCHIVE, "data/blog-index.json"), m = join(ARCHIVE, "data/blog-deposit-map.json");
  if (!existsSync(p)) return (POSTS = new Map());
  const raw = readFileSync(p, "utf8");
  INDEX_SHA = sha256(raw);
  const mapped = new Set(existsSync(m) ? JSON.parse(readFileSync(m, "utf8")).entries.filter((e) => e.deposit_number).map((e) => e.post_url) : []);
  POSTS = new Map(JSON.parse(raw).posts.filter((x) => x.text && !mapped.has(x.url)).map((x) => [`blog:${x.url}`, x]));
  return POSTS;
}
export const blogIndexSha = () => (blogPosts(), INDEX_SHA);
export const blogId = (key) => `blog-${sha256(key).slice(0, 10)}`;

export function blogPass(input) {
  const aliases = input.aliases.map((a) => new RegExp(a.pattern, a.flags?.includes("i") ? "i" : ""));
  const D = [];
  for (const [key, x] of blogPosts()) {
    if (!aliases.some((r) => r.test(x.text))) continue;
    const paras = x.text.split(/\n\s*\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    paras.forEach((p, pi) => p.split(/(?<=[.!?])\s+(?=[A-Z“"'(\[*#Ͱ-Ͽἀ-῿])/).forEach((s, si) => {
      const hit = aliases.filter((r) => r.test(s)).map((r) => r.source);
      if (hit.length) D.push({ dep: key, title: x.title.slice(0, 160), date: x.published, para: pi, sent: si, sentence: s.slice(0, 900), alias: hit, cand_id: `BG${String(D.length + 1).padStart(4, "0")}` });
    }));
  }
  return { D, posts_scanned: blogPosts().size, index_sha256: blogIndexSha() };
}
