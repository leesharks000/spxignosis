// Code checks what the readers claim. Readers judge; this verifies.
// A failed check is a breach: recorded in the evidence record, withheld from the composition result.
import { sha256 } from "./util.js";
import { normalizeReading } from "./reader.js";

// Comparison form only: NFC, one apostrophe/koronis, one space. The stored text is never altered.
export function norm(s) {
  return (s || "").normalize("NFC")
    .replace(/[᾽᾿’ʼ'῾ʽ]/g, "’")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, " ").trim();
}
export const NORMALIZATION = "NFC; ᾿ ᾽ ’ ʼ ' unified; curly and angle quotes unified; whitespace collapsed";

// reading = { claim_id, spans: [{ quote, source_ref, role }], support, paraphrase, attributization, ... } (gnosis-S3/0.5,
// or the 0.4 form, read through normalizeReading). sources = { [ref]: { text, text_sha256, ... } };
// claim = { text, text_sha256 }; shown = { [ref]: the passages sent to the reader, joined } (optional).
// A quotation found nowhere in the full source is a breach that withholds the pass. A quotation found in the source
// but not in the passages sent is recorded as its own breach ("quote-outside-passages"): the reader quoted what it was
// not shown. It is written into the evidence and does not withhold the pass; checks record, they do not prevent.
export const SUPPORT = ["supported", "partially-supported", "qualifier-added", "interpretation-beyond-paraphrase", "unsupported", "unresolved"];
export const SUPPORT_SOURCE = ["at the sentence", "elsewhere in the article", "none"];
export const MEASURES = ["source fidelity", "primary-text adequacy", "operative retention"];
export const ATTR = ["yes", "partial", "no"];
export const AUTHORITY = ["retained", "lost", "mixed", "unknown"];
export const INVITATION = ["preserved", "omitted", "answered-in-source-name", "foreclosed", "not-applicable"];
const WITHHOLDS = new Set(["claim-hash", "locator", "source-hash", "quote-in-source", "schema", "evidence"]);

export function validateReading(reading, claim, sources, shown = null) {
  const breaches = [];
  if (claim.text_sha256 !== sha256(claim.text)) breaches.push({ check: "claim-hash", detail: "claim text does not match its hash" });
  for (const [i, sp] of (reading.spans || []).entries()) {
    const where = sp.source_ref === "claim" ? { text: claim.text } : sources[sp.source_ref];
    if (!where) { breaches.push({ check: "locator", span: i, detail: `source_ref "${sp.source_ref}" does not resolve` }); continue; }
    if (where.text_sha256 && sha256(where.text) !== where.text_sha256) breaches.push({ check: "source-hash", span: i, detail: `stored source ${sp.source_ref} fails its hash` });
    if (!sp.quote || !norm(where.text).includes(norm(sp.quote))) { breaches.push({ check: "quote-in-source", span: i, detail: `quoted span not found verbatim in ${sp.source_ref}`, quote: sp.quote }); continue; }
    if (shown && sp.source_ref !== "claim" && shown[sp.source_ref] != null && !norm(shown[sp.source_ref]).includes(norm(sp.quote)))
      breaches.push({ check: "quote-outside-passages", span: i, detail: `quoted span stands in ${sp.source_ref} but not in the passages sent`, quote: sp.quote });
  }
  for (const k of ["claim_id", "support", "spans", "paraphrase", "attributization"]) if (!(k in reading)) breaches.push({ check: "schema", detail: `missing ${k}` });
  for (const x of reading.support || []) if (!SUPPORT.includes(x)) breaches.push({ check: "schema", detail: `unknown support class "${x}"` });
  // Fields of the 0.5 form, checked where present; a value outside its vocabulary is recorded, and does not withhold.
  const vocab = (field, v, list) => { if (v != null && !list.includes(v)) breaches.push({ check: "vocabulary", detail: `${field}: "${v}" is not one of ${list.join(", ")}` }); };
  for (const x of reading.support_source || []) vocab("support_source", x, SUPPORT_SOURCE);
  vocab("attributization.value", reading.attributization?.value, ATTR);
  vocab("retained_authority.value", reading.retained_authority?.value, AUTHORITY);
  for (const d of reading.paraphrase?.deltas || []) { vocab("delta.measure", d.measure, MEASURES); if (d.lambda != null && ![1, 2, 3, 4, 5].includes(d.lambda)) breaches.push({ check: "vocabulary", detail: `delta.lambda: ${d.lambda}` }); }
  for (const x of reading.invitation?.codes || []) vocab("invitation.codes", x, INVITATION);
  if ((reading.support_source || []).includes("at the sentence") && claim.cited === false) breaches.push({ check: "support-located", detail: "support recorded at the sentence for a sentence that cites nothing" });
  if (!(reading.spans || []).length) breaches.push({ check: "evidence", detail: "a classification with no quoted evidence" });
  return { ok: !breaches.some((b) => WITHHOLDS.has(b.check)), breaches };
}

// Two passes concur when they give the same answer on every distinction the instrument measures: the support classes,
// whether an act was restated as an attribute (yes, partial, no), and the retained authority (retained, lost, mixed,
// unknown). Anything else is contested, with both readings carried whole. The invitation codes are prospective
// (EA-WIKI-OPEN-01 v1.1 §9.7): where the passes differ on them the difference is recorded beside the verdict and never
// makes a claim contested. Two passes of one model family concur or differ; their concordance is a consistency check
// and is named so ("concordant"). Validation is the calibration of the passes against the archive's /non readings
// (§5.4); a second pass on another family is recorded by its model and, where it concurs, the status is "concordant
// across families".
export function reconcile(a0, b0) {
  const a = normalizeReading(a0), b = normalizeReading(b0);
  const key = (r) => ({ support: [...(r.support || [])].sort(), attributization: r.attributization?.value ?? null, authority: r.retained_authority?.value ?? null });
  const ka = key(a), kb = key(b);
  const differs = Object.keys(ka).filter((k) => JSON.stringify(ka[k]) !== JSON.stringify(kb[k]));
  const codes = (r) => [...(r.invitation?.codes || [])].sort();
  const invitation_differs = JSON.stringify(codes(a)) !== JSON.stringify(codes(b)) ? { status: "prospective; recorded, not counted", readings: [codes(a), codes(b)] } : undefined;
  if (!differs.length) return { status: a.__family && b.__family && a.__family !== b.__family ? "concordant across families" : "concordant", support: a.support, attributization: ka.attributization, attributization_converted: ka.attributization === "yes" || ka.attributization === "partial", retained_authority: ka.authority, invitation_differs };
  return { status: "contested", differs, invitation_differs, readings: [a, b].map((r) => ({ support: r.support, attributization: r.attributization?.value, converted: r.attributization?.converted, retained_authority: r.retained_authority?.value, paraphrase: r.paraphrase?.defensible, changes: (r.paraphrase?.deltas || []).map(deltaText), innocent_reading: r.innocent_reading })) };
}

export function deltaText(d) {
  return typeof d === "string" ? d : `${d.sentence_says}${d.source_says ? ` (source: ${d.source_says})` : ""}${d.kind ? ` · ${d.kind}` : ""}${d.measure ? ` · ${d.measure}` : ""}${d.lambda ? ` · λ ${d.lambda}` : ""}`;
}
