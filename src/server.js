// SPXI-gnΩsis HTTP service. Free quote; the paid work behind x402 (agents) or Stripe Checkout (people); results by id.
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { quote, quoteEntity, runOpening, SERVICE } from "./run.js";
import { publicationState } from "./s7/publish.js";
import { load, save } from "./util.js";
import { prepareSentence, readSentence, requestId } from "./sentence.js";
import { stripe, LIVE, x402Config, facilitatorConfig, recordSettlement, checkoutFor, verifyWebhook, refundUnused, CARD_MINIMUM_USD } from "./payments.js";

const { network: NETWORK, payTo: PAY_TO, payToKind, mainnet } = x402Config();
if (!PAY_TO) { console.error("a receiving address is required: STRIPE_DEPOSIT_ADDRESS (Stripe) or GNOSIS_PAY_TO (a wallet)"); process.exit(1); }
const BASE = process.env.GNOSIS_BASE_URL || `http://localhost:${process.env.PORT || 4402}`;

const app = express();
// Stripe's signed webhook needs the raw body, so it is mounted before the JSON parser.
app.post("/v1/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  let ev;
  try { ev = verifyWebhook(req.body, req.headers["stripe-signature"]); } catch (e) { return res.status(e.status || 400).json({ error: String(e.message || e) }); }
  if (ev.type !== "checkout.session.completed") return res.json({ received: true, ignored: ev.type });
  const s = ev.data.object, id = s.metadata?.quote_id;
  const q = id && load(`quotes/${id}.json`);
  if (!q || s.payment_status !== "paid") return res.json({ received: true, note: "no paid quote in this session" });
  if (load(`receipts/${id}.json`)) return res.json({ received: true, note: "already delivered" });
  res.json({ received: true, running: id }); // Stripe gets its answer at once; the work runs after.
  const paid = s.amount_total / 100;
  save(`receipts/${id}.json`, { quote_id: id, at: new Date().toISOString(), channel: "card", stripe_session: s.id, stripe_payment_intent: s.payment_intent, paid_usd: paid,
    settlement: { success: true, payer: s.customer_details?.email ? "card (email on the Stripe record)" : "card" } });
  try {
    const out = await deliver(q);
    const owed = Math.round((paid - (out.billing?.charge_usd ?? 0)) * 100) / 100;
    const refund = await refundUnused(s.payment_intent, owed, `unused by quote ${id}`).catch((e) => ({ error: String(e.message || e) }));
    save(`refunds/${id}.json`, { quote_id: id, channel: "card", amount_usd: owed, refund, at: new Date().toISOString() });
  } catch (e) {
    // Nothing delivered: the whole payment goes back.
    const refund = await refundUnused(s.payment_intent, paid, `quote ${id} could not complete: ${String(e.message || e).slice(0, 200)}`).catch((x) => ({ error: String(x.message || x) }));
    save(`refunds/${id}.json`, { quote_id: id, channel: "card", amount_usd: paid, refund, reason: String(e.message || e), at: new Date().toISOString() });
  }
});
app.use(express.json({ limit: "64kb" }));

// The work for a paid quote, by either channel. Throws when nothing could be delivered.
async function deliver(q) {
  const r = await runOpening(q.quote_id, { onProgress: (p) => save(`progress/${q.quote_id}.json`, { ...p, at: new Date().toISOString() }) });
  // Completion follows the commissioned operation: a composed row is delivered work even where T needed no S3 check.
  if (r.composition.summary.completed === 0 && !r.non?.composed) throw Object.assign(new Error("no claim could be completed and no row was composed"), { result_id: r.result_id });
  const out = { result_id: r.result_id, reused: r.reused, summary: r.composition.summary, billing: r.record?.billing, composition: r.composition, portable: r.portable_dir ? `/v1/results/${r.result_id}/portable/manifest.json` : null };
  save(`delivered/${q.quote_id}.json`, out);
  return out;
}

app.get("/", (_req, res) => res.json({
  service: SERVICE, network: NETWORK,
  operations: {
    "POST /v1/quote": "free. body {oldid, tier?: check|ledger|opening|portable, claims?: [ids]} or, for an entity the encyclopedia does not hold, {commission?: open|construct, object: {kind?: entity|operator, name, aliases? (entity), strings? (operator: the phrases in which it is performed and in which entities speak it), description?, works_by?, capture?: obs_id|slug, transcript?: {text, surface, date, cite_list} (open: admitted through discernment), sources?: [url], compare?: encyclopedia (construct)}, tier?: opening|portable}; the legacy {entity: {...}} form is accepted. A revision is opened; an object is opened where a composition is found or supplied, and constructed otherwise. Pins the revision, resolves its sources and, at the opening and portable tiers, runs the archive traversal; returns scope, cost-based prices, the execution contract and the maximum price.",
    "GET /v1/results/{result_id}/portable/{file}": "portable tier: the entity's knowledge object from its /non row (article.md, article.html, article.jsonld, article.json, manifest.json, LICENSE.txt; CC BY 4.0, with the Wikipedia article's quoted sentences CC BY-SA 4.0)",
    "POST /v1/openings/{quote_id}": "paid (x402, USDC on Base, settling to the service's Stripe balance). Runs the work for a quote; returns the composition result and the result id. A quote already paid returns its result without a second charge; what the work did not use is refunded.",
    "GET /v1/sentence?text=&url=&mode=": "the sentence as you have it and the Wikipedia page it came from: free where it has been read (as recorded); otherwise 402 with the price, then the opening (two readings) or, with mode=preliminary, one quick pass",
    "POST /v1/openings/{quote_id}/checkout": "for people: a Stripe Checkout link for the quote's maximum (at least $0.50); the work runs when the payment completes, and what it did not use is refunded",
    "GET /v1/quotes/{quote_id}/status": "where a quote stands: quoted, paid and running, delivered; its receipt and any refund",
    "GET /v1/results/{result_id}/publication": "the /non row's publication, observed now: composed, checked, landed, public",
    "GET /v1/openings/{quote_id}/progress": "the stage a running opening has reached",
    "GET /v1/receipts/{quote_id}": "the settlement receipt (transaction, payer, amount) and any refund owed or sent",
    "GET /v1/results/{result_id}/composition": "the usable result",
    "GET /v1/results/{result_id}/evidence": "the full evidence record: tuples, spans, hashes, validations, breaches, cost",
    "GET /v1/results/{result_id}/opened.html": "the opened article",
    "GET /v1/results/{result_id}/annotations": "W3C Web Annotations on the pinned revision",
  },
  publication: "Every opening composes the entity's row in the Negative of the Negative (alexanarch.org/non), the opened Wikipedia, and the row is public (CC BY 4.0): a paid opening contributes to the public counter-infrastructure it draws on.",
  notice: "The treatment of an article's entities by composing systems may be recorded and measured.",
}));

app.post("/v1/quote", async (req, res) => {
  try {
    const { oldid, entity, object, commission, tier = "opening", claims } = req.body || {};
    // A commission names what is done (open, construct) and the object it is done to (an entity, or an operator).
    if (object) return res.json(await quoteEntity({ ...object, ...(commission ? { commission } : {}) }, { tier }));
    // An entity the encyclopedia does not hold is opened from its name and strings, with T from the Capture Registry or
    // constructed from sources the service fetches; a composition the caller supplies is refused.
    if (entity) return res.json(await quoteEntity(entity, { tier }));
    if (!/^\d+$/.test(String(oldid))) return res.status(400).json({ error: "oldid (a Wikipedia revision id) or entity {name, aliases?, type?, works_by?, capture?, sources?: [url]} is required" });
    res.json(await quote(Number(oldid), { tier, claims }));
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

// Payment records are kept apart from evidence. store/receipts/<quote_id>.json holds the settlement the facilitator
// returned (transaction, payer, network, amount) and is written only after settlement succeeds; the result exists
// before that and is released only against a receipt. store/refunds/<quote_id>.json queues what is owed back.
const receiptOf = (id) => load(`receipts/${id}.json`);

// Recovery runs before the payment middleware: a quote that has a receipt returns its result without a second charge.
// The quote id is the bearer of the purchase, as it was of the quote.
app.post("/v1/openings/:quote_id", (req, res, next) => {
  // A quote that does not exist or has expired is refused here, before the payment layer can issue a challenge.
  const q = load(`quotes/${req.params.quote_id}.json`);
  if (!q) return res.status(404).json({ error: "unknown quote; no payment was requested" });
  const rc = receiptOf(req.params.quote_id);
  if (!rc?.settlement?.success) {
    if (Date.parse(q.expires) < Date.now()) return res.status(410).json({ error: "quote expired; no payment was requested" });
    return next();
  }
  const out = load(`delivered/${req.params.quote_id}.json`);
  if (!out) return res.status(500).json({ error: "paid quote has a receipt but no stored result; it is queued for review", receipt: rc });
  res.json({ ...out, recovered: true, receipt: rc });
});
app.get("/v1/openings/:quote_id/progress", (req, res) => {
  const p = load(`progress/${req.params.quote_id}.json`);
  if (!p) return res.status(404).json({ error: "no progress recorded for this quote" });
  res.json(p);
});
app.get("/v1/receipts/:quote_id", (req, res) => {
  const rc = receiptOf(req.params.quote_id);
  if (!rc) return res.status(404).json({ error: "no receipt for this quote" });
  res.json({ ...rc, refund: load(`refunds/${req.params.quote_id}.json`) || null });
});

// The sentence request, at the point of contact: free where the reading exists; otherwise the payment layer quotes it.
app.get("/v1/sentence", async (req, res, next) => {
  try {
    const { text, url, mode = "opening" } = req.query;
    const p = await prepareSentence({ text, url, mode });
    if (p.state === "not found" || p.state === "uncited") return res.status(p.status).json(p);
    if (p.state === "recorded") return res.json({ ...(await readSentence(p.request_id)), price_usd: 0, free: "this reading exists; it is served as recorded. Re-reading against changed sources is new work." });
    req.sentence = p; next(); // quoted: the payment layer answers 402 with this price
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient(await facilitatorConfig())).register(NETWORK, new ExactEvmScheme());
// A settled x402 payment is recorded in Stripe as a PaymentIntent, keyed by its transaction, before the route's receipt.
resourceServer.onAfterSettle(async (ctx) => {
  try { const rec = await recordSettlement(ctx); if (rec) save(`settlements/${ctx.result.transaction}.json`, rec); }
  catch (e) { save(`settlements/${ctx.result?.transaction || "unknown"}.json`, { error: String(e.message || e) }); }
});

// People pay by card: a Checkout session for the quote's maximum; the work runs when Stripe reports the payment.
app.post("/v1/openings/:quote_id/checkout", async (req, res) => {
  const q = load(`quotes/${req.params.quote_id}.json`);
  if (!q) return res.status(404).json({ error: "unknown quote" });
  if (Date.parse(q.expires) < Date.now()) return res.status(410).json({ error: "quote expired" });
  if (load(`receipts/${q.quote_id}.json`)) return res.status(409).json({ error: "this quote is already paid", status: `/v1/quotes/${q.quote_id}/status` });
  try { res.json({ ...(await checkoutFor(q, { base: BASE })), status: `/v1/quotes/${q.quote_id}/status`, note: q.max_price_usd < CARD_MINIMUM_USD ? `card payments start at $${CARD_MINIMUM_USD.toFixed(2)}; what the work does not use is refunded` : undefined }); }
  catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});
// Where a quote stands, for either channel: quoted, paid, running, delivered, refunded.
app.get("/v1/quotes/:quote_id/status", (req, res) => {
  const id = req.params.quote_id, q = load(`quotes/${id}.json`);
  if (!q) return res.status(404).json({ error: "unknown quote" });
  const rc = load(`receipts/${id}.json`), out = load(`delivered/${id}.json`), pr = load(`progress/${id}.json`), rf = load(`refunds/${id}.json`);
  res.json({ quote_id: id, max_price_usd: q.max_price_usd, state: out ? "delivered" : rc ? "paid, running" : "quoted",
    progress: pr || null, result: out ? { result_id: out.result_id, composition: `/v1/results/${out.result_id}/composition`, evidence: `/v1/results/${out.result_id}/evidence` } : null,
    receipt: rc ? { channel: rc.channel, at: rc.at, paid_usd: rc.paid_usd ?? rc.reserved_usd } : null, refund: rf || null });
});
app.use(paymentMiddleware({
  "GET /v1/sentence": {
    accepts: [{
      scheme: "exact", network: NETWORK, payTo: PAY_TO, maxTimeoutSeconds: 300,
      price: (ctx) => {
        const q = ctx.adapter.getQueryParams();
        const p = load(`sentences/pending/${requestId({ text: q.text, url: q.url, mode: q.mode || "opening" })}.json`);
        if (!p) throw new Error("unknown sentence request"); // unreachable: the route above prepares it first
        return `$${Math.max(0.01, p.price_usd).toFixed(2)}`;
      },
    }],
    description: "Use when about to cite or quote a sentence from a Wikipedia page: send the sentence and the page; returns whether its cited source supports it, what the source says (quoted), and what the sentence adds or drops. Two readings by default; mode=preliminary for one quick pass.",
    mimeType: "application/json",
  },
  "POST /v1/openings/:quote_id": {
    accepts: [{
      scheme: "exact", network: NETWORK, payTo: PAY_TO, maxTimeoutSeconds: 300,
      price: (ctx) => {
        const id = (ctx.adapter?.getPath?.() || ctx.path || "").split("/").pop();
        const q = load(`quotes/${id}.json`);
        if (!q) throw new Error("unknown quote"); // unreachable: the route above refuses an unknown quote first
        return `$${q.max_price_usd.toFixed(2)}`;
      },
    }],
    description: "SPXI-gnΩsis: opens a pinned Wikipedia revision. Each sentence kept verbatim and checked against what its cited source says; the entity composed with the Crimson Hexagonal Archive admitted by the archive's own procedure, as a public /non row.",
    mimeType: "application/json",
  },
}, resourceServer));

app.get("/v1/sentence", async (req, res) => {
  try {
    const out = await readSentence(req.sentence.request_id);
    // Nothing read: a status of 400 or above cancels settlement, so nothing is charged.
    if (!out.result || ["unread", "withheld"].includes(out.result.status)) return res.status(502).json({ ...out, charged: false });
    res.json({ ...out, price_usd: req.sentence.price_usd });
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e), charged: false }); }
});

app.post("/v1/openings/:quote_id", async (req, res) => {
  const q = load(`quotes/${req.params.quote_id}.json`);
  if (!q) return res.status(404).json({ error: "unknown quote" });
  if (Date.parse(q.expires) < Date.now()) return res.status(410).json({ error: "quote expired" });
  try {
    let out;
    // A status of 400 or above cancels settlement in the middleware: nothing delivered, no charge.
    try { out = await deliver(q); } catch (e) { return res.status(502).json({ error: String(e.message || e), result_id: e.result_id, charged: false }); }
    const owed = out.billing ? Math.round((q.max_price_usd - out.billing.charge_usd) * 1e6) / 1e6 : 0;
    if (owed > 0) out.refund_owed_usd = owed;
    // The receipt is written once the middleware has settled and set its response header; a settled payment is
    // recorded in Stripe, and what the work did not use is refunded against that record.
    res.on("finish", async () => {
      const h = res.getHeader("PAYMENT-RESPONSE") || res.getHeader("X-PAYMENT-RESPONSE");
      let settlement = null;
      try { settlement = h ? decodePaymentResponseHeader(String(h)) : null; } catch (e) { settlement = { success: false, error: String(e.message || e) }; }
      const recorded = load(`settlements/${settlement?.transaction}.json`);
      save(`receipts/${q.quote_id}.json`, { quote_id: q.quote_id, result_id: out.result_id, at: new Date().toISOString(), channel: "x402", network: NETWORK, pay_to: PAY_TO, pay_to_kind: payToKind,
        reserved_usd: q.max_price_usd, charge_usd: out.billing?.charge_usd ?? null, settlement, stripe_payment_intent: recorded?.payment_intent || null });
      if (settlement?.success && owed > 0) {
        const refund = recorded?.payment_intent ? await refundUnused(recorded.payment_intent, owed, `unused by quote ${q.quote_id}`).catch((e) => ({ error: String(e.message || e) })) : null;
        save(`refunds/${q.quote_id}.json`, { quote_id: q.quote_id, channel: "x402", to: settlement.payer, amount_usd: owed, network: NETWORK, settlement_tx: settlement.transaction,
          ...(refund ? { refund, status: refund.error ? "stripe refund failed; queued" : "refunded through Stripe" } : { status: "queued" }), queued_at: new Date().toISOString() });
      }
    });
    res.json(out);
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

const file = (name, type) => (req, res) => {
  const p = `results/${req.params.id}/${name}`;
  const body = load(p, false);
  if (!body) return res.status(404).json({ error: "unknown result" });
  res.type(type).send(body);
};
app.get("/v1/results/:id/publication", async (req, res) => {
  const s7 = load(`results/${req.params.id}/s7.json`);
  if (!s7) return res.status(404).json({ error: "no /non row for this result" });
  res.json(await publicationState(s7));
});
app.get("/v1/results/:id/composition", file("composition.json", "application/json"));
app.get("/v1/results/:id/evidence", file("evidence.json", "application/json"));
app.get("/v1/results/:id/opened.html", file("opened.html", "text/html"));
app.get("/v1/results/:id/annotations", file("annotations.jsonld", "application/ld+json"));
app.get("/v1/results/:id/portable/:name", (req, res) => {
  const ok = ["article.md", "article.html", "article.jsonld", "article.json", "manifest.json", "LICENSE.txt"];
  if (!ok.includes(req.params.name)) return res.status(404).json({ error: "unknown file" });
  const body = load(`results/${req.params.id}/portable/${req.params.name}`, false);
  if (!body) return res.status(404).json({ error: "no portable package for this result" });
  res.type(req.params.name.split(".").pop() === "md" ? "text/markdown" : req.params.name.split(".").pop()).send(body);
});

const port = Number(process.env.PORT || 4402);
app.listen(port, () => console.log(`SPXI-gnΩsis ${SERVICE.version} on :${port} · ${NETWORK}${mainnet ? " (mainnet, Coinbase facilitator)" : " (test network)"} · pay to ${PAY_TO} (${payToKind}) · cards ${stripe ? (LIVE ? "live" : "test") : "off"}`));
