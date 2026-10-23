// Sends queued refunds: the reserved price minus the charge for completed claims, in USDC, from the seller wallet
// to the payer the settlement named. Test network unless GNOSIS_REFUND_NETWORK says otherwise.
// Usage: node scripts/refund.js [--send]   (without --send, lists the queue)
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createWalletClient, createPublicClient, http, parseUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const STORE = (process.env.GNOSIS_STORE ? process.env.GNOSIS_STORE.replace(/\/?$/, "/") : new URL("../store/", import.meta.url).pathname);
const USDC = { "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
const send = process.argv.includes("--send");
const dir = STORE + "refunds/";
const queue = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [dir + f, JSON.parse(readFileSync(dir + f, "utf8"))]).filter(([, r]) => r.status === "queued") : [];
if (!queue.length) { console.log("no queued refunds"); process.exit(0); }
for (const [, r] of queue) console.log(`${r.quote_id}: ${r.amount_usd} USDC to ${r.to} on ${r.network}`);
if (!send) process.exit(0);

const key = process.env.GNOSIS_SELLER_KEY || JSON.parse(readFileSync(STORE + "test-wallets.json", "utf8")).seller.key;
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http() });
const pub = createPublicClient({ chain: baseSepolia, transport: http() });
for (const [path, r] of queue) {
  if (r.network !== "eip155:84532") { console.log(`${r.quote_id}: network ${r.network} not configured; left queued`); continue; }
  try {
    const hash = await wallet.writeContract({ address: USDC[r.network], abi: erc20Abi, functionName: "transfer", args: [r.to, parseUnits(r.amount_usd.toFixed(6), 6)] });
    const rc = await pub.waitForTransactionReceipt({ hash });
    Object.assign(r, { status: rc.status === "success" ? "sent" : "failed", tx: hash, sent_at: new Date().toISOString() });
  } catch (e) { Object.assign(r, { status: "queued", last_error: String(e.shortMessage || e.message || e) }); }
  writeFileSync(path, JSON.stringify(r, null, 1));
  console.log(`${r.quote_id}: ${r.status}${r.tx ? " " + r.tx : ""}${r.last_error ? " (" + r.last_error + ")" : ""}`);
}
