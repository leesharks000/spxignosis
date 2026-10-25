// Payments through Stripe (ruled 2026-10-21: Stripe), for both kinds of caller.
//
// Agents pay per call over x402. The quote's maximum is challenged in USDC on Base; the receiving address is a Stripe
// crypto deposit address (STRIPE_DEPOSIT_ADDRESS), so settled payments land in the Stripe balance and settle in dollars.
// After the facilitator settles, the on-chain transaction is recorded in Stripe as a PaymentIntent (transaction
// verification), which is what refunds are issued against. Mainnet settles through Coinbase's facilitator (CDP keys);
// without them the public test facilitator and Base Sepolia are used.
//
// People pay by card through Stripe Checkout: the quote's maximum is authorized and captured, the job runs when Stripe
// reports the session complete (signed webhook), and whatever the work did not use is refunded through Stripe.
//
// With no Stripe key set, the service runs as before on the test network, to the address in GNOSIS_PAY_TO, and card
// checkout answers that it is not configured.
import Stripe from "stripe";

const KEY = process.env.STRIPE_SECRET_KEY || null;
export const stripe = KEY ? new Stripe(KEY, { apiVersion: "2026-05-27.preview" }) : null;
// A live key is a secret key (sk_live_) or a restricted key (rk_live_); the operator's is restricted (2026-10-25: the index
// reported a live account as the sandbox).
export const LIVE = !!KEY && /^(sk|rk)_live_/.test(KEY);
export const CARD_MINIMUM_USD = 0.5; // Stripe's minimum for a card charge

export function x402Config() {
  const mainnet = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET) && process.env.GNOSIS_NETWORK !== "eip155:84532";
  return {
    network: process.env.GNOSIS_NETWORK || (mainnet ? "eip155:8453" : "eip155:84532"),
    payTo: (process.env.STRIPE_DEPOSIT_ADDRESS || process.env.GNOSIS_PAY_TO || "").toLowerCase() || null,
    payToKind: process.env.STRIPE_DEPOSIT_ADDRESS ? "stripe deposit address" : process.env.GNOSIS_PAY_TO ? "wallet (GNOSIS_PAY_TO)" : null,
    mainnet,
  };
}

// The receiving address for agent payments (2026-10-25). Set in the environment (STRIPE_DEPOSIT_ADDRESS), or else,
// once the service has Coinbase facilitator keys (mainnet) and Stripe has approved the account's Stablecoins and
// Crypto payment method, created once through Stripe's API with the service's own key and kept in the store, so the
// operator runs no command. A refusal (crypto not yet approved, or a key without that permission) is recorded and the
// x402 routes keep answering 503; the next start tries again.
export async function depositAddress() {
  const cfg = x402Config();
  if (cfg.payTo) return { address: cfg.payTo, kind: cfg.payToKind };
  if (!stripe || !cfg.mainnet) return { address: null, kind: null };
  const { load, save } = await import("./util.js");
  const kept = await load("payments/deposit-address-base.json").catch(() => null);
  if (kept?.address) return { address: kept.address.toLowerCase(), kind: "stripe deposit address (created by the service)" };
  try {
    const r = await stripe.rawRequest("POST", "/v1/crypto/deposit_addresses", { network: "base" }, { apiVersion: "2026-05-27.preview" });
    const address = r.address || r.deposit_address || (r.addresses && r.addresses[0]?.address) || null;
    if (!address) throw new Error(`Stripe answered without an address (fields: ${Object.keys(r).join(", ")})`);
    await save("payments/deposit-address-base.json", { address, network: "base", id: r.id || null, created: new Date().toISOString() });
    return { address: address.toLowerCase(), kind: "stripe deposit address (created by the service)" };
  } catch (e) {
    await save("payments/deposit-address-error.json", { at: new Date().toISOString(), error: String(e.message || e).slice(0, 400) }).catch(() => {});
    return { address: null, kind: null, error: String(e.message || e).slice(0, 200) };
  }
}

export async function facilitatorConfig() {
  const { mainnet } = x402Config();
  if (mainnet) {
    const { createFacilitatorConfig } = await import("@coinbase/x402");
    return createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET);
  }
  return { url: process.env.GNOSIS_FACILITATOR || "https://x402.org/facilitator" };
}

// Records a settled x402 payment as a Stripe PaymentIntent. requirements.amount is in atomic USDC (6 decimals).
export async function recordSettlement({ result, requirements }) {
  if (!stripe || !result?.success || !result.transaction) return null;
  const cents = Math.round(Number(requirements.amount) / 10000);
  if (cents < 1) return null;
  const network = String(requirements.network) === "eip155:8453" ? "base" : "base_sepolia";
  const pi = await stripe.paymentIntents.create({
    amount: cents, currency: "usd", confirm: true,
    payment_method_data: { type: "crypto" }, allowed_payment_method_types: ["crypto"],
    payment_method_options: { crypto: { mode: "transaction_verification", transaction_verification_options: { network, transaction_hash: result.transaction } } },
    metadata: { service: "SPXI-gnosis", channel: "x402" },
  }, { idempotencyKey: result.transaction });
  return { payment_intent: pi.id, amount_usd: cents / 100, network };
}

// Card checkout for a quote: the maximum price, at least Stripe's card minimum.
export async function checkoutFor(q, { base }) {
  if (!stripe) throw Object.assign(new Error("card checkout is not configured on this service (no Stripe key)"), { status: 503 });
  const amount = Math.max(CARD_MINIMUM_USD, q.max_price_usd);
  const s = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(amount * 100), product_data: {
      name: `SPXI-gnΩsis — ${q.commission || (q.kind === "entity" ? "construct" : "open")}: ${q.article?.title || q.entity?.name}`.slice(0, 250),
      description: `Quote ${q.quote_id}. Charged for the work done; what it does not use is refunded. The /non row it composes is public under CC BY 4.0.`.slice(0, 500) } } }],
    payment_intent_data: { metadata: { quote_id: q.quote_id, service: "SPXI-gnosis", channel: "card" } },
    metadata: { quote_id: q.quote_id },
    success_url: `${base}/v1/quotes/${q.quote_id}/status?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/v1/quotes/${q.quote_id}/status`,
    // Stripe keeps a Checkout Session open 30 minutes to 24 hours; a quote holds 15 minutes. The session opens for
    // 31 minutes and the quote's price holds for a payment made in it (2026-10-24: Stripe refused the quote's own expiry).
    expires_at: Math.floor((Date.now() + 31 * 60e3) / 1000),
  });
  return { checkout_url: s.url, session: s.id, amount_usd: amount };
}

export function verifyWebhook(raw, signature) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) throw Object.assign(new Error("webhook not configured"), { status: 503 });
  return stripe.webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

// Refunds what the work did not use, against the payment Stripe holds (card or recorded x402 payment).
export async function refundUnused(paymentIntent, amountUsd, reason) {
  if (!stripe || !paymentIntent || !(amountUsd > 0)) return null;
  const cents = Math.floor(amountUsd * 100);
  if (cents < 1) return null;
  const r = await stripe.refunds.create({ payment_intent: paymentIntent, amount: cents, metadata: { reason: String(reason || "unused").slice(0, 400) } }, { idempotencyKey: `refund-${paymentIntent}-${cents}` });
  return { refund: r.id, status: r.status, amount_usd: cents / 100 };
}
