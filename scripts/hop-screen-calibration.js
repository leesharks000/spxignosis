// The hop screen scored on every /non row whose reading admitted deposits by the hop: from the deposits the row admitted
// at D, R and O, the hop is run and screened; recall is the share of the row's hop admissions the screen passes to reading.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NON, fromNonRow } from "../src/s7/input.js";
import { traverse } from "../src/s7/traverse.js";
import { hopScreen } from "../src/s7/reading.js";
const out = [];
for (const d of readdirSync(join(NON, "traversal"))) {
  const rp = join(NON, "traversal", d, "reading.json"), sp = join(NON, "traversal", d, "summary.json");
  if (!existsSync(rp) || !existsSync(sp) || !existsSync(join(NON, "rows", `${d}.json`))) continue;
  const reading = JSON.parse(readFileSync(rp, "utf8"));
  const hopAdm = (reading.verdicts || []).filter((v) => (/reached by the hop|admitted at the hop/i.test(v.reason || "") || (v.strata || []).includes("H")) && Number.isInteger(v.dep)).map((v) => v.dep);
  if (!hopAdm.length) continue;
  let input; try { input = fromNonRow(d, null); } catch (e) { out.push({ row: d, error: String(e.message).slice(0, 80) }); continue; }
  const dro = reading.verdicts.filter((v) => !hopAdm.includes(v.dep) && Number.isInteger(v.dep));
  const trav = traverse(input);
  const cands = [...trav.D, ...trav.R, ...trav.O];
  const passages = dro.flatMap((v) => cands.filter((c) => c.dep === v.dep && (v.cands || []).includes(c.cand_id)).map((c) => c.sentence));
  const travH = traverse(input, { hopFrom: dro.map((v) => v.dep) });
  const s = hopScreen(input, travH, passages);
  const passed = hopAdm.filter((dep) => s.screened.some((x) => x.h.dep === dep));
  const reached = hopAdm.filter((dep) => travH.H.some((h) => h.dep === dep));
  out.push({ row: d, hop_admitted: hopAdm.length, reached_by_hop_now: reached.length, passed_screen: passed.length, missed: hopAdm.filter((x) => !passed.includes(x)), hop_candidates: new Set(travH.H.map((h) => h.dep)).size, screened: s.screened.length });
}
console.log(JSON.stringify(out, null, 1));
