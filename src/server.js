// SPXI-gnΩsis HTTP service. Free quote; the paid work behind x402 (agents) or Stripe Checkout (people); results by id.
import express from "express";
import { waitUntil } from "@vercel/functions";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import { quote, quoteEntity, runOpening, SERVICE, RUN_SECONDS, ADMITS } from "./run.js";
import { deliver, HAS_ARCHIVE, WORKER, needsArchive } from "./deliver.js";
import { randomUUID } from "node:crypto";
import { publicationState } from "./s7/publish.js";
import { accounts } from "./accounts.js";
import { lookupName } from "./lookup.js";
import { handleMcp, MCP_PROTOCOL } from "./mcp.js";
import { frontPage, orderPage, apiPage } from "./front.js";
import { load, save, list, claim, BLOB, sha256, UA } from "./util.js";
import { kept, undeliveredRefund } from "./cost.js";
import { prepareSentence, readSentence, requestId } from "./sentence.js";
import { stripe, LIVE, x402Config, depositAddress, facilitatorConfig, facilitatorName, recordSettlement, checkoutFor, verifyWebhook, refundUnused, CARD_MINIMUM_USD } from "./payments.js";

const { network: NETWORK, mainnet } = x402Config();
// The receiving address: from the environment, or created through Stripe once crypto is approved (payments.js).
const DEPOSIT = await depositAddress();
const PAY_TO = DEPOSIT.address, payToKind = DEPOSIT.kind;
// Without a receiving address the service still starts: the page and the free quote answer, and every paid route says
// that payments are not configured. Nothing is quoted for payment that could not be received.
if (!PAY_TO) console.error("no receiving address (STRIPE_DEPOSIT_ADDRESS or GNOSIS_PAY_TO): paid routes answer 503 until one is set");
const BASE = process.env.GNOSIS_BASE_URL || `http://localhost:${process.env.PORT || 4402}`;

const app = express();
app.set("trust proxy", true); // behind Vercel's proxy the request is https; the payment layer's resource URL had read http
// The logo and icons (public/). Vercel serves public/ itself; locally Express does.
app.use(express.static(new URL("../public", import.meta.url).pathname, { maxAge: "1d" }));
// Stripe's signed webhook needs the raw body, so it is mounted before the JSON parser.
app.post("/v1/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  let ev;
  try { ev = verifyWebhook(req.body, req.headers["stripe-signature"]); } catch (e) { return res.status(e.status || 400).json({ error: String(e.message || e) }); }
  if (ev.type !== "checkout.session.completed") return res.json({ received: true, ignored: ev.type });
  const s = ev.data.object, id = s.metadata?.quote_id;
  const q = id && await load(`quotes/${id}.json`);
  if (!q || s.payment_status !== "paid") return res.json({ received: true, note: "no paid quote in this session" });
  // Each Stripe session is taken up once (2026-10-25, the first adversarial test): the first delivery of its event
  // claims it, so a repeated or concurrent delivery starts nothing twice.
  const first = await claim(`payments/sessions/${s.id}.json`, { quote_id: id, at: new Date().toISOString(), payment_intent: s.payment_intent, amount_usd: s.amount_total / 100 });
  const prior = await load(`receipts/${id}.json`);
  // A second payment for a quote another session already paid is money with no work to buy: it is recorded and
  // refunded as an undelivered order is (undeliveredRefund), and the order it duplicates is untouched.
  // The refund is retried on every delivery of the event until it is sent (Stripe's refund is idempotent on the payment
  // and amount, so a retry cannot refund twice); while it is not sent the event is answered 500, so Stripe delivers it
  // again.
  if (prior?.stripe_session && prior.stripe_session !== s.id) {
    const was = await load(`payments/duplicates/${s.id}.json`);
    if (!["succeeded", "pending"].includes(was?.refund?.status)) {
      const owed = undeliveredRefund("card", s.amount_total / 100);
      const r = await refundUnused(s.payment_intent, owed, `a second payment for ${id}, which session ${prior.stripe_session} had paid`).catch((e) => ({ status: "failed", error: String(e.message || e).slice(0, 200) }));
      await save(`payments/duplicates/${s.id}.json`, { quote_id: id, session: s.id, payment_intent: s.payment_intent, paid_usd: s.amount_total / 100, owed_usd: owed, refund: r || { status: "none owed" },
        first_at: was?.first_at || new Date().toISOString(), attempts: (was?.attempts || 0) + 1, at: new Date().toISOString() });
      if (r && !["succeeded", "pending"].includes(r.status)) return res.status(500).json({ received: true, note: "a second payment for an order already paid: recorded; its refund failed and is retried when Stripe sends this event again", quote_id: id });
    }
    return res.json({ received: true, note: "a second payment for an order already paid: recorded and refunded", quote_id: id });
  }
  // A paid order is run once. A message for one already delivered or refunded is acknowledged; one still running (its
  // progress written in the last five minutes) is left to run; a paid order whose run stopped is resumed, so a message
  // re-sent from Stripe recovers it (2026-10-24: the first card test stopped after its sentences, nothing delivered),
  // through the same exclusive claim as POST /v1/quotes/{id}/resume.
  if (await load(`delivered/${id}.json`)) return res.json({ received: true, note: "already delivered" });
  if (await load(`refunds/${id}.json`)) return res.json({ received: true, note: "already refunded" });
  const pr = await load(`progress/${id}.json`);
  if (prior && pr && Date.now() - Date.parse(pr.at) < 5 * 60e3) return res.json({ received: true, note: "running" });
  if (!first && !prior) return res.json({ received: true, note: "this session's order is being started" });
  if (prior && !(await resumeClaim(id, pr))) return res.json({ received: true, note: "already resumed" });
  res.json({ received: true, running: id, resumed: !!prior }); // Stripe gets its answer at once; the work runs after.
  // The work after the answer is registered with the platform (waitUntil), which otherwise may stop it once the
  // response is sent; outside Vercel it simply runs.
  waitUntil(cardWork(q, s, id, prior));
});

async function cardWork(q, s, id, prior) {
  const paid = s.amount_total / 100;
  if (!prior) await save(`receipts/${id}.json`, { quote_id: id, at: new Date().toISOString(), channel: "card", stripe_session: s.id, stripe_payment_intent: s.payment_intent, paid_usd: paid,
    settlement: { success: true, payer: s.customer_details?.email ? "card (email on the Stripe record)" : "card" } });
  await runCard(q, id, { paid, payment_intent: s.payment_intent });
}

// The worker is started the moment there is work for it (2026-10-25: GitHub's schedule starts late or skips): a
// quote request or a paid order that consults the archive dispatches the workflow through GitHub's API, with a token
// that can only run this repository's workflows (GITHUB_DISPATCH_TOKEN). The ten-minute schedule stays as the backstop;
// a dispatch while a run is going is held by the workflow's concurrency group. The last attempt is recorded.
const DISPATCH = { repo: "leesharks000/spxignosis", workflow: "archive-worker.yml", token: process.env.GITHUB_DISPATCH_TOKEN || null };
async function startWorker(why) {
  if (!DISPATCH.token) return;
  const r = await fetch(`https://api.github.com/repos/${DISPATCH.repo}/actions/workflows/${DISPATCH.workflow}/dispatches`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${DISPATCH.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "SPXI-gnosis" },
    body: JSON.stringify({ ref: "main" }),
  }).then(async (x) => ({ status: x.status, body: x.status === 204 ? "" : (await x.text()).slice(0, 200) })).catch((e) => ({ status: 0, body: String(e.message || e) }));
  await save("worker/dispatch.json", { why, at: new Date().toISOString(), status: r.status, ok: r.status === 204, detail: r.body || undefined }).catch(() => {});
}

// The archive's landing workflow is started the moment a paid row is delivered (2026-10-25: its schedule never fired;
// a manual run landed the first operator in 2 minutes 41 seconds). The same token starts it, where it may run the
// archive's workflows; a refusal (the token cannot reach that repository) is recorded, and the row waits for the next
// run, started by hand or by the schedule.
const LANDING = { repo: process.env.GNOSIS_LANDING_REPO || "leesharks000/alexanarch", workflow: "land-non-rows.yml", token: process.env.GNOSIS_LANDING_TOKEN || DISPATCH.token };
async function startLanding(why) {
  if (!LANDING.token) return;
  const r = await fetch(`https://api.github.com/repos/${LANDING.repo}/actions/workflows/${LANDING.workflow}/dispatches`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${LANDING.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "SPXI-gnosis" },
    body: JSON.stringify({ ref: "main" }),
  }).then(async (x) => ({ status: x.status, body: x.status === 204 ? "" : (await x.text()).slice(0, 200) })).catch((e) => ({ status: 0, body: String(e.message || e) }));
  await save("worker/landing-dispatch.json", { why, at: new Date().toISOString(), status: r.status, ok: r.status === 204, detail: r.body || undefined }).catch(() => {});
}

// One invocation of a paid card order. The platform stops an invocation at about five minutes; a run that reaches its
// time budget (RUN_SECONDS) hands itself on to a fresh invocation through /v1/quotes/{id}/continue, where the claims
// already read come from the ledger, until the order is delivered (2026-10-24: "this needs to be able to run long
// enough to write a full article"). A run handed on more than MAX_HOPS times is refunded in full.
const MAX_HOPS = Number(process.env.GNOSIS_MAX_HOPS || 60);
async function runCard(q, id, { paid, payment_intent, hop = 0, channel = "card" }) {
  // An order that consults the archive is run by the archive worker; this service settles it when the worker reports
  // (POST /v1/quotes/{id}/settle, with the token written here).
  if (needsArchive(q) && !HAS_ARCHIVE) {
    if (!(await load(`${WORKER.runs}/${id}.json`))) await save(`${WORKER.runs}/${id}.json`, { quote_id: id, token: randomUUID(), paid, payment_intent, channel, queued: new Date().toISOString() });
    await save(`progress/${id}.json`, { stage: "queued", detail: "queued for the archive worker, which runs orders that consult the archive", at: new Date().toISOString() });
    await startWorker(`run ${id}`);
    return;
  }
  try {
    const out = await deliver(q, { deadline: Date.now() + RUN_SECONDS * 1000 });
    // the order keeps its charge, and never less than what it cost: its model cost and its payment fee (2026-10-25)
    const keep = kept({ channel, paid, charge: out.billing?.charge_usd ?? 0, cost: out.billing?.cost_usd ?? 0 });
    const owed = Math.round((paid - keep) * 100) / 100;
    await closeOrder(id, { channel, invocations: hop + 1, kept_usd: keep }, { payment_intent, owed, reason: `unused by quote ${id}` });
  } catch (e) {
    if (e.code === "continue" && hop + 1 < MAX_HOPS) return handOn(id, hop + 1, e);
    // Nothing delivered: the whole payment goes back.
    const reason = e.code === "continue" ? `the run did not finish within ${MAX_HOPS} invocations` : String(e.message || e);
    // the run that failed is named, where there was one: its composition carries each failed call with its error
    await closeOrder(id, { channel, reason, invocations: hop + 1,
      ...(e.result_id ? { result_id: e.result_id, composition: `/v1/results/${e.result_id}/composition`, evidence: `/v1/results/${e.result_id}/evidence` } : {}) },
      { payment_intent, owed: undeliveredRefund(channel, paid), reason: `quote ${id} could not complete: ${reason.slice(0, 200)}` });
  }
}

// The order is closed and its refund sent (2026-10-25). A refund owed is recorded with its state: none owed, succeeded,
// pending (Stripe settles it), or failed. A failed refund is an obligation still owed, never a settlement: it is retried
// (by /resume, and by the worker's settle), safely, since Stripe takes the same idempotency key for the same refund.
const refundOpen = (rf) => !!rf && rf.refund_state === "failed";
async function closeOrder(id, base, { payment_intent, owed, reason }) {
  const prior = await load(`refunds/${id}.json`);
  const now = new Date().toISOString();
  let refund = null, state;
  if (!(owed >= 0.01)) state = "none owed";
  else {
    try {
      refund = await refundUnused(payment_intent, owed, reason);
      state = !refund ? "failed" : refund.status === "succeeded" ? "succeeded" : ["failed", "canceled"].includes(refund.status) ? "failed" : "pending";
      if (!refund) refund = { error: "the refund could not be sent: no card key, or no payment to refund" };
    } catch (e) { refund = { error: String(e.message || e).slice(0, 300) }; state = "failed"; }
  }
  const attempts = [...(prior?.attempts || []).slice(-19), { at: now, state, ...(refund?.error ? { error: refund.error } : {}), ...(refund?.refund ? { refund: refund.refund } : {}) }];
  await save(`refunds/${id}.json`, { ...(prior || {}), ...base, quote_id: id, channel: base.channel || prior?.channel || "card", amount_usd: owed, refund_state: state, refund,
    reason_sent: reason, attempts, at: prior?.at || now, last_attempt: now });
  return state;
}
async function retryRefund(id) {
  const rf = await load(`refunds/${id}.json`), rc = await load(`receipts/${id}.json`), job = await load(`${WORKER.runs}/${id}.json`);
  const pi = rc?.stripe_payment_intent || job?.payment_intent;
  return closeOrder(id, {}, { payment_intent: pi, owed: rf.amount_usd, reason: rf.reason_sent || `quote ${id}` });
}

async function handOn(id, hop, e) {
  const token = randomUUID();
  await save(`jobs/${id}.json`, { quote_id: id, hop, token, at: new Date().toISOString(), read: e.read, not_started: e.not_started?.length });
  await save(`progress/${id}.json`, { stage: "continuing", detail: `invocation ${hop + 1}: ${e.not_started?.length ?? "?"} claims still to read`, at: new Date().toISOString() });
  const r = await fetch(`${BASE}/v1/quotes/${id}/continue`, { method: "POST", headers: { "x-gnosis-continue": token }, signal: AbortSignal.timeout(20000) }).catch((x) => ({ ok: false, status: String(x.message || x) }));
  if (!r.ok) await save(`jobs/${id}.json`, { quote_id: id, hop, token, at: new Date().toISOString(), handoff_failed: String(r.status) });
}
// The next invocation of a card order that reached its time budget: only the token the last invocation wrote starts
// it, and only for an order paid, not delivered and not refunded. It answers at once; the work runs after.
app.post("/v1/quotes/:quote_id/continue", async (req, res) => {
  const id = req.params.quote_id;
  const [job, q, rc] = await Promise.all([load(`jobs/${id}.json`), load(`quotes/${id}.json`), load(`receipts/${id}.json`)]);
  if (!job || !q || !rc || req.get("x-gnosis-continue") !== job.token) return res.status(404).json({ error: "no run to continue" });
  if ((await load(`delivered/${id}.json`)) || (await load(`refunds/${id}.json`))) return res.json({ note: "already finished" });
  res.status(202).json({ continuing: id, invocation: job.hop + 1 });
  waitUntil(runCard(q, id, { paid: rc.paid_usd, payment_intent: rc.stripe_payment_intent, hop: job.hop, channel: rc.channel }));
});
// The archive worker's report on an order it ran: delivered (the result is in the store) or failed (its reason). Only
// the token this service wrote when it queued the order is accepted; the refund is computed and sent here, where the
// payment key is.
app.post("/v1/quotes/:quote_id/settle", async (req, res) => {
  const id = req.params.quote_id;
  const [job, q] = await Promise.all([load(`${WORKER.runs}/${id}.json`), load(`quotes/${id}.json`)]);
  if (!job || !q || req.get("x-gnosis-worker") !== job.token) return res.status(404).json({ error: "no queued run to settle" });
  const rf = await load(`refunds/${id}.json`);
  if (rf && !refundOpen(rf)) return res.json({ note: "already settled", refund_state: rf.refund_state || (rf.refund?.error ? "failed" : "recorded") });
  if (rf) return res.json({ settled: id, retried: true, refund_state: await retryRefund(id), refunded_usd: rf.amount_usd });
  const [out, failed] = await Promise.all([load(`delivered/${id}.json`), load(`${WORKER.failed}/${id}.json`)]);
  if (!out && !failed) return res.status(409).json({ error: "the worker has written neither a result nor a failure" });
  const keep = out ? kept({ channel: job.channel || "card", paid: job.paid, charge: out.billing?.charge_usd ?? 0, cost: out.billing?.cost_usd ?? 0 }) : 0;
  const owed = out ? Math.round((job.paid - keep) * 100) / 100 : undeliveredRefund(job.channel || "card", job.paid);
  const reason = out ? `unused by quote ${id}` : `quote ${id} could not complete: ${String(failed.error).slice(0, 200)}`;
  const state = await closeOrder(id, { channel: job.channel || "card", run_by: "archive worker", ...(failed ? { reason: failed.error, result_id: failed.result_id || undefined } : {}) },
    { payment_intent: job.payment_intent, owed, reason });
  if (out?.composition?.non?.composed) waitUntil(startLanding(`row ${out.composition.non.row} delivered (${out.result_id})`));
  res.json({ settled: id, refunded_usd: owed, refund_state: state });
});

// A paid card order whose run stopped (nothing delivered, nothing refunded, no progress for six minutes) is started
// again; anyone may ask, since it only does work already paid for, and what was read comes from the ledger.
const resumeClaim = (id, pr) => claim(`claims/resume/${id}/${sha256(String(pr?.at || "no-progress")).slice(0, 16)}.json`, { quote_id: id, resumed_from: pr || null, at: new Date().toISOString() });
app.post("/v1/quotes/:quote_id/resume", async (req, res) => {
  const id = req.params.quote_id;
  const [q, rc, pr] = await Promise.all([load(`quotes/${id}.json`), load(`receipts/${id}.json`), load(`progress/${id}.json`)]);
  if (!q || !rc || !["card", "x402"].includes(rc.channel)) return res.status(404).json({ error: "no paid order with this id" });
  const rf = await load(`refunds/${id}.json`);
  if (refundOpen(rf)) return res.json({ note: "finished; the refund owed had failed and is sent again", refund_state: await retryRefund(id) });
  if ((await load(`delivered/${id}.json`)) || rf) return res.json({ note: "already finished" });
  if (pr && Date.now() - Date.parse(pr.at) < 6 * 60e3) return res.status(409).json({ note: "still running", progress: pr });
  // One resume of one stopped run (2026-10-25: two resumes at once both started the order): the claim is keyed on the
  // progress record being resumed, so every resume of that run contends for one key and one wins.
  if (!(await resumeClaim(id, pr))) return res.status(409).json({ note: "already resumed", progress: pr });
  await save(`progress/${id}.json`, { stage: "resumed", detail: "started again after its run stopped", at: new Date().toISOString() });
  res.status(202).json({ resumed: id });
  waitUntil(runCard(q, id, { paid: rc.paid_usd, payment_intent: rc.stripe_payment_intent, channel: rc.channel }));
});
app.use(express.json({ limit: "64kb" }));
// A body that is not JSON is answered in JSON (2026-10-25): a parse error on /mcp as JSON-RPC's -32700, elsewhere as an error.
app.use((e, req, res, next) => {
  if (e?.type !== "entity.parse.failed") return next(e);
  if (req.path === "/mcp") return res.status(200).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error: the body is not JSON" } });
  res.status(400).json({ error: "the body is not JSON" });
});


const INDEX = {
  service: SERVICE, network: NETWORK,
  operations: {
    "POST /v1/quote": "free. body {oldid (or article: a Wikipedia link or title, pinned to its current revision), tier?: check|ledger|opening|commission|portable, claims?: [ids]} or, for an entity the encyclopedia does not hold, {commission?: open|construct, object: {kind?: entity|operator, name, aliases? (entity), strings? (operator: the phrases in which it is performed and in which entities speak it), description?, works_by?, capture?: obs_id|slug, transcript?: {text, surface, date, cite_list} (open: admitted through discernment), sources?: [url], compare?: encyclopedia (construct)}, tier?: commission|portable}; the legacy {entity: {...}} form is accepted. A revision is opened; an object is opened where a composition is found or supplied, and constructed otherwise. Pins the revision and resolves its sources; an opening prices each sentence in cents and never consults the archive; at the commission and portable tiers the archive traversal runs and is priced; returns scope, cost-based prices, the execution contract and the maximum price.",
    "GET /v1/results/{result_id}/portable/{file}": "portable tier: the entity's knowledge object from its /non row (article.md, article.html, article.jsonld, article.json, manifest.json, LICENSE.txt; CC BY 4.0, with the Wikipedia article's quoted sentences CC BY-SA 4.0)",
    "POST /v1/openings/{quote_id}": "paid by agents (x402, USDC on Base, settling to the service's Stripe balance; answers 503 until a receiving address is set). Pays for a quote and starts its work; answers 202 with the status address, where the result id appears on delivery (an order that consults the archive is run by the archive worker). A quote already paid answers with its result, or where it stands, without a second charge; what the work did not use is refunded.",
    "GET /v1/sentence?text=&url=&mode=": "the sentence as you have it and the Wikipedia page it came from: free where it has been read (as recorded); otherwise 402 with the price, then the opening (two readings); mode=preliminary, one quick pass; mode=grounded, the opening with the archive's claims on the sentence from a commissioned /non row (two cents more; where no row holds the sentence, the commission is offered and nothing is charged)",
    "POST /v1/openings/{quote_id}/checkout": "for people: a Stripe Checkout link for the quote's maximum (at least $0.50); the work runs when the payment completes, and what it did not use is refunded",
    "GET /v1/quotes/{quote_id}/status": "where a quote stands: quoted, paid and running, delivered; its receipt and any refund",
    "GET /v1/results/{result_id}/publication": "the /non row's publication, observed now: composed, checked, landed, public",
    "archive worker": "commissions, portable packages and entity objects consult the archive, which this deployment does not hold: their quotes and runs are made by a scheduled job with the archive checked out (" + WORKER.where + "); a quote answers 202 with its status address, and a paid order is queued, run there and settled here",
    "POST /v1/quotes/{quote_id}/resume": "a paid card order whose run stopped (no progress for six minutes, nothing delivered or refunded) is started again",
    "GET /v1/results/{result_id}/landing": "the /non row's landing tree: the manifest, each file at …/landing/{path}, for the operator's landing",
    "GET /v1/openings/{quote_id}/progress": "the stage a running opening has reached",
    "GET /v1/non?name=&context=": "free: the /non entry a name answers, or the candidates and what tells them apart, or the construction offered as a free quote",
    "POST /mcp": "the same requests as tools for agents (Model Context Protocol, Streamable HTTP, JSON): find_entry, open_sentence, get_quote, order_status, card_checkout, get_result; payment is taken at the HTTP routes the tools name",
    "GET /v1/calibration": "the latest calibration release of the reading passes: the procedure run live on held-out /non rows and scored against each row by stage (admission, archive claims, field claims, case, ρ), with its cost",
    "GET /v1/receipts/{quote_id}": "the settlement receipt (transaction, payer, amount) and any refund owed or sent",
    "GET /v1/results/{result_id}/composition": "the usable result",
    "GET /v1/results/{result_id}/evidence": "the full evidence record: tuples, spans, hashes, validations, breaches, cost",
    "GET /v1/results/{result_id}/opened.html": "the opened article",
    "GET /v1/results/{result_id}/annotations": "W3C Web Annotations on the pinned revision",
  },
  non: { name: "The Negative of the Negative (/non)", url: "https://www.alexanarch.org/non/", contents: "https://www.alexanarch.org/non/index.json",
    claims: "https://www.alexanarch.org/non/claims.json", entry: "https://www.alexanarch.org/non/{entity}/ (as data: …/entity.json)",
    statement: "Every commission composes the entity's row in /non: public knowledge of the entity composed as the composition layer gave it, as its own disclosed sources give it, and with the Crimson Hexagonal Archive admitted on equal terms. The row is written as a landing tree (GET /v1/results/{result_id}/landing) and the archive's landing workflow lands it in /non by itself, verified against its manifest; a grounded sentence is served from a landed row." },
  spxi_instrument: { method: "0.17", name: "The opening (a pinned Wikipedia revision, read sentence by sentence)", url: "https://www.spxi.dev/methods/#m-0-17",
    also: [{ method: "0.16", name: "The Negative of the Negative (/non)", url: "https://www.spxi.dev/methods/#m-0-16" }], inventory: "https://www.spxi.dev/methods/" },
  publication: "Every commission composes the entity's row in the Negative of the Negative (alexanarch.org/non), the opened Wikipedia, and the row is public (CC BY 4.0): a paid commission contributes to the public counter-infrastructure it draws on.",
  notice: "The treatment of an article's entities by composing systems may be recorded and measured.",
};
// The description for machine readers, as text (2026-10-25).
app.get("/llms.txt", (req, res) => res.type("text/plain; charset=utf-8").send(llmsTxt()));
function llmsTxt() {
  const ops = Object.entries(INDEX.operations).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  return `# SPXI-gnΩsis

> Opens existing compositions against their sources and constructs sourced knowledge objects, for entities and for operators (the operations an entity form conceals). Its principal application opens pinned Wikipedia revisions sentence by sentence and keeps each reading as evidence. A commission consults the Crimson Hexagonal Archive by its own procedure and composes the object's row in the Negative of the Negative (https://www.alexanarch.org/non/), which lands there public under CC BY 4.0.

Fund the counterinfrastructure. Rebuild the foundations of the world.

Jack said, "The foundations of this world are unsound, and the foundations of the world above are unsound. Write this down, for these words are faithful and true: I am making everything new." (after The Gospel of Antioch, saying 11, https://www.alexanarch.org/s/records/71/, and Revelation 21:5, its order inverted)

${SERVICE.name} ${SERVICE.version}, protocol ${SERVICE.protocol}. SPXI method 0.17 (the opening), also 0.16 (the Negative of the Negative): https://www.spxi.dev/methods/#m-0-17

A reader of this file finds the service description as JSON at https://gnosis.spxi.dev/ (Accept: application/json). A quote is free: POST https://gnosis.spxi.dev/v1/quote with {"oldid": <revision id>, "tier": "check" | "opening" | "commission"} or, for an entity the encyclopedia does not hold, {"object": {"name": …}}. Prices derive from measured model cost: typically, as of 2026-10-25, a sentence is 2¢ checked and 22¢ opened; a commission adds the archive's consultation, priced from its traversal. People pay by card (Stripe Checkout); agents pay per request over x402 (USDC on Base mainnet), and the same requests are served as MCP tools at POST https://gnosis.spxi.dev/mcp. GET https://gnosis.spxi.dev/v1/non?name=<name> finds a /non entry free.

## The Negative of the Negative

- Entries: https://www.alexanarch.org/non/
- Contents as data: https://www.alexanarch.org/non/index.json
- Every field claim quoted, by row: https://www.alexanarch.org/non/claims.json
- An entry and its data: https://www.alexanarch.org/non/{entity}/ and …/entity.json
- Specification: EA-NEGONT-02 v0.9, https://www.alexanarch.org/s/records/1690/

## Operations

${ops}

## Elsewhere

- Specification of the opening: EA-WIKI-OPEN-01 v1.1, https://www.alexanarch.org/s/records/1697/
- Protocol home: https://www.spxi.dev/ (methods: https://www.spxi.dev/methods/)
- Archive: https://www.alexanarch.org/
- Source: https://github.com/leesharks000/spxignosis (PolyForm Shield 1.0.0)
`;
}
// Agents and scripts get the service description as JSON; a browser gets the same description as a page.
// The deployment's description, for agents (JSON at /), for people (the front page) and on the API page.
function serviceIndex() {
  return { ...INDEX, payments: { card: stripe ? (LIVE ? "live (Stripe Checkout)" : "test mode (Stripe sandbox)") : "not configured", agents: PAY_TO ? `x402 on ${NETWORK} (USDC; facilitator ${facilitatorName()})` : mainnet ? `not ready: no receiving address yet${DEPOSIT.error ? " (Stripe declined to create one: crypto not yet approved, or the key lacks the permission)" : ""}; the x402 routes answer 503` : "not configured yet: the x402 routes answer 503" },
    // whether the live reader can run: the key's presence only, never its value (2026-10-24: the first card test read no sentence)
    reader: (process.env.GNOSIS_READER || "anthropic") === "replay" ? "replay (recorded readings)" : process.env.ANTHROPIC_API_KEY ? "live: the model key is set" : "not ready: ANTHROPIC_API_KEY is not set, so no sentence can be read",
    worker_start: DISPATCH.token ? "on request" : "GitHub's schedule only (no dispatch token set)",
    landing_start: LANDING.token ? `on delivery of a paid row (${LANDING.repo}, ${LANDING.workflow})` : "the archive's schedule, or by hand (no token set)",
    storage: BLOB ? "private Vercel Blob, with this instance's /tmp in front" : process.env.VERCEL ? "local only (/tmp, not shared between instances): connect a Blob store" : "local folder" };
}
app.get("/", (req, res) => {
  const index = serviceIndex();
  if (!req.accepts(["application/json", "text/html"]) || req.accepts(["application/json", "text/html"]) === "application/json") return res.json(index);
  res.type("html").send(frontPage(index));
});
// An order's page (2026-10-25): its quote, the card payment, its progress and its result, read from the status route.
// The card checkout returns here.
app.get("/order/:quote_id", (req, res) => {
  if (!/^Q-[0-9a-f]{8,32}$/.test(req.params.quote_id)) return res.status(404).type("html").send(orderPage(serviceIndex(), "unknown"));
  res.type("html").send(orderPage(serviceIndex(), req.params.quote_id));
});
// The API reference and the deployment's configuration, for people; agents read the same at GET / as JSON.
app.get("/api", (req, res) => res.type("html").send(apiPage(serviceIndex())));
// Free quotes are limited where they start the archive worker (2026-10-25): QUOTE_PER_HOUR from one address and
// QUOTE_ALL_PER_HOUR from everyone in an hour, so a flood of free quotes cannot hold the worker from paid orders. A quote
// answered at once (an opening) is not limited.
const QUOTE_PER_HOUR = Number(process.env.GNOSIS_QUOTE_PER_HOUR || 12), QUOTE_ALL_PER_HOUR = Number(process.env.GNOSIS_QUOTE_ALL_PER_HOUR || 60);
async function quoteAllowed(req) {
  const hour = new Date().toISOString().slice(0, 13).replace(/[-T]/g, ""), retry = 3600 - (Math.floor(Date.now() / 1000) % 3600);
  const who = sha256(String(req.get("x-forwarded-for") || req.ip || "?").split(",")[0].trim()).slice(0, 24);
  const [all, one] = await Promise.all([load(`limits/quotes/${hour}/all.json`).catch(() => null), load(`limits/quotes/${hour}/${who}.json`).catch(() => null)]);
  if ((all?.n || 0) >= QUOTE_ALL_PER_HOUR) return { ok: false, status: 503, retry, why: `the archive worker has had ${QUOTE_ALL_PER_HOUR} quote requests this hour; ask again after the hour` };
  if ((one?.n || 0) >= QUOTE_PER_HOUR) return { ok: false, status: 429, retry, why: `at most ${QUOTE_PER_HOUR} quotes that consult the archive from one address in an hour` };
  await Promise.all([save(`limits/quotes/${hour}/all.json`, { n: (all?.n || 0) + 1 }), save(`limits/quotes/${hour}/${who}.json`, { n: (one?.n || 0) + 1 })]);
  return { ok: true };
}
// A Wikipedia link or title to its current revision, pinned (2026-10-25): the front page's form sent the browser to
// Wikipedia's API, which throttles anonymous callers (429); the service asks with its own user agent.
async function pinArticle(v) {
  v = String(v || "").trim();
  const id = v.match(/[?&]oldid=(\d+)/) || v.match(/^(\d+)$/);
  if (id) return { oldid: Number(id[1]) };
  const w = v.match(/wikipedia\.org\/wiki\/([^?#]+)/), t = v.match(/[?&]title=([^&#]+)/);
  const title = (w ? decodeURIComponent(w[1]) : t ? decodeURIComponent(t[1].replace(/\+/g, " ")) : v).replace(/_/g, " ").trim();
  if (!title || /^https?:/i.test(title)) throw Object.assign(new Error("article: a link to an English Wikipedia article, its title, or a revision id"), { status: 400 });
  const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=ids&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(title)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  const pg = (await r.json())?.query?.pages?.[0];
  if (!pg || pg.missing || !pg.revisions?.[0]?.revid) throw Object.assign(new Error(`English Wikipedia holds no article titled "${title}"`), { status: 404 });
  return { oldid: pg.revisions[0].revid, title: pg.title };
}
app.post("/v1/quote", async (req, res) => {
  try {
    if (req.body && !req.body.oldid && req.body.article && !req.body.object && !req.body.entity) req.body = { ...req.body, oldid: (await pinArticle(req.body.article)).oldid };
    const { oldid, entity, object, commission, tier = "opening", claims } = req.body || {};
    // A commission names what is done (open, construct) and the object it is done to (an entity, or an operator).
    // An object is always a commission: the archive is consulted on commission only.
    const objTier = tier === "opening" ? "commission" : tier;
    // Where the service holds no archive, a quote that consults it (a commission, a portable package, any entity or
    // object) is priced by the archive worker: the request is recorded and answered at once with where its quote will
    // appear (2026-10-24).
    if (!HAS_ARCHIVE && (object || entity || ADMITS.has(tier))) {
      if (!object && !entity && !/^\d+$/.test(String(oldid))) return res.status(400).json({ error: "oldid (a Wikipedia revision id) or entity {name, aliases?, type?, works_by?, capture?, sources?: [url]} is required" });
      const lim = await quoteAllowed(req);
      if (!lim.ok) return res.status(lim.status).set("Retry-After", String(lim.retry)).json({ error: lim.why, retry_after_seconds: lim.retry });
      const id = `Q-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await save(`${WORKER.quote_requests}/${id}.json`, { quote_id: id, body: req.body, tier: object || entity ? objTier : tier, at: new Date().toISOString() });
      waitUntil(startWorker(`quote ${id}`));
      return res.status(202).json({ quote_id: id, state: "estimating", status: `/v1/quotes/${id}/status`,
        note: `the archive is consulted on this tier: the quote is priced by the archive worker, which traverses the archive (${DISPATCH.token ? "started now; usually a few minutes" : "on its schedule, usually within half an hour"}); its price appears at the status address, and it holds for a day` });
    }
    if (object) return res.json(await quoteEntity({ ...object, ...(commission ? { commission } : {}) }, { tier: objTier }));
    // An entity the encyclopedia does not hold is opened from its name and strings, with T from the Capture Registry or
    // constructed from sources the service fetches; a composition the caller supplies is refused.
    if (entity) return res.json(await quoteEntity(entity, { tier: objTier }));
    if (!/^\d+$/.test(String(oldid))) return res.status(400).json({ error: "oldid (a Wikipedia revision id) or entity {name, aliases?, type?, works_by?, capture?, sources?: [url]} is required" });
    res.json(await quote(Number(oldid), { tier, claims }));
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});

// Payment records are kept apart from evidence. store/receipts/<quote_id>.json holds the settlement the facilitator
// returned (transaction, payer, network, amount) and is written only after settlement succeeds; the result exists
// before that and is released only against a receipt. store/refunds/<quote_id>.json queues what is owed back.
const receiptOf = (id) => load(`receipts/${id}.json`);

// Recovery runs before the payment middleware: a quote that has a receipt returns its result without a second charge.
// The quote id is the bearer of the purchase, as it was of the quote.
app.post("/v1/openings/:quote_id", async (req, res, next) => {
  // A quote that does not exist or has expired is refused here, before the payment layer can issue a challenge.
  const q = await load(`quotes/${req.params.quote_id}.json`);
  if (!q) return res.status(404).json({ error: "unknown quote; no payment was requested" });
  const rc = await receiptOf(req.params.quote_id);
  if (!rc?.settlement?.success) {
    if (Date.parse(q.expires) < Date.now()) return res.status(410).json({ error: "quote expired; no payment was requested" });
    return next();
  }
  // A paid order: its result where delivered, else where it stands; never a second charge.
  const out = await load(`delivered/${req.params.quote_id}.json`);
  if (!out) return res.status(202).json({ quote_id: q.quote_id, state: "paid; running or queued", status: `/v1/quotes/${q.quote_id}/status`, receipt: rc });
  res.json({ ...out, recovered: true, receipt: rc, contributes: contributesOpening(out) });
});
app.get("/v1/openings/:quote_id/progress", async (req, res) => {
  const p = await load(`progress/${req.params.quote_id}.json`);
  if (!p) return res.status(404).json({ error: "no progress recorded for this quote" });
  res.json(p);
});
// The earnings record, computed from the store and kept ten minutes (2026-10-25). It is private (operator, 2026-10-25:
// "please dont make payments public"): it answers only a request carrying the operator's key, set in the deployment's
// environment as GNOSIS_OPERATOR_KEY, and is otherwise indistinguishable from a route that does not exist.
let ACCOUNTS = null;
const OPERATOR_KEY = process.env.GNOSIS_OPERATOR_KEY || null;
app.get("/v1/accounts", async (req, res) => {
  if (!OPERATOR_KEY || req.get("x-gnosis-operator") !== OPERATOR_KEY) return res.status(404).json({ error: "not found" });
  try {
    if (!ACCOUNTS || Date.now() - ACCOUNTS.t > 10 * 60e3) ACCOUNTS = { t: Date.now(), body: await accounts() };
    res.json(ACCOUNTS.body);
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});
// The name request: a /non entry by its name, free; candidates; or the construction offered as a free quote.
app.get("/v1/non", async (req, res) => {
  try { const r = await lookupName(req.query.name, { context: req.query.context }); res.status(r.status).json(r.body); }
  catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});
// The tools (MCP, Streamable HTTP, stateless): POST a JSON-RPC message; GET answers that no stream is offered.
app.post("/mcp", async (req, res) => {
  let out;
  try { out = await handleMcp(req.body, { base: BASE, service: SERVICE }); }
  catch (e) { return res.status(200).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32603, message: `internal error: ${String(e.message || e).slice(0, 200)}` } }); }
  if (!out || (Array.isArray(out) && !out.length)) return res.status(202).end();
  res.set("MCP-Protocol-Version", MCP_PROTOCOL).json(out);
});
app.get("/mcp", (req, res) => res.status(405).set("Allow", "POST").json({ error: "this MCP server answers POST with JSON; it offers no event stream" }));
// The calibration releases (2026-10-25): the latest, and any release by id.
app.get("/v1/calibration", async (req, res) => {
  const latest = await load("calibration/latest.json");
  if (!latest) return res.status(404).json({ note: "no calibration release has run yet; the request is calibration/request.json in the repository" });
  res.json({ ...latest, release: await load(latest.summary) });
});
app.get("/v1/receipts/:quote_id", async (req, res) => {
  const rc = await receiptOf(req.params.quote_id);
  if (!rc) return res.status(404).json({ error: "no receipt for this quote" });
  res.json({ ...rc, refund: await load(`refunds/${req.params.quote_id}.json`) || null });
});

// The sentence request, at the point of contact: free where the reading exists; otherwise the payment layer quotes it.
app.get("/v1/sentence", async (req, res, next) => {
  try {
    const { text, url, mode = "opening" } = req.query;
    const p = await prepareSentence({ text, url, mode });
    if (["not found", "not identical", "uncited", "not grounded"].includes(p.state)) return res.status(p.status).json(p); // answered before any payment
    if (p.state === "recorded") return res.json({ ...(await readSentence(p.request_id)), price_usd: 0, free: "this reading exists; it is served as recorded. Re-reading against changed sources is new work." });
    req.sentence = p; next(); // quoted: the payment layer answers 402 with this price
  } catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});

// Unpaid deployment: a sentence already found and priced says so, with its price, before the 503 (2026-10-24).
// Card checkout and its status run through Stripe alone, and need no receiving address (2026-10-24: they had answered
// this 503 with Stripe configured).
const CARD_PATH = /^\/v1\/openings\/[^/?]+\/checkout(\?|$)/;
if (!PAY_TO) app.use(/^\/v1\/(sentence|openings)/, (req, res, next) => {
  if (stripe && CARD_PATH.test(req.originalUrl)) return next();
  const p = req.sentence;
  res.status(503).json({ error: "payments are not configured on this deployment yet; quotes are free at POST /v1/quote",
    ...(p ? { state: "found", sentence: p.sentence, request_id: p.request_id, est_cost_usd: p.est_cost_usd, price_usd: p.price_usd, expires: p.expires } : {}) });
});
const resourceServer = !PAY_TO ? null : new x402ResourceServer(new HTTPFacilitatorClient(await facilitatorConfig())).register(NETWORK, new ExactEvmScheme())
  // the paid routes declare themselves for discovery (Bazaar): facilitators that keep a catalogue list them with their
  // input and output (2026-10-25)
  .registerExtension(bazaarResourceServerExtension);
// A settled x402 payment is recorded in Stripe as a PaymentIntent, keyed by its transaction, before the route's receipt.
resourceServer?.onAfterSettle(async (ctx) => {
  try { const rec = await recordSettlement(ctx); if (rec) { await save(`settlements/${ctx.result.transaction}.json`, rec);
    // also by the payment's signature, so a route that settles before its work can find its own payment (2026-10-25)
    const sig = ctx.paymentPayload?.payload?.signature; if (sig) await save(`settlements/by-signature/${sha256(String(sig)).slice(0, 40)}.json`, { ...rec, transaction: ctx.result.transaction }); } }
  catch (e) { await save(`settlements/${ctx.result?.transaction || "unknown"}.json`, { error: String(e.message || e) }); }
});

// People pay by card: a Checkout session for the quote's maximum; the work runs when Stripe reports the payment.
app.post("/v1/openings/:quote_id/checkout", async (req, res) => {
  const q = await load(`quotes/${req.params.quote_id}.json`);
  if (!q) return res.status(404).json({ error: "unknown quote" });
  if (Date.parse(q.expires) < Date.now()) return res.status(410).json({ error: "quote expired" });
  if (await load(`receipts/${q.quote_id}.json`)) return res.status(409).json({ error: "this quote is already paid", status: `/v1/quotes/${q.quote_id}/status` });
  try {
    // One open session per quote (2026-10-25): a second request while the first session is open is answered with it,
    // so one quote is not offered two payments. A session that has expired is replaced.
    const open = await load(`checkouts/${q.quote_id}.json`);
    const co = open && Date.parse(open.expires_at) > Date.now() + 60e3 ? { ...open, reused: true } : await checkoutFor(q, { base: BASE });
    if (!co.reused) await save(`checkouts/${q.quote_id}.json`, co);
    res.json({ ...co, status: `/v1/quotes/${q.quote_id}/status`, note: q.max_price_usd < CARD_MINIMUM_USD ? `card payments start at $${CARD_MINIMUM_USD.toFixed(2)}, and an order at that minimum keeps it whole (Stripe keeps its fee on any refund); agents paying over x402 pay the sentence's own price` : "charged for the work done, and never less than what it cost (model and payment fee); the rest is refunded" }); }
  catch (e) { res.status(e.status || 502).json({ error: String(e.message || e) }); }
});
// Where a quote stands, for either channel: quoted, paid, running, delivered, refunded.
app.get("/v1/quotes/:quote_id/status", async (req, res) => {
  const id = req.params.quote_id, q = await load(`quotes/${id}.json`);
  if (!q) {
    const [rq, qe] = await Promise.all([load(`${WORKER.quote_requests}/${id}.json`), load(`${WORKER.quote_errors}/${id}.json`)]);
    if (qe) return res.json({ quote_id: id, state: "not quoted", error: qe.error, at: qe.at });
    if (rq) return res.json({ quote_id: id, state: "estimating", requested: rq.at, worker: WORKER.where, note: "the archive worker has not priced it yet" });
    return res.status(404).json({ error: "unknown quote" });
  }
  const rc = await load(`receipts/${id}.json`), out = await load(`delivered/${id}.json`), pr = await load(`progress/${id}.json`), rf = await load(`refunds/${id}.json`);
  res.json({ quote_id: id, max_price_usd: q.max_price_usd, expires: q.expires, ...(!rc ? { pay: { card: `POST /v1/openings/${id}/checkout` } } : {}),
    // a refund with nothing delivered is a refunded order, not a running one (2026-10-24: the first card test read so)
    state: out ? "delivered" : rf && rc ? `refunded${rf.reason ? `: ${rf.reason}` : ""}` : rc ? "paid, running" : "quoted",
    progress: pr || null, result: out ? { result_id: out.result_id, composition: `/v1/results/${out.result_id}/composition`, evidence: `/v1/results/${out.result_id}/evidence` } : null,
    receipt: rc ? { channel: rc.channel, at: rc.at, paid_usd: rc.paid_usd ?? rc.reserved_usd } : null, refund: rf || null,
    // the quote itself, each line with its estimate, as a quote answered at once returns it (2026-10-25: a quote priced
    // by the archive worker showed only its maximum)
    quote: q });
});
if (PAY_TO) app.use(paymentMiddleware({
  "GET /v1/sentence": {
    accepts: [{
      // settled before the reading runs (2026-10-25): a payment checked and settled after the work could be withdrawn
      // in between, and the reading would have been done unpaid
      scheme: "exact", network: NETWORK, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { paymentFlow: "upfront" },
      price: async (ctx) => {
        const q = ctx.adapter.getQueryParams();
        const p = await load(`sentences/pending/${requestId({ text: q.text, url: q.url, mode: q.mode || "opening" })}.json`);
        if (!p) throw new Error("unknown sentence request"); // unreachable: the route above prepares it first
        return `$${Math.max(0.01, p.price_usd).toFixed(2)}`;
      },
    }],
    resource: `${BASE}/v1/sentence`, serviceName: "SPXI-gnΩsis", iconUrl: "https://gnosis.spxi.dev/omega-512.png", tags: ["fact-checking", "citations", "wikipedia", "provenance", "sources", "research"],
    extensions: declareDiscoveryExtension({
      input: { text: "According to Aristotle, this is the first work to treat the subject of deductive reasoning in ancient Greece (Soph. Ref., 34, 183b34 ff.).", url: "https://en.wikipedia.org/wiki/Sophistical_Refutations", mode: "opening" },
      inputSchema: { type: "object", properties: { text: { type: "string", description: "the sentence exactly as it stands on the page" }, url: { type: "string", description: "the English Wikipedia page, by title or revision URL" }, mode: { type: "string", enum: ["opening", "preliminary", "grounded"] } }, required: ["text", "url"] },
      output: { example: { mode: "opening", page: { title: "Sophistical Refutations", oldid: 1361634710 }, sentence: { id: "W2", text: "According to Aristotle, this is the first work to treat the subject of deductive reasoning in ancient Greece (Soph. Ref., 34, 183b34 ff.).", match: "identical" },
        result: { status: "contested", support: ["partially-supported", "interpretation-beyond-paraphrase"], attributization: { value: "partial", reason: "an act of self-presentation (a claim of priority) restated as a property of a book" }, retained_authority: { value: "mixed" }, spans: [{ quote: "περὶ δὲ τοῦ συλλογίζεσθαι παντελῶς οὐδὲν εἴχομεν πρότερον ἄλλο λέγειν", source_ref: "S1", role: "support" }] },
        evidence: { verdict: { status: "contested", differs: ["support"] } } } },
    }),
    description: "Use when a received claim needs checking against its source before it is cited or relied on: send the sentence and the Wikipedia page it came from; returns whether its cited source supports it, what the source says (quoted), and what the sentence adds or drops. Two readings by default; mode=preliminary for one quick pass; mode=grounded adds the Crimson Hexagonal Archive's claims on the sentence where the article has been commissioned. The paid reading is kept and served free to later callers; the response names it under contributes.",
    mimeType: "application/json",
  },
  "POST /v1/openings/:quote_id": {
    accepts: [{
      scheme: "exact", network: NETWORK, payTo: PAY_TO, maxTimeoutSeconds: 300,
      price: async (ctx) => {
        const id = (ctx.adapter?.getPath?.() || ctx.path || "").split("/").pop();
        const q = await load(`quotes/${id}.json`);
        if (!q) throw new Error("unknown quote"); // unreachable: the route above refuses an unknown quote first
        return `$${q.max_price_usd.toFixed(2)}`;
      },
    }],
    serviceName: "SPXI-gnΩsis", iconUrl: "https://gnosis.spxi.dev/omega-512.png", tags: ["knowledge-graph", "entities", "wikipedia", "provenance", "research", "commission"],
    extensions: declareDiscoveryExtension({
      bodyType: "json", input: {},
      pathParams: { quote_id: "Q-0123456789abcdef" },
      pathParamsSchema: { type: "object", properties: { quote_id: { type: "string", description: "a quote from POST /v1/quote (free), which states its deliverables and maximum" } }, required: ["quote_id"] },
      output: { example: { quote_id: "Q-0123456789abcdef", state: "paid, running", status: "/v1/quotes/Q-0123456789abcdef/status", note: "the result is named at the status address when delivered; a commission's /non row lands public under CC BY 4.0" } },
    }),
    description: "Use when an existing representation of an entity cannot support the task: opens a pinned Wikipedia revision (or an entity it does not hold), each sentence kept verbatim and checked against its cited source, the entity composed with the Crimson Hexagonal Archive admitted by the archive's own procedure. Pays the quote's maximum and answers 202 with a status address to poll; the result, which names the public /non row it composed under contributes, is retrieved by id. What the work does not use is refunded.",
    mimeType: "application/json",
  },
}, resourceServer));

app.get("/v1/sentence", async (req, res) => {
  try {
    const out = await readSentence(req.sentence.request_id);
    // Nothing read: the payment, settled before the reading, is refunded as an undelivered order is (2026-10-25).
    if (!out.result || ["unread", "withheld"].includes(out.result.status)) return res.status(502).json({ ...out, ...(await refundSentence(req, `sentence ${req.sentence.request_id} not read`)) });
    res.json({ ...out, price_usd: req.sentence.price_usd, contributes: contributesSentence(req.sentence) });
  } catch (e) {
    // The payment settled before the reading (paymentFlow upfront), so a failure here is a paid sentence not delivered:
    // it is refunded as the unread branch is, and the answer says it was charged (2026-10-25: it answered that nothing was charged).
    res.status(e.status || 502).json({ error: String(e.message || e), ...(await refundSentence(req, `sentence ${req.sentence?.request_id} failed: ${String(e.message || e).slice(0, 120)}`)) });
  }
});

// A sentence paid for and not read: the settlement is found by its payment's signature and refunded as an undelivered
// order is (undeliveredRefund).
async function refundSentence(req, reason) {
  try {
    const h = req.get("PAYMENT-SIGNATURE") || req.get("X-PAYMENT");
    const sig = h ? decodePaymentSignatureHeader(h)?.payload?.signature : null;
    const rec = sig ? await load(`settlements/by-signature/${sha256(String(sig)).slice(0, 40)}.json`) : null;
    if (!rec?.payment_intent) return { charged: true, refund: "owed: the settlement was not found; it is recorded", ...(await save(`refunds/sentences/${req.sentence.request_id}.json`, { reason, at: new Date().toISOString(), state: "owed, settlement not found" }) && {}) };
    const owed = undeliveredRefund("x402", rec.amount_usd);
    const r = owed >= 0.01 ? await refundUnused(rec.payment_intent, owed, reason) : null;
    await save(`refunds/sentences/${req.sentence.request_id}.json`, { reason, at: new Date().toISOString(), owed, refund: r });
    return { charged: true, refunded_usd: owed, refund_state: r?.status || (owed >= 0.01 ? "failed" : "none owed") };
  } catch (e) { return { charged: true, refund: `owed: ${String(e.message || e).slice(0, 120)}` }; }
}

// What a paid call leaves behind (2026-10-22): the public artifact the payment produced, named in the response.
function contributesSentence(p) {
  const q = new URLSearchParams({ text: p.sentence?.text || "", url: p.page?.url || "", mode: p.mode });
  return { artifact: "sentence reading", mode: p.mode, revision: p.page?.oldid, ledger_key: p.ledger_key,
    reuse: "served free, as recorded, to any later caller of this sentence at this revision", request: `/v1/sentence?${q}`,
    licence: "CC BY 4.0 (the reading); the Wikipedia sentence remains CC BY-SA 4.0",
    non: p.non?.length ? p.non : undefined };
}
function contributesOpening(out) {
  if (!out.non) return { artifact: "opened article", result: `/v1/results/${out.result_id}/opened.html`, note: "this tier composes no /non row" };
  return { artifact: "/non row", row: out.non.row, url: out.non.entity_page, licence: out.non.licence, complete: out.non.complete,
    publication: out.non.publication_endpoint, reuse: "public once landed; later callers read it free" };
}

// The paid route (2026-10-25). An agent's payment is settled, and the order then runs as a card order runs: an order
// that consults the archive is queued for the archive worker, a long one hands itself on, and what the work did not use
// is refunded through the Stripe record of the settlement, the refund's state kept (closeOrder). The route answers at
// once with where the order stands; the agent polls the status address and retrieves the result by id. Before, the
// route ran the whole order inside the request, which a commission cannot finish (the deployment holds no archive) and
// a long opening cannot finish in the platform's time limit.
app.post("/v1/openings/:quote_id", async (req, res) => {
  const q = await load(`quotes/${req.params.quote_id}.json`);
  if (!q) return res.status(404).json({ error: "unknown quote" });
  if (Date.parse(q.expires) < Date.now()) return res.status(410).json({ error: "quote expired" });
  const id = q.quote_id;
  // The work starts once the payment layer has settled and named the settlement in its response header.
  waitUntil(new Promise((resolve) => res.on("finish", () => (async () => {
    const h = res.getHeader("PAYMENT-RESPONSE") || res.getHeader("X-PAYMENT-RESPONSE");
    let settlement = null;
    try { settlement = h ? decodePaymentResponseHeader(String(h)) : null; } catch (e) { settlement = { success: false, error: String(e.message || e) }; }
    if (!settlement?.success) return;
    const recorded = await load(`settlements/${settlement.transaction}.json`);
    if (!(await load(`receipts/${id}.json`))) await save(`receipts/${id}.json`, { quote_id: id, at: new Date().toISOString(), channel: "x402", network: NETWORK, pay_to: PAY_TO, pay_to_kind: payToKind,
      paid_usd: q.max_price_usd, settlement, stripe_payment_intent: recorded?.payment_intent || null });
    await save(`progress/${id}.json`, { stage: "paid", detail: "settled; the order is starting", at: new Date().toISOString() });
    await runCard(q, id, { paid: q.max_price_usd, payment_intent: recorded?.payment_intent || null, channel: "x402" });
  })().catch((e) => console.error(`x402 order ${id}:`, e.message)).finally(resolve))));
  res.status(202).json({ quote_id: id, state: "paid; the order is starting", status: `/v1/quotes/${id}/status`,
    note: "the order runs after settlement; poll the status address, where the result id appears on delivery; what the work does not use is refunded" });
});

const file = (name, type) => async (req, res) => {
  const p = `results/${req.params.id}/${name}`;
  const body = await load(p, false);
  if (!body) return res.status(404).json({ error: "unknown result" });
  res.type(type).send(body);
};
app.get("/v1/results/:id/publication", async (req, res) => {
  const s7 = await load(`results/${req.params.id}/s7.json`);
  if (!s7) return res.status(404).json({ error: "no /non row for this result" });
  res.json(await publicationState(s7));
});
// The composed /non rows, for the archive's landing workflow (.github/workflows/land-non-rows.yml in the archive), which
// lands each one it has not landed by scripts/land_non_row.py and rebuilds /non (2026-10-25). Rows composed before the
// list was kept are found from the result pointers. Rows whose T the caller attests are listed with attested: true and
// are held by the landing tool until their capture is seated.
app.get("/v1/landable", async (req, res) => {
  // Only a row its order paid for: the result of a delivered order (2026-10-25: the first operator commission's row,
  // refunded in full, was listed and would have landed, a partial object published unpaid).
  const paidFor = new Set();
  for (const f of (await list("delivered")).filter((n) => n.endsWith(".json"))) {
    const d = await load(`delivered/${f}`).catch(() => null);
    if (d?.result_id) paidFor.add(d.result_id);
  }
  const rows = new Map();
  for (const f of (await list("landable")).filter((n) => n.endsWith(".json"))) {
    const r = await load(`landable/${f}`).catch(() => null);
    if (r?.result_id) rows.set(r.result_id, r);
  }
  for (const f of (await list("results/by-state")).filter((n) => n.endsWith(".json"))) {
    const p = await load(`results/by-state/${f}`).catch(() => null);
    if (!p?.non_row || rows.has(p.result_id)) continue;
    const s7 = await load(`results/${p.result_id}/s7.json`).catch(() => null);
    if (!s7?.composed || !s7.manifest) continue;
    rows.set(p.result_id, { result_id: p.result_id, row: s7.row_key, execution_key: s7.manifest.key,
      row_sha256: (s7.manifest.files || []).find((x) => x.path === `datasets/negative-of-the-negative/v2/rows/${s7.row_key}.json`)?.sha256 || null,
      complete: !!s7.complete, attested: s7.provenance?.class === "attested", composed_at: null });
  }
  for (const k of [...rows.keys()]) if (!paidFor.has(k)) rows.delete(k);
  res.json({ landable: [...rows.values()].sort((a, b) => String(a.composed_at || "").localeCompare(String(b.composed_at || ""))),
    landing: "the archive lands each row by scripts/land_non_row.py --result <result_id>, verified against its manifest; a row is listed when its order delivered",
    // the last start of the archive's landing workflow, as GitHub answered it (204 is started)
    last_landing_start: await load("worker/landing-dispatch.json").catch(() => null) });
});
// The landing tree of a result's /non row, for the archive's landing tool (scripts/land_non_row.py --result): the manifest,
// then each file it names, as kept in the store.
app.get("/v1/results/:id/landing", async (req, res) => {
  const s7 = await load(`results/${req.params.id}/s7.json`);
  if (!s7?.manifest) return res.status(404).json({ error: "no /non row for this result" });
  res.json(s7.manifest);
});
app.get("/v1/results/:id/landing/*path", async (req, res) => {
  const s7 = await load(`results/${req.params.id}/s7.json`);
  const path = [].concat(req.params.path || []).join("/");
  if (!s7?.manifest?.files?.some((f) => f.path === path)) return res.status(404).json({ error: "not a file of this landing" });
  const body = await load(`s7/${s7.row_key}/runs/${s7.manifest.key}/landing/${path}`, false);
  if (body == null) return res.status(404).json({ error: "the file is not in this service's store" });
  res.type(path.endsWith(".json") ? "application/json" : "text/plain").send(body);
});
// What an order was charged, and what that left over the model cost, are kept off every public surface (2026-10-25:
// "please dont make payments public"). A result id is public (the archive's landings list it), so the result's records
// are served without them, old records included; the buyer sees the charge on the order's status, by its quote id.
const PRIVATE_BILLING = "the charge is shown to the buyer on the order's status (/v1/quotes/{quote_id}/status); it is not published with the result";
const scrubbed = (name) => async (req, res) => {
  const body = await load(`results/${req.params.id}/${name}`).catch(() => null);
  if (!body) return res.status(404).json({ error: "unknown result" });
  if (body.billing) body.billing = { rule: body.billing.rule, cost_measured: body.billing.cost_measured, note: PRIVATE_BILLING };
  for (const v of Object.values(body.non?.stages || {})) delete v.charge_usd;
  res.json(body);
};
app.get("/v1/results/:id/composition", scrubbed("composition.json"));
app.get("/v1/results/:id/evidence", scrubbed("evidence.json"));
app.get("/v1/results/:id/opened.html", file("opened.html", "text/html"));
app.get("/v1/results/:id/annotations", file("annotations.jsonld", "application/ld+json"));
app.get("/v1/results/:id/portable/:name", async (req, res) => {
  const ok = ["article.md", "article.html", "article.jsonld", "article.json", "manifest.json", "LICENSE.txt"];
  if (!ok.includes(req.params.name)) return res.status(404).json({ error: "unknown file" });
  const body = await load(`results/${req.params.id}/portable/${req.params.name}`, false);
  if (!body) return res.status(404).json({ error: "no portable package for this result" });
  res.type(req.params.name.split(".").pop() === "md" ? "text/markdown" : req.params.name.split(".").pop()).send(body);
});

const port = Number(process.env.PORT || 4402);
app.listen(port, () => console.log(`SPXI-gnΩsis ${SERVICE.version} on :${port} · ${NETWORK}${mainnet ? ` (mainnet, facilitator ${facilitatorName()})` : " (test network)"} · pay to ${PAY_TO} (${payToKind}) · cards ${stripe ? (LIVE ? "live" : "test") : "off"}`));
