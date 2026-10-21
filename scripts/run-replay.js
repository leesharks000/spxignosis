// Runs one tier end to end with the replay reader: quote, opening, the /non row where the tier composes one, the package.
// For tests; no payment.
import { quote, runOpening } from "../src/run.js";
const [oldid = "1361634710", tier = "portable"] = process.argv.slice(2);
process.env.GNOSIS_READER = "replay";
const q = await quote(Number(oldid), { tier });
const r = await runOpening(q.quote_id);
const s = r.composition.entries.map((e) => `${e.id}:${e.status}${e.archive ? "+arch" + e.archive.claims.length : ""}${e.differs ? "[" + e.differs.join(",") + "]" : ""}`);
console.log(JSON.stringify({ tier, quote: q.quote_id, max_price_usd: q.max_price_usd, s7_quote: q.s7 ? { price_usd: q.s7.price_usd, ledgered: q.s7.ledgered, estimate: q.s7.estimate } : null,
  result: r.result_id, reused: r.reused, summary: r.composition.summary, non: r.composition.non || null, entries: s,
  billing: r.record?.billing, portable: r.portable_dir || null, portable_breaches: r.record?.portable?.breaches || null }, null, 1));
