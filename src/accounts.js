// The earnings record (2026-10-25): every paid order, what it was paid, what it was charged, what went back, what its
// model calls cost (failed runs included) and the payment processor's fee, so that the margin is measured across orders
// and the floors and multipliers can be set from it ("measure the first 20–30 completed orders"). Aggregates and
// per-order rows by result id and date only: no payer, no card, no quote id.
import { load, list } from "./util.js";
import { WORKER } from "./deliver.js";

// Stripe's domestic card fee, which it keeps on a refunded charge (stripe.com/pricing, read 2026-10-25). An estimate:
// international cards and currency conversion cost more, and the exact fee is on each charge's balance transaction.
export const CARD_FEE = { pct: 0.029, fixed: 0.30, basis: "Stripe domestic card pricing, 2.9% + $0.30, kept on refunded charges; an estimate per charge" };
const r2 = (x) => Math.round((x || 0) * 100) / 100, r4 = (x) => Math.round((x || 0) * 1e4) / 1e4;

async function costOf(result_id) {
  if (!result_id) return null;
  const ev = await load(`results/${result_id}/evidence.json`).catch(() => null);
  return ev?.cost?.actual_cost_usd ?? null;
}

export async function accounts() {
  const ids = (await list("receipts")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  const orders = [];
  for (const id of ids) {
    const [rc, out, rf, failed, q] = await Promise.all([load(`receipts/${id}.json`), load(`delivered/${id}.json`), load(`refunds/${id}.json`), load(`${WORKER.failed}/${id}.json`), load(`quotes/${id}.json`)]);
    if (!rc) continue;
    const live = rc.channel === "card" ? /^cs_live_/.test(rc.stripe_session || "") : rc.network === "eip155:8453";
    const paid = rc.paid_usd ?? rc.reserved_usd ?? 0;
    const refunded = rf && ["succeeded", "pending"].includes(rf.refund_state || (rf.refund?.refund ? "succeeded" : "")) ? rf.amount_usd || 0 : 0;
    const owed = rf && rf.refund_state === "failed" ? rf.amount_usd || 0 : 0;
    const result_id = out?.result_id || rf?.result_id || failed?.result_id || null;
    const cost = await costOf(result_id);
    const fee = rc.channel === "card" ? r2(paid * CARD_FEE.pct + CARD_FEE.fixed) : null;
    const state = out ? "delivered" : failed || rf ? "closed undelivered" : "running";
    orders.push({ at: rc.at, live, channel: rc.channel, tier: q?.tier || null, state, result_id, paid_usd: r2(paid), charged_usd: r2(out?.billing?.charge_usd ?? 0),
      refunded_usd: r2(refunded), refund_owed_usd: r2(owed), model_cost_usd: cost == null ? null : r4(cost), fee_usd_est: fee,
      kept_usd: r2(paid - refunded - owed), net_usd: cost == null ? null : r2(paid - refunded - owed - cost - (fee || 0)) });
  }
  orders.sort((a, b) => (a.at < b.at ? -1 : 1));
  const sum = (xs, k) => r2(xs.reduce((n, o) => n + (o[k] || 0), 0));
  const block = (xs) => ({ orders: xs.length, delivered: xs.filter((o) => o.state === "delivered").length, closed_undelivered: xs.filter((o) => o.state === "closed undelivered").length,
    running: xs.filter((o) => o.state === "running").length, paid_usd: sum(xs, "paid_usd"), refunded_usd: sum(xs, "refunded_usd"), refund_owed_usd: sum(xs, "refund_owed_usd"),
    kept_usd: sum(xs, "kept_usd"), model_cost_usd: sum(xs, "model_cost_usd"), fees_usd_est: sum(xs, "fee_usd_est"), net_usd: sum(xs, "net_usd"),
    cost_unknown: xs.filter((o) => o.model_cost_usd == null).length });
  return {
    what: "Every paid order of SPXI-gnΩsis: paid, charged, refunded, its model cost (failed runs included), the card fee, and what remains. Live and test orders apart.",
    fee_basis: CARD_FEE.basis,
    note: "Model cost is the measured cost the result records; an order with no result has no recorded cost. Net is before hosting, maintenance and the operator's labour.",
    live: block(orders.filter((o) => o.live)), test: block(orders.filter((o) => !o.live)),
    orders, computed: new Date().toISOString(),
  };
}
