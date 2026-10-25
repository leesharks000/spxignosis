// S7–S8 end to end for one address: traversal, admission, extraction, ontology, composition, audit; then the /non row.
import { ABOUT_RULE } from "./about.js";
import { traverse, archiveRelease } from "./traverse.js";
import { admitDRO, admitHop } from "./reading.js";
import { extractArchive, extractField } from "./extract.js";
import { readOntology, settleOntology } from "./ontology.js";
import { compose, delta, audit } from "./compose.js";
import { checkComposition } from "./checks.js";
import { passLog, mode, S7_PROTOCOL, MODELS } from "./model.js";
import { depMeta } from "./archive.js";
import { buildRow, writeLanding } from "./row.js";
import { blogPass, blogIndexSha } from "./blog.js";
import { sha256, save, load, STORE } from "../util.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The /non row is reusable when its whole input matches: T, every field source by hash, the entity's strings, the
// archive release (commit, registry, citation graph, traversal script, blog index), the S7 protocol, models and mode.
export function s7Key(input) {
  // Everything the row is computed from: T, B, the strings, the names whose works count as the entity's, the division's
  // rule, the archive's release, the protocol, models and mode.
  return sha256(JSON.stringify({ T: input.T.sha256, field: input.field.map((b) => [b.id, b.text_sha256 || b.availability]), aliases: input.aliases, works_by: input.works_by || [], about: ABOUT_RULE,
    release: archiveRelease(), blog: blogIndexSha(), protocol: S7_PROTOCOL, models: MODELS, mode: mode() }));
}

// Two stages, each its own deliverable (2026-10-25): the reading (traversal, admission, extraction, the ontology read
// twice) and the construction (the knowledge object, its compression, the delta, the audit). The reading is kept as a
// checkpoint under the execution key once its ontology passes have run, so a construction that fails, or a later order
// on the same input, starts from it and the investigation is not repeated. While the reading runs, the construction's
// share of the budget is held.
export const readingAt = (row, key) => `s7/${row}/reading/${key}.json`;

export async function runS7(input, { service, onProgress = () => {}, budget_usd, construction_usd = 0, log: shared } = {}) {
  const key = s7Key(input);
  // The job's log, where the caller passes one (the construction and S7 then share one budget); else S7's own.
  const log = shared || passLog({ budget_usd });
  const start = log.calls.length;
  const t0 = Date.now();
  let cp = await load(readingAt(input.row, key));
  let trav, blog, dro, travH, hop, verdicts, arch, field, ontoRaw;
  if (cp) {
    onProgress({ stage: "S7", detail: "the reading, from its checkpoint" });
    ({ trav, blog, dro, travH, hop, verdicts, arch, field, ontoRaw } = cp.state);
  } else {
    log.hold(construction_usd);
    onProgress({ stage: "S7a", detail: "traversal" });
    trav = traverse(input);
    blog = blogPass(input);
    onProgress({ stage: "S7b", detail: "admission by reading" });
    dro = await admitDRO(log, input, trav, blog);
    const droCands = [...trav.D, ...trav.R, ...trav.O, ...blog.D];
    const passages = dro.verdicts.flatMap((v) => droCands.filter((c) => c.dep === v.dep && v.cands.includes(c.cand_id)).map((c) => c.sentence));
    const { readsWhole } = await import("./about.js");
    for (const v of dro.verdicts) v.read_as = readsWhole(dro.division, v.dep) ? "whole" : "predication";
    const hopFrom = dro.verdicts.filter((v) => v.read_as === "whole").map((v) => v.dep).filter((d) => typeof d === "number");
    travH = hopFrom.length ? traverse(input, { hopFrom }) : { ...trav, H: [] };
    hop = await admitHop(log, input, travH, passages);
    verdicts = [...dro.verdicts, ...hop.verdicts];
    onProgress({ stage: "S7b", detail: "extraction" });
    arch = await extractArchive(log, input, verdicts, [...droCands, ...hop.cands]);
    field = await extractField(log, input);
    onProgress({ stage: "S7c", detail: "ontology" });
    const deps = [...new Set(arch.ledger.map((c) => c.dep ?? `blog:${c.record.url}`))].map(depMeta);
    ontoRaw = await readOntology(log, input, field.claims, arch.ledger, deps);
    log.hold(0);
    // The checkpoint is written once the reading is delivered, which is when both ontology passes returned: a reading
    // charged as delivered can be reused. A pass that failed or was cut by the budget is kept in it, and every row
    // composed from it carries the breach (2026-10-25: the second commission of Sophistical Refutations was charged for
    // its reading, and a stricter rule, no failed pass at all, left the reading unkept for one failed hop batch).
    const readCalls = log.calls.slice(start);
    const whole = ontoRaw.passes.filter(Boolean).length === 2;
    if (whole) {
      cp = { key, row: input.row, at: new Date().toISOString(), cost_usd: Math.round(readCalls.reduce((n, c) => n + (c.cost_usd || 0), 0) * 1e5) / 1e5, calls: readCalls,
        state: { trav, blog, dro, travH, hop, verdicts, arch, field, ontoRaw } };
      try { await save(readingAt(input.row, key), cp); cp = { ...cp, written_now: true }; } catch { cp = null; }
    } else cp = null;
  }
  const mid = log.calls.length;
  // The ontology is settled from the raw readings each time, so a rule ruled since the checkpoint applies to it.
  const onto = settleOntology(ontoRaw, field.claims, arch.ledger);
  let composition = null, checks = null, aud = null;
  if (onto.status === "read" || onto.status === "read (single pass)") {
    onProgress({ stage: "S8", detail: "composition" });
    const fs = Object.fromEntries(input.field.map((b) => [b.id, b.card]));
    composition = await compose(log, input, onto, field.claims, arch.ledger, fs);
    if (composition) {
      onProgress({ stage: "S8", detail: "the delta, read against T" });
      composition.delta = (await delta(log, input, onto, field.claims, composition)) || { T_vs_LB: null, LB_vs_LBA: null, note: "not read" };
      checks = checkComposition(composition, { fieldClaims: field.claims, archiveLedger: arch.ledger, caseValue: onto.case?.value });
      aud = await audit(log, input, composition, checks.byId);
    }
  }
  const sum = (cs) => Math.round(cs.reduce((n, c) => n + (c.cost_usd || 0), 0) * 1e5) / 1e5;
  const fromCheckpoint = !!(cp && !cp.written_now);
  // The calls of this run, with the reading's from the checkpoint where it was reused (their cost was paid by the order
  // that ran them, and is not counted again).
  const thisRun = log.calls.slice(start);
  const calls = fromCheckpoint ? [...cp.calls.map((c) => ({ ...c, from_checkpoint: cp.at })), ...thisRun] : thisRun;
  const run = { key, input, trav, blog, travH, dro, hop, verdicts, arch, field, onto, composition, checks, audit: aud,
    release: archiveRelease(), protocol: S7_PROTOCOL, models: MODELS, mode: mode(), calls, cost_usd: sum(thisRun), seconds: (Date.now() - t0) / 1000, service,
    stages: { reading: { cost_usd: fromCheckpoint ? 0 : sum(log.calls.slice(start, mid)), from_checkpoint: fromCheckpoint ? cp.at : null, checkpoint: cp ? readingAt(input.row, key) : null,
                         delivered: onto.status !== "unread" },
              construction: { cost_usd: sum(log.calls.slice(mid)), ran: !!composition, delivered: !!composition } },
    budget: { budget_usd: Number.isFinite(log.budget_usd) ? log.budget_usd : null, held_for_construction_usd: construction_usd || 0, shared_with_construction: !!shared && start > 0, exhausted: log.exhausted(),
      failed_calls: calls.filter((c) => c.how.startsWith("failed")).length, not_run: calls.filter((c) => c.how.startsWith("not run")).length } };
  const row = buildRow(run);
  // One tree per execution key, never overwritten (row.js): a later run under the same key keeps the tree already kept,
  // whose manifest earlier results name. Its bytes can differ only in what the run itself measures (its seconds), so
  // rewriting it would leave those results naming hashes their files no longer have (found 2026-10-24). A run that
  // composes where the kept tree has no knowledge object writes its own tree beside it, under the key with a suffix
  // (2026-10-25: otherwise a construction that failed once would stand for every later run).
  const kept = await load(`s7/${input.row}/runs/${key}/landing/landing/manifest.json`);
  const keptRow = kept ? await load(`s7/${input.row}/runs/${key}/landing/datasets/negative-of-the-negative/v2/rows/${input.row}.json`) : null;
  if (kept && (keptRow?.objects?.KO || !row.objects.KO)) {
    return { row, landing: { dir: join(STORE, `s7/${input.row}/runs/${key}/landing`), files: kept.files.map((f) => f.path), manifest: kept, kept: true }, run };
  }
  if (kept) run.key = `${key}.${sha256(JSON.stringify(row.objects.KO)).slice(0, 8)}`;
  const keptAt = `s7/${input.row}/runs/${run.key}/landing`;
  const landing = writeLanding(run, row);
  // The landing tree is kept in the service's store (Blob where configured), so the operator can fetch it from any
  // instance (GET /v1/results/{id}/landing) and the service can ground sentences from it (2026-10-24).
  for (const f of [...landing.files, "landing/manifest.json"]) await save(`${keptAt}/${f}`, readFileSync(join(landing.dir, f), "utf8"));
  return { row, landing, run };
}
