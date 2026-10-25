#!/usr/bin/env node
// The archive worker (2026-10-24). The deployed service holds no archive and no Python, so the orders that consult the
// archive (commissions, portable packages, entity objects) are quoted and run here, by a scheduled job in this
// repository that checks the archive out beside it (.github/workflows/archive-worker.yml). It shares the service's
// store (Blob): it reads the quote requests and queued runs the service recorded, writes quotes and results there, and
// reports each run to the service, which computes and sends the refund where the payment key is.
//
//   node scripts/worker.js check   # prints work=<n> (to $GITHUB_OUTPUT when set): whether there is anything to do
//   node scripts/worker.js         # quotes every pending request, runs every queued order, settles each
//
// Environment: GNOSIS_ARCHIVE (the archive checkout), BLOB_READ_WRITE_TOKEN (the service's store), ANTHROPIC_API_KEY,
// GNOSIS_BASE_URL (the service, for settlement), WORKER_MINUTES (stop starting runs after this; default 300).
import { appendFileSync } from "node:fs";
import { load, save, list, BLOB } from "../src/util.js";
import { quote, quoteEntity } from "../src/run.js";
import { deliver, HAS_ARCHIVE, WORKER } from "../src/deliver.js";

const BASE = (process.env.GNOSIS_BASE_URL || "https://gnosis.spxi.dev").replace(/\/$/, "");
const STOP = Date.now() + Number(process.env.WORKER_MINUTES || 300) * 60e3;
const QUOTE_TTL = 24 * 3600e3; // a commission's quote holds for a day: the worker prices it on its own schedule
const ids = async (dir) => (await list(dir)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

async function pending() {
  const quotes = [], runs = [];
  for (const id of await ids(WORKER.quote_requests))
    if (!(await load(`quotes/${id}.json`)) && !(await load(`${WORKER.quote_errors}/${id}.json`))) quotes.push(id);
  for (const id of await ids(WORKER.runs)) if (!(await load(`refunds/${id}.json`))) runs.push(id);
  return { quotes, runs };
}

async function priceOne(id) {
  const rq = await load(`${WORKER.quote_requests}/${id}.json`);
  const { oldid, entity, object, commission, claims } = rq.body || {};
  try {
    const q = object ? await quoteEntity({ ...object, ...(commission ? { commission } : {}) }, { tier: rq.tier, quote_id: id, ttl_ms: QUOTE_TTL })
      : entity ? await quoteEntity(entity, { tier: rq.tier, quote_id: id, ttl_ms: QUOTE_TTL })
      : await quote(Number(oldid), { tier: rq.tier, claims, quote_id: id, ttl_ms: QUOTE_TTL });
    console.log(`quoted ${id}: ${q.tier}, $${q.max_price_usd}`);
  } catch (e) {
    await save(`${WORKER.quote_errors}/${id}.json`, { quote_id: id, error: String(e.message || e).slice(0, 600), at: new Date().toISOString() });
    console.log(`not quoted ${id}: ${String(e.message || e).slice(0, 200)}`);
  }
}

async function settle(id, job) {
  const r = await fetch(`${BASE}/v1/quotes/${id}/settle`, { method: "POST", headers: { "x-gnosis-worker": job.token }, signal: AbortSignal.timeout(60000) })
    .then(async (x) => ({ status: x.status, body: await x.text() })).catch((e) => ({ status: 0, body: String(e.message || e) }));
  console.log(`settle ${id}: ${r.status} ${r.body.slice(0, 200)}`);
}

async function runOne(id) {
  const [job, q] = await Promise.all([load(`${WORKER.runs}/${id}.json`), load(`quotes/${id}.json`)]);
  if (!job || !q) return console.log(`skip ${id}: no job or quote`);
  if (!(await load(`delivered/${id}.json`)) && !(await load(`${WORKER.failed}/${id}.json`))) {
    await save(`progress/${id}.json`, { stage: "running", detail: "the archive worker is running the order", at: new Date().toISOString() });
    try { const out = await deliver(q); console.log(`delivered ${id}: ${JSON.stringify(out.summary)}`); }
    catch (e) {
      await save(`${WORKER.failed}/${id}.json`, { quote_id: id, error: String(e.message || e).slice(0, 600), result_id: e.result_id || null, at: new Date().toISOString() });
      console.log(`failed ${id}: ${String(e.message || e).slice(0, 200)}`);
    }
  }
  await settle(id, job);
}

const { quotes, runs } = await pending();
if (process.argv[2] === "check") {
  const n = quotes.length + runs.length;
  console.log(`work=${n} (quotes ${quotes.length}, runs ${runs.length})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `work=${n}\n`);
  process.exit(0);
}
if (!HAS_ARCHIVE) { console.error("the archive is not checked out at GNOSIS_ARCHIVE"); process.exit(1); }
if (!BLOB) console.error("warning: no Blob token: the worker reads and writes a local store only");
for (const id of quotes) await priceOne(id);
for (const id of runs) { if (Date.now() > STOP) { console.log(`time's up; ${id} and after wait for the next run`); break; } await runOne(id); }
console.log(`done: ${quotes.length} quotes, ${runs.length} runs`);
