// SPXI-gnΩsis HTTP service. Free quote; paid opening behind x402 (test network); results by id.
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { quote, quoteEntity, runOpening, SERVICE } from "./run.js";
import { publicationState } from "./s7/publish.js";
import { load, save } from "./util.js";

const NETWORK = process.env.GNOSIS_NETWORK || "eip155:84532"; // Base Sepolia
const FACILITATOR = process.env.GNOSIS_FACILITATOR || "https://x402.org/facilitator";
const PAY_TO = process.env.GNOSIS_PAY_TO; // the receiving address; required
if (!PAY_TO) { console.error("GNOSIS_PAY_TO (receiving address) is required"); process.exit(1); }

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/", (_req, res) => res.json({
  service: SERVICE, network: NETWORK,
  operations: {
    "POST /v1/quote": "free. body {oldid, tier?: check|ledger|opening|portable, claims?: [ids]} or, for an entity the encyclopedia does not hold, {entity: {name, aliases?, type?, works_by?: [name], capture?: obs_id|slug, sources?: [url]}, tier?: opening|portable}; a composition supplied by the caller is refused: the article Wikipedia's content policies would compose from the sources is constructed (notability not applied) and opened. Pins the revision, resolves its sources and, at the opening and portable tiers, runs the archive traversal; returns scope, cost-based prices, the execution contract and the maximum price.",
    "GET /v1/results/{result_id}/portable/{file}": "portable tier: the entity's knowledge object from its /non row (article.md, article.html, article.jsonld, article.json, manifest.json, LICENSE.txt; CC BY 4.0, with the Wikipedia article's quoted sentences CC BY-SA 4.0)",
    "POST /v1/openings/{quote_id}": "paid (x402). Runs the opening for a quote; returns the composition result and the result id. A quote already paid returns its result without a second charge.",
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
    const { oldid, entity, tier = "opening", claims } = req.body || {};
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

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR })).register(NETWORK, new ExactEvmScheme());
app.use(paymentMiddleware({
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

app.post("/v1/openings/:quote_id", async (req, res) => {
  const q = load(`quotes/${req.params.quote_id}.json`);
  if (!q) return res.status(404).json({ error: "unknown quote" });
  if (Date.parse(q.expires) < Date.now()) return res.status(410).json({ error: "quote expired" });
  try {
    const r = await runOpening(q.quote_id, { onProgress: (p) => save(`progress/${q.quote_id}.json`, { ...p, at: new Date().toISOString() }) });
    // A status of 400 or above cancels settlement in the middleware: no claim completed, no charge.
    if (r.composition.summary.completed === 0) return res.status(502).json({ error: "no claim could be completed; no charge", result_id: r.result_id });
    const out = { result_id: r.result_id, reused: r.reused, summary: r.composition.summary, billing: r.record?.billing, composition: r.composition, portable: r.portable_dir ? `/v1/results/${r.result_id}/portable/manifest.json` : undefined };
    const owed = r.record?.billing ? Math.round((q.max_price_usd - r.record.billing.charge_usd) * 1e6) / 1e6 : 0;
    if (owed > 0) out.refund_owed_usd = owed;
    save(`delivered/${q.quote_id}.json`, out);
    // The receipt is written once the middleware has settled and set its response header.
    res.on("finish", () => {
      const h = res.getHeader("PAYMENT-RESPONSE") || res.getHeader("X-PAYMENT-RESPONSE");
      let settlement = null;
      try { settlement = h ? decodePaymentResponseHeader(String(h)) : null; } catch (e) { settlement = { success: false, error: String(e.message || e) }; }
      save(`receipts/${q.quote_id}.json`, { quote_id: q.quote_id, result_id: r.result_id, at: new Date().toISOString(), network: NETWORK, pay_to: PAY_TO,
        reserved_usd: q.max_price_usd, charge_usd: r.record?.billing?.charge_usd ?? null, settlement });
      if (settlement?.success && owed > 0) save(`refunds/${q.quote_id}.json`, { quote_id: q.quote_id, to: settlement.payer, amount_usd: owed, network: NETWORK,
        settlement_tx: settlement.transaction, status: "queued", queued_at: new Date().toISOString() });
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
app.listen(port, () => console.log(`SPXI-gnΩsis ${SERVICE.version} on :${port} · ${NETWORK} · pay to ${PAY_TO}`));
