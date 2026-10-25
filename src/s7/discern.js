// Discernment of a composition the caller supplies (operator, 2026-10-21: "i think we have to be careful on admitting a
// supplied composition. that would open /non to any kind of falsification"; "there has to be some kind of
// evaluation/verification"; "discernment").
//
// /non is public, so a transcript enters a row only with an account of what was checked and what could not be. Three
// things are separable. (1) What the service can verify by code, at the quote and free: that the transcript engages
// sources at all (the registry's rule: "a capture enters the registry by means of source engagement in composition");
// that each card it cites resolves to a page the service fetches itself; how much of each sentence's content stands in
// the fetched pages; that every string the transcript quotes is found there; whether the registry already holds an
// observation at the same address, surface and date, and if so whether the texts agree; and how far the transcript
// departs from the most recent observation seated at its address. (2) What the service verifies by reading, at the
// opening: S3, each sentence of the transcript read against the cards it engages, as any sentence is read against
// its cited sources. (3) What no check here can verify: that the surface composed this text at this address on this
// date. That is the caller's attestation. It is recorded as attestation, and a row whose T rests on it is held from
// landing until the registry's own intake seats the composition as a capture.
// Checks record; they do not prevent: a failing check is written into the row as a breach, with its evidence.
import { capturesFor } from "./input.js";

const TOK = /[\p{L}\p{N}]+/gu;
const STOP = new Set("the a an and or of to in on for with by as at from that this these those is are was were be been being it its which who whom whose what when where how not no but also than then there their they them he she his her we our you your i me my".split(" "));
const words = (s) => (String(s || "").toLowerCase().normalize("NFKC").match(TOK) || []).filter((w) => w.length > 2 && !STOP.has(w));
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size && !B.size) return 1; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
const norm = (s) => String(s || "").toLowerCase().normalize("NFKC").replace(/[“”"‘’']/g, "'").replace(/\s+/g, " ").trim();

export const GROUNDING_FLOOR = 0.5; // a sentence is grounded by code when half its content words stand in one fetched card

// Two claims a supplied text can make, kept apart (operator, 2026-10-21: "it is fine to construct novel entities as long
// as they are marked as such"). An *attested* composition claims a surface composed it at an address on a date; that
// claim is what discernment tests, and what holds the row from landing until the registry seats it. A *composition by
// the caller* claims no surface (it names none, or the entity is declared novel): it is admitted as what it is, the
// caller's construction, marked so in the row, and the checks below are recorded as its account.
export function discern(spec, snaps, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const tr = spec.transcript || {};
  const attested = !!tr.surface && !spec.novel;
  const text = String(tr.text || "");
  const cards = Array.isArray(tr.cite_list) ? tr.cite_list : [];
  const breaches = [], checks = {};
  const address = String(spec.address || tr.q || spec.name || "").toLowerCase().trim();
  // Attestation: what the caller says happened. Recorded as said; the defaults follow the registry's own.
  checks.attestation = { address, surface: tr.surface || null, date: tr.date || null, auth: tr.auth || "signed out, incognito (registry default)", attested_by: "the caller", observed_by_service: false };
  if (attested && !/^\d{4}-\d{2}-\d{2}/.test(String(tr.date || ""))) breaches.push({ check: "attestation", detail: "no date in YYYY-MM-DD form" });
  else if (String(tr.date).slice(0, 10) > today) breaches.push({ check: "attestation", detail: `the attested date ${tr.date} is after the quote (${today})` });
  // Source engagement.
  const fetched = snaps.filter((s) => s.text && s.retrieved);
  checks.engagement = { cards: cards.length, cards_with_url: cards.filter((c) => c.url).length, fetched_by_service: fetched.length,
    rule: "a capture enters the registry by means of source engagement in composition" };
  if (attested && !cards.length) breaches.push({ check: "engagement", detail: "the transcript cites no source card: under the registry's rule it is no capture, and nothing in it can be checked against a source" });
  else if (cards.length && !fetched.length) breaches.push({ check: "engagement", detail: "no cited card resolved to a page the service could fetch" });
  // Grounding by code, sentence by sentence, against the pages the service fetched (snippets the caller supplies are
  // the caller's attestation, never evidence).
  const sentences = text.split(/\n+|(?<=[.!?])\s+(?=[A-Z“"'(])/).map((s) => s.trim()).filter((s) => words(s).length >= 4);
  const pages = fetched.map((s) => ({ url: s.final_url || s.url, set: new Set(words(s.text)), low: norm(s.text) }));
  const per = sentences.map((s, i) => {
    const w = [...new Set(words(s))];
    let best = 0, at = null;
    for (const p of pages) { const share = w.filter((x) => p.set.has(x)).length / w.length; if (share > best) { best = share; at = p.url; } }
    return { id: `T${i + 1}`, share: Math.round(best * 100) / 100, card: at, grounded: best >= GROUNDING_FLOOR };
  });
  checks.grounding = { sentences: per.length, grounded: per.filter((x) => x.grounded).length, floor: GROUNDING_FLOOR, per_sentence: per,
    note: "content-word share of each sentence found in its best fetched card; a locator for S3, which reads each sentence against the cards" };
  // Quoted strings must stand in a fetched page.
  const quoted = [...text.matchAll(/[“"]([^”"]{12,300})[”"]/g)].map((m) => m[1]);
  const lost = quoted.filter((q) => !pages.some((p) => p.low.includes(norm(q))));
  checks.quotations = { quoted: quoted.length, found: quoted.length - lost.length, not_found: lost.slice(0, 20) };
  if (lost.length) breaches.push({ check: "quotation", detail: `${lost.length} of ${quoted.length} quoted strings stand in no fetched card` });
  // The registry: the same observation already seated, or a departure from what is seated at the address.
  const caps = capturesFor([spec.name, ...(spec.aliases || [])]);
  const all = [...caps.bare, ...caps.related];
  const same = all.filter((o) => String(o.q || "").toLowerCase().trim() === address && o.surface === tr.surface && String(o.date || "").slice(0, 10) === String(tr.date || "").slice(0, 10));
  const seatedText = (o) => { try { return capturesFor([spec.name, ...(spec.aliases || [])], { pick: o.obs_id || o.slug }).primary.transcript; } catch { return ""; } };
  checks.registry = { same_observation: same.map((o) => o.obs_id || o.slug) };
  if (same.length) {
    const sims = same.map((o) => ({ id: o.obs_id || o.slug, similarity: Math.round(jaccard(words(text), words(seatedText(o))) * 100) / 100 }));
    checks.registry.agreement = sims;
    if (!sims.some((x) => x.similarity >= 0.8)) breaches.push({ check: "registry", detail: `the registry seats an observation at this address, surface and date (${sims.map((x) => x.id).join(", ")}) whose text differs from the one supplied` });
  }
  const prior = all.filter((o) => String(o.q || "").toLowerCase().trim() === address && o.chars >= 300).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (prior) checks.registry.departure = { from: prior.obs_id || prior.slug, date: prior.date, surface: prior.surface, similarity: Math.round(jaccard(words(text), words(seatedText(prior))) * 100) / 100,
    note: "word-set overlap with the most recent observation seated at the address; compositions drift, so this is recorded, never judged" };
  if (!attested) return { protocol: "gnosis discernment v1", verdict: "admitted as the caller's composition, marked as such", mode: spec.novel ? "novel entity" : "composition by the caller", checks, breaches,
    provenance: spec.novel ? "a novel entity, constructed by the caller and marked as such: no surface is claimed to have composed it" : "composed by the caller and marked as such: no surface is claimed to have composed it",
    landing: "not held: the row marks T as the caller's construction" };
  const verdict = breaches.some((b) => ["engagement", "registry"].includes(b.check)) ? "not admissible as T"
    : breaches.length || checks.grounding.grounded < checks.grounding.sentences ? "admissible, with breaches recorded"
    : "admissible";
  return { protocol: "gnosis discernment v1", verdict, mode: "attested composition", checks, breaches,
    provenance: "attested by the caller, not observed by the service: the surface, address and date are the caller's statement",
    landing: "held: a row whose T is a supplied composition lands only once the registry's intake seats the composition as a capture" };
}
