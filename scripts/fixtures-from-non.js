// Assembles replay recordings of every S7 pass from an existing /non row (its reading, ledgers, ontology and objects),
// so the procedure can run end to end on the row's own inputs in replay mode. The recordings are the row's agent-composed
// work, labelled as such: a replay round trip shows the pipeline carries the row whole; only a live run measures agreement.
// Usage: node scripts/fixtures-from-non.js <row> <saved-field-texts-dir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fromNonRow, NON, ARCHIVE } from "../src/s7/input.js";
import { STORE } from "../src/util.js";
import { blogId } from "../src/s7/blog.js";

const [rowKey, saved] = process.argv.slice(2);
const row = JSON.parse(readFileSync(join(NON, "rows", `${rowKey}.json`), "utf8"));
const reading = JSON.parse(readFileSync(join(NON, "traversal", rowKey, "reading.json"), "utf8"));
const ledger = JSON.parse(readFileSync(join(ARCHIVE, row.ledger.archive), "utf8"));
const fieldL = JSON.parse(readFileSync(join(ARCHIVE, row.ledger.field), "utf8"));
const input = fromNonRow(rowKey, saved);
const recorded = `assembled from /non row ${rowKey} (${(reading.reader || "").slice(0, 80)}; ${reading.pass}) for the calibration round trip`;
const out = (stage, id, o) => { const d = join(STORE, "replays/s7", rowKey, stage); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${id}.json`), JSON.stringify({ recorded, model: "replay", out: o }, null, 1)); };

// Field ids: gnosis numbers field claims F1… in the order of the field sources it reads, claims in ledger order.
const fmap = {}; let n = 0;
for (const b of input.field) for (const [id, c] of Object.entries(fieldL.field_claims)) if (c.source === b.id) fmap[id] = `F${++n}`;
// Archive ids: gnosis numbers <prefix><dep>-NN in ledger order per deposit.
const amap = {}; const per = {};
let blogN = 0;
for (const c of ledger) if (Number.isInteger(c.dep)) { per[c.dep] = (per[c.dep] || 0) + 1; amap[c.id] = `${input.prefix}${c.dep}-${String(per[c.dep]).padStart(2, "0")}`; }
  else if (c.record?.kind === "blog post") amap[c.id] = `${input.prefix}blog-${String(++blogN).padStart(2, "0")}`;
const remap = (x) => typeof x === "string" ? (fmap[x] || amap[x] || x.replace(/`([^`]+)`/g, (m, id) => `\`${fmap[id] || amap[id] || id}\``))
  : Array.isArray(x) ? x.map(remap) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ["field_claims", "field_sources"].includes(k) && !Array.isArray(v) ? undefined : remap(v)]).filter(([, v]) => v !== undefined)) : x;

const hopRe = /reached by the hop/;
const v = (x, admitted) => ({ dep: x.dep, admitted, strata: x.strata || [], cands: admitted ? x.cands || [] : [], reason: x.reason, lineage: x.lineage || null });
const na = reading.not_admitted.flatMap((x) => (Array.isArray(x.dep) ? x.dep : [x.dep]).map((dep) => ({ ...x, dep })));
const dro = [...reading.verdicts.filter((x) => !hopRe.test(x.reason)).map((x) => v(x, true)), ...na.filter((x) => !/^Hop/.test(x.reason || "") && !hopRe.test(x.reason || "")).map((x) => v(x, false))];
// Blog records the row admitted outside the registry enter as D verdicts on their blog keys.
const blogRecs = ledger.filter((c) => c.record?.kind === "blog post");
for (const url of [...new Set(blogRecs.map((c) => c.record.url))]) dro.push({ dep: `blog:${url}`, admitted: true, strata: ["D"], cands: [], reason: JSON.stringify(reading.archive_records_outside_the_registry || "a blog record the row admitted").slice(0, 400), lineage: blogRecs.find((c) => c.record.url === url).lineage });
const hop = [...reading.verdicts.filter((x) => hopRe.test(x.reason)).map((x) => ({ ...v(x, true), reason: x.reason.replace(/^.*?reached by the hop \([^)]*\)\.\s*/, "") })), ...na.filter((x) => /^Hop/.test(x.reason || "") || hopRe.test(x.reason || "")).map((x) => v(x, false))];
for (const p of [1, 2]) { out("admit-dro", `all-pass${p}`, { verdicts: dro }); out("admit-hop", `all-pass${p}`, { verdicts: hop }); }

const byDep = {};
for (const c of ledger) if (Number.isInteger(c.dep)) (byDep[c.dep] ||= []).push({ quote: c.quote, locus: c.locus, claim: c.claim, kind: c.kind, modality: c.modality, kernel: !!c.kernel, const: !!c.const, lineage: c.lineage });
for (const [dep, claims] of Object.entries(byDep)) out("extract-archive", dep, { claims });
for (const url of [...new Set(blogRecs.map((c) => c.record.url))]) out("extract-archive", blogId(`blog:${url}`), { claims: blogRecs.filter((c) => c.record.url === url).map((c) => ({ quote: c.quote, locus: c.locus, claim: c.claim, kind: c.kind, modality: c.modality, kernel: !!c.kernel, const: !!c.const, lineage: c.lineage })) });
for (const b of input.field) out("extract-field", b.id, { claims: Object.values(fieldL.field_claims).filter((c) => c.source === b.id).map((c) => ({ quote: c.quote.replace(/^"|"$/g, ""), locus: c.locus, claim: c.claim, kind: c.kind, modality: c.modality, kernel: !!c.kernel, const: !!c.const, lineage: c.lineage })) });

const o = row.ontology;
const onto = remap({ E_F: o.E_F, E_A: o.E_A, rho: o.rho, case: o.case, translation: (o.translation || []).map(({ received, ...t }) => t), t_alignment: [] });
out("ontology", "pass1", onto); out("ontology", "pass2", onto);
const ob = row.objects;
out("compose", "pass1", remap({ KO: { title: ob.KO.title, sentences: ob.KO.sentences }, P: { title: ob.P.title, lede: ob.P.lede, sections: ob.P.sections, open: ob.P.open, rail: ob.P.rail },
  KO_B: { title: ob.KO_B.title, sentences: ob.KO_B.sentences }, P_B: { title: ob.P_B.title, lede: ob.P_B.lede, sections: ob.P_B.sections, rail: ob.P_B.rail }, kernel: row.kernel, channel: [] }));
out("delta", "pass1", remap({ T_vs_LB: row.delta?.T_vs_LB, LB_vs_LBA: row.delta?.LB_vs_LBA }));
console.log(JSON.stringify({ row: rowKey, dro: dro.length, hop: hop.length, archive_deps: Object.keys(byDep).length, field_sources: input.field.length, field_ids_mapped: Object.keys(fmap).length, archive_ids_mapped: Object.keys(amap).length }));
