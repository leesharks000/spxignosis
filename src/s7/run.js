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

export async function runS7(input, { service, onProgress = () => {}, budget_usd, log: shared } = {}) {
  const key = s7Key(input);
  // The job's log, where the caller passes one (the construction and S7 then share one budget); else S7's own.
  const log = shared || passLog({ budget_usd });
  const start = log.calls.length;
  const t0 = Date.now();
  onProgress({ stage: "S7a", detail: "traversal" });
  const trav = traverse(input);
  const blog = blogPass(input);
  onProgress({ stage: "S7b", detail: "admission by reading" });
  const dro = await admitDRO(log, input, trav, blog);
  const droCands = [...trav.D, ...trav.R, ...trav.O, ...blog.D];
  const passages = dro.verdicts.flatMap((v) => droCands.filter((c) => c.dep === v.dep && v.cands.includes(c.cand_id)).map((c) => c.sentence));
  const { readsWhole } = await import("./about.js");
  for (const v of dro.verdicts) v.read_as = readsWhole(dro.division, v.dep) ? "whole" : "predication";
  const hopFrom = dro.verdicts.filter((v) => v.read_as === "whole").map((v) => v.dep).filter((d) => typeof d === "number");
  const travH = hopFrom.length ? traverse(input, { hopFrom }) : { ...trav, H: [] };
  const hop = await admitHop(log, input, travH, passages);
  const verdicts = [...dro.verdicts, ...hop.verdicts];
  onProgress({ stage: "S7b", detail: "extraction" });
  const arch = await extractArchive(log, input, verdicts, [...droCands, ...hop.cands]);
  const field = await extractField(log, input);
  onProgress({ stage: "S7c", detail: "ontology" });
  const deps = [...new Set(arch.ledger.map((c) => c.dep ?? `blog:${c.record.url}`))].map(depMeta);
  const ontoRaw = await readOntology(log, input, field.claims, arch.ledger, deps);
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
  const run = { key, input, trav, blog, travH, dro, hop, verdicts, arch, field, onto, composition, checks, audit: aud,
    release: archiveRelease(), protocol: S7_PROTOCOL, models: MODELS, mode: mode(), calls: log.calls.slice(start), cost_usd: Math.round(log.calls.slice(start).reduce((n, c) => n + (c.cost_usd || 0), 0) * 1e5) / 1e5, seconds: (Date.now() - t0) / 1000, service,
    budget: { budget_usd: Number.isFinite(log.budget_usd) ? log.budget_usd : null, shared_with_construction: !!shared && start > 0, exhausted: log.exhausted(),
      failed_calls: log.calls.slice(start).filter((c) => c.how.startsWith("failed")).length, not_run: log.calls.slice(start).filter((c) => c.how.startsWith("not run")).length } };
  const row = buildRow(run);
  // One tree per execution key, never overwritten (row.js): a later run under the same key keeps the tree already kept,
  // whose manifest earlier results name. Its bytes can differ only in what the run itself measures (its seconds), so
  // rewriting it would leave those results naming hashes their files no longer have (found 2026-10-24).
  const keptAt = `s7/${input.row}/runs/${key}/landing`;
  const prior = await load(`${keptAt}/landing/manifest.json`);
  if (prior) {
    return { row, landing: { dir: join(STORE, keptAt), files: prior.files.map((f) => f.path), manifest: prior, kept: true }, run };
  }
  const landing = writeLanding(run, row);
  // The landing tree is kept in the service's store (Blob where configured), so the operator can fetch it from any
  // instance (GET /v1/results/{id}/landing) and the service can ground sentences from it (2026-10-24).
  for (const f of [...landing.files, "landing/manifest.json"]) await save(`${keptAt}/${f}`, readFileSync(join(landing.dir, f), "utf8"));
  return { row, landing, run };
}
