// Cost accounting and pricing. Prices in USD per million tokens, from the Claude API pricing page (read 2026-10-21).
// Update the table when prices change; every result records the table version it was costed with.
export const PRICE_TABLE = {
  version: "claude-api-2026-10-21",
  models: {
    "claude-haiku-5-5":  { in: 0.10, out: 0.50, cache_write_5m: 0.125, cache_read: 0.01, long_context: { over: 100_000, in: 0.50, out: 2.50, cache_write_5m: 0.625, cache_read: 0.05 } },
    "claude-sonnet-5-5": { in: 2.00, out: 10.00, cache_write_5m: 2.50, cache_read: 0.10 },
    "claude-opus-5-5":   { in: 4.00, out: 20.00, cache_write_5m: 5.00, cache_read: 0.20 },
  },
};

// usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
export function callCost(model, u = {}) {
  let p = PRICE_TABLE.models[model];
  if (!p) return null;
  const prompt = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  if (p.long_context && prompt > p.long_context.over) p = { ...p, ...p.long_context };
  const usd = ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out
    + (u.cache_creation_input_tokens || 0) * p.cache_write_5m + (u.cache_read_input_tokens || 0) * p.cache_read) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

// Token estimate before a call: English ~4 chars/token; Greek and other dense scripts ~1.3 chars/token.
export function estimateTokens(text) {
  const t = text || "";
  const dense = (t.match(/[Ͱ-Ͽἀ-῿Ѐ-ӿ֐-ۿ一-鿿]/g) || []).length;
  return Math.ceil((t.length - dense) / 4 + dense / 1.3);
}

// Estimated cost of reading one claim: the first pass writes the full account, compactly (about 1,200 output tokens);
// the second, independent pass reads the first's cached prefix and returns only the fields the passes are reconciled
// on (about 300). Output is most of the cost: two full accounts of 2,800 tokens each cost $0.075 a sentence on the
// middle model, against about $0.03 this way. outSecond = 0 costs a single pass.
// What one claim's reading measurably costs, per model: both passes, the widened reading where it happened, the cache
// as it was used. The estimate above it assumes compact replies and no widening; the live card tests of 2026-10-24
// cost several times that, so a claim is never estimated below what it was measured to cost (operator, 2026-10-24:
// the buyer pays for the service; it is not subsidized). Re-measure when the reader changes.
export const MEASURED = {
  "claude-haiku-5-5": { usd_per_claim: 0.008, basis: "test orders 5 (8 claims, $0.0506, 0.63¢ each) and 6 (Mycelium, 62 claims read fresh in its last invocation, $0.497, 0.80¢ each), 2026-10-24" },
  "claude-sonnet-5-5": { usd_per_claim: 0.145, basis: "test order 7 (Sophistical Refutations, 8 claims, $1.160), 2026-10-24, before 0.14.3 let the second pass read the first's cache" },
};

export function estimateClaim(model, promptTokens, outFirst = 1200, outSecond = 300) {
  const a = callCost(model, { cache_creation_input_tokens: promptTokens, output_tokens: outFirst });
  const b = outSecond ? callCost(model, { cache_read_input_tokens: promptTokens, input_tokens: 200, output_tokens: outSecond }) : 0;
  const m = MEASURED[model]?.usd_per_claim || 0;
  return Math.max(a + b, outSecond ? m : m / 2); // a one-pass reading, half the measured two-pass cost
}

// Price policy. A sentence is priced in cents, where agents pay (operator, 2026-10-23: "opening sentences cannot cost
// dollars"): its list price, raised only when a sentence's sources are long enough that the estimate times the
// sentence margin passes it. Listed per-call prices on the x402 markets run at a median of about $0.005-0.01, and a
// fact-check listed at $0.10 had no paying buyers in its first month (observed 2026-10-23). The archive is consulted
// only on commission, priced from its traversal at the commission margin.
export const POLICY = {
  margin: 2.0, // commissions: S7, the construction, the package (3.0 until 2026-10-24: "we might need to bring it down to 2x for the commissioned article")
  sentence_margin: 1.5,
  floor_per_claim: { check: 0.01, ledger: 0.05, opening: 0.05, commission: 0.05, portable: 0.05 }, // the list price of a sentence
  ledgered_per_claim: { check: 0.005, ledger: 0.01, opening: 0.01, commission: 0.01, portable: 0.01 }, // a reading already in the ledger
  floor_s7: 1.0, // the archive's consultation and the /non row, fresh: the two stages' floors together
  floor_s7_reading: 0.75, // the reading: traversal, admission, extraction, the ontology read twice (2026-10-25)
  floor_s7_construction: 0.25, // the construction: the knowledge object, compression, delta, audit
  s7_budget_ratio: 1.5, // model spending on S7 stops at price / ratio
  ledgered_s7: 0.10, // a /non row already composed for the same input
  grounded_sentence: 0.02, // a sentence served the archive's claims on it from a commissioned row, added to its own price
  portable_package: 0.25, // the knowledge object packaged, charged when the audit marks no unit
  ledgered_package: 0.05,
};
// The archive line in two stages, each priced and charged as its own deliverable (2026-10-25). A reading already in
// the checkpoint is charged at the ledgered rate; each stage's model spending stops at its price over the budget ratio,
// and the construction's share is held while the reading runs.
export const S7_STAGES = { reading: ["admission", "hop", "extraction", "triage", "ontology"], construction: ["composition", "delta", "audit"] };
export function s7Stages(estimate, { readingLedgered = false } = {}) {
  const st = estimate?.stages || {};
  const line = (names, floor, ledgered) => {
    const est = ledgered ? 0 : names.reduce((n, k) => n + (st[k] || 0), 0);
    const price = ledgered ? POLICY.ledgered_s7 : Math.ceil(Math.max(floor, est * POLICY.margin) * 100) / 100;
    return { est_cost_usd: Math.round(est * 1e4) / 1e4, price_usd: price, budget_usd: Math.round((price / POLICY.s7_budget_ratio) * 100) / 100, ...(ledgered ? { from_checkpoint: true } : {}) };
  };
  return { reading: line(S7_STAGES.reading, POLICY.floor_s7_reading, readingLedgered), construction: line(S7_STAGES.construction, POLICY.floor_s7_construction, false) };
}
// What a stage is charged: its measured cost times the margin, at its floor, never above its quoted price; nothing for
// a stage that did not deliver.
export function stageCharge(stage, quoted) {
  if (!stage?.delivered || !quoted) return 0;
  if (quoted.from_checkpoint || stage.from_checkpoint) return Math.min(quoted.price_usd, POLICY.ledgered_s7);
  const floor = stage.name === "construction" ? POLICY.floor_s7_construction : POLICY.floor_s7_reading;
  return Math.min(quoted.price_usd, Math.ceil(Math.max(floor, (stage.cost_usd || 0) * POLICY.margin) * 100) / 100);
}
export function priceClaim(tier, estCost, ledgered) {
  if (ledgered) return POLICY.ledgered_per_claim[tier];
  return Math.ceil(Math.max(POLICY.floor_per_claim[tier], estCost * POLICY.sentence_margin) * 100) / 100;
}
