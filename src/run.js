// The opening job: S0–S9 for one pinned revision. S3 reads each sentence against the sources it cites (T against L_F(B));
// at the opening and portable tiers S7–S8 consult the archive by its own procedure and compose the entity's /non row,
// which is public; the portable tier packages the row's knowledge object.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pinRevision } from "./pin.js";
import { segment } from "./segment.js";
import { resolveSources } from "./resolve.js";
import { makeReader, inputFor, READER_PROTOCOL, CALIBRATION } from "./reader.js";
import { fromWikipedia } from "./s7/input.js";
import { runS7 } from "./s7/run.js";
import { estimateS7 } from "./s7/estimate.js";
import { archiveRelease } from "./s7/traverse.js";
import { S7_PROTOCOL, MODELS as S7_MODELS, mode as s7mode } from "./s7/model.js";
import { blogIndexSha } from "./s7/blog.js";
import { validateReading, reconcile, NORMALIZATION } from "./validate.js";
import { sha256, save, load, STORE } from "./util.js";
import { renderOpenedHTML, annotations } from "./emit.js";
import { estimateTokens, estimateClaim, priceClaim, callCost, PRICE_TABLE, POLICY } from "./cost.js";
import { packageRow, writePackage } from "./writer.js";

export const SERVICE = { name: "SPXI-gnΩsis", version: "0.4.0", protocol: "EA-WIKI-OPEN-01 v0.9" };
export const NON_URL = (entity) => `https://www.alexanarch.org/non/${entity}/`;

// Which model reads at which tier. Check runs on the small model; openings on the middle one.
export const TIERS = {
  check: { reader_model: "claude-haiku-5-5", steps: "S0–S3, S6 integrity" },
  ledger: { reader_model: "claude-sonnet-5-5", steps: "S0–S6" },
  opening: { reader_model: "claude-sonnet-5-5", steps: "S0–S9: the article opened sentence by sentence, and the entity's /non row composed with the archive admitted (public)" },
  portable: { reader_model: "claude-sonnet-5-5", steps: "the opening, and the entity's knowledge object as a portable package" },
};

function policyState() {
  const dir = join(STORE, "policies");
  return Object.fromEntries(readdirSync(dir).map((f) => [f.replace(/\.wiki$/, "").replace(/_/g, " ").replace("Wikipedia ", "Wikipedia:"), sha256(readFileSync(join(dir, f), "utf8"))]));
}

// A claim's reading is reusable when everything it was computed from matches: the sentence, the hashes of its
// sources, the policies, the reader adapter and its mode (live or replay), the model, the protocol and the calibration
// release. A replayed reading can never serve a live run.
export function claimKey(claim, srcs, model, reader) {
  return sha256(JSON.stringify({ claim: claim.text_sha256, sources: srcs.map((s) => s.text_sha256 || s.availability), policies: policyState(),
    protocol: READER_PROTOCOL, model, adapter: reader.id, mode: reader.mode, calibration: CALIBRATION }));
}

// Tiers that consult the archive and compose the entity's /non row.
export const ADMITS = new Set(["opening", "portable"]);

// The /non row is reusable when its whole input matches: T, every field source by hash, the entity's strings, the
// archive release (commit, registry, citation graph, traversal script, blog index), the S7 protocol, models and mode.
export function s7Key(input) {
  return sha256(JSON.stringify({ T: input.T.sha256, field: input.field.map((b) => [b.id, b.text_sha256 || b.availability]), aliases: input.aliases,
    release: archiveRelease(), blog: blogIndexSha(), protocol: S7_PROTOCOL, models: S7_MODELS, mode: s7mode() }));
}

export async function prepare(oldid, only) {
  const pinned = await pinRevision(oldid);
  const { claims: all } = segment(pinned);
  const claims = only ? all.filter((c) => only.includes(c.id)) : all;
  const sources = await resolveSources(claims.filter((c) => c.cited));
  return { pinned, claims, sources };
}

// Quote (free): S0–S2, a per-claim cost estimate from the passages that would be sent, and a price that clears it.
export async function quote(oldid, { tier = "opening", claims: only } = {}) {
  if (!TIERS[tier]) throw new Error(`unknown tier ${tier}`);
  const { pinned, claims, sources } = await prepare(oldid, only);
  const model = TIERS[tier].reader_model;
  const reader = makeReader(undefined, model);
  const lines = claims.filter((c) => c.cited).map((c) => {
    const srcs = sources[c.id];
    const ledgered = !!load(`ledger/claims/${claimKey(c, srcs, model, reader)}.json`);
    const tokens = estimateTokens(JSON.stringify(inputFor(c, srcs, pinned))) + 2500; // + instructions
    const est = ledgered ? 0 : estimateClaim(model, tokens);
    return { id: c.id, ledgered, est_tokens: tokens, est_cost_usd: Math.round(est * 1e5) / 1e5, price_usd: priceClaim(tier, est, ledgered) };
  });
  // S7–S8: the archive consulted and the /non row composed, priced from the traversal it would run.
  let s7 = null;
  if (ADMITS.has(tier)) {
    const input = fromWikipedia(pinned, claims, sources);
    const key = s7Key(input);
    const ledgered = !!load(`s7/${input.row}/by-key/${key}.json`)?.composed;
    const e = ledgered ? null : estimateS7(input);
    s7 = { id: "S7", row: input.row, entity: input.entity.name, non_url: NON_URL(input.entity.slug), key, ledgered, estimate: e,
      est_cost_usd: ledgered ? 0 : e.est_cost_usd, price_usd: ledgered ? POLICY.ledgered_s7 : Math.ceil(Math.max(POLICY.floor_s7, e.est_cost_usd * POLICY.margin) * 100) / 100 };
  }
  const package_price = tier === "portable" ? POLICY.portable_package : 0;
  const est_cost = lines.reduce((n, l) => n + l.est_cost_usd, 0) + (s7?.est_cost_usd || 0);
  const max = Math.max(0.01, Math.round((lines.reduce((n, l) => n + l.price_usd, 0) + (s7?.price_usd || 0) + package_price) * 100) / 100);
  const q = {
    quote_id: `Q-${sha256(`${oldid}|${tier}|${(only || []).join(",")}|${Date.now()}`).slice(0, 16)}`,
    article: { title: pinned.title, oldid: pinned.oldid, url: pinned.url, html_sha256: pinned.html_sha256 },
    tier, tier_steps: TIERS[tier].steps, reader_model: model,
    claims_total: claims.length, claims_cited: lines.length, claims_uncited: claims.length - lines.length,
    claims_ledgered: lines.filter((l) => l.ledgered).length,
    lines, s7: s7 || undefined, package_price_usd: package_price || undefined,
    estimated_cost_usd: Math.round(est_cost * 1e4) / 1e4, max_price_usd: max, currency: "USDC (test network)",
    pricing: { table: PRICE_TABLE.version, margin: POLICY.margin, rule: "price per claim = max(floor, estimated cost × margin); the archive's consultation and the /non row priced as one line, max(floor, estimated cost × margin), from the traversal it would run; work already in the ledger at the ledgered rates; the charge is for completed work only" },
    execution_contract: {
      sources: "the sources each sentence cites (footnotes and classical pointers), fetched once and hashed",
      sent_to_reader: "the passages of each source that bear on the claim (classical chapters whole), with a code-computed structure summary; quotations are checked against the full text",
      search_scope: ADMITS.has(tier) ? "the sources the article cites (the disclosed field B); and the Crimson Hexagonal Archive by its own procedure (EA-NEGONT-02 v0.9 §3.4): every deposit text and every blog post the blog–deposit map does not assign to a deposit, scanned for the entity's strings (the article's title and the names its lead gives) at D, R and O; one citation hop from the deposits admitted by reading, screened by string; admission by two reading passes" : "cited sources only at this tier",
      archive_release: s7?.estimate?.release || (s7 ? archiveRelease() : null),
      publication: ADMITS.has(tier) ? `the entity's /non row is public (CC BY 4.0) at ${s7.non_url} once landed: the opening contributes to the opened Wikipedia` : undefined,
      context_rule: "passages first; when a reading pass reports that the passages lack what a judgment needs, the passages are widened and the claim is read again, once",
      retrieval_budget: { max_sources: 100, max_bytes_per_source: 5_000_000 },
      stopping_rule: "every cited source fetched or recorded unavailable",
    },
    expires: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  save(`quotes/${q.quote_id}.json`, { ...q, only: only || null });
  return q;
}

export async function runOpening(quoteId, { onProgress = () => {} } = {}) {
  const q = load(`quotes/${quoteId}.json`);
  if (!q) throw new Error(`unknown quote ${quoteId}`);
  const t0 = Date.now();
  const { pinned, claims, sources } = await prepare(q.article.oldid, q.only);
  const model = TIERS[q.tier].reader_model;
  const reader = makeReader(undefined, model);
  const priceOf = Object.fromEntries(q.lines.map((l) => [l.id, l.price_usd]));

  const state = {
    article: { oldid: pinned.oldid, html_sha256: pinned.html_sha256 }, claims: claims.map((c) => c.id),
    sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.map((s) => s.text_sha256 || s.availability)])),
    policies: policyState(), s7: q.s7?.key || null, protocol: READER_PROTOCOL, reader: reader.id, reader_mode: reader.mode, calibration: CALIBRATION, service: SERVICE.version, tier: q.tier,
  };
  const execution_key = sha256(JSON.stringify(state));
  const prior = load(`results/by-state/${execution_key}.json`);
  // A result is served again only when it is complete for its tier: at the tiers that compose the /non row, a result
  // whose row was not composed is recomputed.
  if (prior && (!q.s7 || prior.non_row)) {
    // The same state was computed before: the result is served again, and billed against this quote, at the
    // ledgered rates it was quoted at (each completed claim's line; a cached portable package at the ledgered writer rate).
    const composition = load(prior.composition_path), record = load(prior.composition_path.replace("composition", "evidence"));
    const done = composition.entries.filter((e) => ["agreed", "single-valid", "contested"].includes(e.status)).map((e) => e.id);
    let charge = done.reduce((n, id) => n + (priceOf[id] || 0), 0);
    if (q.s7 && prior.non_row) charge += POLICY.ledgered_s7;
    if (prior.portable_dir) charge += Math.min(q.package_price_usd || 0, POLICY.ledgered_package);
    charge = Math.min(q.max_price_usd, Math.round(charge * 100) / 100);
    const billing = { quoted_max_usd: q.max_price_usd, charge_usd: charge, cost_usd: 0, margin_usd: charge, reused_from: prior.result_id,
      rule: "a result already computed for this exact state is served again at the ledgered rates; no model call is made" };
    return { ...prior, composition, record: { ...record, billing }, reused: true };
  }

  const entries = [], evidence = [], breaches = [];
  let completed = 0, charge = 0, actual = 0;
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const c of claims) {
    if (!c.cited) { entries.push({ id: c.id, section: c.section, sentence: c.text, status: "uncited", note: "the sentence carries no citation; nothing to check it against" }); continue; }
    const srcs = sources[c.id];
    const srcMap = Object.fromEntries(srcs.map((s, i) => [`S${i + 1}`, s]));
    const key = claimKey(c, srcs, model, reader);
    onProgress({ stage: "S3", detail: c.id });
    let r = load(`ledger/claims/${key}.json`), fromLedger = !!r, err = null, expanded = false;
    if (!r) { try { r = await reader.read(c, srcs, pinned); } catch (e) { err = String(e.message || e); } }
    // Windowing can drop the passage that revises a claim. When a pass says the passages lack what it needs,
    // widen them and read again, once; both readings' costs are counted.
    if (r && !fromLedger && r.passes.some((p) => p.reading?.needs_more_context)) {
      for (const p of r.passes) if (p.usage) { for (const k of Object.keys(usage)) usage[k] += p.usage[k] || 0; actual += callCost(p.model, p.usage) || 0; }
      try { const r2 = await reader.read(c, srcs, pinned, { size: 3000, keep: 8 }); if (r2) { r = r2; expanded = true; } } catch (e) { err = String(e.message || e); }
    }
    if (!r) { entries.push({ id: c.id, section: c.section, sentence: c.text, status: "unread", note: err || "no reading available for this claim" }); continue; }
    if (!fromLedger) for (const p of r.passes) if (p.usage) { for (const k of Object.keys(usage)) usage[k] += p.usage[k] || 0; actual += callCost(p.model, p.usage) || 0; }
    const checked = r.passes.map((p) => ({ ...p, validation: validateReading(p.reading, c, srcMap) }));
    const valid = checked.filter((p) => p.validation.ok);
    checked.filter((p) => !p.validation.ok).forEach((p) => breaches.push({ claim: c.id, model: p.model, breaches: p.validation.breaches }));
    let verdict;
    if (valid.length === 2) verdict = reconcile(valid[0].reading, valid[1].reading);
    else if (valid.length === 1) verdict = { status: "single-valid", support: valid[0].reading.support };
    else verdict = { status: "withheld" };
    if (!fromLedger && verdict.status !== "withheld") save(`ledger/claims/${key}.json`, { key, claim: c.id, oldid: pinned.oldid, model, created: new Date().toISOString(), passes: r.passes.map((p) => ({ model: p.model, reading: p.reading })) });
    // A contested claim carries both readings; no single paraphrase stands for it.
    const lead = verdict.status === "contested" ? null : valid[0]?.reading;
    if (verdict.status !== "withheld") { completed++; charge += priceOf[c.id] || 0; }
    entries.push({
      id: c.id, section: c.section, sentence: c.text, status: verdict.status, from_ledger: fromLedger || undefined,
      support: verdict.support || null,
      operation: lead?.attributization?.operation || null,
      converted: lead?.attributization?.converted ?? null,
      what_the_source_says: lead?.paraphrase?.defensible || null,
      changes: lead ? [...(lead.paraphrase?.scope_changes || []), ...(lead.paraphrase?.introduced || [])] : [],
      sources: srcs.map((s, i) => ({ ref: `S${i + 1}`, kind: s.kind, label: s.edition || s.citation || s.url, url: s.final_url || s.url, availability: s.availability })),
      readings: verdict.status === "contested" ? verdict.readings : undefined, differs: verdict.differs,
      spans: lead ? lead.spans : verdict.status === "contested" ? valid.flatMap((p) => p.reading.spans || []) : [],
      expanded: expanded || undefined,
    });
    evidence.push({
      claim: c, ledger_key: key, sources: srcs.map((s, i) => ({ ref: `S${i + 1}`, ...s, text: undefined, text_chars: s.text ? s.text.length : 0 })),
      passes: checked.map((p) => ({ model: p.model, reading: p.reading, validation: p.validation, usage: p.usage || null })),
      verdict,
      tuple: lead ? {
        "ω": lead.attributization?.operation, w: c.text, "δ": c.section === "lead" ? "lead statement" : `statement in ${c.section}`,
        G_W: lead.policy, "Δ_D": lead.paraphrase?.scope_changes, "Δ_C": lead.attributization?.lost,
        R_W: lead.attributization?.converted ? `${lead.attributization.operation} → ${lead.attributization.attribute}` : null,
        P_W: { required: "inline citation (WP:V)", available: srcs.map((s) => s.final_url || s.url) },
        "ρ_W": lead.notes || null,
      } : null,
    });
  }
  // S7–S8: the archive consulted by its own procedure; the entity's /non row composed and written for landing.
  let s7 = null;
  if (q.s7) {
    onProgress({ stage: "S7", detail: "the archive's bearing on the entity" });
    const input = fromWikipedia(pinned, claims, sources);
    const cached = load(`s7/${input.row}/by-key/${q.s7.key}.json`);
    if (cached?.composed) s7 = { ...cached, from_ledger: true };
    else {
      const out = await runS7(input, { service: SERVICE, onProgress });
      s7 = { row_key: input.row, entity: input.entity.slug, non_url: NON_URL(input.entity.slug), landing: out.landing.dir, manifest: out.landing.manifest,
        composed: !!out.row.objects.KO, case: out.row.ontology?.case?.value || null, rho: out.row.ontology?.rho?.value || null, breaches: out.row.breaches.length,
        audit: out.run.audit, cost_usd: out.run.cost_usd, mode: out.run.mode, passes: out.run.calls.length };
      for (const c of out.run.calls) if (c.usage) for (const k of Object.keys(usage)) usage[k] += c.usage[k] || 0;
      actual += out.run.cost_usd || 0;
      // Only a composed row is ledgered: a run that composed nothing is recomputed on the next request.
      if (s7.composed) save(`s7/${input.row}/by-key/${q.s7.key}.json`, s7);
    }
    // The quoted S7 line is an upper bound (every candidate deposit costed as admitted); the charge is the measured cost
    // times the margin, at the floor, and never above the quote.
    if (s7.composed) s7.charge_usd = s7.from_ledger ? POLICY.ledgered_s7 : Math.min(q.s7.price_usd, Math.ceil(Math.max(POLICY.floor_s7, (s7.cost_usd || 0) * POLICY.margin) * 100) / 100);
    charge += s7.charge_usd || 0;
    // Each sentence of the article, with what the archive's claims do to it (the ontology pass's alignment).
    const row = load(`s7/${input.row}/landing/datasets/negative-of-the-negative/v2/rows/${input.row}.json`);
    const ledger = load(`s7/${input.row}/landing/datasets/negative-of-the-negative/v2/ledgers/${input.row}/ledger-archive.json`) || [];
    const byA = Object.fromEntries(ledger.map((c) => [c.id, c]));
    for (const a of row?.ontology?.t_alignment || []) {
      const e = entries.find((x) => x.id === a.t);
      if (e) e.archive = { bears: a.bears, note: a.note, claims: (a.archive_claims || []).filter((id) => byA[id]).map((id) => ({ id, dep: byA[id].dep, record: byA[id].record, locus: byA[id].locus, quote: byA[id].quote,
        url: byA[id].dep ? `https://www.alexanarch.org/s/records/${byA[id].dep}/` : byA[id].record?.url })) };
    }
    s7.row = row; s7.ledger = ledger;
  }
  const result_id = `R-${execution_key.slice(0, 16)}`;
  const composition = {
    result_id, service: SERVICE, tier: q.tier, article: q.article,
    licence_note: "Wikipedia sentences are CC BY-SA 4.0, attributed to the revision URL; the service's account is licensed to the caller under the service terms.",
    notice: "The treatment of this article's entities by composing systems may be recorded and measured.",
    non: s7 ? { row: s7.row_key, entity_page: s7.non_url, composed: s7.composed, case: s7.case, rho: s7.rho, breaches_recorded: s7.breaches, from_ledger: !!s7.from_ledger,
      landing: "the row, its ledgers, traversal and reading, in the archive's paths; public once landed", publication: "CC BY 4.0" } : undefined,
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
      const manifest = writePackage(dir, pkg, { result_id, article: q.article, service: SERVICE, non_row: s7.row_key });
      const clean = !!s7.audit?.ran && s7.audit.breaches.length === 0;
      portable = { ok: true, dir, manifest, charged: clean, breaches: clean ? [] : [{ check: "package", detail: s7.audit?.ran ? `${s7.audit.breaches.length} units marked by the audit; the package fee is released` : "the audit did not run; the package fee is released" }] };
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
  save(`results/${result_id}/composition.json`, composition);
  save(`results/${result_id}/evidence.json`, record);
  save(`results/${result_id}/opened.html`, renderOpenedHTML(composition, pinned));
  save(`results/${result_id}/annotations.jsonld`, annotations(composition));
  const pointer = { result_id, composition_path: `results/${result_id}/composition.json`, portable_dir: portable?.ok ? portable.dir : undefined, non_row: s7?.composed ? s7.row_key : undefined };
  save(`results/by-state/${execution_key}.json`, pointer);
  return { ...pointer, composition, record, reused: false };
}
