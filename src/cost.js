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
export function estimateClaim(model, promptTokens, outFirst = 1200, outSecond = 300) {
  const a = callCost(model, { cache_creation_input_tokens: promptTokens, output_tokens: outFirst });
  const b = outSecond ? callCost(model, { cache_read_input_tokens: promptTokens, input_tokens: 200, output_tokens: outSecond }) : 0;
  return a + b;
}

// Price policy. A sentence is priced in cents, where agents pay (operator, 2026-10-23: "opening sentences cannot cost
// dollars"): its list price, raised only when a sentence's sources are long enough that the estimate times the
// sentence margin passes it. Listed per-call prices on the x402 markets run at a median of about $0.005-0.01, and a
// fact-check listed at $0.10 had no paying buyers in its first month (observed 2026-10-23). The archive is consulted
// only on commission, priced from its traversal at the commission margin.
export const POLICY = {
  margin: 3.0, // commissions: S7, the construction, the package
  sentence_margin: 1.5,
  floor_per_claim: { check: 0.01, ledger: 0.05, opening: 0.05, commission: 0.05, portable: 0.05 }, // the list price of a sentence
  ledgered_per_claim: { check: 0.005, ledger: 0.01, opening: 0.01, commission: 0.01, portable: 0.01 }, // a reading already in the ledger
  floor_s7: 1.0, // the archive's consultation and the /non row, fresh
  s7_budget_ratio: 1.5, // model spending on S7 stops at price / ratio
  ledgered_s7: 0.10, // a /non row already composed for the same input
  portable_package: 0.25, // the knowledge object packaged, charged when the audit marks no unit
  ledgered_package: 0.05,
};
export function priceClaim(tier, estCost, ledgered) {
  if (ledgered) return POLICY.ledgered_per_claim[tier];
  return Math.ceil(Math.max(POLICY.floor_per_claim[tier], estCost * POLICY.sentence_margin) * 100) / 100;
}
