// A calibration release (EA-WIKI-OPEN-01 §5.4; 2026-10-25): the procedure run live, by the archive worker, on the own
// inputs of /non rows the passes were not tuned on, and scored against each row stage by stage (src/s7/calibrate.js).
// The request is a file committed to this repository (calibration/request.json): the operator authorizes the spend by
// landing it, and no route can start a run. Its rows run in order of estimated cost until the cap; each row's model
// spending stops at its estimate times the contingency. Field sources the row did not save are fetched now, each with
// its date and hash, so a source that has changed since the row was composed shows in the score as what it is.
import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { join } from "node:path";
import { load, save, sha256 } from "./util.js";
import { fromNonRow } from "./s7/input.js";
import { runS7 } from "./s7/run.js";
import { estimateS7 } from "./s7/estimate.js";
import { calibrate, THRESHOLDS, TUNED_ON, SCORER } from "./s7/calibrate.js";
import { archiveRelease } from "./s7/traverse.js";
import { MODELS, S7_PROTOCOL, mode } from "./s7/model.js";
import { snapshot } from "./resolve.js";
import { POLICY, s7Stages } from "./cost.js";
import { SERVICE } from "./run.js";

const REQUEST = new URL("../calibration/request.json", import.meta.url).pathname;

export function calibrationRequest() {
  if (!existsSync(REQUEST)) return null;
  const body = readFileSync(REQUEST, "utf8");
  const rq = JSON.parse(body);
  const release = archiveRelease();
  // A release is the request and the passes (protocol, models, mode).
  // The archive commit is recorded with the release and is no part of its id, so that a new archive commit does not
  // start a new (paid) release; a changed request or a changed reader does.
  const id = `CAL-${sha256(JSON.stringify({ rq, protocol: S7_PROTOCOL, models: MODELS, mode: mode() })).slice(0, 12)}`;
  return { ...rq, id, request_sha256: sha256(body), archive_release: release };
}

export async function pendingCalibration() {
  const rq = calibrationRequest();
  if (!rq) return null;
  const done = await load(`calibration/releases/${rq.id}/summary.json`);
  return done?.complete ? null : rq;
}

// A Wikipedia article is read as it stood on the day the row read it: the last revision on or before that date, so the
// score does not count the article's later edits against the passes. Any other source is fetched as it is now.
async function revisionAsOf(url, day) {
  const m = String(url).match(/^https?:\/\/en\.wikipedia\.org\/wiki\/([^?#]+)/);
  if (!m || !day) return null;
  const title = decodeURIComponent(m[1]);
  const api = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&titles=${encodeURIComponent(title)}&rvlimit=1&rvdir=older&rvstart=${day}T23:59:59Z&rvprop=ids|timestamp&format=json&formatversion=2`;
  try {
    const r = await fetch(api, { headers: { "User-Agent": "SPXI-gnosis/0.1 (https://spxi.dev; calibration)" }, signal: AbortSignal.timeout(20000) });
    const rev = (await r.json())?.query?.pages?.[0]?.revisions?.[0];
    return rev?.revid ? { oldid: rev.revid, timestamp: rev.timestamp, url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&oldid=${rev.revid}` } : null;
  } catch { return null; }
}
export async function withFieldTexts(input) {
  for (const b of input.field) {
    if (b.text || !b.url) continue;
    const day = (String(b.fetched || "").match(/\b(20\d\d-\d\d-\d\d)\b/) || [])[1] || null;
    const rev = await revisionAsOf(b.url, day);
    const s = await snapshot(rev?.url || b.url);
    Object.assign(b, { text: s.text || "", text_sha256: s.text_sha256, availability: s.availability,
      fetched: rev ? `gnosis calibration: revision ${rev.oldid} (${rev.timestamp}), the last on or before ${day}, the day the row read it; the row did not save its text`
        : `gnosis calibration, ${String(s.retrieved || "").slice(0, 10)} (fetched as it is now; the row read it ${day || "on a date it did not record"} and did not save its text)` });
  }
  return input;
}

export async function runCalibration(rq, { stopAt = Infinity } = {}) {
  const base = `calibration/releases/${rq.id}`;
  const prior = (await load(`${base}/summary.json`)) || { id: rq.id, request: rq, started: new Date().toISOString(), rows: {}, spent_usd: 0 };
  const plan = [];
  for (const row of rq.rows) {
    if (prior.rows[row]?.state === "scored" || prior.rows[row]?.state?.startsWith("not run")) continue;
    // A row whose run failed is tried once more, and then left: a failure must not spend again every ten minutes.
    if (prior.rows[row]?.state === "failed" && (prior.rows[row].attempts || 1) >= 2) { prior.rows[row].state = "not run: failed twice"; continue; }
    if (TUNED_ON[row]) { prior.rows[row] = { state: "not run: used in tuning", note: TUNED_ON[row] }; continue; }
    try {
      const input = await withFieldTexts(fromNonRow(row, null));
      const e = await estimateS7(input);
      plan.push({ row, input, e, stages: s7Stages(e) });
    } catch (e) { prior.rows[row] = { state: "not run: the row's inputs could not be prepared", error: String(e.message || e).slice(0, 300) }; }
  }
  plan.sort((a, b) => a.e.est_cost_usd - b.e.est_cost_usd);
  for (const p of plan) {
    if (Date.now() > stopAt) break;
    const allowance = Math.round((p.stages.reading.budget_usd + p.stages.construction.budget_usd) * 100) / 100;
    if (prior.spent_usd + allowance > rq.cap_usd) { prior.rows[p.row] = { state: "not run: the cap would be passed", estimate_usd: p.e.est_cost_usd, allowance_usd: allowance }; continue; }
    console.log(`calibration ${rq.id}: ${p.row}, estimate $${p.e.est_cost_usd}, allowance $${allowance}`);
    try {
      const out = await runS7(p.input, { service: SERVICE, budget_usd: allowance, construction_usd: p.stages.construction.budget_usd });
      const score = calibrate(p.row, out.landing.dir);
      prior.spent_usd = Math.round((prior.spent_usd + (out.run.cost_usd || 0)) * 1e4) / 1e4;
      prior.rows[p.row] = { state: "scored", cost_usd: out.run.cost_usd, estimate_usd: p.e.est_cost_usd, seconds: out.run.seconds, key: out.run.key,
        field_sources: p.input.field.map((b) => ({ id: b.id, url: b.url, availability: b.availability, text_sha256: b.text_sha256 })),
        breaches: out.row.breaches.map((b) => b.check), score };
    } catch (e) {
      prior.rows[p.row] = { state: "failed", error: String(e.message || e).slice(0, 400), attempts: (prior.rows[p.row]?.attempts || 0) + 1 };
    }
    await save(`${base}/summary.json`, prior);
  }
  return summarize(prior, rq, base, plan.length === 0 && Date.now() <= stopAt);
}

async function summarize(prior, rq, base, nothingLeft) {
  const scored = Object.values(prior.rows).filter((r) => r.state === "scored");
  prior.complete = rq.rows.every((r) => prior.rows[r] && prior.rows[r].state !== "failed") || nothingLeft;
  prior.thresholds = THRESHOLDS;
  prior.verdict = !scored.length ? "no row scored"
    : scored.every((r) => r.score.verdict === "meets the provisional thresholds") ? "accepted: every scored held-out row meets the provisional thresholds"
    : "provisional: at least one scored row is below the provisional thresholds";
  prior.scorer = SCORER;
  prior.by_stage = Object.fromEntries(["admission", "archive_claims", "field_claims", "case", "rho"].map((k) => [k, scored.map((r) => ({ row: Object.keys(prior.rows).find((x) => prior.rows[x] === r), meets: r.score[k].meets,
    ...(r.score[k].recall !== undefined ? Object.fromEntries(["recall", "precision", "verified", "precision_vs_seated", "measured"].filter((m) => r.score[k][m] !== undefined).map((m) => [m, r.score[k][m]])) : { got: r.score[k].got, want: r.score[k].want }) }))]));
  prior.updated = new Date().toISOString();
  await save(`${base}/summary.json`, prior);
  await save("calibration/latest.json", { id: rq.id, summary: `${base}/summary.json`, verdict: prior.verdict, complete: prior.complete, spent_usd: prior.spent_usd, updated: prior.updated });
  return prior;
}

// A release scored by an earlier scorer is scored again from each row's kept landing tree (s7/<row>/runs/<key>/landing in
// the store). Nothing is run and nothing is spent; the earlier score is kept beside the new one.
export async function rescoreCalibration() {
  const latest = await load("calibration/latest.json");
  if (!latest?.id) return null;
  const base = `calibration/releases/${latest.id}`;
  const prior = await load(`${base}/summary.json`);
  if (!prior || prior.scorer === SCORER) return null;
  const V2 = "datasets/negative-of-the-negative/v2";
  for (const [row, r] of Object.entries(prior.rows)) {
    if (r.state !== "scored" || !r.key || r.score?.scorer === SCORER) continue;
    const dir = mkdtempSync(join(tmpdir(), "rescore-"));
    try {
      for (const rel of [`${V2}/rows/${row}.json`, `${V2}/traversal/${row}/reading.json`, `${V2}/traversal/${row}/summary.json`, `${V2}/ledgers/${row}/ledger-archive.json`]) {
        const body = await load(`s7/${row}/runs/${r.key}/landing/${rel}`, false);
        if (body == null) throw new Error(`the kept landing tree lacks ${rel}`);
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), body);
      }
      r.earlier_scores = [...(r.earlier_scores || []), { scorer: r.score?.scorer || "before 2026-10-25", score: r.score }];
      r.score = calibrate(row, dir);
    } catch (e) { r.rescore_error = String(e.message || e).slice(0, 300); }
  }
  return summarize(prior, prior.request, base, true);
}
