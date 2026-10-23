// The about/by screen measured against readings (ChatGPT, 2026-10-21: "measure its missed-bearing rate against read
// examples"). For every /non row with a reading, the row's entity is divided as if it were an author in the archive,
// and the deposits the row's reading admitted at D, R and O are looked for among those the division sends to reading.
// A deposit the reading admitted and the division would only have scanned is missed bearing, listed with its reason.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NON, fromNonRow } from "../src/s7/input.js";
import { traverse } from "../src/s7/traverse.js";
import { blogPass } from "../src/s7/blog.js";
import { divide } from "../src/s7/about.js";
import { isByline } from "../src/s7/reading.js";
const out = [];
for (const d of readdirSync(join(NON, "traversal")).sort()) {
  const rp = join(NON, "traversal", d, "reading.json");
  if (!existsSync(rp) || !existsSync(join(NON, "rows", `${d}.json`))) continue;
  const reading = JSON.parse(readFileSync(rp, "utf8"));
  const admitted = [...new Set((reading.verdicts || []).filter((v) => Number.isInteger(v.dep) && !/reached by the hop|admitted at the hop/i.test(v.reason || "") && !(v.strata || []).includes("H")).map((v) => v.dep))];
  if (!admitted.length) continue;
  let input; try { input = fromNonRow(d, null); } catch (e) { out.push({ row: d, error: String(e.message).slice(0, 100) }); continue; }
  const trav = traverse(input), blog = blogPass(input);
  const dv = divide(input, [...trav.D, ...trav.R, ...trav.O, ...blog.D], isByline, { force: true });
  const readSet = new Set(dv.read.map((c) => c.dep));
  const missed = admitted.filter((x) => !readSet.has(x));
  const why = Object.fromEntries(missed.map((x) => [x, Object.entries(dv.scanned.excluded).find(([, v]) => v.includes(x))?.[0] || "not a candidate in this traversal"]));
  out.push({ row: d, admitted: admitted.length, read_by_division: admitted.length - missed.length, missed, why, division_reads: readSet.size, division_scans: dv.scanned.deposits });
  console.error(d, admitted.length - missed.length, "/", admitted.length);
}
const rows = out.filter((r) => r.admitted);
const A = rows.reduce((n, r) => n + r.admitted, 0), K = rows.reduce((n, r) => n + r.read_by_division, 0);
console.log(JSON.stringify({ rows: rows.length, admitted: A, read_by_division: K, recall: Math.round((K / A) * 1000) / 1000, per_row: out }, null, 1));
