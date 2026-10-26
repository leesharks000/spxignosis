// The random request (2026-10-26), with Wikipedia and the archive stubbed: a random open picks a cited sentence of a
// pinned article; a random construct picks from the pool asked (an alternative to a Wikipedia article, from the sources
// it cites; or an archive entity with no /non entry); an unknown pool is refused; the pick is described.
import { randomOpenPick, randomConstructBody, citedLinks, archivePool } from "../src/random.js";

const ref = (n, url) => `<li id="cite_note-${n}"><span class="reference-text"><a class="external" href="${url}">Source ${n}</a></span></li>`;
const sup = (n) => `<sup class="reference"><a href="#cite_note-${n}">[${n}]</a></sup>`;
const html = `<div class="mw-parser-output">
<p>The first sentence of this article is long enough to be read and it cites a source plainly here.${sup(1)} An uncited sentence follows it in the same paragraph without any citation at all.</p>
<p>The second cited sentence of the article says something else that a reader could check against its source.${sup(2)}</p>
<p>The third cited sentence also carries its own reference, which links to a page outside the encyclopedia.${sup(3)}</p>
<ol class="references">${ref(1, "https://example.org/a")}${ref(2, "https://example.org/b")}${ref(3, "https://en.wikipedia.org/wiki/Self")}</ol></div>`;
const pinned = { title: "Stub Article", oldid: 4242, url: "https://en.wikipedia.org/w/index.php?oldid=4242", html, html_sha256: "x" };
const json = (o) => ({ ok: true, status: 200, json: async () => o });
const f = async (url) => {
  if (url.includes("list=random")) return json({ query: { random: [{ title: "Stub Article" }] } });
  if (url.includes("prop=revisions")) return json({ query: { pages: [{ revisions: [{ revid: 4242 }] }] } });
  if (url.includes("entities.json")) return json({ entities: [
    { id: "E1", name: "Sappho 31", type: "work", relation: "archive", aliases: [] },
    { id: "E2", name: "Attributization", type: "concept", relation: "archive", aliases: [] },
    { id: "E3", name: "The Feist Function", type: "work", relation: "archive", aliases: [], presents: "a method for restoring a voice" },
    { id: "E4", name: "Plato", type: "person", relation: "external", aliases: [] },
    { id: "E5", name: "alexanarch.org", type: "site", relation: "archive", aliases: [] } ] });
  if (url.includes("non/index.json")) return json({ entities: [{ entity: "sappho-31", name: "Sappho 31", addresses: ["sappho 31"] }, { entity: "attributization", name: "Attributization" }] });
  throw new Error("unexpected " + url);
};
const pin = async () => pinned;
const rnd = () => 0;

let fails = 0; const t = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) fails++; };

const o = await randomOpenPick({ f, pin, rnd });
t(o.oldid === 4242 && o.random.act === "open" && /cites a source plainly/.test(o.random.picked.sentence.text) && o.random.picked.article.title === "Stub Article",
  "random open: a cited sentence of a pinned random article is picked, and the pick names the article, revision and sentence");

const w = await randomConstructBody({ pool: "wikipedia", f, pin, rnd });
t(w.commission === "construct" && w.object.name === "Stub Article" && w.object.sources.join() === "https://example.org/a,https://example.org/b"
  && w.random.pool === "wikipedia" && w.random.pool_chosen === "by the caller" && w.random.picked.sources === 2,
  "random construct, wikipedia: an alternative to the article from the sources it cites, the encyclopedia's own links left out");

const a = await randomConstructBody({ pool: "archive", f, pin, rnd });
t(a.object.name === "The Feist Function" && a.object.description === "a method for restoring a voice" && a.random.pool === "archive" && /1 candidates/.test(a.random.drawn_from),
  "random construct, archive: an archive entity with no /non entry, external entities and sites left out");

const pool = await archivePool({ f });
t(pool.length === 1 && !pool.some((e) => /Sappho|Attributization/.test(e.name)), "the archive pool excludes what /non already holds");

let refused = false; try { await randomConstructBody({ pool: "elsewhere", f, pin, rnd }); } catch (e) { refused = e.status === 400; }
t(refused, "random construct: an unknown pool is refused (400)");

const auto = await randomConstructBody({ f, pin, rnd });
t(auto.random.pool_chosen === "at random", "random construct: with no pool named, the pool is chosen at random and says so");
t(citedLinks([{ footnotes: [{ links: ["https://x.org/1", "https://x.org/1", "ftp://no"] }] }]).length === 1, "cited links are unique and http(s) only");

if (fails) process.exit(1);
