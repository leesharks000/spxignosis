// Code checks what the readers claim. Readers judge; this verifies.
// A failed check is a breach: recorded in the evidence record, withheld from the composition result.
import { sha256 } from "./util.js";

// Comparison form only: NFC, one apostrophe/koronis, one space. The stored text is never altered.
export function norm(s) {
  return (s || "").normalize("NFC")
    .replace(/[᾽᾿’ʼ'῾ʽ]/g, "’")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, " ").trim();
}
export const NORMALIZATION = "NFC; ᾿ ᾽ ’ ʼ ' unified; curly and angle quotes unified; whitespace collapsed";

// reading = { claim_id, spans: [{ quote, source_ref, role }], classes, paraphrase, attributization, ... }
// sources = { [ref]: { text, text_sha256, ... } } ; claim = { text, text_sha256 }
export function validateReading(reading, claim, sources) {
  const breaches = [];
  if (claim.text_sha256 !== sha256(claim.text)) breaches.push({ check: "claim-hash", detail: "claim text does not match its hash" });
  for (const [i, sp] of (reading.spans || []).entries()) {
    const where = sp.source_ref === "claim" ? { text: claim.text } : sources[sp.source_ref];
    if (!where) { breaches.push({ check: "locator", span: i, detail: `source_ref "${sp.source_ref}" does not resolve` }); continue; }
    if (where.text_sha256 && sha256(where.text) !== where.text_sha256) breaches.push({ check: "source-hash", span: i, detail: `stored source ${sp.source_ref} fails its hash` });
    if (!sp.quote || !norm(where.text).includes(norm(sp.quote))) breaches.push({ check: "quote-in-source", span: i, detail: `quoted span not found verbatim in ${sp.source_ref}`, quote: sp.quote });
  }
  const required = ["claim_id", "support", "spans", "paraphrase", "attributization"];
  for (const k of required) if (!(k in reading)) breaches.push({ check: "schema", detail: `missing ${k}` });
  const SUPPORT = ["supported", "partially-supported", "qualifier-added", "interpretation-beyond-paraphrase", "unsupported", "unresolved"];
  for (const s of reading.support || []) if (!SUPPORT.includes(s)) breaches.push({ check: "schema", detail: `unknown support class "${s}"` });
  if (!(reading.spans || []).length) breaches.push({ check: "evidence", detail: "a classification with no quoted evidence" });
  return { ok: breaches.length === 0, breaches };
}

// Two passes: they concur when they give the same answer on every distinction the instrument measures: the support
// classes, whether an act was converted into an attribute, and whether what survives keeps authority to revise the
// description. Anything else is contested, with both readings carried whole. Two passes of one model family concur or
// differ; their concordance is a consistency check and is named so ("concordant"). Validation is the calibration of the
// passes against the archive's /non readings (EA-WIKI-OPEN-01 §5.4); a second pass on another family is recorded by its
// model and, where it concurs, the status is "concordant across families".
export function reconcile(a, b) {
  const key = (r) => JSON.stringify({
    support: [...(r.support || [])].sort(),
    converted: r.attributization?.converted ?? null,
    authority: r.attributization?.retains_authority ?? null,
  });
  const ka = JSON.parse(key(a)), kb = JSON.parse(key(b));
  const differs = Object.keys(ka).filter((k) => JSON.stringify(ka[k]) !== JSON.stringify(kb[k]));
  if (!differs.length) return { status: a.__family && b.__family && a.__family !== b.__family ? "concordant across families" : "concordant", support: a.support, attributization_converted: ka.converted, retains_authority: ka.authority };
  return { status: "contested", differs, readings: [a, b].map((r) => ({ support: r.support, converted: r.attributization?.converted, retains_authority: r.attributization?.retains_authority, paraphrase: r.paraphrase?.defensible, changes: [...(r.paraphrase?.scope_changes || []), ...(r.paraphrase?.introduced || [])] })) };
}
