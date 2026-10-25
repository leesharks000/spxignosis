// Probes: the review of Appendix B (2026-10-21) and the S7 build. Each must hold; exits 1 on any failure.
// Usage: node test/probes.js <result_id with a composed opening or none>   (GNOSIS_STORE names the store)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { reconcile, validateReading } from "../src/validate.js";
import { normalizeReading, INSTRUCTIONS, READER_PROTOCOL } from "../src/reader.js";
import { windows } from "../src/window.js";
import { claimKey, withArticleSources } from "../src/run.js";
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
const savedCands = (row) => ["D", "R", "O"].flatMap((k) => { try { return readFileSync(`${NON}/traversal/${row}/candidates-${k}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } });

let fail = 0;
const t = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) fail++; };
const STORE = process.env.GNOSIS_STORE || "store";

// 1. reconcile: authority alone separates two readings.
const r = { support: ["supported"], attributization: { converted: true, retains_authority: true } };
const r2 = structuredClone(r); r2.attributization.retains_authority = false;
t("reconcile: authority alone separates two readings (a 0.4 reading, normalized)", reconcile(r, r2).differs?.includes("authority"));
t("reconcile: identical readings agree", reconcile(r, structuredClone(r)).status === "concordant");

// 1a. The v1.1 reading (gnosis-S3/0.5, EA-WIKI-OPEN-01 v1.1 §5.3 S3, §6.3 (c), §9.7).
{
  const base = { support: ["partially-supported"], attributization: { value: "partial" }, retained_authority: { value: "mixed" }, invitation: { codes: ["omitted"] } };
  const inv = structuredClone(base); inv.invitation.codes = ["omitted", "answered-in-source-name"];
  const rc = reconcile(base, inv);
  t("reconcile: readings that differ only on the invitation codes concur; the difference is recorded, not counted (prospective)", rc.status === "concordant" && !!rc.invitation_differs);
  const attr = structuredClone(base); attr.attributization.value = "no";
  t("reconcile: partial against no attributization is contested", reconcile(base, attr).differs?.includes("attributization"));
  const ra = structuredClone(base); ra.retained_authority.value = "retained";
  t("reconcile: mixed against retained authority is contested", reconcile(base, ra).differs?.includes("authority"));
  const old = normalizeReading({ attributization: { converted: true, retains_authority: false }, paraphrase: { scope_changes: ["bounded"], introduced: [] } });
  t("normalize: a 0.4 reading reads as attributization yes, authority lost, its scope change a delta", old.attributization.value === "yes" && old.retained_authority.value === "lost" && old.paraphrase.deltas[0].kind === "scope");
  const sha = (x) => createHash("sha256").update(x).digest("hex");
  const cl = { text: "He identified thirteen kinds.", cited: false }; cl.text_sha256 = sha(cl.text);
  const src = { S1: { text: "Aristotle divides sophistical refutations into six kinds dependent on language and seven that are not. The list is complete." } };
  const shown = { S1: "Aristotle divides sophistical refutations into six kinds dependent on language and seven that are not." };
  const rd = (q, where = ["elsewhere in the article"]) => ({ claim_id: "W1", support: ["supported"], support_source: where, spans: [{ quote: q, source_ref: "S1", role: "support" }], paraphrase: { defensible: "x", deltas: [] }, attributization: { value: "no" } });
  const v1 = validateReading(rd("The list is complete."), cl, src, shown);
  t("validate: a quotation in the source but outside the passages sent is recorded and does not withhold the pass", v1.ok && v1.breaches.some((b) => b.check === "quote-outside-passages"));
  const v2 = validateReading(rd("The list is incomplete."), cl, src, shown);
  t("validate: a quotation found nowhere in the source withholds the pass", !v2.ok && v2.breaches.some((b) => b.check === "quote-in-source"));
  const v3 = validateReading(rd("six kinds dependent on language", ["at the sentence"]), cl, src, shown);
  t("validate: support placed at the sentence for a sentence that cites nothing is recorded", v3.breaches.some((b) => b.check === "support-located"));
  const sources = withArticleSources([{ id: "W1", text: "Aristotle identified thirteen kinds of sophistical refutation.", cited: false }, { id: "W5", text: "Chapters on tactics for the Questioner.", cited: true }],
    { W5: [{ kind: "footnote", url: "k", text_sha256: "k", text: "In Chapter 4, sophistical refutations are divided into two groups; thirteen kinds in all." }, { kind: "footnote", url: "z", text_sha256: "z", text: "Bees and honey production in alpine meadows." }] });
  t("article sources: an uncited sentence receives the article's sources that bear on it, marked elsewhere in the article", sources.W1.length === 1 && sources.W1[0].url === "k" && sources.W1[0].located === "elsewhere in the article");
  t("article sources: a cited sentence keeps its own sources first, marked at the sentence", sources.W5[0].located === "at the sentence" && sources.W5.filter((x) => x.located === "at the sentence").length === 2);
  // 0.12.0: the store is layered (this process's writes, the committed seed, Vercel Blob where configured).
  {
    const U = await import("../src/util.js");
    const k = `probe-store/${Date.now()}.json`;
    await U.save(k, { a: 1 });
    t("store: a record written is read back, and a missing one is null", (await U.load(k))?.a === 1 && (await U.load("probe-store/none.json")) === null);
    t("store: a directory lists what was written to it", (await U.list("probe-store")).includes(k.split("/")[1]));
    t("store: the committed seed is readable from any store (the policy texts)", existsSync(U.SEED + "/policies") && (U.STORE === U.SEED || (await U.list("policies")).length > 0));
    t("store: without a Blob token the service uses the local store only", U.BLOB === !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID));
    const src = readFileSync(new URL("../src/run.js", import.meta.url), "utf8") + readFileSync(new URL("../src/sentence.js", import.meta.url), "utf8") + readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
    t("store: no await binds to a property of a pending read (await load(x)?.y)", !/(?<!\()await (load|save)\(`[^`]*`\)\?\./.test(src));
  }
  // 2026-10-23: archive-grounded sentences, from a commissioned row, at two cents over the sentence.
  {
    const { groundingFor } = await import("../src/grounding.js");
    const { POLICY: PO, priceClaim: pc } = await import("../src/cost.js");
    const { STORE: ST, save: sv } = await import("../src/util.js");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const land = join(ST, "probe-landing"), V = "datasets/negative-of-the-negative/v2";
    mkdirSync(join(land, V, "rows"), { recursive: true }); mkdirSync(join(land, V, "ledgers", "probe-row"), { recursive: true });
    writeFileSync(join(land, V, "rows", "probe-row.json"), JSON.stringify({ objects: { T: { url: "https://en.wikipedia.org/w/index.php?oldid=42", claims: ["W1 Aristotle had nothing to say of syllogizing.", "W2 A sentence the archive does not touch."] } },
      ontology: { t_alignment: [{ t: "W1", bears: "qualifies", note: "the claim is a priority claim", archive_claims: ["A1", "A9"] }] } }));
    writeFileSync(join(land, V, "ledgers", "probe-row", "ledger-archive.json"), JSON.stringify([{ id: "A1", dep: 1697, quote: "q" }]));
    await sv("s7/probe-row/by-key/k-old.json", { complete: true, landing: land, key: "k-old", release: { commit: "r1" }, created: "2026-10-01T00:00:00Z", non_url: "u" });
    await sv("s7/probe-row/by-key/k-partial.json", { complete: false, landing: land, key: "k-partial", created: "2026-10-22T00:00:00Z" });
    const g = await groundingFor("probe-row", "Aristotle had  nothing to say of syllogizing.[3]", { commit: "r2" });
    t("grounded: a sentence held in a complete commissioned row is served its alignment, with the archive claims the row's ledger holds", g?.sentence_id === "W1" && g.archive.bears === "qualifies" && g.archive.claims.length === 1 && g.archive.claims[0].url.endsWith("/records/1697/") && g.revision === "42");
    t("grounded: the row's release is disclosed beside the current one, and a moved archive is said", g.release === "r1" && g.current_release === "r2" && g.archive_moved === true && /recomposes/.test(g.note));
    t("grounded: a sentence the alignment does not touch is served as none recorded", (await groundingFor("probe-row", "A sentence the archive does not touch."))?.archive.bears === "none recorded");
    t("grounded: no row holding the sentence, no grounding (the commission is offered instead)", (await groundingFor("probe-row", "Nothing like this is in T.")) === null && (await groundingFor("no-such-row", "x")) === null);
    const { sentencePrice: sp } = await import("../src/sentence.js");
    t("grounded: a grounded sentence costs its opening and two cents; with its reading already ledgered, the two cents alone", sp({ tier: "ledger", est: 0.02, ledgered: false, grounded: true }) === 0.07 && sp({ tier: "ledger", est: 0, ledgered: true, grounded: true }) === 0.02 && sp({ tier: "ledger", est: 0.02, ledgered: false, grounded: false }) === 0.05);
  }
  // 2026-10-23: sentences in cents, the archive on commission only.
  {
    const { POLICY: PO, priceClaim: pc, estimateClaim: ec } = await import("../src/cost.js");
    const { ADMITS: AD } = await import("../src/run.js");
    const { SECOND } = await import("../src/reader.js");
    t("tiers: the archive is consulted on commission only, never at an opening", !AD.has("opening") && AD.has("commission") && AD.has("portable"));
    t("price: a sentence opening is listed at five cents, raised only where the estimate times the sentence margin passes it; a ledgered one is a cent", pc("opening", 0.02, false) === 0.05 && pc("opening", 0.034, false) === 0.06 && pc("opening", 0, true) === 0.01);
    t("price: a preliminary reading is listed at a cent", pc("check", ec("claude-haiku-5-5", 7195, 1200, 0), false) === 0.01);
    t("price: a sentence with long sources is raised above its list price, at the sentence margin", pc("opening", 0.06, false) === Math.ceil(0.06 * PO.sentence_margin * 100) / 100);
    t("reader: the second pass returns the reconciled fields only", /attributization/.test(SECOND) && /retained_authority/.test(SECOND) && !/five_part/.test(SECOND));
  }
  t("instructions: the S3 rules of v1.1 are in the reader's instructions", READER_PROTOCOL === "gnosis-S3/0.6" && ["innocent reading", "never by itself supports fidelity", "species put for its genus", "answered-in-source-name", "elsewhere in the article", "primary-text adequacy"].every((k) => INSTRUCTIONS.includes(k)));
}

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
  // The archive grows, and a later deposit that names the row's strings adds candidates and renumbers their ids; the
  // row's files are a record of the archive at its release. What must hold at any later release: every candidate the
  // row holds is produced again (same deposit, same sentence); what later deposits add is reported, never compared.
  const sig = (c) => `${c.dep}|${String(c.sentence || "").slice(0, 200)}`;
  const savedSe = savedCands("se-183b34"), nowSe = new Set([...trav.D, ...trav.R, ...trav.O].map(sig));
  const lostSe = savedSe.filter((c) => !nowSe.has(sig(c)));
  t("traversal: every candidate the row's files hold is produced again at the archive's current release", lostSe.length === 0);
  const sameRelease = ["candidates-D.jsonl", "candidates-R.jsonl", "candidates-O.jsonl"].every((f) => trav.files[f] === ex.sha256[f]);
  console.log(`     traversal: ${sameRelease ? "byte-identical to the row's files" : `${[...trav.D, ...trav.R, ...trav.O].filter((c) => !savedSe.some((x) => sig(x) === sig(c))).length} candidates added since the row's release, from #${[...new Set([...trav.D, ...trav.R, ...trav.O].filter((c) => !savedSe.some((x) => sig(x) === sig(c))).map((c) => c.dep))].join(", #")}`}`);
  const reading = JSON.parse(readFileSync(`${NON}/traversal/se-183b34/reading.json`, "utf8"));
  const dro = reading.verdicts.filter((v) => !/reached by the hop/.test(v.reason));
  const cands = [...trav.D, ...trav.R, ...trav.O];
  // A reading's candidate ids belong to the traversal it read: they are resolved against the row's saved files.
  const passages = dro.flatMap((v) => savedSe.filter((c) => c.dep === v.dep && v.cands.includes(c.cand_id)).map((c) => c.sentence));
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
  const saved2 = savedCands("ai-overview-capture-registry");
  const hs2 = hopScreen(reg, traverse(reg, { hopFrom: dro2.map((v) => v.dep) }), dro2.flatMap((v) => saved2.filter((c) => c.dep === v.dep && (v.cands || []).includes(c.cand_id)).map((c) => c.sentence)));
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

// 12. discernment (2026-10-21: "careful on admitting a supplied composition. that would open /non to any kind of
// falsification"; "there has to be some kind of evaluation/verification"; "it is fine to construct novel entities as long
// as they are marked as such").
{
  const { discern } = await import("../src/s7/discern.js");
  const { checkSupplied } = await import("../src/run.js");
  const { provenanceOf } = await import("../src/s7/row.js");
  const page = { url: "https://example.org/p", final_url: "https://example.org/p", retrieved: "2026-10-21T00:00:00Z", text: "Lee Sharks is a poet and archive operator in Michigan. He wrote Pearl and Other Poems in 2014.", text_sha256: "x" };
  const good = { name: "Lee Sharks", address: "who is lee sharks", transcript: { text: "Lee Sharks is a poet and archive operator in Michigan. He wrote \"Pearl and Other Poems\" in 2014.", surface: "Google AI Overview", date: "2026-10-20", cite_list: [{ url: page.url, title: "p" }] } };
  const d1 = discern(good, [page]);
  t("discernment: an attested composition grounded in the cards it cites is admissible, held from landing, its provenance the caller's attestation", d1.verdict === "admissible" && /attested by the caller/.test(d1.provenance) && /held/.test(d1.landing));
  const forged = { ...good, transcript: { ...good.transcript, text: "Lee Sharks was convicted of fraud in Ohio, according to \"court records filed in 2019\". He fled the state afterwards and changed names." } };
  const d2 = discern(forged, [page]);
  t("discernment: a forged composition is caught: its sentences stand in no card and its quotation in none", d2.checks.grounding.grounded === 0 && d2.breaches.some((b) => b.check === "quotation") && d2.verdict !== "admissible");
  const nocards = discern({ ...good, transcript: { ...good.transcript, cite_list: [] } }, []);
  t("discernment: an attested composition engaging no source is not admissible as T (the registry's rule)", nocards.verdict === "not admissible as T");
  const future = discern({ ...good, transcript: { ...good.transcript, date: "2099-01-01" } }, [page]);
  t("discernment: an attested date after the quote is a breach", future.breaches.some((b) => b.check === "attestation"));
  const novel = discern({ name: "The Glass Moon Society", novel: true, transcript: { text: "The Glass Moon Society is an invented reading circle." } }, []);
  t("discernment: a novel entity is admitted as the caller's construction, marked as such, never held", novel.mode === "novel entity" && /marked as such/.test(novel.provenance) && /not held/.test(novel.landing));
  let refused = false; try { checkSupplied({ name: "x", sources: [{ text: "anything at all" }] }); } catch { refused = true; }
  t("discernment: source text supplied by the caller is refused; a source is a URL the service fetches", refused);
  const mk = (T) => provenanceOf({ kind: "entity", T });
  t("provenance: every T is marked by class (seated, attested, novel, constructed, null)", mk({ capture: { slug: "s" } }).class === "seated" && mk({ supplied: true, discernment: d1 }).class === "attested" && mk({ supplied: true, discernment: novel }).class === "novel" && mk({ kind: "constructed" }).class === "constructed" && mk({ kind: "null" }).class === "null");
  const ps = await publicationState({ composed: true, row_key: "x", non_url: "u", manifest: { files: [] }, audit: { ran: false }, provenance: mk({ supplied: true, discernment: d1 }) }, { fetchPublic: false });
  t("publication: a row whose T is attested and unseated carries the landing hold", /held from landing/.test(ps.hold || ""));
}

// 13. the review of 0.6.0 (ChatGPT, 2026-10-21), each finding reproduced, then fixed.
{
  const { passLog: pl } = await import("../src/s7/model.js");
  const { makeReader } = await import("../src/reader.js");
  const { s7Key } = await import("../src/s7/run.js");
  const { settleOntology } = await import("../src/s7/ontology.js");
  const { divide } = await import("../src/s7/about.js");
  const realFetch = globalThis.fetch, prevKey = process.env.ANTHROPIC_API_KEY, prevR = process.env.GNOSIS_READER;
  const bodies = [];
  // The archive passes stream (2026-10-25): the stand-in API answers as a Messages stream.
  const sse = (text, usage) => [{ type: "message_start", message: { usage: { input_tokens: usage.input_tokens, output_tokens: 1 } } }, { type: "content_block_delta", delta: { type: "text_delta", text } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: usage.output_tokens } }].map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  globalThis.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); const s = sse("not json at all", { input_tokens: 20000, output_tokens: 4000 });
    const b = JSON.parse(opts.body);
    return b.stream ? { ok: true, status: 200, body: (async function* () { yield new TextEncoder().encode(s); })() }
      : { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "not json at all" }], usage: { input_tokens: 20000, output_tokens: 4000 } }) }; };
  process.env.ANTHROPIC_API_KEY = "test"; process.env.GNOSIS_READER = "anthropic";
  const l1 = pl(); const o1 = await l1.run({ row: "x", stage: "s", id: "1", system: "sys", task: "t", model: "claude-sonnet-5-5", maxTokens: 4000 });
  t("model: no sampling parameter is sent (Sonnet 5.5 rejects non-default values; Haiku 5.5 asks they be omitted)", bodies.every((b) => !("temperature" in b) && !("top_p" in b) && !("top_k" in b)));
  t("budget: a reply that does not parse is billed at its usage", o1 === null && l1.cost() > 0 && /did not parse/.test(l1.calls[0].how));
  const l2 = pl({ budget_usd: 0.01 }); const n0 = bodies.length;
  await l2.run({ row: "x", stage: "s", id: "1", system: "sys", task: "t", model: "claude-sonnet-5-5", maxTokens: 8000 });
  t("budget: a call whose worst case would pass the budget is not made, so a $0.01 budget spends nothing", bodies.length === n0 && l2.cost() === 0 && l2.exhausted());
  const rd = makeReader("anthropic", "claude-sonnet-5-5"); let spent = null;
  try { await rd.read({ id: "W1", text: "x", section: "lead" }, [{ text: "y", text_sha256: "h" }], { oldid: 1, title: "x" }); } catch (e) { spent = e.spent; }
  t("S3: a reading pass whose reply does not parse carries its usage to billing", spent && spent.length >= 1 && spent[0].usage.input_tokens === 20000);
  globalThis.fetch = realFetch; process.env.GNOSIS_READER = prevR; if (prevKey) process.env.ANTHROPIC_API_KEY = prevKey; else delete process.env.ANTHROPIC_API_KEY;
  const base = fromEntity({ name: "Lee Sharks" });
  t("cache: the S7 key changes with the names whose works count as the entity's", s7Key(base) !== s7Key({ ...base, works_by: ["heteronyms"] }));
  const c0 = claimKey({ text_sha256: "h" }, [{ text_sha256: "s" }], "m", { id: "a", mode: "live" }); process.env.GNOSIS_MODEL_2 = "other";
  const c1 = claimKey({ text_sha256: "h" }, [{ text_sha256: "s" }], "m", { id: "a", mode: "live" }); delete process.env.GNOSIS_MODEL_2;
  t("cache: the claim key changes with the second reader's model", c0 !== c1);
  const one = settleOntology({ passes: [{ rho: { value: "extends" }, case: { value: "equal", loci: [] }, translation: [] }, null], F: [], A: [] }, {}, []);
  t("ontology: one pass of two is a single-pass reading, kept, with a breach", one.status === "read (single pass)" && one.breaches.some((b) => b.check === "ontology-single-pass"));
  const ex = fromEntity({ name: "Example Author" });
  const dvx = divide(ex, [{ dep: 9e6, para: 0, sent: 0, sentence: "Example Author received the award in 2015." }, { dep: 9e6 + 1, para: 0, sent: 0, sentence: "Example Author (ORCID 0000-0000-0000-0000) founded the press in 2014." }], isByline, { force: true });
  t("about/by: an accomplishment is read, with an ORCID beside the name or a verb outside the closed list", dvx.read.length === 2);
  const { ARCHIVE: AR } = await import("../src/s7/input.js");
  const rowRel = "datasets/negative-of-the-negative/v2/rows/se-183b34.json";
  const want = createHash("sha256").update(readFileSync(`${AR}/${rowRel}`)).digest("hex");
  globalThis.fetch = async (url) => ({ ok: true, status: 200, text: async () => (String(url).endsWith(".json") ? "{\"row\":\"se-183b34\",\"old\":true}" : "<html>se-183b34</html>") });
  const stale = await publicationState({ composed: true, row_key: "se-183b34", non_url: "https://www.alexanarch.org/non/se-183b34/", manifest: { files: [{ path: rowRel, sha256: want }] }, audit: { ran: true, complete: true } });
  globalThis.fetch = realFetch;
  t("publication: a page naming the slug while serving an older row is landed, not public", stale.state === "landed" && stale.stages.public.version_matches === false);
}

// 14. the commissions and the operator (2026-10-21: "i agree with undoing the constructed wikipedia article ruling";
// "the commodity form of the entity as what conceals the operator or in which the operator comes to speak with the voice
// of the entity").
{
  const { forKind, OPERATOR_PREAMBLE } = await import("../src/s7/object.js");
  const { ADMISSION_INSTRUCTIONS } = await import("../src/s7/reading.js");
  const { worksLedger } = await import("../src/s7/about.js");
  const { quoteEntity } = await import("../src/run.js");
  const op = fromEntity({ kind: "operator", name: "The exhaustive negation turned priority claim", description: "a first-person count over a stated domain ending in a total negation, stated of an entity as primacy", strings: ["nothing at all", "first work"] });
  t("operator: an operator is its own object, its row and strings its own, matched by its strings and never by its label", op.object_kind === "operator" && op.row.startsWith("op-") && op.aliases.length === 2 && !op.aliases.some((a) => /exhaustive/i.test(a.pattern)));
  t("operator: every pass reads its object as an operator", forKind(ADMISSION_INSTRUCTIONS, op).startsWith(OPERATOR_PREAMBLE) && forKind(ADMISSION_INSTRUCTIONS, fromEntity({ name: "x" })) === ADMISSION_INSTRUCTIONS);
  t("operator: an operator is no author, so every mention is bearing", worksLedger({ ...op, works_by: ["heteronyms"] }).length === 0);
  let e1 = ""; try { await quoteEntity({ kind: "operator", name: "x op", strings: ["nothing at all"], commission: "open" }); } catch (e) { e1 = e.message; }
  t("commission: open with nothing at an address says so and offers construction", /nothing to open/.test(e1) && /construct/.test(e1));
  let e2 = ""; try { await quoteEntity({ name: "Lee Sharks", commission: "construct", transcript: { text: "x" } }); } catch (e) { e2 = e.message; }
  t("commission: construct takes no T", /no T/.test(e2));
  let e3 = ""; try { await quoteEntity({ kind: "operator", name: "x op" }); } catch (e) { e3 = e.message; }
  t("commission: an operator needs its strings", /strings/.test(e3));
  const { provenanceOf } = await import("../src/s7/row.js");
  t("provenance: a construction is marked as one", provenanceOf({ kind: "entity", commission: "construct", T: { kind: "null" } }).class === "construction");
}

// 15. the sentence request at the point of contact (2026-10-21).
{
  const { parsePage, locate, requestId, nonEntriesFor, MODES } = await import("../src/sentence.js");
  const { makeReader } = await import("../src/reader.js");
  t("sentence: a Wikipedia address is read by title or by revision; other hosts are declined", parsePage("https://en.wikipedia.org/wiki/Sophistical_Refutations").title === "Sophistical Refutations" && parsePage("https://en.wikipedia.org/w/index.php?title=X&oldid=123").oldid === 123 && parsePage("https://example.com/a").unsupported);
  const cl = [{ id: "W1", text: "Aristotle wrote the Organon, a collection of logical works.[3]" }, { id: "W2", text: "According to Aristotle, this is the first work to treat the subject of deductive reasoning in ancient Greece." }];
  t("sentence: found by its text as the caller holds it, footnote markers and quotes aside", locate(cl, "According to Aristotle, this is the first work to treat the subject of deductive reasoning in ancient Greece").claim?.id === "W2" && locate(cl, "Aristotle wrote the Organon, a collection of logical works.").claim?.id === "W1");
  const miss = locate(cl, "Aristotle invented the printing press in the Organon era.");
  t("sentence: a sentence not on the page is not read, and the closest are offered", miss.claim === null && miss.closest.length > 0);
  t("sentence: the request id depends on the sentence, the page and the mode", requestId({ text: "A b.", url: "u", mode: "opening" }) === requestId({ text: " a  B. ", url: "u", mode: "opening" }) && requestId({ text: "A b.", url: "u", mode: "opening" }) !== requestId({ text: "A b.", url: "u", mode: "preliminary" }));
  const c0 = { text_sha256: "h" }, s0 = [{ text_sha256: "s" }];
  t("sentence: a preliminary reading is keyed apart from an opening and is one pass", claimKey(c0, s0, "m", makeReader("anthropic", "m", { passes: 1 })) !== claimKey(c0, s0, "m", makeReader("anthropic", "m")) && MODES.preliminary.passes === 1 && MODES.opening.passes === 2);
  const fl = JSON.parse(readFileSync(`${NON}/ledgers/se-183b34/field.json`, "utf8")).field_claims;
  const anyQ = Object.values(fl).find((c) => c.quote && c.quote.length > 60).quote;
  t("sentence: where /non already holds the sentence, the entry is named", (await nonEntriesFor(anyQ)).some((x) => x.row === "se-183b34"));
}

// 8. the execution budget and a failed call.
{
  const prev = process.env.GNOSIS_READER; process.env.GNOSIS_READER = "anthropic"; const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  const lb = passLog({ budget_usd: 0 }); const r0 = await lb.run({ row: "x", stage: "s", id: "1", system: "", task: "", model: "claude-haiku-5-5" });
  t("budget: a pass beyond the execution budget is recorded as not run", r0 === null && lb.exhausted());
  const lf = passLog(); const r1 = await lf.run({ row: "x", stage: "s", id: "1", system: "", task: "", model: "claude-haiku-5-5" });
  t("failure: a failed call is retried once, both attempts recorded, and the run continues", r1 === null && lf.calls.length === 2 && lf.calls[0].how.startsWith("retried:") && lf.calls[1].how.startsWith("failed:"));
  process.env.GNOSIS_READER = prev; if (key) process.env.ANTHROPIC_API_KEY = key;
}

// 9. a portable result's package: manifest hashes match files.
const [rid] = process.argv.slice(2);
if (rid && existsSync(`${STORE}/results/${rid}/portable/manifest.json`)) {
  const dir = `${STORE}/results/${rid}/portable/`;
  const man = JSON.parse(readFileSync(dir + "manifest.json", "utf8"));
  t("portable: every manifest hash matches its file", Object.entries(man.files).every(([n, h]) => createHash("sha256").update(readFileSync(dir + n)).digest("hex") === h));
}

// 2026-10-25: the first operator commission composed its row and was refunded in full as undelivered.
{
  const { deliveredWork } = await import("../src/deliver.js");
  t("delivery: a composed row with no sentences is delivered work", deliveredWork({ composition: { summary: { completed: 0 }, non: { composed: true } } }));
  t("delivery: a delivered reading with no row is delivered work", deliveredWork({ composition: { summary: { completed: 0 }, non: { composed: false, stages: { reading: { delivered: true } } } } }));
  t("delivery: nothing completed, read or composed is not", !deliveredWork({ composition: { summary: { completed: 0 }, non: { composed: false } } }));
}

// 2026-10-25: no order leaves the service short ("i WILL NOT pay others to use this service").
{
  const { kept, netBudget, paymentFee } = await import("../src/cost.js");
  t("fees: a 50¢ card order keeps its 50¢ (Stripe keeps its fee on a refund)", kept({ channel: "card", paid: 0.5, charge: 0.02, cost: 0.008 }) === 0.5);
  t("fees: a partial delivery keeps at least its model cost and payment fee", kept({ channel: "card", paid: 2.45, charge: 0.4, cost: 0.71 }) === Math.ceil((0.71 + paymentFee("card", 2.45)) * 100) / 100);
  t("fees: a delivery whose charge covers its costs keeps its charge", kept({ channel: "card", paid: 1.6, charge: 1.48, cost: 0.43 }) === 1.48);
  t("fees: an order never keeps more than it paid", kept({ channel: "x402", paid: 1, charge: 1, cost: 2 }) === 1);
  t("fees: model spending stops where the payment, less its fee, is spent", netBudget("card", 2.45) === Math.floor((2.45 - paymentFee("card", 2.45)) * 100) / 100 && netBudget("card", 2.45) < 2.45);
}

process.exit(fail ? 1 : 0);
