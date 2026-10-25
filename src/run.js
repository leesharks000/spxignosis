// The opening job: S0–S9 for one pinned revision. S3 reads each sentence against the sources it cites (T against L_F(B));
// at the commission and portable tiers S7–S8 consult the archive by its own procedure and compose the entity's /non
// row, which is public; the portable tier packages the row's knowledge object. An opening reads the article's sentences
// against their sources and never consults the archive (operator, 2026-10-23).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pinRevision } from "./pin.js";
import { segment } from "./segment.js";
import { resolveSources } from "./resolve.js";
import { makeReader, inputFor, normalizeReading, READER_PROTOCOL, CALIBRATION, INVITATION_STATUS } from "./reader.js";
import { relevance } from "./window.js";
import { fromWikipedia, fromEntity, capturesFor } from "./s7/input.js";
import { discern } from "./s7/discern.js";
import { constructArticle, asClaims, CONSTRUCTION_PROTOCOL } from "./s7/construct.js";
import { passLog, MODELS as S7_MODELS } from "./s7/model.js";
import { snapshot } from "./resolve.js";
import { politeFetch, SEED } from "./util.js";
import { runS7, s7Key, readingAt, keptReading } from "./s7/run.js";
import { ONTOLOGY_RULES } from "./s7/ontology.js";
import { estimateS7 } from "./s7/estimate.js";
import { archiveOn, readLanding } from "./grounding.js";
import { publicationState } from "./s7/publish.js";
import { archiveRelease } from "./s7/traverse.js";
import { validateReading, reconcile, NORMALIZATION, deltaText } from "./validate.js";
import { sha256, save, load, STORE } from "./util.js";
import { renderOpenedHTML, annotations } from "./emit.js";
import { estimateTokens, estimateClaim, priceClaim, callCost, PRICE_TABLE, POLICY, MEASURED, s7Stages, stageCharge, ceilCent } from "./cost.js";
import { packageRow, writePackage } from "./writer.js";

// How many claims are read at once, and how long one invocation reads before it hands the run on (seconds).
export const READ_CONCURRENCY = Number(process.env.GNOSIS_READ_CONCURRENCY || 6);
export const RUN_SECONDS = Number(process.env.GNOSIS_RUN_SECONDS || 210);
export const SERVICE = { name: "SPXI-gnΩsis", version: "0.20.3", protocol: "EA-WIKI-OPEN-01 v1.1 (#1697)" };
export const NON_URL = (entity) => `https://www.alexanarch.org/non/${entity}/`;

// Which model reads at which tier. Check runs on the small model; openings on the middle one.
export const TIERS = {
  check: { reader_model: "claude-haiku-5-5", steps: "S0–S3, S6 integrity" },
  ledger: { reader_model: "claude-sonnet-5-5", steps: "S0–S6" },
  opening: { reader_model: "claude-sonnet-5-5", steps: "S0–S6: the article opened sentence by sentence against its cited sources; the archive is not consulted" },
  commission: { reader_model: "claude-sonnet-5-5", steps: "S0–S9: the opening, and the entity's /non row composed with the archive admitted (public)" },
  portable: { reader_model: "claude-sonnet-5-5", steps: "the commission, and the entity's knowledge object as a portable package" },
};

function policyState() {
  // The policy texts are seed data: in this process's store when it was seeded (tests), else as committed.
  const dir = [join(STORE, "policies"), join(SEED, "policies")].find((d) => existsSync(d));
  if (!dir) return { _none: "no policy texts saved in the store" };
  return Object.fromEntries(readdirSync(dir).map((f) => [f.replace(/\.wiki$/, "").replace(/_/g, " ").replace("Wikipedia ", "Wikipedia:"), sha256(readFileSync(join(dir, f), "utf8"))]));
}

// A claim's reading is reusable when everything it was computed from matches: the sentence, the hashes of its
// sources, the policies, the reader adapter and its mode (live or replay), the model, the protocol and the calibration
// release. A replayed reading can never serve a live run.
export function claimKey(claim, srcs, model, reader) {
  return sha256(JSON.stringify({ claim: claim.text_sha256, sources: srcs.map((s) => s.text_sha256 || s.availability), policies: policyState(),
    protocol: READER_PROTOCOL, model, model_2: process.env.GNOSIS_MODEL_2 || model, adapter: reader.id, mode: reader.mode, calibration: CALIBRATION }));
}

// Tiers that consult the archive and compose the entity's /non row.
// The archive is consulted on commission only (operator, 2026-10-23).
export const ADMITS = new Set(["commission", "portable"]);


export async function prepare(oldid, only) {
  const pinned = await pinRevision(oldid);
  const { claims: all } = segment(pinned);
  const claims = only ? all.filter((c) => only.includes(c.id)) : all;
  // Every cited sentence of the article is resolved, so a sentence can be read against the sources the article cites
  // elsewhere (S3 rule 1); only the requested claims are read.
  const cited = await resolveSources(all.filter((c) => c.cited));
  return { pinned, claims, sources: withArticleSources(claims, cited) };
}

// S3 rule 1 (EA-WIKI-OPEN-01 v1.1): the innocent reading is built first from the sources the article itself cites
// anywhere, then from the cited source; an uncited sentence is read against the sources the article cites elsewhere,
// and support found there is recorded as article-internal, never as a citation at the sentence. Each claim keeps its
// own sources first ("at the sentence"); the article's other sources follow ("elsewhere in the article"), ranked by
// how strongly their passages bear on the sentence, at most ARTICLE_SOURCES of them, none that bears on it not at all.
export const ARTICLE_SOURCES = Number(process.env.GNOSIS_ARTICLE_SOURCES || 4);
export function withArticleSources(claims, cited) {
  const idOf = (s) => s.text_sha256 || s.final_url || s.url || `${s.edition || ""}|${s.scope || ""}`;
  const pool = new Map();
  for (const [cid, srcs] of Object.entries(cited)) for (const s of srcs) if (s.text && !pool.has(idOf(s))) pool.set(idOf(s), { ...s, first_cited_at: cid });
  const out = {};
  for (const c of claims) {
    const own = (cited[c.id] || []).map((s) => ({ ...s, located: "at the sentence" }));
    const ownIds = new Set(own.map(idOf));
    const others = [...pool.values()].filter((s) => !ownIds.has(idOf(s)))
      .map((s) => ({ s, r: relevance(s.text, c.text) })).filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r).slice(0, ARTICLE_SOURCES)
      .map(({ s }) => ({ ...s, located: "elsewhere in the article" }));
    out[c.id] = [...own, ...others];
  }
  return out;
}

// Quote (free): S0–S2, a per-claim cost estimate from the passages that would be sent, and a price that clears it.
export async function quote(oldid, { tier = "opening", claims: only, quote_id = null, ttl_ms = 15 * 60_000 } = {}) {
  if (!TIERS[tier]) throw new Error(`unknown tier ${tier}`);
  const { pinned, claims, sources } = await prepare(oldid, only);
  const model = TIERS[tier].reader_model;
  const reader = makeReader(undefined, model);
  // Every sentence with something to read it against is priced: its own sources, or the article's (S3 rule 1).
  const lines = await Promise.all(claims.filter((c) => (sources[c.id] || []).length).map(async (c) => {
    const srcs = sources[c.id];
    const ledgered = !!await load(`ledger/claims/${claimKey(c, srcs, model, reader)}.json`);
    const tokens = estimateTokens(JSON.stringify(inputFor(c, srcs, pinned))) + 2500; // + instructions
    const est = ledgered ? 0 : estimateClaim(model, tokens);
    return { id: c.id, ledgered, est_tokens: tokens, est_cost_usd: Math.round(est * 1e5) / 1e5, price_usd: priceClaim(tier, est, ledgered) };
  }));
  // S7–S8: the archive consulted and the /non row composed, priced from the traversal it would run.
  let s7 = null;
  if (ADMITS.has(tier)) {
    const input = fromWikipedia(pinned, claims, sources);
    const key = s7Key(input);
    const prior = await load(`s7/${input.row}/by-key/${key}.json`);
    const ledgered = !!prior?.complete && prior.ontology_rules === ONTOLOGY_RULES;
    const e = ledgered ? null : await estimateS7(input);
    s7 = { id: "S7", row: input.row, entity: input.entity.name, non_url: NON_URL(input.entity.slug), key, ledgered, estimate: e };
    if (ledgered) Object.assign(s7, { est_cost_usd: 0, price_usd: POLICY.ledgered_s7 });
    else {
      // Two stages, priced apart (2026-10-25); the execution budget is each stage's price divided by the budget ratio,
      // so a run that costs more than estimated still clears its cost at the price it was quoted.
      s7.stages = s7Stages(e, { readingLedgered: !!(await keptReading(input, key)) });
      s7.est_cost_usd = Math.round((s7.stages.reading.est_cost_usd + s7.stages.construction.est_cost_usd) * 1e4) / 1e4;
      s7.price_usd = Math.round((s7.stages.reading.price_usd + s7.stages.construction.price_usd) * 100) / 100;
    }
    s7.budget_usd = s7.stages ? Math.round((s7.stages.reading.budget_usd + s7.stages.construction.budget_usd) * 100) / 100 : Math.round((s7.price_usd / POLICY.s7_budget_ratio) * 100) / 100;
  }
  const package_price = tier === "portable" ? POLICY.portable_package : 0;
  const est_cost = lines.reduce((n, l) => n + l.est_cost_usd, 0) + (s7?.est_cost_usd || 0);
  const max = Math.max(0.01, Math.round((lines.reduce((n, l) => n + l.price_usd, 0) + (s7?.price_usd || 0) + package_price) * 100) / 100);
  const q = {
    quote_id: quote_id || `Q-${sha256(`${oldid}|${tier}|${(only || []).join(",")}|${Date.now()}`).slice(0, 16)}`,
    article: { title: pinned.title, oldid: pinned.oldid, url: pinned.url, html_sha256: pinned.html_sha256 },
    tier, tier_steps: TIERS[tier].steps, reader_model: model,
    claims_total: claims.length, claims_cited: claims.filter((c) => c.cited).length, claims_uncited: claims.filter((c) => !c.cited).length,
    claims_read: lines.length, claims_read_against_the_article: lines.filter((l) => !claims.find((c) => c.id === l.id).cited).length,
    claims_ledgered: lines.filter((l) => l.ledgered).length,
    lines, s7: s7 || undefined, package_price_usd: package_price || undefined,
    estimated_cost_usd: Math.round(est_cost * 1e4) / 1e4, max_price_usd: max, currency: "USD (card, Stripe Checkout); agents pay the same amount in USDC once x402 is configured",
    pricing: { table: PRICE_TABLE.version, floor_per_claim: POLICY.floor_per_claim[tier], sentence_margin: POLICY.sentence_margin, margin: POLICY.margin,
      measured_cost_per_claim: MEASURED[model] || null, execution_budget_usd: Math.round((max / POLICY.sentence_margin) * 100) / 100,
      rule: "price per claim = max(floor_per_claim, estimated cost × sentence_margin), rounded up to the cent; the archive's consultation priced in two stages from the traversal it would run, each max(its floor, estimated cost × margin): the reading (traversal, admission, extraction, the ontology read twice) and the construction (the knowledge object, compression, delta and audit); a stage is charged when it delivers, at its measured cost × margin, never above its line, and a stage that does not deliver is refunded; work already in the ledger at the ledgered rates",
      lines_at_floor: lines.filter((l) => !l.ledgered && l.price_usd === POLICY.floor_per_claim[tier]).length },
    execution_contract: {
      sources: `the sources each sentence cites (footnotes and classical pointers), fetched once and hashed; and, for every sentence, at most ${ARTICLE_SOURCES} of the sources the article cites elsewhere that bear on it, marked "elsewhere in the article" (S3 rule 1); an uncited sentence is read against those alone`,
      sent_to_reader: "the passages of each source that bear on the claim (classical chapters whole), with a code-computed structure summary; quotations are checked against the full text",
      search_scope: ADMITS.has(tier) ? "the sources the article cites (the disclosed field B); and the Crimson Hexagonal Archive by its own procedure (EA-NEGONT-02 v0.9 §3.4): every deposit text and every blog post the blog–deposit map does not assign to a deposit, scanned for the entity's strings (the article's title and the names its lead gives) at D, R and O; one citation hop from the deposits admitted by reading, screened by string; admission by two reading passes" : "cited sources only at this tier",
      archive_release: s7?.estimate?.release || (s7 ? archiveRelease() : null),
      publication: ADMITS.has(tier) ? `the entity's /non row is public (CC BY 4.0) at ${s7.non_url} once landed: the opening contributes to the opened Wikipedia` : undefined,
      execution_budget: s7 ? `model spending for the archive's consultation stops at $${s7.budget_usd} (each stage's estimated cost × ${POLICY.s7_contingency}, never above its line)${s7.stages ? `, and $${s7.stages.construction.budget_usd} of it is held for the construction while the reading runs` : ""}; passes beyond it are recorded as not run, and the row is composed from what was read, marked` : undefined,
      deliverables: s7 ? { reading: "the reading dossier: the traversal, the admitted deposits with their readings, the archive and field ledgers with every claim's quote checked, and both ontology readings with the determination of the case and ρ (in the landing tree)", construction: "the knowledge object, its compression and the field-only arm, the delta read against T, and the reverse entailment audit (the /non row)" } : undefined,
      context_rule: "passages first; when a reading pass reports that the passages lack what a judgment needs, the passages are widened and the claim is read again, once",
      retrieval_budget: { max_sources: 100, max_bytes_per_source: 5_000_000 },
      stopping_rule: "every cited source fetched or recorded unavailable",
    },
    expires: new Date(Date.now() + ttl_ms).toISOString(),
  };
  await save(`quotes/${q.quote_id}.json`, { ...q, only: only || null });
  return q;
}

// The entity path: an entity with no encyclopedia article. Its sources are fetched and hashed; the encyclopedia's
// absence at its title is observed and recorded; the quote prices the construction, the sentences' checks and S7.
async function wikipediaAt(title) {
  const r = await politeFetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&format=json&formatversion=2`);
  if (r.status !== 200) return { title, observed: false, status: r.status, at: new Date().toISOString() };
  const pg = (JSON.parse(r.body).query?.pages || [])[0] || {};
  return { title, observed: true, exists: !pg.missing, page_title: pg.title || title, at: new Date().toISOString(),
    url: pg.missing ? null : `https://en.wikipedia.org/wiki/${encodeURIComponent((pg.title || title).replace(/ /g, "_"))}` };
}

// T for an entity, in order: a composition the caller supplies, admitted only through discernment (discern.js: what code
// verifies at the quote, S3's reading at the opening, and the caller's attestation recorded as attestation, the row held
// from landing until the registry's intake seats it); the composition layer's own article of the entity, from the
// captures seated in the Capture Registry (the most recent at its bare addresses, or the seated capture the caller
// names); the article constructed under Wikipedia's content policies from sources the service fetches itself. Source
// text is never taken from the caller: a source is a URL the service fetches and hashes, and a card's snippet supplied
// with a transcript is the caller's attestation, never evidence.
export function checkSupplied(spec) {
  for (const s of spec.sources || []) if (typeof s !== "string" || !/^https?:\/\//.test(s)) throw new Error("each source is a URL the service fetches and hashes itself; source text supplied by the caller is not admitted");
  if (spec.transcript && (typeof spec.transcript.text !== "string" || !spec.transcript.text.trim())) throw new Error("a supplied composition needs its text");
  for (const c of spec.transcript?.cite_list || []) if (c.url && !/^https?:\/\//.test(c.url)) throw new Error("a card's url must be http(s)");
}
async function prepareEntity(spec) {
  const snaps = [];
  checkSupplied(spec);
  let discernment = null, supplied = false;
  if (spec.transcript?.text && !spec.transcript.capture) {
    // The supplied composition's cards: each URL fetched by the service; a card without one carries nothing checkable.
    for (const c of (spec.transcript.cite_list || []).slice(0, 40)) {
      if (c.url) { const s = await snapshot(c.url); snaps.push({ ...s, title: `${c.site || ""} — ${c.title || ""}`.trim(), card_snippet_attested: c.snip || null }); }
      else snaps.push({ url: null, title: `${c.site || ""} — ${c.title || ""}`.trim(), text: "", text_sha256: null, availability: "card without URL (its snippet is the caller's attestation, not evidence)", retrieved: null });
    }
    discernment = spec.transcript.discernment || discern(spec, snaps);
    if (discernment.verdict !== "not admissible as T") return { snaps, capture: null, captures: null, discernment, supplied: true };
    snaps.length = 0; // not admitted: T falls to the registry or the construction, and the discernment is recorded
  }
  // Construction composes the object with no T, so no capture is looked up for it. An operator has no bare address:
  // it is opened only from a capture the caller names or a composition the caller supplies. A quote already settled on
  // a seated capture carries it; the run fetches the same cards again.
  const lookUp = !spec.transcript?.capture && spec.commission !== "construct" && (spec.kind !== "operator" || spec.capture);
  const captures = lookUp ? capturesFor([spec.name, ...(spec.kind === "operator" ? spec.strings || [] : spec.aliases || [])], { pick: spec.capture || null }) : null;
  const capture = captures?.primary || null;
  const cards = capture?.cite_list || spec.transcript?.capture?.cite_list;
  if (cards) {
    // B is the capture's disclosed field: each card fetched where it carries a URL; a card without one is its snippet.
    for (const [i, c] of cards.slice(0, 40).entries()) {
      if (c.url) { const s = await snapshot(c.url); snaps.push({ ...s, title: `${c.site || ""} — ${c.title || ""}`.trim() }); }
      else snaps.push({ url: null, title: `${c.site || ""} — ${c.title || ""}`.trim(), text: c.snip || "", text_sha256: c.snip ? sha256(c.snip) : null, availability: c.snip ? "card snippet only (no URL on the card)" : "card without URL or snippet", retrieved: null });
    }
  } else for (const u of (spec.sources || []).slice(0, 40)) snaps.push(await snapshot(u));
  return { snaps, capture, captures, discernment, supplied };
}
const specWithCapture = (spec, capture) => (capture ? { ...spec, address: capture.q, transcript: { text: capture.transcript, surface: capture.surface, date: capture.date, auth: capture.auth,
  capture: { slug: capture.slug, entry: capture.entry, obs_id: capture.obs_id, addr_id: capture.addr_id, q: capture.q, cite_list: capture.cite_list } } } : spec);

// Two commissions (operator, 2026-10-21). *open*: a composition already at an address (a capture seated in the
// registry, or a supplied composition admitted through discernment) is read against its sources and against the
// archive; the delta is the product. *construct*: the object (an entity, or an operator) is composed from the archive
// and the sources the caller names, with no T; the article Wikipedia's policies would write is constructed only when
// the caller asks for it as a comparison (compare: "encyclopedia"). With no commission named, a composition found or
// supplied is opened, and otherwise the object is constructed.
export async function quoteEntity(spec, { tier = "commission", quote_id = null, ttl_ms = 15 * 60_000 } = {}) {
  if (!spec?.name) throw new Error("object.name is required");
  if (!ADMITS.has(tier)) throw new Error("an object without an article is commissioned at the commission or portable tier");
  if (spec.kind && !["entity", "operator"].includes(spec.kind)) throw new Error("object.kind is entity or operator");
  if (spec.kind === "operator" && !(spec.strings || []).length) throw new Error("an operator needs its strings: the phrases in which it is performed and in which entities speak it");
  if (spec.commission && !["open", "construct"].includes(spec.commission)) throw new Error("commission is open or construct");
  if (spec.commission === "construct" && spec.transcript) throw new Error("construct composes the object with no T; to read a composition, commission open");
  const { snaps, capture, captures, discernment, supplied } = await prepareEntity(spec);
  if (spec.commission === "open" && !capture && !supplied)
    throw new Error(discernment ? "nothing to open: the supplied composition was not admitted (see discernment), and no capture is seated at the object's addresses; the object can be constructed (commission: construct)"
      : "nothing to open: no capture is seated at the object's addresses and none was supplied; the object can be constructed (commission: construct)");
  spec = { ...spec, commission: spec.commission || (capture || supplied ? "open" : "construct") };
  const wikipedia = await wikipediaAt(spec.name);
  if (discernment && !supplied) { const { transcript, ...rest } = spec; spec = { ...rest, supplied_not_admitted: { discernment } }; }
  else if (supplied) spec = { ...spec, transcript: { ...spec.transcript, supplied: true, discernment } };
  spec = specWithCapture(spec, capture);
  const input = fromEntity(spec, { sources: snaps, wikipedia });
  const e = await estimateS7(input);
  const srcTok = input.field.reduce((n, b) => n + Math.min(estimateTokens(b.text), 9000), 0);
  const compare = spec.commission === "construct" && spec.compare === "encyclopedia";
  const construct = compare ? callCost(S7_MODELS.reading, { input_tokens: srcTok + 2500, output_tokens: 6000 }) : 0;
  // S3 reads each sentence of T against its sources: a capture's or a supplied composition's sentences against its cards.
  const nSent = spec.transcript?.text ? (input.field.some((b) => b.text) ? Math.min(30, input.T.claims.length) : 0) : compare ? Math.min(30, input.field.filter((b) => b.text).length * 3) : 0;
  const perSentEst = estimateClaim(TIERS[tier].reader_model, Math.min(9000, Math.ceil(srcTok / Math.max(1, input.field.length))) + 2500);
  const sentence_price = priceClaim(tier, perSentEst, false);
  const stages = s7Stages(e);
  const s7 = { id: "S7", row: input.row, entity: input.entity.name, non_url: NON_URL(input.entity.slug), key: null, ledgered: false, estimate: e, stages,
    est_cost_usd: Math.round((stages.reading.est_cost_usd + stages.construction.est_cost_usd) * 1e4) / 1e4,
    price_usd: Math.round((stages.reading.price_usd + stages.construction.price_usd) * 100) / 100 };
  s7.budget_usd = Math.round((stages.reading.budget_usd + stages.construction.budget_usd + construct * POLICY.s7_contingency) * 100) / 100;
  const construct_price = construct ? ceilCent(Math.max(0.10, construct * POLICY.margin)) : 0;
  const package_price = tier === "portable" ? POLICY.portable_package : 0;
  const max = Math.round((construct_price + nSent * sentence_price + s7.price_usd + package_price) * 100) / 100;
  const q = {
    quote_id: quote_id || `Q-${sha256(`entity|${spec.name}|${tier}|${Date.now()}`).slice(0, 16)}`, kind: "entity",
    article: { title: spec.name, oldid: null, url: null, entity: true }, entity: spec, wikipedia,
    discernment: discernment || undefined,
    T_source: supplied ? { kind: discernment.mode === "attested composition" ? "composition supplied by the caller, admitted through discernment" : discernment.provenance, verdict: discernment.verdict, provenance: discernment.provenance, landing: discernment.landing }
      : capture ? { kind: captures.picked ? "capture named by the caller, seated in the registry" : "capture (the closed-ontology article)", primary: { slug: capture.slug, q: capture.q, surface: capture.surface, date: capture.date, obs_id: capture.obs_id }, bare_address_observations: captures.bare, related_captures: captures.related.length }
      : compare ? { kind: "construction, with the article Wikipedia's content policies would write constructed as a comparison (notability not applied)" } : { kind: "construction: the object composed with no T" },
    commission: spec.commission, object_kind: spec.kind || "entity", sources: snaps.map((s) => ({ url: s.url, final_url: s.final_url, text_sha256: s.text_sha256, availability: s.availability })),
    tier, tier_steps: spec.transcript?.text ? `S3 on each sentence of T against its cards (at most 30), S7–S9${spec.transcript.supplied ? "; the supplied composition was discerned at the quote, and its row is held from landing until the registry seats it" : ""}` : compare ? "S0′ (the comparison article, under Wikipedia's content policies, notability not applied), S3 on each of its sentences, S7–S8" : "S7–S8: the object composed from the archive and the named sources, with no T",
    reader_model: TIERS[tier].reader_model, lines: [], s7, construction: !compare ? null : { protocol: CONSTRUCTION_PROTOCOL, est_cost_usd: Math.round(construct * 1e4) / 1e4, price_usd: construct_price },
    sentence_price_usd: sentence_price, sentences_estimated: nSent, package_price_usd: package_price || undefined,
    estimated_cost_usd: Math.round((construct + nSent * perSentEst + e.est_cost_usd) * 1e4) / 1e4, max_price_usd: max, currency: "USD (card, Stripe Checkout); agents pay the same amount in USDC once x402 is configured",
    pricing: { table: PRICE_TABLE.version, floor_per_claim: POLICY.floor_per_claim[tier], sentence_margin: POLICY.sentence_margin, margin: POLICY.margin,
      rule: "each constructed sentence's check at max(floor_per_claim, estimated cost × sentence_margin); the construction and the archive's consultation with the row each at max(floor, estimated cost × margin); the charge is for completed work only" },
    execution_contract: {
      sources: "the sources the caller supplies, fetched once and hashed (the disclosed field B); notability is not applied",
      encyclopedia: wikipedia.exists ? `the encyclopedia holds an article at this title (${wikipedia.url}); the entity is opened as given here, and the article can be opened by its revision id` : "the encyclopedia holds no article at this title (observed at the quote); the absence is recorded in the row",
      search_scope: "the Crimson Hexagonal Archive by its own procedure (EA-NEGONT-02 v0.9 §3.4), as for an article",
      archive_release: e.release, execution_budget: `model spending stops at $${s7.budget_usd}`,
      publication: `the entity's /non row is public (CC BY 4.0) at ${s7.non_url} once landed`,
    },
    expires: new Date(Date.now() + ttl_ms).toISOString(),
  };
  await save(`quotes/${q.quote_id}.json`, q);
  return q;
}

// S3 over a set of sentences: each read against the sources it cites, two passes, code checks, reconciliation; the
// claim ledger serves any sentence whose state matches. Shared by the encyclopedia path and the constructed article.
export async function readSentences({ claims, sources, pinned, model, reader, priceOf, onProgress, usage, deadline = Infinity, concurrency = READ_CONCURRENCY, runCache = null, budget_usd = Infinity }) {
  const E = [], V = [], B = [];
  let completed = 0, charge = 0, actual = 0;
  // One claim's reading; claims are read several at a time (2026-10-24: one at a time, an eight-sentence check outran
  // the platform's five-minute limit). Each result is kept at its claim's place, so the order is the article's.
  const one = async (c, idx, mayRead) => {
    const srcs = sources[c.id] || [];
    if (!srcs.length) { (E[idx] = { id: c.id, section: c.section, sentence: c.text, status: "uncited", note: "the sentence carries no citation, and no source the article cites elsewhere bears on it; nothing to check it against" }); return; }
    const srcMap = Object.fromEntries(srcs.map((s, i) => [`S${i + 1}`, s]));
    const key = claimKey(c, srcs, model, reader);
    onProgress({ stage: "S3", detail: c.id });
    let r = await load(`ledger/claims/${key}.json`), fromLedger = !!r, err = null, expanded = false, fromRun = false;
    // An order that runs across invocations keeps every reading it made, withheld ones included, for its own later
    // invocations only (the ledger keeps only readings that stand); so no invocation reads a claim an earlier one read.
    let unreadBefore = null;
    if (!r && runCache) { const k = await load(`${runCache}/${key}.json`); if (k?.unread) unreadBefore = k.unread; else if (k) { r = k; fromRun = true; expanded = !!k.expanded; } }
    // Past the deadline, a claim the ledger already holds is still taken from it; one that needs reading waits for the
    // next invocation. A claim an earlier invocation tried and could not read is not tried again.
    if (!r && !unreadBefore && !mayRead()) return "deferred";
    const billFailed = (e) => { for (const p of e.spent || []) if (p.usage) { for (const k of Object.keys(usage)) usage[k] += p.usage[k] || 0; actual += callCost(p.model, p.usage) || 0; } };
    if (unreadBefore) err = unreadBefore;
    // The order's spend never passes its execution budget (its price over the sentence margin): past it, a claim is not
    // read, is recorded as such, and is not charged (2026-10-24).
    else if (!r && actual >= budget_usd) err = `not read: the order's execution budget ($${budget_usd.toFixed(2)}) is spent`;
    else if (!r) { try { r = await reader.read(c, srcs, pinned); } catch (e) { err = String(e.message || e); billFailed(e); } }
    if (runCache && !fromLedger && !fromRun && !unreadBefore) await save(`${runCache}/${key}.json`, r || { unread: err || "no reading available for this claim" });
    // Windowing can drop the passage that revises a claim. When a pass says the passages lack what it needs,
    // widen them and read again, once; both readings' costs are counted.
    if (r && !fromLedger && !fromRun && actual < budget_usd && r.passes.some((p) => p.reading?.needs_more_context)) {
      for (const p of r.passes) if (p.usage) { for (const k of Object.keys(usage)) usage[k] += p.usage[k] || 0; actual += callCost(p.model, p.usage) || 0; }
      try { const r2 = await reader.read(c, srcs, pinned, { size: 3000, keep: 8 }); if (r2) { r = r2; expanded = true; if (runCache) await save(`${runCache}/${key}.json`, { ...r2, expanded: true }); } } catch (e) { err = String(e.message || e); billFailed(e); }
    }
    if (!r) { (E[idx] = { id: c.id, section: c.section, sentence: c.text, status: "unread", note: err || "no reading available for this claim" }); return; }
    // A reading this order made in an earlier invocation (fromRun) is this order's spend and is counted again here, so
    // the cost of an order run across invocations is its whole cost (2026-10-24: test order 6 reported only the last
    // invocation's). A ledgered reading made for another order is not.
    if (!fromLedger) for (const p of r.passes) if (p.usage) { for (const k of Object.keys(usage)) usage[k] += p.usage[k] || 0; actual += callCost(p.model, p.usage) || 0; }
    // The passages each pass was shown, so a quotation from outside them is recorded (validate.js).
    const shownInput = r.input || inputFor(c, srcs, pinned, expanded ? { size: 3000, keep: 8 } : undefined);
    const shown = Object.fromEntries(shownInput.sources.map((x) => [x.id, x.passages.map((q) => q.text).join(" \n ")]));
    // the reading is checked in the form it is compared and rendered in (labels in lower case; 0.4 fields read as 0.5)
    const checked = r.passes.map((p) => { const nr = normalizeReading(p.reading); return { ...p, reading: nr, validation: validateReading(nr, c, srcMap, shown) }; });
    const valid = checked.filter((p) => p.validation.ok);
    checked.filter((p) => p.validation.breaches.length).forEach((p) => (B[idx] ||= []).push({ claim: c.id, model: p.model, withheld: !p.validation.ok, breaches: p.validation.breaches }));
    let verdict;
    const fam = (m) => (/claude/.test(m || "") ? "anthropic" : String(m || "").split(/[-:/]/)[0]);
    if (valid.length === 2) verdict = reconcile({ ...valid[0].reading, __family: fam(valid[0].model) }, { ...valid[1].reading, __family: fam(valid[1].model) });
    else if (valid.length === 1) verdict = { status: reader.passes === 1 ? "preliminary" : "single-valid", support: valid[0].reading.support };
    // No pass survived its checks, and a pass gave a reading: it is delivered as unverified, its failed checks beside it
    // (checks record; they do not prevent; 2026-10-25: "it should deliver when possible"). Withheld only where no pass
    // returned a reading with a support class at all.
    else if (checked.some((p) => (p.reading?.support || []).length)) {
      const best = checked.filter((p) => (p.reading?.support || []).length).sort((a, b) => a.validation.breaches.length - b.validation.breaches.length)[0];
      valid.push(best);
      verdict = { status: "unverified", support: best.reading.support, checks_failed: [...new Set(best.validation.breaches.map((b) => b.check))] };
    }
    else verdict = { status: "withheld" };
    if (!fromLedger && verdict.status !== "withheld") await save(`ledger/claims/${key}.json`, { key, claim: c.id, oldid: pinned.oldid, model, created: new Date().toISOString(), passes: r.passes.map((p) => ({ model: p.model, reading: p.reading })) });
    // A contested claim carries both readings; no single paraphrase stands for it.
    // The full account comes from the first pass; the second returns only the reconciled fields.
    const lead = verdict.status === "contested" ? null : (valid.find((v) => v.reading?.five_part) || valid[0])?.reading;
    if (verdict.status !== "withheld") { completed++; charge += priceOf[c.id] || 0; }
    (E[idx] = {
      id: c.id, section: c.section, sentence: c.text, status: verdict.status, from_ledger: fromLedger || undefined,
      cited: !!c.cited,
      support: verdict.support || null,
      support_source: lead?.support_source || null,
      innocent_reading: lead?.innocent_reading || null,
      innocent_reading_fails_at: lead?.innocent_reading_fails_at ?? null,
      operation: lead?.attributization?.operation || null,
      converted: lead?.attributization?.converted ?? null,
      attributization: lead?.attributization ? { value: lead.attributization.value, attribute: lead.attributization.attribute || null, reason: lead.attributization.reason || null } : null,
      retained_authority: lead?.retained_authority || null,
      what_the_source_says: lead?.paraphrase?.defensible || null,
      deltas: lead?.paraphrase?.deltas || [],
      changes: lead ? (lead.paraphrase?.deltas || []).map(deltaText) : [],
      divided: lead?.divided?.length ? lead.divided : undefined,
      invitation: lead?.invitation ? { ...lead.invitation, status: INVITATION_STATUS } : null,
      alternatives: lead?.alternatives || [], correction_pathway: lead?.correction_pathway || null,
      five_part: lead?.five_part || null,
      invitation_differs: verdict.invitation_differs,
      sources: srcs.map((s, i) => ({ ref: `S${i + 1}`, kind: s.kind, located: s.located, label: s.edition || s.citation || s.url, url: s.final_url || s.url, availability: s.availability })),
      readings: verdict.status === "contested" ? verdict.readings : undefined, differs: verdict.differs,
      spans: lead ? lead.spans : verdict.status === "contested" ? valid.flatMap((p) => p.reading.spans || []) : [],
      expanded: expanded || undefined,
    });
    (V[idx] = {
      claim: c, ledger_key: key, sources: srcs.map((s, i) => ({ ref: `S${i + 1}`, ...s, text: undefined, text_chars: s.text ? s.text.length : 0 })),
      passes: checked.map((p) => ({ model: p.model, reading: p.reading, validation: p.validation, usage: p.usage || null })),
      verdict,
      tuple: lead ? {
        "ω": lead.attributization?.operation, w: c.text, "δ": c.section === "lead" ? "lead statement" : `statement in ${c.section}`,
        G_W: lead.policy, "Δ_D": lead.paraphrase?.deltas, "Δ_C": lead.attributization?.lost,
        R_W: lead.attributization?.converted ? `${lead.attributization.operation} → ${lead.attributization.attribute}` : null,
        "λ": (lead.paraphrase?.deltas || []).filter((d) => d.lambda).map((d) => ({ change: d.sentence_says, lambda: d.lambda, measure: d.measure })),
        P_W: { required: "inline citation (WP:V)", available: srcs.map((s) => s.final_url || s.url) },
        "ρ_W": lead.notes || null,
        // Elements of §5.2's tuple the 0.10 runner does not produce; named here so a reader sees the gap. λ is the reader's
        // location of each change, per delta; code does not yet verify it.
        "∼_W": "unimplemented: substitutability under WP:V is not computed", K_W: "unimplemented: the closure kind is not computed (S4 not run)",
        B_W: "unimplemented: S4's grammar ledger is not run", C_W: "unimplemented: talk-page and deletion pointers are not fetched",
      } : null,
    });
  };
  // A pool of readers; none starts after the deadline. Claims not started are named, and the caller continues the
  // run in a fresh invocation, where the claims already read come from the ledger (2026-10-24).
  // Each worker reads at least one claim live per invocation, so every invocation makes progress.
  let next = 0; const notStarted = [];
  const worker = async () => {
    let readLive = 0;
    while (next < claims.length) {
      const idx = next++;
      const got = await one(claims[idx], idx, () => { const ok = readLive === 0 || Date.now() <= deadline; if (ok) readLive++; return ok; });
      if (got === "deferred") notStarted.push(claims[idx].id);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, claims.length)) }, worker));
  if (notStarted.length) throw Object.assign(new Error(`continue: ${notStarted.length} claims not yet read`), { code: "continue", not_started: notStarted, read: claims.length - notStarted.length });
  const entries = E.filter(Boolean), evidence = V.filter(Boolean), breaches = B.filter(Boolean).flat();
  return { entries, evidence, breaches, completed, charge, actual };
}

export async function runOpening(quoteId, { onProgress = () => {}, deadline = Infinity } = {}) {
  const q = await load(`quotes/${quoteId}.json`);
  if (!q) throw new Error(`unknown quote ${quoteId}`);
  const t0 = Date.now();
  let pinned, claims, sources, entityInput = null, construction = null;
  const preLog = passLog({ budget_usd: q.s7?.budget_usd ?? Infinity });
  if (q.kind === "entity") {
    // The entity path: the caller's composition as T, or the article constructed under Wikipedia's policies.
    const { snaps } = await prepareEntity(q.entity);
    entityInput = fromEntity(q.entity, { sources: snaps, wikipedia: q.wikipedia });
    if (q.T_source) entityInput.T.source = q.T_source;
    pinned = { title: q.entity.name, oldid: `entity-${entityInput.row}`, url: null };
    if (q.entity.transcript?.text) {
      // T's sentences are read against the cards T engages, as an article's sentences are read against their citations.
      const fetched = snaps.filter((s) => s.text && s.retrieved);
      const cardSrc = fetched.map((s) => ({ kind: "card", url: s.url, final_url: s.final_url || s.url, citation: s.title, text: s.text, text_sha256: s.text_sha256, availability: s.availability }));
      claims = entityInput.T.claims.slice(0, 30).map((c) => ({ ...c, section: "T", cited: cardSrc.length > 0, footnotes: [], pointers: [], text_sha256: sha256(c.text) }));
      sources = Object.fromEntries(claims.map((c) => [c.id, cardSrc]));
      const dn = q.entity.transcript.discernment;
      if (q.entity.transcript.supplied) entityInput.T = { ...entityInput.T, supplied: true, discernment: dn,
        note: dn.mode === "attested composition" ? "T is a composition supplied by the caller, admitted through discernment: its surface, address and date are the caller's attestation, not observed by the service; the row is held from landing until the registry's intake seats it as a capture" : `T is ${dn.provenance}` };
    }
    else if (q.entity.commission === "construct" && q.entity.compare !== "encyclopedia") {
      // Construction: the object is composed from the archive and the named sources (B), with no T to read.
      claims = []; sources = {};
      entityInput.T = { ...entityInput.T, kind: "null", note: `construction: the ${entityInput.object_kind === "operator" ? "operator" : "entity"} composed from the archive and the sources the caller named, with no composition at an address to read` };
    }
    else {
      onProgress({ stage: "S0′", detail: "constructing the comparison article under Wikipedia's content policies" });
      construction = await constructArticle(preLog, entityInput);
      ({ claims, sources } = asClaims(construction.article, entityInput));
      const text = claims.map((c) => c.text).join("\n");
      entityInput.T = { ...entityInput.T, kind: construction.article ? "constructed" : "null", text, sha256: sha256(text), claims: claims.map((c) => ({ id: c.id, section: c.section, text: c.text, cites: c.cites })),
        construction: construction.article ? { protocol: CONSTRUCTION_PROTOCOL, title: construction.article.title, classes: construction.article.classes, excluded: construction.article.excluded, breaches: construction.breaches } : { status: construction.status, breaches: construction.breaches },
        note: construction.article ? "T is the article constructed under Wikipedia's content policies (V, NOR, NPOV, BLP, ABOUTSELF/SPS), notability not applied, from the sources the caller supplied: a construction, labelled as such, never a Wikipedia article" : entityInput.T.note };
      entityInput.address = { ...entityInput.address, surface: construction.article ? "constructed article (Wikipedia's content policies, notability not applied)" : entityInput.address.surface };
    }
  } else ({ pinned, claims, sources } = await prepare(q.article.oldid, q.only));
  const model = TIERS[q.tier].reader_model;
  const reader = makeReader(undefined, model);
  const priceOf = q.kind === "entity" ? new Proxy({}, { get: () => q.sentence_price_usd }) : Object.fromEntries(q.lines.map((l) => [l.id, l.price_usd]));

  const state = {
    article: { oldid: pinned.oldid, html_sha256: pinned.html_sha256 || null, T: entityInput ? entityInput.T.sha256 : undefined }, claims: claims.map((c) => c.id),
    sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.map((s) => s.text_sha256 || s.availability)])),
    policies: policyState(), s7: q.s7?.key || (entityInput && q.s7 ? s7Key(entityInput) : null), ontology_rules: q.s7 ? ONTOLOGY_RULES : undefined, protocol: READER_PROTOCOL, reader: reader.id, reader_mode: reader.mode, calibration: CALIBRATION, service: SERVICE.version, tier: q.tier,
  };
  const execution_key = sha256(JSON.stringify(state));
  const prior = await load(`results/by-state/${execution_key}.json`);
  // A result is served again only when it is complete for its tier: at the tiers that compose the /non row, a result
  // whose row was not composed is recomputed.
  // Reuse needs a complete row: a partial one (a pass failed, was skipped by the budget, or the audit is incomplete) is
  // delivered and recorded, and the next request recomputes it.
  // A result in which no claim was read and no row composed is never served again: its failure may have been passing
  // (2026-10-24: a reader that could not run, or replies that would not parse, would otherwise stand for that state).
  const priorEmpty = prior && !prior.non_row && (await load(prior.composition_path))?.summary?.completed === 0;
  if (prior && !priorEmpty && (!q.s7 || (prior.non_row && prior.s7_complete))) {
    // The same state was computed before: the result is served again, and billed against this quote, at the
    // ledgered rates it was quoted at (each completed claim's line; a cached portable package at the ledgered writer rate).
    const composition = await load(prior.composition_path), record = await load(prior.composition_path.replace("composition", "evidence"));
    const done = composition.entries.filter((e) => ["concordant", "concordant across families", "single-valid", "contested", "unverified", "preliminary"].includes(e.status)).map((e) => e.id);
    let charge = done.reduce((n, id) => n + (priceOf[id] || 0), 0);
    if (q.s7 && prior.non_row) charge += POLICY.ledgered_s7;
    if (prior.portable_dir) charge += Math.min(q.package_price_usd || 0, POLICY.ledgered_package);
    charge = Math.min(q.max_price_usd, Math.round(charge * 100) / 100);
    const billing = { quoted_max_usd: q.max_price_usd, charge_usd: charge, cost_usd: 0, margin_usd: charge, reused_from: prior.result_id,
      rule: "a result already computed for this exact state is served again at the ledgered rates; no model call is made" };
    return { ...prior, composition, record: { ...record, billing }, reused: true };
  }

  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const c of preLog.calls) if (c.usage) for (const k of Object.keys(usage)) usage[k] += c.usage[k] || 0;
  const s3 = await readSentences({ claims, sources, pinned, model, reader, priceOf, onProgress, usage, deadline, runCache: Number.isFinite(deadline) ? `runs/${quoteId}/reads` : null,
    budget_usd: q.max_price_usd ? q.max_price_usd / POLICY.sentence_margin : Infinity });
  const { entries, evidence, breaches } = s3;
  let completed = s3.completed, charge = s3.charge, actual = s3.actual + preLog.cost();
  if (construction?.article && q.construction) charge += Math.min(q.construction.price_usd, ceilCent(Math.max(0.10, preLog.cost() * POLICY.margin)));
  // S7–S8: the archive consulted by its own procedure; the entity's /non row composed and written for landing.
  let s7 = null;
  if (q.s7) {
    onProgress({ stage: "S7", detail: "the archive's bearing on the entity" });
    const input = entityInput || fromWikipedia(pinned, claims, sources);
    const key = s7Key(input);
    const cached = await load(`s7/${input.row}/by-key/${key}.json`);
    // A ledgered row is reused only when it was settled under the current ontology rules; otherwise it is composed
    // again, its reading taken from the checkpoint.
    if (cached?.complete && cached.ontology_rules === ONTOLOGY_RULES) s7 = { ...cached, from_ledger: true };
    else {
      // One log for the job: the construction's spending and S7's share the budget the quote declared.
      const out = await runS7(input, { service: SERVICE, onProgress, budget_usd: q.s7.budget_usd, construction_usd: q.s7.stages?.construction?.budget_usd || 0, ceiling_usd: (q.s7.price_usd || 0) + (q.construction?.price_usd || 0), log: preLog });
      s7 = { row_key: input.row, entity: input.entity.slug, non_url: NON_URL(input.entity.slug), landing: out.landing.dir, manifest: out.landing.manifest,
        composed: !!out.row.objects.KO, case: out.row.ontology?.case?.value || null, rho: out.row.ontology?.rho?.value || null, breaches: out.row.breaches.length,
        audit: out.run.audit, cost_usd: out.run.cost_usd, mode: out.run.mode, passes: out.run.calls.length, budget: out.run.budget, key: out.run.key, provenance: out.row.objects?.T?.provenance || null,
        stages: { reading: { name: "reading", ...out.run.stages.reading }, construction: { name: "construction", ...out.run.stages.construction } } };
      for (const c of out.run.calls) if (c.usage) for (const k of Object.keys(usage)) usage[k] += c.usage[k] || 0;
      actual += out.run.cost_usd || 0;
      // Composed, checked and complete are distinct. Only a complete row (composed; no pass failed or skipped by the
      // budget; the audit complete) is ledgered for reuse. A partial row is kept under its execution key with its
      // coverage, delivered as partial, and recomputed on the next request.
      const notRun = out.run.budget.not_run || 0, failed = out.run.budget.failed_calls || 0;
      s7.coverage = { composed: s7.composed, budget_exhausted: !!out.run.budget.exhausted, failed_passes: failed, passes_not_run: notRun, audit_complete: !!out.run.audit?.complete };
      s7.complete = s7.composed && !s7.coverage.budget_exhausted && !failed && !notRun && s7.coverage.audit_complete;
      // The release and the time are kept with the row, so a grounded sentence served from it can disclose both.
      s7.release = out.run.release || null; s7.created = new Date().toISOString(); s7.ontology_rules = ONTOLOGY_RULES;
      await save(`s7/${input.row}/${s7.complete ? "by-key" : "partial"}/${key}.json`, s7);
    }
    // The quoted S7 line is an upper bound (every candidate deposit costed as admitted); the charge is the measured cost
    // times the margin, at the floor, and never above the quote.
    // Each stage is charged when it delivers (2026-10-25): the reading when its ontology passes returned, the
    // construction when the knowledge object was composed. A quote made before the stages were priced apart is charged
    // as one line, on composition, as it was quoted.
    if (s7.from_ledger) s7.charge_usd = POLICY.ledgered_s7;
    else if (q.s7.stages && s7.stages) {
      s7.stages.reading.charge_usd = stageCharge(s7.stages.reading, q.s7.stages.reading);
      s7.stages.construction.charge_usd = stageCharge(s7.stages.construction, q.s7.stages.construction);
      s7.charge_usd = Math.round((s7.stages.reading.charge_usd + s7.stages.construction.charge_usd) * 100) / 100;
    } else if (s7.composed) s7.charge_usd = Math.min(q.s7.price_usd, ceilCent(Math.max(POLICY.floor_s7, (s7.cost_usd || 0) * POLICY.margin)));
    charge += s7.charge_usd || 0;
    // Each sentence of the article, with what the archive's claims do to it (the ontology pass's alignment).
    const { row, ledger } = await readLanding(s7, input.row);
    for (const a of row?.ontology?.t_alignment || []) {
      const e = entries.find((x) => x.id === a.t);
      if (e) e.archive = archiveOn(a, ledger);
    }
    s7.row = row; s7.ledger = ledger;
  }
  const result_id = `R-${execution_key.slice(0, 16)}`;
  const composition = {
    result_id, service: SERVICE, tier: q.tier, article: q.article,
    ...(entityInput ? { entity: { name: entityInput.entity.name, wikipedia: q.wikipedia, T: entityInput.T.kind, construction: entityInput.T.construction || null } } : {}),
    licence_note: "Wikipedia sentences are CC BY-SA 4.0, attributed to the revision URL; the service's account is licensed to the caller under the service terms.",
    notice: "The treatment of this article's entities by composing systems may be recorded and measured.",
    non: s7 ? { row: s7.row_key, entity_page: s7.non_url, composed: s7.composed, complete: !!s7.complete, coverage: s7.coverage || null, case: s7.case, rho: s7.rho, breaches_recorded: s7.breaches, from_ledger: !!s7.from_ledger,
      stages: s7.stages ? Object.fromEntries(Object.entries(s7.stages).map(([k, v]) => [k, { delivered: !!v.delivered, charge_usd: v.charge_usd ?? null, ...(v.from_checkpoint ? { from_checkpoint: v.from_checkpoint } : {}) }])) : undefined,
      dossier: s7.stages?.reading?.delivered ? `/v1/results/${result_id}/landing` : undefined,
      licence: "CC BY 4.0", publication: await publicationState(s7, { fetchPublic: false }), publication_endpoint: `/v1/results/${result_id}/publication` } : undefined,
    summary: { claims: entries.length, cited: entries.filter((e) => e.status !== "uncited").length, completed, contested: entries.filter((e) => e.status === "contested").length, withheld: entries.filter((e) => e.status === "withheld").length, unread: entries.filter((e) => e.status === "unread").length, from_ledger: entries.filter((e) => e.from_ledger).length },
    entries,
  };
  // The portable tier: the row's knowledge object, packaged. The package is charged when the reverse entailment audit
  // ran and marked no unit; otherwise it is delivered with its marks and its fee released.
  let portable = null;
  if (q.tier === "portable") {
    if (!s7?.composed) portable = { ok: false, breaches: [{ check: "package", detail: "the /non row has no knowledge object to package" }] };
    else {
      onProgress({ stage: "package", detail: "the knowledge object" });
      const pkg = packageRow(s7.row, s7.ledger, { result_id, service: SERVICE, article: q.article, audit: s7.audit, rowUrl: s7.non_url });
      const dir = `results/${result_id}/portable`;
      const manifest = await writePackage(dir, pkg, { result_id, article: q.article, service: SERVICE, non_row: s7.row_key });
      const clean = !!s7.audit?.ran && !!s7.audit.complete && s7.audit.breaches.length === 0;
      portable = { ok: true, dir, manifest, charged: clean, breaches: clean ? [] : [{ check: "package", detail: !s7.audit?.ran ? "the audit did not run; the package fee is released" : !s7.audit.complete ? `the audit is incomplete (${(s7.audit.missing || []).length} units unjudged); the package fee is released` : `${s7.audit.breaches.length} units marked by the audit; the package fee is released` }] };
      if (clean) charge += q.package_price_usd || 0;
    }
  }
  charge = Math.min(q.max_price_usd, Math.round(charge * 100) / 100);
  const record = {
    result_id, execution_key, execution_state: state, normalization: NORMALIZATION,
    pinned: { title: pinned.title, oldid: pinned.oldid, url: pinned.url, retrieved: pinned.retrieved, from: pinned.from, html_sha256: pinned.html_sha256 },
    execution_contract: q.execution_contract, evidence, breaches, portable: portable ? { ok: portable.ok, breaches: portable.breaches, manifest: portable.manifest } : null,
    cost: { seconds: (Date.now() - t0) / 1000, reader_usage: usage, actual_cost_usd: Math.round(actual * 1e5) / 1e5, price_table: PRICE_TABLE.version },
    billing: { quoted_max_usd: q.max_price_usd, charge_usd: charge, margin_usd: Math.round((charge - actual) * 1e5) / 1e5,
      cost_measured: reader.mode === "live", ...(reader.mode === "live" ? {} : { note: "replay mode: no model was called, so cost and margin are not measured" }), rule: "charged for completed claims only, at quoted per-claim prices; the rest of the reservation is released" },
  };
  await save(`results/${result_id}/composition.json`, composition);
  await save(`results/${result_id}/evidence.json`, record);
  await save(`results/${result_id}/opened.html`, renderOpenedHTML(composition, pinned));
  await save(`results/${result_id}/annotations.jsonld`, annotations(composition));
  if (s7) await save(`results/${result_id}/s7.json`, { ...s7, row: undefined, ledger: undefined });
  // A composed row is listed for the archive's landing workflow (GET /v1/landable), which lands it in /non by itself
  // (2026-10-25: "a microservice … and me hand clicking every one. it does not compute").
  if (s7?.composed && s7.manifest) await save(`landable/${result_id}.json`, { result_id, row: s7.row_key, execution_key: s7.manifest.key,
    row_sha256: (s7.manifest.files || []).find((f) => f.path === `datasets/negative-of-the-negative/v2/rows/${s7.row_key}.json`)?.sha256 || null,
    complete: !!s7.complete, attested: s7.provenance?.class === "attested", composed_at: new Date().toISOString() });
  const pointer = { result_id, composition_path: `results/${result_id}/composition.json`, portable_dir: portable?.ok ? portable.dir : undefined, non_row: s7?.composed ? s7.row_key : undefined, s7_complete: !!s7?.complete };
  await save(`results/by-state/${execution_key}.json`, pointer);
  return { ...pointer, composition, record, reused: false };
}
