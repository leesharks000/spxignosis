// S0. Pin: an article at an exact revision, with hashes of what was read.
import { politeFetch, sha256, save, load, STORE, SEED } from "./util.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Rendered HTML of a revision. Order: snapshot store, then the parse API, then a seed file.
export async function pinRevision(oldid) {
  const key = `snapshots/wikipedia/${oldid}.json`;
  const cached = await load(key);
  if (cached) return { ...cached, from: "store" };

  const api = `https://en.wikipedia.org/w/api.php?action=parse&oldid=${oldid}&prop=text|revid|displaytitle&format=json&formatversion=2`;
  const r = await politeFetch(api);
  let html, title, from;
  if (r.status === 200) {
    const j = JSON.parse(r.body);
    if (j.error) throw new Error(`wikipedia: ${j.error.info}`);
    html = j.parse.text; title = j.parse.title; from = "parse-api";
  } else {
    // Seeds are full page saves; accept one only if its own wgRevisionId matches.
    const base = [STORE, SEED].find((d) => existsSync(d) && readdirSync(d).some((f) => f.startsWith("seed-wp-") && f.includes(String(oldid))));
    const seed = base && readdirSync(base).find((f) => f.startsWith("seed-wp-") && f.includes(String(oldid)));
    if (!seed) throw new Error(`wikipedia unavailable (HTTP ${r.status}) and no seed for ${oldid}`);
    const page = readFileSync(join(base, seed), "utf8");
    const rev = (page.match(/"wgRevisionId":(\d+)/) || [])[1];
    if (rev !== String(oldid)) throw new Error(`seed revision ${rev} does not match ${oldid}`);
    title = (page.match(/"wgTitle":"([^"]+)"/) || [])[1];
    const m = page.match(/<div class="mw-content-ltr mw-parser-output"[\s\S]*?(?=<div class="printfooter")/);
    html = m ? m[0] : page;
    from = `seed:${seed}`;
  }
  const pinned = {
    title, oldid: Number(oldid),
    url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&oldid=${oldid}`,
    retrieved: new Date().toISOString(), from,
    html, html_sha256: sha256(html),
    licence: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  };
  await save(key, pinned);
  return pinned;
}
