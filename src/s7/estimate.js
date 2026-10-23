// The S7 estimate a quote carries: the traversal and the hop screen run for real (deterministic, no model call), and each
// model pass is costed from what it would be sent. Where admission is not yet known, every DRO candidate deposit is
// costed as admitted and extracted, the hop is screened from all of them, and a declared share of the screened hop
// candidates is costed as admitted and extracted. It is an estimate; the run's execution budget is what bounds spending.
export const HOP_ADMIT_SHARE = 0.1;
import { traverse } from "./traverse.js";
import { blogPass } from "./blog.js";
import { hopScreen } from "./reading.js";
import { depText } from "./archive.js";
import { MODELS } from "./model.js";
import { callCost, estimateTokens } from "../cost.js";

const two = (model, inTok, outTok) => callCost(model, { cache_creation_input_tokens: inTok, output_tokens: outTok }) + callCost(model, { cache_read_input_tokens: inTok, input_tokens: 100, output_tokens: outTok });

export async function estimateS7(input) {
  const trav = traverse(input);
  const blog = blogPass(input);
  const { divide } = await import("./about.js");
  const { isByline } = await import("./reading.js");
  const dv = divide(input, [...trav.D, ...trav.R, ...trav.O, ...blog.D], isByline);
  const dro = dv.read;
  const deps = [...new Set(dro.map((c) => c.dep))];
  const droChars = dro.reduce((n, c) => n + c.sentence.length + 600, 0);
  const { readsWhole, triageSentences, CODE_SCREEN_RECALL } = await import("./about.js");
  const { paragraphs } = await import("./archive.js");
  const whole = deps.filter((d) => readsWhole(dv, d)), pred = deps.filter((d) => !readsWhole(dv, d));
  const numeric = whole.filter((d) => typeof d === "number");
  const travH = numeric.length ? traverse(input, { hopFrom: numeric }) : { ...trav, H: [] };
  const hs = hopScreen(input, travH, dro.map((c) => c.sentence));
  const hopChars = JSON.stringify(hs.screened).length;
  const hopAdmit = hs.screened.slice().sort((a, b) => b.cands.length - a.cands.length).slice(0, Math.ceil(hs.screened.length * HOP_ADMIT_SHARE)).map((x) => x.h.dep);
  // A predication deposit is costed at the paragraphs it would be sent: its opening three and each predicating one with its neighbours.
  const predTok = (d) => { const ps = paragraphs(depText(d).text), want = new Set([0, 1, 2]); for (const c of dro.filter((x) => x.dep === d)) for (const k of [-1, 0, 1]) want.add(c.para + k);
    return Math.min(estimateTokens([...want].map((i) => ps[i] || "").join("\n\n")), 10000) + 1500; };
  // Live, the triage pass decides which mentions are about the entity, and the code screen finds about half of what
  // readings admit (CODE_SCREEN_RECALL); the predication deposits are therefore costed at the code screen's count
  // divided by its recall, and the triage pass at every distinct live sentence on the small model.
  const scale = dv.mode === "bearing" ? 1 : 1 / CODE_SCREEN_RECALL;
  const tri = dv.mode === "bearing" ? [] : triageSentences(input, [...trav.D, ...trav.R, ...trav.O, ...blog.D], isByline);
  const exTok = [...whole, ...hopAdmit].reduce((n, d) => n + Math.min(estimateTokens(depText(d).text), 15000) + 1500, 0) + pred.reduce((n, d) => n + predTok(d), 0) * scale;
  const fieldTok = input.field.reduce((n, b) => n + Math.min(estimateTokens(b.text), 9000) + 1500, 0);
  const claimsEst = (whole.length + hopAdmit.length) * 10 + Math.ceil(pred.length * 3 * scale) + input.field.length * 8;
  // Composition by lineage caps what one call receives (lineage.js); the estimate costs the larger ledger at that cap.
  const ledgerTok = Math.min(claimsEst * 140, 90000) + input.T.claims.length * 60;
  const hopBatches = Math.max(1, Math.ceil(hopChars / 4 / 60000));
  const stages = {
    admission: two(MODELS.reading, Math.ceil((droChars / 4) * (dv.mode === "bearing" ? 1 : scale)) + 1200, Math.ceil(deps.length * scale) * 120),
    // The hop is read in batches on the small model; costed per batch of at most 60,000 tokens, never at the long-context rate.
    hop: hopBatches * two(MODELS.triage, Math.ceil(hopChars / 4 / hopBatches) + 1200, Math.ceil((hs.screened.length * 120) / hopBatches)),
    extraction: callCost(MODELS.reading, { input_tokens: exTok + fieldTok, output_tokens: (whole.length + hopAdmit.length + input.field.length) * 2500 + pred.length * 900 * scale }),
    // Costed batch by batch, as it runs (120 sentences a call), so no call is priced at the long-context rate.
    triage: Array.from({ length: Math.ceil(tri.length / 120) }, (_, i) => tri.slice(i * 120, i * 120 + 120))
      .reduce((n, b) => n + callCost(MODELS.triage, { input_tokens: b.reduce((m, s) => m + Math.ceil(Math.min(500, s.sentence.length) / 4) + 40, 0) + 700, output_tokens: b.length * 8 }), 0),
    ontology: two(MODELS.reading, ledgerTok + 1500, 9000),
    composition: callCost(MODELS.reading, { input_tokens: ledgerTok + 3000, output_tokens: 16000 }),
    delta: callCost(MODELS.reading, { input_tokens: Math.ceil(ledgerTok / 2) + estimateTokens(input.T.text) + 8000, output_tokens: 3000 }),
    audit: two(MODELS.reading, 18000, 3000),
  };
  const est = Object.values(stages).reduce((a, b) => a + b, 0);
  return { est_cost_usd: Math.round(est * 1e4) / 1e4, stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])),
    division: dv.mode === "bearing" ? null : { mode: dv.mode, read_deposits: deps.length, read_whole: whole.length, read_at_predication: pred.length, predication_scaled_by: Math.round(scale * 1000) / 1000, triage_sentences: tri.length, scanned_deposits: dv.scanned.deposits, works: dv.works.length, basis: dv.scanned.basis },
    counts: { candidate_deposits: deps.length, blog_candidate_posts: new Set(blog.D.map((c) => c.dep)).size, hop_candidates: travH.H.length, hop_screened_upper_bound: hs.screened.length, hop_admissions_costed: hopAdmit.length, hop_admit_share: HOP_ADMIT_SHARE, field_sources: input.field.length, est_claims: claimsEst },
    release: trav.release };
}
