// The random request (operator, 2026-10-26): "an option to open random sentences or construct a random new article";
// "the quote should tell them what random option it picked along with the pricing"; "for random it is fine if that
// includes archive entities and operations".
//
// open       a random English Wikipedia article, then a random sentence in it that cites a source; the quote reads that
//            one sentence, at the tier asked (checked or opened).
// construct  from one of two pools, chosen at random unless the caller names one:
//              wikipedia  a random English Wikipedia article, constructed as an alternative to it from the sources it
//                         cites (the encyclopedia's own field), with the archive admitted on commission;
//              archive    an entity or operation the archive names that has no /non entry yet, constructed from the
//                         archive.
// The pick is recorded on the quote as `random`, so the caller sees what was chosen before paying.
import { pinRevision } from "./pin.js";
import { segment } from "./segment.js";
import { UA } from "./util.js";

const WP = "https://en.wikipedia.org/w/api.php";
const ENTITIES_URL = process.env.GNOSIS_ENTITIES_URL || "https://www.alexanarch.org/data/entities.json";
const NON_INDEX_URL = process.env.GNOSIS_NON_INDEX_URL || "https://www.alexanarch.org/non/index.json";
export const RANDOM_POOLS = ["wikipedia", "archive"];
const ARCHIVE_TYPES = new Set(["concept", "work", "person", "institution", "dataset", "protocol", "product", "event"]);
const pick = (xs, rnd = Math.random) => xs[Math.floor(rnd() * xs.length)];

async function getJSON(url, f = fetch) {
  const r = await f(url, { headers: { "User-Agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} answered ${r.status}`), { status: 502 });
  return r.json();
}

// A random article with enough cited sentences to read, its revision pinned. Up to `tries` titles are drawn.
export async function randomArticle({ f = fetch, pin = pinRevision, rnd = Math.random, tries = 6 } = {}) {
  const j = await getJSON(`${WP}?action=query&list=random&rnnamespace=0&rnlimit=${tries}&format=json&formatversion=2`, f);
  for (const { title } of j?.query?.random || []) {
    const rv = await getJSON(`${WP}?action=query&prop=revisions&rvprop=ids&format=json&formatversion=2&titles=${encodeURIComponent(title)}`, f);
    const oldid = rv?.query?.pages?.[0]?.revisions?.[0]?.revid;
    if (!oldid) continue;
    const pinned = await pin(oldid);
    const { claims } = segment(pinned);
    const cited = claims.filter((c) => c.cited && c.text.length >= 60 && c.text.length <= 420);
    if (cited.length >= 3) return { title: pinned.title, oldid: pinned.oldid, url: pinned.url, claims, cited, drawn_from: "Wikipedia's random article list" };
  }
  throw Object.assign(new Error("no random article with three or more cited sentences was found in this draw; ask again"), { status: 503 });
}

// The sources an article cites, as fetchable links: its own field, for constructing an alternative to it.
export function citedLinks(claims, max = 12) {
  const out = [];
  for (const c of claims) for (const fn of c.footnotes || []) for (const u of fn.links || [])
    if (/^https?:\/\//.test(u) && !/wikipedia\.org|wikimedia\.org|wikidata\.org/.test(u) && !out.includes(u)) out.push(u);
  return out.slice(0, max);
}

export async function randomOpenPick(opts = {}) {
  const a = await randomArticle(opts);
  const c = pick(a.cited, opts.rnd);
  return {
    oldid: a.oldid, claim_id: c.id,
    random: { act: "open", pool: "a random English Wikipedia article, then a random sentence in it that cites a source",
      picked: { article: { title: a.title, oldid: a.oldid, url: a.url }, sentence: { id: c.id, section: c.section || null, text: c.text } },
      drawn_from: a.drawn_from, at: new Date().toISOString() },
  };
}

// The archive's entities and operations with no /non entry, from the archive's published entity list.
export async function archivePool({ f = fetch } = {}) {
  const [E, N] = await Promise.all([getJSON(ENTITIES_URL, f), getJSON(NON_INDEX_URL, f)]);
  const have = new Set();
  for (const n of N?.entities || []) for (const s of [n.name, n.entity, ...(n.addresses || [])]) if (s) have.add(String(s).toLowerCase());
  return (E?.entities || []).filter((e) => e.relation === "archive" && ARCHIVE_TYPES.has(e.type) && e.name
    && ![e.name, ...(e.aliases || [])].some((s) => have.has(String(s).toLowerCase())));
}

export async function randomConstructBody({ pool, ...opts } = {}) {
  if (pool && !RANDOM_POOLS.includes(pool)) throw Object.assign(new Error(`pool is one of ${RANDOM_POOLS.join(", ")}, or omitted to choose at random`), { status: 400 });
  const chosen = pool || pick(RANDOM_POOLS, opts.rnd);
  if (chosen === "wikipedia") {
    const a = await randomArticle(opts);
    const sources = citedLinks(a.claims);
    return { commission: "construct", object: { kind: "entity", name: a.title, ...(sources.length ? { sources } : {}) },
      random: { act: "construct", pool: "wikipedia", pool_label: "a random English Wikipedia article, constructed as an alternative to it from the sources it cites",
        pool_chosen: pool ? "by the caller" : "at random", picked: { name: a.title, wikipedia: { title: a.title, oldid: a.oldid, url: a.url }, sources: sources.length },
        drawn_from: a.drawn_from, at: new Date().toISOString() } };
  }
  const cands = await archivePool(opts);
  if (!cands.length) throw Object.assign(new Error("every entity the archive names already has a /non entry"), { status: 503 });
  const e = pick(cands, opts.rnd);
  return { commission: "construct", object: { kind: "entity", name: e.name, ...(e.presents ? { description: e.presents } : {}) },
    random: { act: "construct", pool: "archive", pool_label: "an entity or operation the archive names that has no /non entry yet, constructed from the archive",
      pool_chosen: pool ? "by the caller" : "at random", picked: { name: e.name, type: e.type, description: e.presents || null, id: e.id },
      drawn_from: `${cands.length} candidates in the archive's entity list with no /non entry`, at: new Date().toISOString() } };
}
