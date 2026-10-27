// The free route never calls a model (2026-10-27). readSentences with inference off, on a claim the ledger does not hold,
// leaves it unread and sends nothing to the reader; with inference on (the paid route) the reader is called.
import assert from "node:assert";
import { readSentences } from "../src/run.js";
let called = 0;
const reader = { id: "probe", mode: "probe", passes: 2, read: async () => { called++; throw new Error("model called"); } };
const claims = [{ id: "c1", section: "Lead", text: "A sentence that no ledger holds.", text_sha256: "free-route-probe", cited: true, pointers: [], footnotes: [] }];
const sources = { c1: [{ kind: "footnote", text_sha256: "free-route-probe-source", availability: "fetched", text: "Source text.", url: "https://example.org" }] };
const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const args = { claims, sources, pinned: { oldid: 1, title: "T" }, model: "m", reader, priceOf: { c1: 0 }, onProgress: () => {}, usage };
const off = await readSentences({ ...args, inference: false });
assert.equal(called, 0); assert.equal(off.entries[0].status, "unread");
console.log("ok   free route: with inference off, a sentence the ledger does not hold is left unread and no model is called");
await readSentences(args);
assert.equal(called, 1);
console.log("ok   paid route: with inference on, the reader is called");
