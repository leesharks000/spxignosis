// The first adversarial test's defects (2026-10-25), each reproduced against the code and shown fixed. Run with
// GNOSIS_STORE set to a fresh directory (scripts/test-all.sh does).
import http from "node:http";
const fail = (m) => { console.log("FAIL " + m); process.exit(1); };
const ok = (m) => console.log("ok   " + m);

// 5. The sentence read is the sentence sent.
const { locate } = await import("../src/sentence.js");
const claims = [
  { id: "W1", section: "lead", text: "Aristotle criticized Plato, while Theophrastus defended Socrates." },
  { id: "W2", section: "lead", text: "The treatment does not improve survival in adults with severe disease." },
  { id: "W3", section: "lead", text: "According to Aristotle, this is the first work to treat the subject of deductive reasoning in ancient Greece." },
];
const swap = locate(claims, "Plato criticized Aristotle, while Socrates defended Theophrastus.");
const neg = locate(claims, "The treatment does improve survival in adults with severe disease.");
const exc = locate(claims, "the first work to treat the subject of deductive reasoning");
const same = locate(claims, "According to Aristotle, this is the first work to treat the subject of deductive reasoning in ancient Greece[1].");
if (swap.claim || neg.claim || exc.claim) fail("sentence identity: a different proposition was selected " + JSON.stringify([swap.claim, neg.claim, exc.claim]));
if (swap.closest[0]?.id !== "W1" || neg.closest[0]?.id !== "W2" || !/contains/.test(exc.closest[0]?.relation || "")) fail("sentence identity: the stored sentence is not suggested " + JSON.stringify([swap.closest, neg.closest, exc.closest]));
if (same.claim?.id !== "W3" || same.match !== "identical") fail("sentence identity: the identical sentence (a footnote marker aside) was not selected");
ok("sentence identity: an actor swap, a dropped negation and an excerpt are suggestions, not readings; the identical sentence is read");

// The exclusive claim: one winner among concurrent claims of one key.
const { claim } = await import("../src/util.js");
const wins = (await Promise.all(Array.from({ length: 8 }, (_, i) => claim("claims/probe/one.json", { n: i })))).filter(Boolean).length;
if (wins !== 1) fail(`claim: ${wins} of 8 concurrent claims won`);
if (await claim("claims/probe/one.json", {})) fail("claim: a claimed key was claimed again");
ok("claim: of 8 concurrent claims of one key exactly one wins, and the key cannot be claimed again");

// 7. MCP: a malformed call is a structured error and reaches nothing downstream.
const { handleMcp } = await import("../src/mcp.js");
let fetched = 0; const realFetch = globalThis.fetch; globalThis.fetch = async () => { fetched++; return new Response("{}"); };
const ctx = { base: "http://127.0.0.1:1", service: { version: "test" } };
const r1 = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: null }, ctx);
const r2 = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_quote", arguments: { oldid: "x", tier: "nonexistent" } } }, ctx);
const r3 = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "order_status", arguments: {} } }, ctx);
const r4 = await handleMcp({ id: 4, method: "tools/list" }, ctx);
const r5 = await handleMcp("nonsense", ctx);
globalThis.fetch = realFetch;
if (r1?.error?.code !== -32602 || r2?.error?.code !== -32602 || r3?.error?.code !== -32602 || r4?.error?.code !== -32600 || r5?.error?.code !== -32600 || fetched) fail("mcp: " + JSON.stringify([r1, r2, r3, r4, r5, fetched]));
ok("mcp: params null, a wrong type or enum, a missing argument, a missing jsonrpc and a non-object are structured errors; nothing was sent on");

// 6. A changed source is read again; a restored source is seen again; the earlier snapshot is kept.
let body = "x".repeat(300) + " first", status = 200;
const srv = http.createServer((req, res) => { res.writeHead(status, { "content-type": "text/plain" }); res.end(status === 200 ? body : "gone"); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${srv.address().port}/source`;
const { snapshot } = await import("../src/resolve.js");
const { load, list, sha256 } = await import("../src/util.js");
const a = await snapshot(url);
body = "y".repeat(300) + " second";
const b = await snapshot(url, { fresh: true });
status = 404; const c = await snapshot(url, { fresh: true });
status = 200; body = "z".repeat(300) + " restored"; const d = await snapshot(url, { fresh: true });
const hist = await list(`snapshots/history/${sha256(url).slice(0, 24)}`);
srv.close();
if (a.text_sha256 === b.text_sha256 || !/second/.test(b.text) || b.previous?.text_sha256 !== a.text_sha256) fail("source refresh: a changed source kept its first bytes " + JSON.stringify([a.text_sha256, b.text_sha256]));
if (c.availability === "fetched" || d.availability !== "fetched" || !/restored/.test(d.text)) fail("source refresh: a restored source was not seen again " + JSON.stringify([c.availability, d.availability]));
if (hist.length !== 3) fail(`source refresh: ${hist.length} earlier snapshots kept, 3 expected`);
const kept = await load(`snapshots/history/${sha256(url).slice(0, 24)}/${hist.sort()[0]}`);
if (kept?.text_sha256 !== a.text_sha256) fail("source refresh: the first snapshot was not kept as it was");
ok("source refresh: new bytes make a new snapshot with its predecessor named; a 404 and its restoration are both seen; the three earlier snapshots are kept unchanged");
