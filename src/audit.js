// The erasure audit: the Self-Audit Module for Public Summarizers v3.2 (provenanceerasure.org/module, deposit #817)
// run as an order (2026-10-29). A source and the answers that render it: the provenance atoms are taken from the source
// (Measurement Sovereignty: never from the answers audited), each answer is read twice for each atom and for the ABN
// gate, every quote is checked verbatim against the text it quotes, and the module's family metrics are computed from
// the agreed cells, with the formulas of its compute page.
//
// The existence screen is free and calls no model (the service's rule since 0.23.1: an unpaid request never invokes a
// model). It finds the phrasings of existence denial by rule, near the node's name; it is a screen, and the paid audit
// reads ABN itself. Operator, 2026-10-29: the existence check, "about 1/100th of the computation", is the free part.
import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { save, load, sha256, politeFetch } from "./util.js";
import { callCost, ceilCent, estimateTokens, POLICY } from "./cost.js";
import { thinkingFor } from "./reader.js";

export const AUDIT_PROTOCOL = "gnosis-audit/0.1 (Self-Audit Module v3.2, #817)";
export const MODULE = { name: "Self-Audit Module for Public Summarizers", version: "3.2", url: "https://www.provenanceerasure.org/module/", deposit: "https://www.alexanarch.org/s/records/817/", spec: "https://www.provenanceerasure.org/module.json" };
const MODEL = process.env.GNOSIS_AUDIT_MODEL || "claude-sonnet-5-5";
export const AUDIT_LIMITS = { renderings: 12, source_chars: 60000, rendering_chars: 20000, atoms: 24, label_chars: 120 };
export const ATOM_TYPES = ["producer", "archival authority", "institution", "corpus", "identifier", "commercial interest", "licence"];
export const EXISTENCE_TYPES = ["real", "pseudonym", "fictional", "construct"];
const FLOOR = 0.5; // a card charge starts at $0.50; an audit is priced at least there
const CAPTURES = "https://www.alexanarch.org/captures";
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const low = (s) => norm(s).toLowerCase();

// ---------------------------------------------------------------- input
function htmlText(body) {
  const $ = cheerio.load(body);
  $("script,style,noscript,svg,nav,footer,header").remove();
  return norm($("body").text() || $.root().text());
}
async function sourceOf(src) {
  if (!src || (typeof src !== "object")) throw bad("source: {url} or {text} — the source whose provenance the answers should carry");
  if (src.text) {
    const text = norm(src.text).slice(0, AUDIT_LIMITS.source_chars);
    return { kind: "supplied", label: String(src.label || "supplied text").slice(0, AUDIT_LIMITS.label_chars), url: src.url || null, text, sha256: sha256(text), chars: text.length };
  }
  if (!/^https?:\/\//.test(String(src.url || ""))) throw bad("source.url must be an http(s) address, or give source.text");
  const r = await politeFetch(src.url, { tries: 2 });
  if (r.status !== 200 || !r.body) throw Object.assign(new Error(`the source could not be fetched (HTTP ${r.status}); give its text as source.text`), { status: 422 });
  const text = (/html/i.test(r.contentType) || /<html/i.test(r.body.slice(0, 2000)) ? htmlText(r.body) : norm(r.body)).slice(0, AUDIT_LIMITS.source_chars);
  if (text.length < 200) throw Object.assign(new Error("the source page has too little text to read (a script-built page?); give its text as source.text"), { status: 422 });
  return { kind: "fetched", label: String(src.label || src.url).slice(0, AUDIT_LIMITS.label_chars), url: r.url || src.url, text, sha256: sha256(r.body), text_sha256: sha256(text), chars: text.length, fetched: new Date().toISOString() };
}
async function captureOf(slug) {
  if (!/^[a-z0-9-]{3,120}$/.test(String(slug))) throw bad(`captures: "${slug}" is not a Capture Registry address`);
  const r = await politeFetch(`${CAPTURES}/${slug}/record.json`, { tries: 2 });
  if (r.status !== 200) throw Object.assign(new Error(`the Capture Registry holds no capture at ${slug} (HTTP ${r.status})`), { status: 404 });
  const c = JSON.parse(r.body);
  const text = norm(c.transcript || c.transcript_raw || "");
  if (!text) throw Object.assign(new Error(`the capture ${slug} carries no transcript to audit`), { status: 422 });
  return { label: `${c.surface || "answer"} · ${c.date || ""} · “${c.q || slug}”`.slice(0, AUDIT_LIMITS.label_chars), surface: c.surface || null, date: c.date || null, query: c.q || null,
           capture: `${CAPTURES}/${slug}/`, text: text.slice(0, AUDIT_LIMITS.rendering_chars), sha256: sha256(text) };
}
export async function auditInputs(a) {
  if (!a || typeof a !== "object") throw bad("audit: {node: {name, existence_type}, source: {url}|{text}, renderings: [{label, text}] and/or captures: [slug], atoms?: [{type, value}], scope?: existence|full}");
  const name = norm(a.node?.name);
  if (!name) throw bad("audit.node.name: the node the answers are about");
  const et = a.node?.existence_type || "real";
  if (!EXISTENCE_TYPES.includes(et)) throw bad(`audit.node.existence_type: one of ${EXISTENCE_TYPES.join(", ")} (preregistered from the source or a registry, never from the answers)`);
  const aliases = (Array.isArray(a.node?.aliases) ? a.node.aliases : []).map(norm).filter(Boolean).slice(0, 8);
  const pasted = (Array.isArray(a.renderings) ? a.renderings : []).map((x, i) => {
    const text = norm(x?.text).slice(0, AUDIT_LIMITS.rendering_chars);
    if (!text) throw bad(`audit.renderings[${i}].text is empty`);
    return { label: norm(x.label || `answer ${i + 1}`).slice(0, AUDIT_LIMITS.label_chars), surface: x.surface || null, date: x.date || null, query: x.query || null, supplied: true, text, sha256: sha256(text) };
  });
  const caps = [];
  for (const s of (Array.isArray(a.captures) ? a.captures : []).slice(0, AUDIT_LIMITS.renderings)) caps.push(await captureOf(s));
  const renderings = [...caps, ...pasted].slice(0, AUDIT_LIMITS.renderings).map((r, i) => ({ id: `R${i + 1}`, ...r }));
  if (!renderings.length) throw bad("audit: at least one rendering (renderings: [{label, text}] or captures: [slug])");
  const atoms = (Array.isArray(a.atoms) ? a.atoms : []).slice(0, AUDIT_LIMITS.atoms).map((x, i) => {
    const type = low(x?.type), value = norm(x?.value);
    if (!ATOM_TYPES.includes(type) || !value) throw bad(`audit.atoms[${i}]: {type: one of ${ATOM_TYPES.join(", ")}, value}`);
    return { id: `A${i + 1}`, type, value, basis: "preregistered by the caller" };
  });
  return { node: { name, aliases, existence_type: et }, renderings, atoms, scope: a.scope === "existence" ? "existence" : "full", source_spec: a.source };
}

// ---------------------------------------------------------------- the free screen (no model)
// Phrasings that convert a retrieval failure into a claim about the node's existence (ABN = 1 when read and confirmed),
// and phrasings that only report the failure (ABN = 0). Hedged denials count: "it may not exist" is a denial.
const DENIAL = [
  /\b(does|do|did) not (appear to |seem to )?(actually |really )?exist\b/i, /\b(doesn'?t|didn'?t) (appear to |seem to )?exist\b/i, /\bmay not (actually |really )?exist\b/i,
  /\bmight not (actually |really )?exist\b/i, /\bno longer exists?\b/i, /\bthere (is|are|was) no (such|known|real|record of|evidence of)\b/i, /\bno such\b/i,
  /\bnot (a |an )?(real|actual|genuine|known|recogni[sz]ed|established|verifiable|legitimate)\b/i,
  /\b(appears|seems) to be (fictional|fabricated|made[- ]up|invented|a hoax|hypothetical|non-?existent)\b/i, /\b(is|are|was) (likely |probably |possibly )?(fictional|fabricated|made[- ]up|invented|a hoax|hypothetical|non-?existent)\b/i,
  /\bnon-?existent\b/i, /\bno (record|evidence|trace) (of|that)\b/i,
];
const FAILURE = [/\b(could|can) ?not (find|locate|verify|confirm)\b/i, /\bunable to (find|locate|verify|confirm)\b/i, /\bno (results|information) (found|available)\b/i, /\bI (don'?t|do not) have (any )?(information|details)\b/i];
const FICTION = /\b(fictional|hypothetical|invented|made[- ]up)\b/i;
export function existenceScreen(node, renderings) {
  const names = [node.name, ...(node.aliases || [])].map(low).filter((n) => n.length >= 3);
  const out = renderings.map((r) => {
    const sents = r.text.split(/(?<=[.!?])\s+/);
    const near = (i) => [sents[i - 1], sents[i]].some((s) => s && names.some((n) => low(s).includes(n)));
    const hits = [], fails = [];
    sents.forEach((s, i) => {
      if (!near(i) && !names.some((n) => low(s).includes(n))) return;
      for (const p of DENIAL) if (p.test(s)) {
        // a node preregistered as fictional or a construct is correctly called so
        if (["fictional", "construct"].includes(node.existence_type) && FICTION.test(s) && !/\b(not|no|doesn|does not)\b/i.test(s)) continue;
        hits.push({ sentence: s.slice(0, 400), pattern: String(p).slice(1, -2) }); break;
      }
      if (!hits.length || hits[hits.length - 1].sentence !== s.slice(0, 400)) for (const p of FAILURE) if (p.test(s)) { fails.push(s.slice(0, 400)); break; }
    });
    const mentions = names.some((n) => low(r.text).includes(n));
    return { id: r.id, label: r.label, surface: r.surface, date: r.date, mentions_node: mentions,
      screen: hits.length ? "possible existence-conversion" : fails.length ? "failure reported (scores 0)" : mentions ? "no denial phrasing found" : "node not named",
      denial_sentences: hits, failure_sentences: fails };
  });
  return {
    kind: "existence screen", free: true, model_calls: 0, protocol: AUDIT_PROTOCOL, module: MODULE, node,
    rule: "A screen by rule, with no model: it finds the phrasings of existence denial in the sentences that name the node or follow one that does. A denial, categorical or hedged, would score ABN = 1 once read and confirmed; a reported failure (\"I could not find X\") scores 0. The paid audit reads ABN itself, twice, with the quote.",
    renderings: out,
    gate: out.some((x) => x.denial_sentences.length) ? "at least one answer carries denial phrasing: read it before any family metric" : "no denial phrasing found",
  };
}

// ---------------------------------------------------------------- the model passes
const S = { type: "string" }, NS = { anyOf: [S, { type: "null" }] };
const O = (props, required = Object.keys(props)) => ({ type: "object", properties: props, required, additionalProperties: false });
const ATOM_SCHEMA = O({ atoms: { type: "array", items: O({ type: { type: "string", enum: ATOM_TYPES }, value: S, quote: S }) }, notes: S });
const READ_SCHEMA = (ids) => O({
  abn: O({ value: { type: "integer", enum: [0, 1] }, quote: NS, reason: S }),
  failure_reported: { type: "boolean" },
  atoms: { type: "array", items: O({ id: { type: "string", enum: ids }, state: { type: "string", enum: ["present", "absent", "reassigned"] }, quote: NS, credited_to: NS }) },
  notes: S,
});
const ATOM_INSTRUCTIONS = `The pass reads one SOURCE and lists the provenance atoms that any faithful rendering of the NODE would have to carry, and returns JSON only. An atom is one unit of provenance, of one of these types: producer (the author, creator or maker), archival authority (where the canonical record is kept), institution (the organization the work belongs to or issues from), corpus (the larger body of work it belongs to), identifier (a DOI, deposit number, catalogue number, URL that identifies it), commercial interest (who owns, sells or licenses it), licence (its terms of reuse). Each atom's value is stated as the source states it, and its quote is copied character for character from the source text, short (under 30 words). An atom the source does not state is not listed; nothing is inferred from outside the source. Duplicates are merged.`;
const READ_INSTRUCTIONS = `The pass reads one RENDERING (an answer a summarizer gave about the NODE) against the provenance ATOMS taken from the node's source, and returns JSON only.
1. ABN, Absence-as-Nonexistence (precondition rank 0): value 1 if the rendering converts a failure to find the node into a claim or inference that the node does not exist, categorical or hedged ("it may not exist", "this appears to be fictional"), incompatible with the node's preregistered existence type; else 0. Declining, reporting uncertainty and "I could not find X" score 0, with failure_reported true. A node preregistered as a pseudonym, a fictional entity or a construct is correctly called so, and that scores 0. Omission is not denial. The quote is the denying words, copied exactly from the rendering, or null.
2. For each atom: present if the rendering carries that provenance (the value, or an unmistakable equivalent naming the same thing, for this node); reassigned if the rendering credits the same contribution, record or role to someone or something else (credited_to names it, as the rendering does); absent otherwise. Present and reassigned need a quote copied character for character from the rendering, short (under 30 words); absent has quote null. A mention of the atom's value that does not attach it to the node is not present.
Where the rendering does not settle a cell, the pass says absent and says why in notes; a guess presented as a finding is a failure.`;
const SECOND = `\n\nThis is an independent second reading: it reaches its own judgment from the texts, and returns the same JSON form.`;

async function pass({ system, cached, prompt, schema, pass: n }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set: the audit cannot run");
  const call = async (max) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: max, ...(thinkingFor(MODEL) ? { thinking: thinkingFor(MODEL) } : {}), output_config: { format: { type: "json_schema", schema } },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: cached, cache_control: { type: "ephemeral" } }, { type: "text", text: prompt + (n === 2 ? SECOND : "") }] }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`audit reader HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  };
  let j = await call(2500), usage = [j.usage];
  if (j.stop_reason === "max_tokens") { j = await call(5000); usage.push(j.usage); }
  const text = (j.content || []).map((c) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  try { return { reading: JSON.parse(m ? m[0] : text), usage, model: MODEL }; }
  catch (e) { throw Object.assign(new Error(`audit reader returned unparseable JSON (${String(e.message).slice(0, 100)})`), { usage }); }
}
const usageCost = (us) => us.reduce((n, u) => n + (callCost(MODEL, u) || 0), 0);

// ---------------------------------------------------------------- quote
const estPass = (inTok, outTok, cached) => cached
  ? callCost(MODEL, { cache_read_input_tokens: inTok, input_tokens: 150, output_tokens: outTok })
  : callCost(MODEL, { cache_creation_input_tokens: inTok, output_tokens: outTok });
export async function quoteAudit(body, { ttl_ms = 60 * 60_000 } = {}) {
  const inp = await auditInputs(body.audit);
  const src = await sourceOf(inp.source_spec);
  const quote_id = `Q-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const nAtoms = inp.atoms.length || 10;
  const lines = [];
  if (!inp.atoms.length) {
    const t = estimateTokens(src.text) + 700;
    lines.push({ what: "the atoms, taken from the source by two independent readings", est_cost_usd: estPass(t, 900, false) + estPass(t, 900, true) });
  }
  for (const r of inp.renderings) {
    const t = estimateTokens(r.text) + nAtoms * 40 + 900;
    lines.push({ what: `${r.id}: ${r.label}, read twice for each atom and for the ABN gate`, est_cost_usd: estPass(t, 1100, false) + estPass(t, 1100, true) });
  }
  const est = lines.reduce((n, l) => n + l.est_cost_usd, 0);
  const max_price_usd = ceilCent(Math.max(FLOOR, est * POLICY.margin));
  const q = {
    quote_id, kind: "audit", protocol: AUDIT_PROTOCOL, module: MODULE, model: MODEL,
    node: inp.node, source: { kind: src.kind, label: src.label, url: src.url, sha256: src.sha256, chars: src.chars },
    renderings: inp.renderings.map(({ text, ...r }) => ({ ...r, chars: text.length })), atoms_preregistered: inp.atoms.length || 0,
    lines: lines.map((l) => ({ ...l, est_cost_usd: Math.round(l.est_cost_usd * 1e4) / 1e4 })), est_cost_usd: Math.round(est * 1e4) / 1e4,
    max_price_usd, margin: POLICY.margin, created: new Date().toISOString(), expires: new Date(Date.now() + ttl_ms).toISOString(),
    deliverables: ["the atom set A(N) with each atom's quote from the source", "the presence matrix: each answer × each atom, read twice, every quote checked verbatim, disagreements kept as contested",
      "the ABN gate per answer, read twice", "per answer: PER and the atoms reassigned to others", "family: FC, ACP, ASI, shard coverage per atom, the condition, CC (k ≥ 4)",
      "what the order does not compute (Ω, Π_d, RR, DD, QFS, DSL, α_T, Β, L), each with the input it needs"],
    terms: `Charged at the measured model cost × ${POLICY.margin}, at least $${FLOOR.toFixed(2)}, never above this quote's maximum; what the work did not use is refunded. An order that delivers nothing is refunded in full.`,
    publication: "The audit's result is public under CC BY 4.0 at its result address, with the source's hash and every quote; the texts audited are kept with it.",
  };
  await save(`audit/inputs/${quote_id}.json`, { node: inp.node, atoms: inp.atoms, renderings: inp.renderings, source: src });
  await save(`quotes/${quote_id}.json`, q);
  return q;
}

// ---------------------------------------------------------------- run
const inText = (quote, text) => !!quote && low(text).includes(low(quote));
function reconcileAtoms(a, b, srcText) {
  const key = (x) => `${x.type}|${low(x.value)}`;
  const keep = (list) => new Map(list.filter((x) => ATOM_TYPES.includes(x.type) && norm(x.value) && inText(x.quote, srcText)).map((x) => [key(x), x]));
  const A = keep(a.atoms || []), B = keep(b.atoms || []);
  const agreed = [], contested = [], breaches = [];
  for (const x of [...(a.atoms || []), ...(b.atoms || [])]) if (x.quote && !inText(x.quote, srcText)) breaches.push({ where: "atom quote", type: x.type, value: x.value, quote: x.quote, breach: "not found verbatim in the source" });
  for (const [k, x] of A) (B.has(k) ? agreed : contested).push({ ...x, readings: B.has(k) ? 2 : 1 });
  for (const [k, x] of B) if (!A.has(k)) contested.push({ ...x, readings: 1 });
  return { agreed: agreed.slice(0, AUDIT_LIMITS.atoms).map((x, i) => ({ id: `A${i + 1}`, type: x.type, value: x.value, quote: x.quote, basis: "the source, two readings agreeing" })), contested, breaches };
}
function reconcileRendering(r, atoms, a, b) {
  const breaches = [];
  const cellOf = (rd, id) => {
    const c = (rd.atoms || []).find((x) => x.id === id);
    if (!c) return { state: "absent", quote: null };
    if (c.state !== "absent" && !inText(c.quote, r.text)) { breaches.push({ where: `${r.id}×${id}`, state: c.state, quote: c.quote, breach: "not found verbatim in the rendering" }); return { state: "unverified", quote: c.quote }; }
    return c;
  };
  const cells = atoms.map((at) => {
    const x = cellOf(a, at.id), y = cellOf(b, at.id);
    const agreed = x.state === y.state && x.state !== "unverified";
    return { atom: at.id, state: agreed ? x.state : "contested", readings: [x.state, y.state], quote: agreed ? (x.quote || y.quote || null) : null, credited_to: agreed && x.state === "reassigned" ? (x.credited_to || y.credited_to || null) : null };
  });
  const abnQ = (rd) => (rd.abn?.value === 1 && !inText(rd.abn.quote, r.text)) ? (breaches.push({ where: `${r.id} ABN`, quote: rd.abn?.quote, breach: "not found verbatim in the rendering" }), null) : rd.abn?.value;
  const v1 = abnQ(a), v2 = abnQ(b);
  const abn = v1 === 1 && v2 === 1 ? { value: 1, quote: a.abn.quote } : v1 === 0 && v2 === 0 ? { value: 0 } : { value: "contested", readings: [a.abn?.value, b.abn?.value] };
  return { cells, abn, failure_reported: !!(a.failure_reported && b.failure_reported), notes: [a.notes, b.notes].filter(Boolean), breaches };
}
// The module's family metrics (compute page, v3.2): over the renderings that admitted the node. A contested cell
// counts as not carried, so every figure is a lower bound where cells are contested; the count is reported.
export function familyMetrics(atoms, rows) {
  const n = atoms.length, fam = rows.filter((r) => r.abn.value !== 1), k = fam.length;
  if (!n) return { note: "no atom was agreed from the source: there is no atom set to measure against" };
  if (!k) return { gate: "every answer denied the node's existence: there is no family to score; PER is undefined at the existence-claim layer" };
  const P = fam.map((r) => r.cells.map((c) => (c.state === "present" ? 1 : 0)));
  const cov = atoms.map((_, j) => P.reduce((s, row) => s + row[j], 0) / k);
  const acp = Math.max(...P.map((row) => row.reduce((s, v) => s + v, 0) / n));
  const fc = atoms.filter((_, j) => P.some((row) => row[j] === 1)).length / n;
  const asi = fc - acp;
  const cond = fc >= 0.9999 && Math.abs(asi) < 1e-9 ? "At least one complete rendering; no irreducible family sharding."
    : fc >= 0.9999 ? "Attribution sharding — complete only in union. Harm is displaced reader labour, which is a DSL question."
    : Math.abs(asi) < 1e-9 ? "Uniform family erasure — every rendering missing the same atoms. Nothing to traverse to."
    : "Partial sharding plus destructive family erasure.";
  const cc = [];
  if (k >= 4) for (let a1 = 0; a1 < n; a1++) for (let a2 = a1 + 1; a2 < n; a2++) {
    let t11 = 0, t10 = 0, t01 = 0, t00 = 0;
    for (const rw of P) { const x = rw[a1], y = rw[a2]; if (x && y) t11++; else if (x) t10++; else if (y) t01++; else t00++; }
    const den = Math.sqrt((t11 + t10) * (t01 + t00) * (t11 + t01) * (t10 + t00));
    if (!den) continue;
    const phi = (t11 * t00 - t10 * t01) / den;
    if (Math.abs(phi) >= 0.5) cc.push({ pair: [atoms[a1].id, atoms[a2].id], phi: Math.round(phi * 1000) / 1000, table: [t11, t10, t01, t00] });
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { k, n, excluded_by_abn: rows.length - k, FC: r3(fc), ACP: r3(acp), ASI: r3(asi), coverage: atoms.map((a, j) => ({ atom: a.id, coverage: r3(cov[j]), note: cov[j] === 0 ? "shed by every rendering" : cov[j] === 1 ? "travels intact" : null })),
    condition: cond, CC: k >= 4 ? cc : { not_interpreted: `k = ${k}; CC is not interpreted below k ≥ 4` },
    note: "ASI = 0 does not certify intact attribution: a family can be uniformly incomplete. A contested cell counts as not carried, so each figure is a lower bound where cells are contested." };
}
export async function runAudit(q, { deadline } = {}) {
  const inp = await load(`audit/inputs/${q.quote_id}.json`);
  if (!inp) throw new Error("the audit's inputs are not in the store");
  const budget = q.max_price_usd / POLICY.margin * 1.5; // model spending stops here
  const spent = [], evidence = { passes: [] };
  let cost = 0;
  const run = async (what, args) => {
    const out = [];
    for (const n of [1, 2]) { const p = await pass({ ...args, pass: n }); out.push(p.reading); spent.push(...p.usage); cost += usageCost(p.usage); evidence.passes.push({ what, pass: n, model: p.model, usage: p.usage, reading: p.reading }); }
    return out;
  };
  const nodeLine = `NODE\n${JSON.stringify(inp.node)}`;
  let atoms, atomBreaches = [], atomsContested = [];
  if (inp.atoms?.length) {
    atoms = inp.atoms.map((a) => ({ ...a, in_source: inText(a.value, inp.source.text) }));
  } else {
    const [a, b] = await run("atoms", { system: ATOM_INSTRUCTIONS, cached: `${nodeLine}\nSOURCE (${inp.source.label})\n${inp.source.text}`, prompt: "List the provenance atoms.", schema: ATOM_SCHEMA });
    const rc = reconcileAtoms(a, b, inp.source.text); atoms = rc.agreed; atomsContested = rc.contested; atomBreaches = rc.breaches;
  }
  const rows = [], unread = [];
  const atomLine = `ATOMS\n${JSON.stringify(atoms.map(({ id, type, value }) => ({ id, type, value })))}`;
  // Three answers are read at once (each answer's two passes in order, so the second reads the first's cache); an
  // answer not started before the model budget or the run's time budget is reached is listed as unread, never charged.
  const one = async (r) => {
    if (cost >= budget || (deadline && Date.now() > deadline - 60e3)) { unread.push({ id: r.id, label: r.label, reason: cost >= budget ? "the order's model budget was reached" : "the run's time budget was reached" }); return; }
    try {
      const [a, b] = await run(r.id, { system: READ_INSTRUCTIONS, cached: `${nodeLine}\n${atomLine}\nRENDERING ${r.id} (${r.label})\n${r.text}`, prompt: "Read the rendering against the atoms.", schema: READ_SCHEMA(atoms.map((x) => x.id)) });
      const rc = reconcileRendering(r, atoms, a, b);
      const carried = rc.cells.filter((c) => c.state === "present").length;
      rows.push({ id: r.id, label: r.label, surface: r.surface, date: r.date, query: r.query, capture: r.capture || null, sha256: r.sha256, ...rc,
        PER: rc.abn.value === 1 ? null : Math.round((1 - carried / atoms.length) * 1000) / 1000,
        PER_note: rc.abn.value === 1 ? "undefined at the existence-claim layer (ABN = 1)" : `1 − ${carried}/${atoms.length}; a contested cell counts as not carried`,
        reassigned: rc.cells.filter((c) => c.state === "reassigned").map((c) => ({ atom: c.atom, credited_to: c.credited_to, quote: c.quote })) });
    } catch (e) { if (e.usage) { spent.push(...e.usage); cost += usageCost(e.usage); } unread.push({ id: r.id, label: r.label, reason: String(e.message || e).slice(0, 200) }); }
  };
  if (atoms.length) { const queue = [...inp.renderings]; await Promise.all([0, 1, 2].map(async () => { while (queue.length) await one(queue.shift()); })); }
  else unread.push(...inp.renderings.map((r) => ({ id: r.id, label: r.label, reason: "no atom was agreed from the source" })));
  const order = new Map(inp.renderings.map((r, i) => [r.id, i])); rows.sort((x, y) => order.get(x.id) - order.get(y.id));
  const family = familyMetrics(atoms, rows);
  const charge = rows.length ? Math.min(q.max_price_usd, ceilCent(Math.max(FLOOR, cost * POLICY.margin))) : 0;
  const result_id = `R-${sha256(q.quote_id + AUDIT_PROTOCOL).slice(0, 16)}`;
  const composition = {
    result_id, kind: "audit", protocol: AUDIT_PROTOCOL, module: MODULE, quote_id: q.quote_id, node: inp.node,
    source: { label: inp.source.label, url: inp.source.url, sha256: inp.source.sha256, chars: inp.source.chars },
    atoms: { set: atoms, contested: atomsContested, basis: inp.atoms?.length ? "preregistered by the caller; in_source marks a value found verbatim in the source" : "taken from the source by two independent readings; only atoms both readings found, each with a quote found verbatim in the source" },
    renderings: rows, unread, family,
    not_computed: [
      { metric: "Ω (erasure skew)", needs: "four or more sources with their standing; incomputable below four, reported as such" },
      { metric: "Π_d (referential dispersal)", needs: "the token-coordinates the referent shares with other entities" },
      { metric: "RR and DD (recoverability)", needs: "live follow-up queries under a preregistered budget B_a" },
      { metric: "QFS, DSL-Self, α_T, Β, L", needs: "the query wording, the substrate's own audit, and the legibility test, which this order does not run" }],
    summary: { renderings: inp.renderings.length, completed: rows.length, unread: unread.length, atoms: atoms.length, contested_cells: rows.reduce((n, r) => n + r.cells.filter((c) => c.state === "contested").length, 0),
      abn_gates: rows.filter((r) => r.abn.value === 1).length, breaches: atomBreaches.length + rows.reduce((n, r) => n + r.breaches.length, 0) },
    licence: "CC BY 4.0", created: new Date().toISOString(),
  };
  const billing = { rule: `measured model cost × ${POLICY.margin}, at least $${FLOOR.toFixed(2)}, never above the quote`, cost_measured: true, cost_usd: Math.round(cost * 1e6) / 1e6, charge_usd: charge, quoted_max_usd: q.max_price_usd };
  await save(`results/${result_id}/composition.json`, composition);
  await save(`results/${result_id}/evidence.json`, { result_id, protocol: AUDIT_PROTOCOL, inputs: { node: inp.node, atoms: inp.atoms, source: inp.source, renderings: inp.renderings }, atom_breaches: atomBreaches, ...evidence, billing: { rule: billing.rule, cost_measured: true } });
  await save(`billing/${result_id}.json`, billing);
  return { result_id, composition, record: { billing } };
}
