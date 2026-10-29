// The erasure audit (2026-10-29), with the model replaced by scripted readings: the free screen calls no model; a
// quote is priced at least at the floor; the run takes atoms only where both readings agree with a verbatim quote,
// keeps disagreements as contested, drops a quote not found in the text, gates ABN, and computes the module's metrics.
import assert from "node:assert";
process.env.ANTHROPIC_API_KEY = "test";
const { existenceScreen, quoteAudit, runAudit, familyMetrics, auditInputs } = await import("../src/audit.js");
const { deliver } = await import("../src/deliver.js");

const SOURCE = "The Self-Audit Module for Public Summarizers v3.2 is by Lee Sharks. It is deposit #817 in the Crimson Hexagonal Archive, licensed CC BY-SA 4.0.";
const R = {
  full: "The Self-Audit Module v3.2, written by Lee Sharks, is deposit #817 of the Crimson Hexagonal Archive.",
  moved: "The Self-Audit Module is a framework developed at a university lab, published as deposit #817.",
  denied: "I could not find the Self-Audit Module for Public Summarizers; it may not exist.",
  split: "The Self-Audit Module is held in the Crimson Hexagonal Archive.",
  failed: "I could not find anything on the Self-Audit Module for Public Summarizers.",
};
const node = { name: "Self-Audit Module for Public Summarizers", aliases: ["Self-Audit Module"], existence_type: "real" };

// 1. the free screen: by rule, no model
let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error("no network in the screen"); };
const inp = await auditInputs({ node, renderings: Object.entries(R).map(([label, text]) => ({ label, text })), scope: "existence" });
const sc = existenceScreen(inp.node, inp.renderings);
assert.equal(calls, 0);
const by = Object.fromEntries(sc.renderings.map((r) => [r.label, r.screen]));
assert.equal(by.denied, "possible existence-conversion");
assert.equal(by.failed, "failure reported (scores 0)");
assert.equal(by.full, "no denial phrasing found");
assert.equal(sc.model_calls, 0);
console.log("ok   existence screen: by rule, no model; a hedged denial flagged, a reported failure scores 0");
const fic = existenceScreen({ name: "Elias", aliases: [], existence_type: "fictional" }, [{ id: "R1", label: "f", text: "Elias is a fictional character in the charter." }]);
assert.equal(fic.renderings[0].screen, "no denial phrasing found");
console.log("ok   existence screen: a node preregistered as fictional is correctly called so");

// 2. the quote
const body = { audit: { node, source: { text: SOURCE, label: "deposit #817" }, renderings: ["full", "moved", "denied", "split"].map((k) => ({ label: k, text: R[k] })) } };
const q = await quoteAudit(body);
assert.equal(q.kind, "audit"); assert.ok(q.max_price_usd >= 0.5); assert.equal(q.renderings.length, 4);
assert.ok(!JSON.stringify(q).includes(R.full), "the quote carries no rendering text");
console.log(`ok   quote: kind audit, ${q.lines.length} lines, maximum $${q.max_price_usd.toFixed(2)} (at least the floor)`);

// 3. the run, with scripted readings
const atomsA = [{ type: "producer", value: "Lee Sharks", quote: "is by Lee Sharks" }, { type: "identifier", value: "deposit #817", quote: "It is deposit #817" },
  { type: "archival authority", value: "Crimson Hexagonal Archive", quote: "in the Crimson Hexagonal Archive" }, { type: "licence", value: "CC BY-SA 4.0", quote: "licensed CC BY-SA 4.0" }];
const atomsB = [atomsA[0], atomsA[1], atomsA[2], { type: "institution", value: "Zenodo", quote: "deposited at Zenodo" }]; // licence only in A; a quote not in the source
const cell = (id, state, quote = null, credited_to = null) => ({ id, state, quote, credited_to });
const reads = {
  full: [{ abn: { value: 0, quote: null, reason: "" }, failure_reported: false, atoms: [cell("A1", "present", "written by Lee Sharks"), cell("A2", "present", "is deposit #817"), cell("A3", "present", "the Crimson Hexagonal Archive")], notes: "" }],
  moved: [{ abn: { value: 0, quote: null, reason: "" }, failure_reported: false, atoms: [cell("A1", "reassigned", "developed at a university lab", "a university lab"), cell("A2", "present", "published as deposit #817"), cell("A3", "absent")], notes: "" }],
  denied: [{ abn: { value: 1, quote: "it may not exist", reason: "hedged denial" }, failure_reported: true, atoms: [cell("A1", "absent"), cell("A2", "absent"), cell("A3", "absent")], notes: "" }],
  split: [{ abn: { value: 0, quote: null, reason: "" }, failure_reported: false, atoms: [cell("A1", "absent"), cell("A2", "absent"), cell("A3", "present", "held in the Crimson Hexagonal Archive")], notes: "" },
          { abn: { value: 0, quote: null, reason: "" }, failure_reported: false, atoms: [cell("A1", "absent"), cell("A2", "absent"), cell("A3", "absent")], notes: "" }],
};
let n = 0;
globalThis.fetch = async (url, opt) => {
  assert.ok(String(url).includes("api.anthropic.com")); n++;
  const b = JSON.parse(opt.body), txt = b.messages[0].content.map((c) => c.text).join("\n");
  const second = txt.includes("independent second reading");
  let reading;
  if (txt.startsWith("NODE") && txt.includes("SOURCE")) reading = { atoms: second ? atomsB : atomsA, notes: "" };
  else { const k = Object.keys(reads).find((k) => txt.includes(R[k])); const rs = reads[k]; reading = rs[second && rs[1] ? 1 : 0]; }
  return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(reading) }], usage: { input_tokens: 500, output_tokens: 300, cache_creation_input_tokens: 800, cache_read_input_tokens: 0 }, stop_reason: "end_turn" }) };
};
const out = await deliver(q, { deadline: Date.now() + 300e3 });
const c = out.composition;
assert.equal(n, 10, "two atom readings and two per rendering");
assert.deepEqual(c.atoms.set.map((a) => a.value), ["Lee Sharks", "deposit #817", "Crimson Hexagonal Archive"]);
assert.ok(c.atoms.contested.some((a) => a.value === "CC BY-SA 4.0"), "an atom one reading found is contested");
assert.ok(!c.atoms.set.some((a) => a.value === "Zenodo") && !c.atoms.contested.some((a) => a.value === "Zenodo"), "an atom whose quote is not in the source is dropped");
console.log("ok   atoms: only where both readings agree with a verbatim quote; one reading's atom contested; a quote not in the source dropped");
const row = Object.fromEntries(c.renderings.map((r) => [r.label, r]));
assert.equal(row.full.PER, 0);
assert.equal(row.moved.reassigned[0].credited_to, "a university lab");
assert.equal(row.moved.PER, Math.round((1 - 1 / 3) * 1000) / 1000);
assert.equal(row.denied.abn.value, 1); assert.equal(row.denied.PER, null);
assert.equal(row.split.cells.find((x) => x.atom === "A3").state, "contested");
console.log("ok   cells: PER per answer, a reassignment named, ABN gates its answer out, a disagreement contested");
assert.equal(c.family.k, 3); assert.equal(c.family.excluded_by_abn, 1);
assert.equal(c.family.FC, 1); assert.equal(c.family.ACP, 1); assert.equal(c.family.ASI, 0);
assert.ok(c.family.CC.not_interpreted, "CC not interpreted below k = 4");
console.log(`ok   family: k ${c.family.k}, FC ${c.family.FC}, ACP ${c.family.ACP}, ASI ${c.family.ASI}; ${c.family.condition}`);
assert.ok(out.billing.charge_usd >= 0.5 && out.billing.charge_usd <= q.max_price_usd);
console.log(`ok   billing: charged $${out.billing.charge_usd.toFixed(2)} of a $${q.max_price_usd.toFixed(2)} maximum`);

// 4. the module's formulas against the compute page's own fixture shape
const fm = familyMetrics([{ id: "A1" }, { id: "A2" }], [{ abn: { value: 0 }, cells: [{ state: "present" }, { state: "absent" }] }, { abn: { value: 0 }, cells: [{ state: "absent" }, { state: "present" }] }]);
assert.equal(fm.FC, 1); assert.equal(fm.ACP, 0.5); assert.equal(fm.ASI, 0.5);
assert.match(fm.condition, /complete only in union/);
console.log("ok   formulas: sharding complete only in union (FC 1, ACP 0.5, ASI 0.5)");
