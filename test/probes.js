// Probes: the review of Appendix B (2026-10-21) and the S7 build. Each must hold; exits 1 on any failure.
// Usage: node test/probes.js <result_id with a composed opening or none>   (GNOSIS_STORE names the store)
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { reconcile } from "../src/validate.js";
import { windows } from "../src/window.js";
import { claimKey } from "../src/run.js";
import { fromNonRow, NON } from "../src/s7/input.js";
import { traverse } from "../src/s7/traverse.js";
import { hopScreen } from "../src/s7/reading.js";
import { runS7 } from "../src/s7/run.js";
import { checkComposition } from "../src/s7/checks.js";
import { calibrate } from "../src/s7/calibrate.js";
import { packageRow } from "../src/writer.js";
import { audit } from "../src/s7/compose.js";
import { passLog } from "../src/s7/model.js";
import { publicationState } from "../src/s7/publish.js";
import { fromEntity } from "../src/s7/input.js";
import { constructArticle, asClaims } from "../src/s7/construct.js";
import { isByline } from "../src/s7/reading.js";
import { compactLedger } from "../src/s7/lineage.js";

let fail = 0;
const t = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) fail++; };
const STORE = process.env.GNOSIS_STORE || "store";

// 1. reconcile: authority alone separates two readings.
const r = { support: ["supported"], attributization: { converted: true, retains_authority: true } };
const r2 = structuredClone(r); r2.attributization.retains_authority = false;
t("reconcile: authority alone separates two readings", reconcile(r, r2).differs?.includes("authority"));
t("reconcile: identical readings agree", reconcile(r, structuredClone(r)).status === "concordant");

// 2. ledger: a replay reading and a live reading never share a key.
const claim = { id: "W2", text_sha256: "h" }, srcs = [{ text_sha256: "s" }];
t("ledger: replay and live keys differ", claimKey(claim, srcs, "m", { id: "replay/x", mode: "replay" }) !== claimKey(claim, srcs, "m", { id: "anthropic:m/x", mode: "live" }));

// 3. windowing: a wider window carries more text (the expansion re-read).
const text = Array.from({ length: 800 }, (_, i) => `Paragraph ${i} on syllogizing and the treatment of refutation, part ${i}.`).join("\n\n");
const len = (w) => w.passages.reduce((n, p) => n + p.text.length, 0);
t("windowing: the expansion window carries more text", len(windows(text, "syllogizing refutation", { size: 3000, keep: 8 })) > len(windows(text, "syllogizing refutation")));

// 4. S7 on the archive's own row: traversal, hop screen, round trip, calibration, checks.
const SAVED = `${STORE}/calibration/se-183b34`;
if (!existsSync(SAVED)) console.log("skip S7 calibration probes: no saved field texts for se-183b34 in the store");
else {
  const input = fromNonRow("se-183b34", SAVED);
  // The texts saved on 2026-10-20 were lost with the container on 2026-10-21 and re-fetched; the extractor differs, so
  // most hashes differ while the pages hold the same text. The probe asks that every field quote stands in its text, and
  // records the hash state.
  const rowJ = JSON.parse(readFileSync(`${NON}/rows/se-183b34.json`, "utf8"));
  const { ARCHIVE } = await import("../src/s7/input.js");
  const fl = JSON.parse(readFileSync(`${ARCHIVE}/${rowJ.ledger.field}`, "utf8")).field_claims;
  const norm = (s) => String(s || "").normalize("NFC").replace(/\s+/g, " ").toLowerCase();
  const quotes = Object.values(fl).filter((c) => c.quote);
  t("input: every field quote of the row stands in its saved field text", quotes.length > 0 && quotes.every((c) => norm(input.field.find((b) => b.id === c.source)?.text).includes(norm(c.quote))));
  console.log(`     field texts: ${input.field.filter((b) => b.text_sha256 === b.expected_sha256).length} of ${input.field.length} match the hash recorded 2026-10-20 (re-fetched 2026-10-21)`);
  const trav = traverse(input);
  const ex = JSON.parse(readFileSync(`${NON}/traversal/se-183b34/summary.json`, "utf8"));
  t("traversal: D, R and O candidates reproduce the row's files byte for byte", ["candidates-D.jsonl", "candidates-R.jsonl", "candidates-O.jsonl"].every((f) => trav.files[f] === ex.sha256[f]));
  const reading = JSON.parse(readFileSync(`${NON}/traversal/se-183b34/reading.json`, "utf8"));
  const dro = reading.verdicts.filter((v) => !/reached by the hop/.test(v.reason));
  const cands = [...trav.D, ...trav.R, ...trav.O];
  const passages = dro.flatMap((v) => cands.filter((c) => c.dep === v.dep && v.cands.includes(c.cand_id)).map((c) => c.sentence));
  const hs = hopScreen(input, traverse(input, { hopFrom: dro.map((v) => v.dep) }), passages);
  t("hop screen: every deposit the row admitted by hop passes the screen (#1582, #1587, #1590)", [1582, 1587, 1590].every((d) => hs.screened.some((x) => x.h.dep === d)));
  const prev = process.env.GNOSIS_READER; process.env.GNOSIS_READER = "replay";
  const out = await runS7(input, { service: { name: "SPXI-gnΩsis", version: "probe" } });
  process.env.GNOSIS_READER = prev;
  const cal = calibrate("se-183b34", out.landing.dir);
  t("round trip: admission, archive claims and field claims recovered whole (replay of the row's own readings)", [cal.admission, cal.archive_claims, cal.field_claims].every((x) => x.precision === 1 && x.recall === 1));
  t("round trip: case and ρ read back (equal, extends)", cal.case.got === "equal" && cal.rho.got === "extends");
  t("round trip: the measure reproduces the row's block sequence", cal.composition.blocks.got === cal.composition.blocks.want);
  t("round trip: no unknown claim ids, no uncovered claims, no structural breach", !out.row.breaches.some((b) => ["claim-id", "coverage", "structure", "reversibility"].includes(b.check)));
  // 5. composition checks: the empty object, the invented sentence, a claim left out, a quote not found.
  const fc = out.run.field.claims, al = out.run.arch.ledger, base = out.run.composition;
  const empty = { KO: { sentences: [] }, P: { lede: { text: "", claims: [] }, sections: [], rail: [] }, KO_B: { sentences: [] }, P_B: { lede: { text: "", claims: [] }, sections: [], rail: [] } };
  t("checks: an empty composition is a breach (structure, coverage)", ["structure", "coverage"].every((k) => checkComposition(empty, { fieldClaims: fc, archiveLedger: al, caseValue: "equal" }).breaches.some((b) => b.check === k)));
  const glass = structuredClone(base); glass.KO.sentences[1].text = "The Moon is made of glass, as every astronomer has long agreed.";
  t("checks: 'The Moon is made of glass' cited to real claims is a breach (grounding)", checkComposition(glass, { fieldClaims: fc, archiveLedger: al, caseValue: "equal" }).breaches.some((b) => b.check === "grounding (heuristic)" && b.at === "KO2"));
  const drop = structuredClone(base); drop.KO.sentences = drop.KO.sentences.slice(1); drop.P.lede.claims = []; drop.P.rail = []; drop.P.sections = [];
  t("checks: claims left out of the composition are a breach (coverage)", checkComposition(drop, { fieldClaims: fc, archiveLedger: al, caseValue: "equal" }).breaches.some((b) => b.check === "coverage"));
  const al2 = al.map((c, i) => (i === 0 ? { ...c, quote_ok: false } : c));
  t("checks: citing a claim whose quote was not found is a breach", checkComposition(base, { fieldClaims: fc, archiveLedger: al2, caseValue: "equal" }).breaches.some((b) => b.check === "quote"));
  // 6. the portable package from the row: licence, marks.
  const pkg = packageRow(out.row, al, { result_id: "R-probe", service: { name: "SPXI-gnΩsis", version: "probe" }, article: { title: "Sophistical Refutations", oldid: 1, url: "https://en.wikipedia.org/" }, rowUrl: "https://www.alexanarch.org/non/se-183b34/",
    audit: { ran: true, agreement: 1, breaches: [{ check: "reverse-entailment", at: "KO3" }] } });
  t("package: the knowledge object is released CC BY 4.0, the article's sentences marked CC BY-SA 4.0", /CC BY 4\.0/.test(pkg.files["LICENSE.txt"]) && /CC BY-SA 4\.0/.test(pkg.files["LICENSE.txt"]));
  t("package: a unit the audit marks is marked in place", pkg.files["article.md"].includes("[not entailed by its cited claims") && pkg.flagged.includes("KO3"));
  // 7. the review of v0.9 (2026-10-21).
  const emptyRaters = { calls: [], run: async () => ({ units: [] }) };
  const au = await audit(emptyRaters, input, base, out.run.checks.byId);
  t("audit: raters that return no judgments make the audit incomplete, never clean", au.ran && !au.complete && au.breaches.some((b) => b.check === "audit-incomplete") && au.missing.length === au.units);
  const ledePkg = packageRow(out.row, al, { result_id: "R-probe", service: { name: "SPXI-gnΩsis", version: "probe" }, article: { title: "x", oldid: 1, url: "https://en.wikipedia.org/" }, rowUrl: "u",
    audit: { ran: true, complete: true, agreement: 1, breaches: [{ check: "reverse-entailment", at: "P-lede" }] } });
  const ledeLine = ledePkg.files["article.md"].split("\n").find((l) => l.startsWith("**"));
  t("package: a marked lede is marked beside the lede, and its claims are in the bibliography", ledeLine.includes("[not entailed") && (out.row.objects.P.lede.claims || []).every((c) => !out.run.checks.byId[c] || ledePkg.files["article.md"].includes(`**${c}**`)));
  t("package: JSON-LD in the HTML cannot close its script element", !/<\/script>[\s\S]*<\/script>[\s\S]*<\/head>/.test(packageRow({ ...out.row, objects: { ...out.row.objects, KO: { ...out.row.objects.KO, title: "</script><b>x" } } }, al, { result_id: "R", service: { name: "s", version: "v" }, article: { title: "t", oldid: 1, url: "u" }, rowUrl: "u", audit: null }).files["article.html"].split("<body>")[0]));
  const out2 = await (async () => { process.env.GNOSIS_READER = "replay"; const o = await runS7({ ...input, aliases: [...input.aliases] }, { service: { name: "SPXI-gnΩsis", version: "probe-2" } }); process.env.GNOSIS_READER = prev; return o; })();
  t("landing: each opening keeps its own tree under its execution key", out2.landing.dir.includes(`/runs/${out2.run.key}/`) && existsSync(out.landing.dir));
  const pub = await publicationState({ composed: true, row_key: "se-183b34", non_url: "u", manifest: out.landing.manifest, audit: { ran: false } }, { fetchPublic: false });
  t("publication: a row the archive does not hold with the landing tree's hash is not reported landed", pub.state === "composed" && pub.stages.landed === false);
  const reg = fromNonRow("ai-overview-capture-registry", null);
  const rr = JSON.parse(readFileSync(`${NON}/traversal/ai-overview-capture-registry/reading.json`, "utf8"));
  const tr2 = traverse(reg), c2 = [...tr2.D, ...tr2.R, ...tr2.O];
  const dro2 = rr.verdicts.filter((v) => Number.isInteger(v.dep) && !(v.strata || []).includes("H"));
  const hs2 = hopScreen(reg, traverse(reg, { hopFrom: dro2.map((v) => v.dep) }), dro2.flatMap((v) => c2.filter((c) => c.dep === v.dep && (v.cands || []).includes(c.cand_id)).map((c) => c.sentence)));
  t("hop screen: a deposit whose bearing stands in the admitted deposit's citing paragraph passes (#716, #740 by #1694)", [716, 740].every((d) => hs2.screened.some((x) => x.h.dep === d)));
}

// 10. an entity the encyclopedia does not hold (2026-10-21: "lee sharks is not allowed in wikipedia. lee sharks is allowed in /non").
{
  const wiki = { title: "Lee Sharks", observed: true, exists: false };
  const e0 = fromEntity({ name: "Lee Sharks", aliases: ["Sharks, Lee"] }, { sources: [], wikipedia: wiki });
  t("entity: no transcript and no source gives the null composition, with the encyclopedia's absence recorded", e0.T.kind === "null" && e0.T.wikipedia.exists === false && e0.row === "lee-sharks");
  const c0 = await constructArticle(passLog(), e0);
  t("entity: with no citable source the constructed article is empty and the breach says so", c0.status === "no sources" && c0.breaches[0].check === "construction");
  const e1 = fromEntity({ name: "Lee Sharks" }, { sources: [{ url: "https://example.org/a", text: "Lee Sharks is an independent scholar and archive operator.", text_sha256: "x", availability: "fetched" }], wikipedia: wiki });
  const art = { title: "Lee Sharks", sections: [{ heading: "lead", sentences: [{ id: "W1", text: "Lee Sharks is an independent scholar.", cites: [{ source: "B1", quote: "Lee Sharks is an independent scholar" }] }] }] };
  const { claims: cl, sources: so } = asClaims(art, e1);
  t("entity: a constructed sentence becomes an S3 claim with its cited source", cl.length === 1 && cl[0].cited && so.W1[0].text.includes("independent scholar"));
  const a = [/\bLee Sharks\b/i];
  t("byline screen: a byline is screened and a claim is read", isByline("**Lee Sharks**", a) && isByline("Authors: TECHNE/Kimi, Lee Sharks.", a) && !isByline("Lee Sharks is a heteronym.", a) && !isByline("**Lee Sharks and the Archive**", a));
  const big = Array.from({ length: 4000 }, (_, i) => ({ id: `X${i}`, dep: i, date: `2026-01-${String(1 + (i % 28)).padStart(2, "0")}`, quote: "q ".repeat(30), lineage: `L${i % 50}`, kernel: i % 400 === 0 }));
  const cmp = compactLedger(big);
  t("lineage: an oversized ledger is sent one slot per lineage, every instance reachable", cmp.compacted && cmp.lineages === 50 && cmp.claims.length < 200 && cmp.claims.reduce((n, c) => n + 1 + (c.lineage_instances || []).length, 0) === 4000);
}

// 11. about and by (2026-10-21: "distinguish material about lee sharks from material by lee sharks"), and the captures as T.
{
  const { divide, topicOf, worksLedger, longerNames } = await import("../src/s7/about.js");
  const { registry } = await import("../src/s7/archive.js");
  const { capturesFor } = await import("../src/s7/input.js");
  const { blogPass } = await import("../src/s7/blog.js");
  const ls = fromEntity({ name: "Lee Sharks", works_by: ["heteronyms"] });
  const tr = traverse(ls), bl = blogPass(ls);
  const all = [...tr.D, ...tr.R, ...tr.O, ...bl.D];
  const dv = divide(ls, all, isByline);
  const allDeps = new Set(all.map((c) => c.dep)).size, readDeps = new Set(dv.read.map((c) => c.dep)).size;
  console.log(`     Lee Sharks: ${allDeps} deposits and posts name the entity; read ${readDeps} (${JSON.stringify(dv.scanned.basis)}), scanned ${dv.scanned.deposits}; works ledger ${dv.works.length}`);
  t("about/by: the archive's author is divided, and what is read is a small part of what names it", dv.mode === "about and by" && readDeps > 0 && readDeps < allDeps / 5 && dv.works.length > 500);
  t("about/by: no deposit sends more than six sentences", Object.values(dv.read.reduce((m, c) => ((m[c.dep] = (m[c.dep] || 0) + 1), m), {})).every((n) => n <= 6));
  t("about/by: a longer name that contains the entity's string is another name (Mary Lee Sharks)", longerNames(ls).includes("Mary Lee Sharks") && dv.scanned.other_names.sentences > 0);
  const reg = registry(), names = [/\bLee Sharks\b/i];
  t("about/by: a title naming the entity as its subject is about it; a byline in a title is not", topicOf(reg.get(1623), ls, names) === "title" && topicOf(reg.get(1004), ls, names) === null);
  const pod = fromEntity({ name: "Pearl and Other Poems" });
  t("about/by: an entity that is no author in the archive keeps the bearing reading", worksLedger(pod).length === 0 && divide(pod, [{ dep: 1, para: 0, sent: 0, sentence: "x" }], isByline).mode === "bearing");
  const cap = capturesFor(["Lee Sharks"]);
  t("captures: the entity's bare address yields a capture as T, the most recent with a transcript", cap.primary && cap.primary.transcript.length >= 300 && /lee sharks/i.test(cap.primary.q) && cap.bare.filter((o) => o.chars >= 300).every((o) => o.date <= cap.primary.date));
  t("captures: an entity with no capture yields none", capturesFor(["Zzyzx Quuxbaum"]).primary === null);
}

// 8. the execution budget and a failed call.
{
  const prev = process.env.GNOSIS_READER; process.env.GNOSIS_READER = "anthropic"; const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  const lb = passLog({ budget_usd: 0 }); const r0 = await lb.run({ row: "x", stage: "s", id: "1", system: "", task: "", model: "claude-haiku-5-5" });
  t("budget: a pass beyond the execution budget is recorded as not run", r0 === null && lb.exhausted());
  const lf = passLog(); const r1 = await lf.run({ row: "x", stage: "s", id: "1", system: "", task: "", model: "claude-haiku-5-5" });
  t("failure: a failed call is recorded with its error and the run continues", r1 === null && lf.calls[0].how.startsWith("failed:"));
  process.env.GNOSIS_READER = prev; if (key) process.env.ANTHROPIC_API_KEY = key;
}

// 9. a portable result's package: manifest hashes match files.
const [rid] = process.argv.slice(2);
if (rid && existsSync(`${STORE}/results/${rid}/portable/manifest.json`)) {
  const dir = `${STORE}/results/${rid}/portable/`;
  const man = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
  t("portable: every manifest hash matches its file", Object.entries(man.files).every(([n, h]) => createHash("sha256").update(readFileSync(dir + n)).digest("hex") === h));
}
process.exit(fail ? 1 : 0);
