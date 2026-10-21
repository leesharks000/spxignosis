// A buyer agent: quotes, pays with x402 on the test network, receives the opening.
// Usage: BUYER_KEY=0x... node scripts/buyer.js <oldid> [service-url]
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const oldid = process.argv[2] || "1361634710";
const base = process.argv[3] || "http://localhost:4402";
const key = process.env.BUYER_KEY;
if (!key) { console.error("BUYER_KEY (a funded test-network key) is required"); process.exit(1); }
const account = privateKeyToAccount(key);
const network = process.env.GNOSIS_NETWORK || "eip155:84532";
const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network, client: new ExactEvmScheme(account) }] });

const t0 = Date.now();
const q = await (await fetch(`${base}/v1/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ oldid, tier: "opening" }) })).json();
console.log("quote", JSON.stringify({ id: q.quote_id, title: q.article?.title, cited: q.claims_cited, max: q.max_price_usd }));
const r = await pay(`${base}/v1/openings/${q.quote_id}`, { method: "POST" });
const receipt = r.headers.get("payment-response") || r.headers.get("x-payment-response");
const body = await r.json();
console.log("status", r.status, "seconds", (Date.now() - t0) / 1000);
if (receipt) console.log("settlement", JSON.stringify(decodePaymentResponseHeader(receipt)));
console.log(JSON.stringify({ result_id: body.result_id, summary: body.summary, billing: body.billing, error: body.error }, null, 1));
