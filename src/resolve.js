// S2. Resolve sources: every cited source fetched once, saved verbatim, hashed.
import { politeFetch, sha256, save, load } from "./util.js";

// Classical works cited by abbreviation -> CTS text in a pinned repository commit.
// Extend as articles require; an unknown abbreviation resolves as "unresolved", never guessed.
const F1K = "https://raw.githubusercontent.com/OpenGreekAndLatin/First1KGreek/7881c563436f52fb3550e6daa6df94be1b83b0e3/data";
export const CLASSICAL = {
  "Soph. Ref.": { urn: "urn:cts:greekLit:tlg0086.tlg040.1st1K-grc1", url: `${F1K}/tlg0086/tlg040/tlg0086.tlg040.1st1K-grc1.xml`, title: "Aristotle, De sophisticis elenchis", unit: "chapter" },
  "SE": { alias: "Soph. Ref." },
  "Top.": { urn: "urn:cts:greekLit:tlg0086.tlg044.1st1K-grc1", url: `${F1K}/tlg0086/tlg044/tlg0086.tlg044.1st1K-grc1.xml`, title: "Aristotle, Topica", unit: "chapter" },
};

const stripTags = (x) => x.replace(/<note[\s\S]*?<\/note>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function htmlToText(h) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&(ldquo|rdquo|lsquo|rsquo|ndash|mdash|hellip);/g, (_, n) => ({ ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…" })[n])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, " ").trim();
}

// A source is read again when its snapshot is older than the policy for its state (2026-10-25, the first adversarial
// test: a snapshot was kept by URL forever, so a changed source never reached the execution keys, and a source restored
// after a 404 stayed dead). Fetched: 7 days (GNOSIS_SOURCE_TTL_DAYS); dead, blocked or thin: 1 day; a transient failure
// (no answer, 429, 5xx): 1 hour. On a revalidation the same bytes keep the snapshot and record the check; new bytes, or
// a dead source answering again, make a new current snapshot, and the one it replaces is kept under snapshots/history/,
// never overwritten, so every reading made against it keeps its evidence; a transient failure never replaces good bytes.
const DAY = 86400e3, SOURCE_TTL = Number(process.env.GNOSIS_SOURCE_TTL_DAYS || 7) * DAY;
const transient = (st) => st === 0 || st === 429 || st >= 500;
const ttlOf = (snap) => snap.availability === "fetched" ? SOURCE_TTL : transient(snap.status) ? 3600e3 : DAY;
export async function snapshot(url, { fresh = false } = {}) {
  const key = `snapshots/sources/${sha256(url).slice(0, 24)}.json`;
  const hit = await load(key);
  if (hit && !fresh && Date.now() - Date.parse(hit.checked || hit.retrieved) < ttlOf(hit)) return hit;
  const now = await fetchSnapshot(url);
  if (!hit) { await save(key, now); return now; }
  if (now.raw_sha256 === hit.raw_sha256 && now.status === hit.status) { const kept = { ...hit, checked: now.retrieved }; await save(key, kept); return kept; }
  if (transient(now.status) && hit.availability === "fetched") { const kept = { ...hit, checked: now.retrieved, last_check: { at: now.retrieved, status: now.status, kept: "the earlier bytes: the source did not answer" } }; await save(key, kept); return kept; }
  await save(`snapshots/history/${sha256(url).slice(0, 24)}/${hit.retrieved.replace(/[:.]/g, "-")}.json`, hit);
  const next = { ...now, previous: { retrieved: hit.retrieved, status: hit.status, availability: hit.availability, raw_sha256: hit.raw_sha256, text_sha256: hit.text_sha256 } };
  await save(key, next);
  return next;
}
async function fetchSnapshot(url) {
  let r;
  try { r = await politeFetch(url); } catch (e) { r = { status: 0, body: "", contentType: "", error: String(e) }; }
  // An http link that redirects to a site root has lost its path; try the same path over https.
  const lostPath = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.pathname.length > 1 && y.pathname === "/"; } catch { return false; } };
  if (r.url && lostPath(url, r.url) && url.startsWith("http:")) {
    const r2 = await politeFetch(url.replace(/^http:/, "https:"));
    if (r2.status === 200 && !lostPath(url, r2.url)) r = r2;
  }
  const redirectedToRoot = r.url && lostPath(url, r.url);
  const text = r.status === 200 ? (/html/.test(r.contentType) ? htmlToText(r.body) : r.body) : "";
  const snap = {
    url, final_url: r.url || url, status: r.status, retrieved: new Date().toISOString(),
    raw_sha256: r.body ? sha256(r.body) : null, text, text_sha256: text ? sha256(text) : null,
    availability: redirectedToRoot ? "dead-redirect" : r.status === 200 && text.length > 200 ? "fetched" : r.status === 200 ? "fetched-thin" : r.status === 403 || r.status === 401 ? "paywalled-or-blocked" : r.status === 404 ? "dead" : "unavailable",
  };
  return snap;
}

async function classical(ptr) {
  let w = CLASSICAL[ptr.work];
  if (w && w.alias) w = CLASSICAL[w.alias];
  if (!w) return { kind: "classical", pointer: ptr, availability: "unresolved", reason: `no edition mapped for "${ptr.work}"` };
  const key = `snapshots/classical/${sha256(w.url + "#" + ptr.chapter).slice(0, 24)}.json`;
  const hit = await load(key);
  if (hit) return hit;
  const r = await politeFetch(w.url);
  if (r.status !== 200) return { kind: "classical", pointer: ptr, availability: "unavailable", status: r.status };
  const chapters = [...r.body.matchAll(/<div[^>]*subtype="chapter"[^>]*n="(\d+)"[^>]*>/g)].map((m) => ({ n: Number(m[1]), at: m.index }));
  let want = Number(ptr.chapter), numbering = "matches";
  const max = Math.max(...chapters.map((c) => c.n));
  // Editions differ in chapter division: some close the treatise at a lower number.
  // A citation to a chapter beyond the edition's last resolves to the closing chapter, flagged.
  if (!chapters.some((c) => c.n === want) && want > max) { want = max; numbering = `cited chapter ${ptr.chapter}; this edition has ${max} chapters, and its chapter ${max} is the closing chapter`; }
  const i = chapters.findIndex((c) => c.n === want);
  const end = i >= 0 && chapters[i + 1] ? chapters[i + 1].at : r.body.indexOf("</body>");
  const text = i >= 0 ? stripTags(r.body.slice(chapters[i].at, end)) : "";
  const snap = {
    kind: "classical", pointer: ptr, edition: w.title, urn: w.urn, url: w.url,
    scope: `${w.unit} ${want}`, numbering,
    locus_note: `cited at Bekker ${ptr.locus}; this edition is divided by chapter and section, without Bekker lines, so the whole chapter is the resolved source`,
    retrieved: new Date().toISOString(), raw_sha256: sha256(r.body), text, text_sha256: text ? sha256(text) : null,
    availability: text ? "fetched" : "unresolved", licence: "CC BY-SA 4.0 (First1KGreek); underlying edition public domain",
  };
  await save(key, snap);
  return snap;
}

// Pick the reading link for a footnote: prefer a direct text over DOI/handle/index links.
function pickLink(links) {
  const rank = (u) => (/doi\.org|hdl\.handle|semanticscholar|worldcat|books\.google/.test(u) ? 2 : 0);
  return [...links].sort((a, b) => rank(a) - rank(b))[0];
}

export async function resolveSources(claims) {
  const out = {};
  for (const c of claims) {
    const srcs = [];
    for (const p of c.pointers) srcs.push(await classical(p));
    for (const f of c.footnotes) {
      if (f.missing) { srcs.push({ kind: "footnote", note: f.id, availability: "unresolved", reason: "footnote id not found" }); continue; }
      const link = f.links && f.links.length ? pickLink(f.links) : null;
      if (!link) { srcs.push({ kind: "footnote", note: f.id, citation: f.text, availability: "print-only" }); continue; }
      const snap = await snapshot(link);
      srcs.push({ kind: "footnote", note: f.id, citation: f.text, ...snap });
    }
    out[c.id] = srcs;
  }
  return out;
}
