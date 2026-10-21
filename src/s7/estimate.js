// The S7 estimate a quote carries: the traversal and the hop screen run for real (deterministic, no model call), and each
// model pass is costed from what it would be sent. Upper bounds where admission is not yet known: every DRO candidate
// deposit is costed as admitted and extracted, and the hop is screened from all of them.
import { traverse } from "./traverse.js";
import { blogPass } from "./blog.js";
import { hopScreen } from "./reading.js";
import { depText } from "./archive.js";
import { MODELS } from "./model.js";
import { callCost, estimateTokens } from "../cost.js";

const two = (model, inTok, outTok) => callCost(model, { cache_creation_input_tokens: inTok, output_tokens: outTok }) + callCost(model, { cache_read_input_tokens: inTok, input_tokens: 100, output_tokens: outTok });

export function estimateS7(input) {
  const trav = traverse(input);
  const blog = blogPass(input);
  const dro = [...trav.D, ...trav.R, ...trav.O, ...blog.D];
  const deps = [...new Set(dro.map((c) => c.dep))];
  const droChars = dro.reduce((n, c) => n + c.sentence.length + 600, 0);
  const numeric = deps.filter((d) => typeof d === "number");
  const travH = numeric.length ? traverse(input, { hopFrom: numeric }) : { ...trav, H: [] };
  const hs = hopScreen(input, travH, dro.map((c) => c.sentence));
  const hopChars = JSON.stringify(hs.screened).length;
  const exTok = deps.reduce((n, d) => n + Math.min(estimateTokens(depText(d).text), 15000) + 1500, 0);
  const fieldTok = input.field.reduce((n, b) => n + Math.min(estimateTokens(b.text), 9000) + 1500, 0);
  const claimsEst = deps.length * 10 + input.field.length * 8;
  const ledgerTok = claimsEst * 140 + input.T.claims.length * 60;
  const stages = {
    admission: two(MODELS.reading, Math.ceil(droChars / 4) + 1200, deps.length * 120),
    hop: two(MODELS.triage, Math.ceil(hopChars / 4) + 1200, hs.screened.length * 120),
    extraction: callCost(MODELS.reading, { input_tokens: exTok + fieldTok, output_tokens: (deps.length + input.field.length) * 2500 }),
    ontology: two(MODELS.reading, ledgerTok + 1500, 9000),
    composition: callCost(MODELS.reading, { input_tokens: ledgerTok + 3000, output_tokens: 16000 }),
    audit: two(MODELS.reading, 18000, 3000),
  };
  const est = Object.values(stages).reduce((a, b) => a + b, 0);
  return { est_cost_usd: Math.round(est * 1e4) / 1e4, stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])),
    counts: { candidate_deposits: deps.length, blog_candidate_posts: new Set(blog.D.map((c) => c.dep)).size, hop_candidates: travH.H.length, hop_screened_upper_bound: hs.screened.length, field_sources: input.field.length, est_claims: claimsEst },
    release: trav.release };
}
