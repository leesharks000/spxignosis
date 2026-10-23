// The sentence request, offered at the point of contact (operator, 2026-10-21: "sentences could exist as a profitable
// and accessible microservice, but offered at point of contact, where needed").
//
// The caller sends a sentence as it holds it and the page it came from. The service pins the page's revision, finds
// the sentence on it, recovers the sources the sentence cites, and reads it against them. The default is an opening:
// S3's two readings on the middle model, its declared checks, a disagreement returned as contested. A preliminary
// reading (one pass on the small model) is offered under its own name and keyed apart; it is never presented as an
// opening. The sentence is read against its own sources and the article's; the archive is never consulted here, and
// the price is in cents (operator, 2026-10-23). A reading already in the claim ledger is returned free, at its disclosed state: the revision, the hashes of
// the sources it read, and when it was made. New work is quoted, paid, and then ledgered and public.
import { pinRevision } from "./pin.js";
import { segment } from "./segment.js";
import { resolveSources } from "./resolve.js";
import { makeReader } from "./reader.js";
import { claimKey, readSentences, TIERS, withArticleSources } from "./run.js";
import { inputFor } from "./reader.js";
import { estimateClaim, estimateTokens, priceClaim } from "./cost.js";
import { load, save, sha256, politeFetch } from "./util.js";
import { NON } from "./s7/input.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const MODES = {
  opening: { tier: "ledger", model: TIERS.ledger.reader_model, passes: 2, label: "opening: two independent readings, reconciled, with the declared checks" },
  preliminary: { tier: "check", model: TIERS.check.reader_model, passes: 1, label: "preliminary reading: one pass on the small model; not an opening" },
};

// A Wikipedia page address: /wiki/Title, or index.php?title=…&oldid=…; other hosts are not read yet.
export function parsePage(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)wikipedia\.org$/.test(u.hostname) || !/^en\./.test(u.hostname.replace(/^www\./, ""))) return { unsupported: true, host: u.hostname };
  const oldid = u.searchParams.get("oldid");
  const title = u.searchParams.get("title") || decodeURIComponent((u.pathname.match(/^\/wiki\/(.+)$/) || [])[1] || "").replace(/_/g, " ");
  return { title: title || null, oldid: oldid && /^\d+$/.test(oldid) ? Number(oldid) : null };
}

async function currentRevision(title) {
  const r = await politeFetch(`https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=ids|timestamp&titles=${encodeURIComponent(title)}&redirects=1&format=json&formatversion=2`);
  if (r.status !== 200) throw Object.assign(new Error(`wikipedia answered ${r.status}`), { status: 502 });
  const pg = (JSON.parse(r.body).query?.pages || [])[0];
  if (!pg || pg.missing || !pg.revisions?.[0]) throw Object.assign(new Error(`no Wikipedia article at "${title}"`), { status: 404 });
  return { oldid: pg.revisions[0].revid, title: pg.title, timestamp: pg.revisions[0].timestamp };
}

// Normalized for matching: footnote markers, quotes, dashes and spacing set aside.
const norm = (s) => String(s || "").normalize("NFKC").replace(/\[\s*(\d+|[a-z]|citation needed|note \d+)\s*\]/gi, " ")
  .replace(/[“”"‘’']/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const words = (s) => norm(s).match(/[\p{L}\p{N}]+/gu) || [];
export function locate(claims, text) {
  const t = norm(text);
  if (!t) return { claim: null, closest: [] };
  const exact = claims.find((c) => norm(c.text) === t) || claims.find((c) => norm(c.text).includes(t) && t.length >= 25) || claims.find((c) => t.includes(norm(c.text)) && norm(c.text).length >= 25);
  if (exact) return { claim: exact, match: "exact", closest: [] };
  const tw = new Set(words(text));
  const scored = claims.map((c) => { const cw = new Set(words(c.text)); let n = 0; for (const w of tw) if (cw.has(w)) n++; return { c, s: n / Math.max(1, new Set([...tw, ...cw]).size) }; }).sort((a, b) => b.s - a.s);
  if (scored[0] && scored[0].s >= 0.75) return { claim: scored[0].c, match: `near (${Math.round(scored[0].s * 100)}% of words shared)`, closest: [] };
  return { claim: null, closest: scored.slice(0, 3).filter((x) => x.s > 0.2).map((x) => ({ id: x.c.id, section: x.c.section, text: x.c.text, overlap: Math.round(x.s * 100) / 100 })) };
}

// Where /non already holds the sentence: a field claim of some row quoting it.
let NON_INDEX = null;
export function nonEntriesFor(text) {
  if (!NON_INDEX) {
    NON_INDEX = [];
    const d = join(NON, "ledgers");
    if (existsSync(d)) for (const row of readdirSync(d)) {
      const f = join(d, row, "field.json");
      if (!existsSync(f)) continue;
      try { for (const [id, c] of Object.entries(JSON.parse(readFileSync(f, "utf8")).field_claims || {})) if (c.quote) NON_INDEX.push({ row, id, q: norm(c.quote) }); } catch {}
    }
  }
  const t = norm(text);
  if (t.length < 25) return [];
  return NON_INDEX.filter((x) => x.q.includes(t) || (t.includes(x.q) && x.q.length >= 25)).map((x) => ({ row: x.row, field_claim: x.id, url: `https://www.alexanarch.org/non/${x.row}/` }));
}

export const requestId = ({ text, url, mode }) => `S-${sha256(`${norm(text)}|${String(url).trim()}|${mode}`).slice(0, 20)}`;

// Prepares a sentence request: pins, locates, resolves; returns the ledgered reading (free), or the quote to pay.
export async function prepareSentence({ text, url, mode = "opening" }) {
  if (!MODES[mode]) throw Object.assign(new Error("mode is opening or preliminary"), { status: 400 });
  if (!text || String(text).trim().length < 8) throw Object.assign(new Error("text: the sentence as you have it"), { status: 400 });
  const page = parsePage(url || "");
  if (!page) throw Object.assign(new Error("url: the page the sentence came from"), { status: 400 });
  if (page.unsupported) throw Object.assign(new Error(`pages on ${page.host} are not read yet; English Wikipedia pages are`), { status: 422 });
  const rev = page.oldid ? { oldid: page.oldid } : await currentRevision(page.title);
  const pinned = await pinRevision(rev.oldid);
  const { claims } = segment(pinned);
  const found = locate(claims, text);
  const rid = requestId({ text, url, mode });
  const base = { request_id: rid, mode, mode_label: MODES[mode].label, page: { title: pinned.title, oldid: pinned.oldid, url: pinned.url, html_sha256: pinned.html_sha256 } };
  if (!found.claim) return { ...base, state: "not found", status: 404, note: "the sentence is not on this revision of the page", closest: found.closest };
  const c = found.claim;
  const non = nonEntriesFor(c.text);
  // S3 rule 1: the sentence travels with its own sources and the ones the article cites elsewhere that bear on it.
  const sources = withArticleSources([c], await resolveSources(claims.filter((x) => x.cited)));
  const srcs = sources[c.id];
  if (!srcs.length) return { ...base, state: "uncited", status: 200, sentence: { id: c.id, section: c.section, text: c.text, match: found.match }, note: "the sentence carries no citation, and no source the article cites elsewhere bears on it; there is nothing to read it against", non };
  const M = MODES[mode], reader = makeReader(undefined, M.model, { passes: M.passes });
  const key = claimKey(c, srcs, M.model, reader);
  const ledgered = load(`ledger/claims/${key}.json`);
  const tokens = estimateTokens(JSON.stringify(inputFor(c, srcs, pinned))) + 2500;
  const est = M.passes === 1 ? estimateClaim(M.model, tokens, 1200, 0) : estimateClaim(M.model, tokens);
  const price = ledgered ? 0 : priceClaim(M.tier, est, false);
  const prepared = { ...base, state: ledgered ? "recorded" : "quoted", sentence: { id: c.id, section: c.section, text: c.text, match: found.match }, ledger_key: key,
    sources: srcs.map((s, i) => ({ ref: `S${i + 1}`, located: s.located, label: s.edition || s.citation || s.url, url: s.final_url || s.url, availability: s.availability, text_sha256: s.text_sha256 || null })),
    est_cost_usd: Math.round(est * 1e5) / 1e5, price_usd: price, non, created: new Date().toISOString(),
    expires: new Date(Date.now() + 2 * 3600e3).toISOString() };
  save(`sentences/pending/${rid}.json`, prepared);
  return prepared;
}

// Reads the sentence (or serves its ledgered reading): the opening, or the preliminary reading, as an entry.
export async function readSentence(rid) {
  const p = load(`sentences/pending/${rid}.json`);
  if (!p) throw Object.assign(new Error("unknown sentence request; ask again"), { status: 404 });
  const pinned = await pinRevision(p.page.oldid);
  const { claims } = segment(pinned);
  const c = claims.find((x) => x.id === p.sentence.id);
  const sources = withArticleSources([c], await resolveSources(claims.filter((x) => x.cited)));
  const M = MODES[p.mode], reader = makeReader(undefined, M.model, { passes: M.passes });
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const s3 = await readSentences({ claims: [c], sources, pinned, model: M.model, reader, priceOf: { [c.id]: p.price_usd }, onProgress: () => {}, usage });
  const entry = s3.entries[0], ev = s3.evidence[0] || null;
  const recorded = load(`ledger/claims/${p.ledger_key}.json`);
  const out = {
    request_id: rid, mode: p.mode, mode_label: p.mode_label, page: p.page, sentence: p.sentence,
    result: entry ? { status: entry.status, support: entry.support, support_source: entry.support_source, innocent_reading: entry.innocent_reading, what_the_source_says: entry.what_the_source_says, changes: entry.changes, deltas: entry.deltas, operation: entry.operation, converted: entry.converted, attributization: entry.attributization, retained_authority: entry.retained_authority, invitation: entry.invitation, five_part: entry.five_part,
      readings: entry.readings, spans: entry.spans, sources: entry.sources, from_ledger: !!entry.from_ledger } : null,
    state: recorded ? { recorded: recorded.created, ledger_key: p.ledger_key, revision: p.page.oldid, source_hashes: p.sources.map((s) => s.text_sha256) } : null,
    non: p.non, evidence: ev ? { passes: ev.passes.map((x) => ({ model: x.model, validation: x.validation })), verdict: ev.verdict } : null,
    breaches: s3.breaches, cost: { actual_usd: Math.round(s3.actual * 1e5) / 1e5, charged_usd: s3.charge },
    note: p.mode === "preliminary" ? "a preliminary reading: one pass on the small model; ask with mode=opening for the opening" : undefined,
  };
  save(`sentences/results/${rid}.json`, out);
  return out;
}
