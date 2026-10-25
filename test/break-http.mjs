// The first adversarial test's payment and execution defects (2026-10-25), against the running server with a fake
// Stripe key: signatures are verified offline, and any call that would reach Stripe's API fails and is recorded.
// usage: node test/break-http.mjs <fresh store dir>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";
const S = process.argv[2]; const PORT = 4471; const B = `http://127.0.0.1:${PORT}`;
const fail = (m) => { console.log("FAIL " + m); srv.kill(); process.exit(1); };
const ok = (m) => console.log("ok   " + m);
const put = (rel, o) => { mkdirSync(join(S, rel, ".."), { recursive: true }); writeFileSync(join(S, rel), JSON.stringify(o)); };
const at = (min) => new Date(Date.now() + min * 60e3).toISOString();
const SECRET = "whsec_probe_secret";
const srv = spawn(process.execPath, ["src/server.js"], { env: { ...process.env, PORT: String(PORT), GNOSIS_STORE: S, STRIPE_SECRET_KEY: "sk_test_probe_not_a_key", STRIPE_WEBHOOK_SECRET: SECRET, GNOSIS_READER: "replay", GNOSIS_BLOB: "off", GNOSIS_ARCHIVE: "/nonexistent-archive", GITHUB_DISPATCH_TOKEN: "", GNOSIS_LANDING_TOKEN: "" }, stdio: ["ignore", "ignore", "ignore"] });
for (let i = 0; i < 50; i++) { try { await fetch(B + "/llms.txt"); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const stripe = new Stripe("sk_test_probe_not_a_key");
const event = (session) => { const payload = JSON.stringify({ id: "evt_" + session.id, type: "checkout.session.completed", data: { object: session } }); return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) }; };
const hook = ({ payload, header }) => fetch(B + "/v1/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload }).then(async (r) => ({ ...(await r.json()), http: r.status }));
const quote = (id) => ({ quote_id: id, max_price_usd: 2, expires: at(15), tier: "commission", kind: "entity", entity: { name: "Probe" }, article: { title: "Probe", entity: true }, s7: { stages: { reading: { price_usd: 1.5 }, construction: { price_usd: 0.5 } }, price_usd: 2, budget_usd: 1 } });

// 1. The checkout answers the field the page reads, and one open session is reused.
put("quotes/Q-probe00000000001.json", quote("Q-probe00000000001"));
put("checkouts/Q-probe00000000001.json", { url: "https://checkout.stripe.com/c/pay/cs_test_open", checkout_url: "https://checkout.stripe.com/c/pay/cs_test_open", session: "cs_test_open", amount_usd: 2, expires_at: at(20) });
const co = await fetch(B + "/v1/openings/Q-probe00000000001/checkout", { method: "POST" }).then((r) => r.json());
if (co.url !== "https://checkout.stripe.com/c/pay/cs_test_open" || !co.reused) fail("checkout: " + JSON.stringify(co));
const page = readFileSync("src/front.js", "utf8"), adapter = readFileSync("src/payments.js", "utf8");
if (!/var to=c\.url\|\|c\.checkout_url;if\(to\)location\.href=to;/.test(page) || !/return \{ url: s\.url, checkout_url: s\.url/.test(adapter)) fail("checkout: the page and the adapter do not share a field");
ok("checkout: the answer carries url, which the page follows; an open session for the quote is reused, not duplicated");

// 3. A second paid session for a quote another session paid is recorded and refunded; the same event twice starts once.
put("quotes/Q-probe00000000002.json", quote("Q-probe00000000002"));
put("receipts/Q-probe00000000002.json", { quote_id: "Q-probe00000000002", channel: "card", stripe_session: "cs_first", stripe_payment_intent: "pi_first", paid_usd: 2, settlement: { success: true } });
put("delivered/Q-probe00000000002.json", { result_id: "R-probe" });
const second = await hook(event({ id: "cs_second", payment_status: "paid", amount_total: 200, payment_intent: "pi_second", metadata: { quote_id: "Q-probe00000000002" } }));
const dup = existsSync(join(S, "payments/duplicates/cs_second.json")) && JSON.parse(readFileSync(join(S, "payments/duplicates/cs_second.json"), "utf8"));
if (!/second payment/.test(second.note || "") || !dup || dup.owed_usd !== 2 || dup.paid_usd !== 2 || second.http !== 500) fail("second payment: " + JSON.stringify([second, dup]));
const again = await hook(event({ id: "cs_second", payment_status: "paid", amount_total: 200, payment_intent: "pi_second", metadata: { quote_id: "Q-probe00000000002" } }));
const dup2 = JSON.parse(readFileSync(join(S, "payments/duplicates/cs_second.json"), "utf8"));
if (dup2.attempts !== 2 || dup2.first_at !== dup.first_at || again.http !== 500) fail("second payment: a failed refund was not retried on redelivery " + JSON.stringify(dup2));
ok(`second payment: a distinct paid session for a paid quote is recorded and refunded (owed $${dup.owed_usd}); against the fake key the refund fails, the event is answered 500 so Stripe sends it again, and the redelivery retries the refund (attempt ${dup2.attempts}, idempotent on the payment)`);

put("quotes/Q-probe00000000003.json", quote("Q-probe00000000003"));
const ev3 = event({ id: "cs_third", payment_status: "paid", amount_total: 200, payment_intent: "pi_third", metadata: { quote_id: "Q-probe00000000003" } });
const both = await Promise.all([hook(ev3), hook(ev3), hook(ev3)]);
const started = both.filter((x) => x.running).length;
if (started !== 1) fail(`concurrent delivery: ${started} of 3 deliveries of one event started the order ` + JSON.stringify(both));
ok("concurrent delivery: three simultaneous deliveries of one paid session start its order once");

// 4. Two resumes of one stopped run: one starts it.
put("quotes/Q-probe00000000004.json", quote("Q-probe00000000004"));
put("receipts/Q-probe00000000004.json", { quote_id: "Q-probe00000000004", channel: "card", stripe_session: "cs_four", stripe_payment_intent: "pi_four", paid_usd: 2, settlement: { success: true } });
put("progress/Q-probe00000000004.json", { stage: "S7b", detail: "extraction", at: new Date(Date.now() - 20 * 60e3).toISOString() });
const rr = await Promise.all([1, 2, 3].map(() => fetch(B + "/v1/quotes/Q-probe00000000004/resume", { method: "POST" }).then(async (r) => ({ s: r.status, b: await r.text() })))); const rs = rr.map((x) => x.s); 
if (rs.filter((x) => x === 202).length !== 1 || rs.filter((x) => x === 409).length !== 2) fail("resume: " + JSON.stringify(rs));
const claimsMade = existsSync(join(S, "claims/resume/Q-probe00000000004")) ? readdirSync(join(S, "claims/resume/Q-probe00000000004")).length : 0;
if (claimsMade !== 1) fail(`resume: ${claimsMade} resume claims written for one stopped run`);
ok("resume: of three simultaneous resumes of one stopped run, one starts it and two are refused (409)");

// 2. A paid sentence that fails after settlement is refunded and said to be charged.
const handler = readFileSync("src/server.js", "utf8").match(/app\.get\("\/v1\/sentence", async \(req, res\) => \{[\s\S]*?\n\}\);/)[0];
if (/charged: false/.test(handler) || !/catch \(e\) \{[\s\S]*refundSentence\(req/.test(handler)) fail("sentence failure: the paid handler's failure path does not refund");
ok("sentence failure: the paid sentence handler's failure path refunds through refundSentence and no longer answers charged: false");

// 7. The MCP route answers malformed calls in JSON-RPC; an unknown tier is a 400.
const m1 = await fetch(B + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: null }) });
const m2 = await fetch(B + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
const j1 = await m1.json().catch(() => null), j2 = await m2.json().catch(() => null);
const t = await fetch(B + "/v1/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ oldid: 1361634710, tier: "nonexistent-test-tier" }) });
if (j1?.error?.code !== -32602 || j2?.error?.code !== -32700 || t.status !== 400) fail("mcp route: " + JSON.stringify([m1.status, j1, m2.status, j2, t.status]));
ok("mcp route: params null and a body that is not JSON are JSON-RPC errors; an unknown tier is answered 400");
srv.kill();
