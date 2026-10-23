// Generates two test-network wallets (seller and buyer) into store/test-wallets.json. Test network only.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
const p = new URL("../store/test-wallets.json", import.meta.url).pathname;
if (!existsSync(p)) {
  const mk = () => { const k = generatePrivateKey(); return { key: k, address: privateKeyToAccount(k).address }; };
  writeFileSync(p, JSON.stringify({ network: "eip155:84532 (Base Sepolia, test only)", seller: mk(), buyer: mk() }, null, 1));
}
const w = JSON.parse(readFileSync(p, "utf8"));
console.log("seller (receives):", w.seller.address, "\nbuyer (needs test USDC):", w.buyer.address);
