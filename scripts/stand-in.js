// Test only: lays a composed /non row (the se-183b34 re-run from its own readings) into the specimen's S7 ledger slot, so
// the opening and portable tiers can be exercised on the composed path before a live run exists. The stand-in is named
// in the ledger record; nothing it produces is a reading of the specimen's entity.
import { cpSync, readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { quote } from "../src/run.js";
import { fromNonRow } from "../src/s7/input.js";
import { runS7 } from "../src/s7/run.js";
import { STORE, save } from "../src/util.js";

process.env.GNOSIS_READER = "replay";
const [tier = "portable"] = process.argv.slice(2);
const q = await quote(1361634710, { tier });
const src = await runS7(fromNonRow("se-183b34", join(STORE, "calibration/se-183b34")), { service: { name: "SPXI-gnΩsis", version: "stand-in" } });
const V2 = "datasets/negative-of-the-negative/v2", to = join(STORE, "s7", q.s7.row, "runs", `stand-in-${q.s7.key}`, "landing");
mkdirSync(join(to, V2, "rows"), { recursive: true });
cpSync(join(src.landing.dir, V2, "ledgers/se-183b34"), join(to, V2, "ledgers", q.s7.row), { recursive: true });
const row = { ...src.row, row: q.s7.row, stand_in: "the se-183b34 re-run, laid here for testing the composed path; not a reading of this entity" };
writeFileSync(join(to, V2, "rows", `${q.s7.row}.json`), JSON.stringify(row, null, 1));
save(`s7/${q.s7.row}/by-key/${q.s7.key}.json`, { row_key: q.s7.row, entity: q.s7.row, non_url: q.s7.non_url, landing: to, composed: true, case: row.ontology.case.value, rho: row.ontology.rho.value,
  breaches: row.breaches.length, audit: { ran: false, breaches: [] }, cost_usd: 0, mode: "replay", stand_in: row.stand_in });
console.log(JSON.stringify({ laid: q.s7.row, key: q.s7.key }));
