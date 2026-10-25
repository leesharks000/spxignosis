// The work for a paid quote, shared by the service and the archive worker (scripts/worker.js). Throws when nothing
// could be delivered.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runOpening } from "./run.js";
import { save } from "./util.js";
import { ARCHIVE } from "./s7/input.js";

// Whether this process holds the archive. The deployed service does not (no archive, no Python): the tiers that consult
// the archive (commission, portable, and every entity object) are quoted and run by the archive worker, a scheduled job
// in this repository with the archive checked out beside it (2026-10-24).
export const HAS_ARCHIVE = existsSync(join(ARCHIVE, "data/registry.json")) && existsSync(join(ARCHIVE, "scripts/non_traverse.py"));
export const WORKER = {
  quote_requests: "worker/quote-requests", quote_errors: "worker/quote-errors", runs: "worker/runs", failed: "worker/failed",
  where: "https://github.com/leesharks000/spxignosis/actions/workflows/archive-worker.yml",
};
export const needsArchive = (q) => !!(q?.s7 || q?.kind === "entity");

export async function deliver(q, { deadline } = {}) {
  const r = await runOpening(q.quote_id, { deadline, onProgress: (p) => { save(`progress/${q.quote_id}.json`, { ...p, at: new Date().toISOString() }).catch((e) => console.error("progress write:", e.message)); } });
  // Completion follows the commissioned operation: a composed row is delivered work even where T needed no S3 check.
  if (r.composition.summary.completed === 0 && !r.non?.composed) throw Object.assign(new Error("no claim could be completed and no row was composed"), { result_id: r.result_id });
  const out = { result_id: r.result_id, reused: r.reused, summary: r.composition.summary, billing: r.record?.billing, composition: r.composition, portable: r.portable_dir ? `/v1/results/${r.result_id}/portable/manifest.json` : null };
  await save(`delivered/${q.quote_id}.json`, out);
  return out;
}
