// Calibration (EA-WIKI-OPEN-01 §5.4): a run of the procedure on a /non row's own inputs, scored against the row as the
// archive composed it. The exemplar is the calibration point; acceptance is explanatory reach across rows the passes
// were not tuned on. Agreement is reported by stage, never as one number.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NON, ARCHIVE } from "./input.js";
import { norm } from "../validate.js";

const pr = (got, want) => {
  const g = new Set(got), w = new Set(want), hit = [...g].filter((x) => w.has(x)).length;
  return { precision: g.size ? Math.round((hit / g.size) * 1000) / 1000 : null, recall: w.size ? Math.round((hit / w.size) * 1000) / 1000 : null, got: g.size, want: w.size,
    missed: [...w].filter((x) => !g.has(x)), extra: [...g].filter((x) => !w.has(x)) };
};
const qkey = (src, q) => `${src}|${norm(q).replace(/^["“]|["”]$/g, "").toLowerCase().slice(0, 120)}`;

export function calibrate(rowKey, landingDir) {
  const V2 = "datasets/negative-of-the-negative/v2";
  const ex = { row: JSON.parse(readFileSync(join(NON, "rows", `${rowKey}.json`), "utf8")), reading: JSON.parse(readFileSync(join(NON, "traversal", rowKey, "reading.json"), "utf8")),
    summary: JSON.parse(readFileSync(join(NON, "traversal", rowKey, "summary.json"), "utf8")) };
  ex.ledger = JSON.parse(readFileSync(join(ARCHIVE, ex.row.ledger.archive), "utf8"));
  ex.field = JSON.parse(readFileSync(join(ARCHIVE, ex.row.ledger.field), "utf8"));
  const L = (rel) => JSON.parse(readFileSync(join(landingDir, rel), "utf8"));
  const run = { row: L(`${V2}/rows/${rowKey}.json`), reading: L(`${V2}/traversal/${rowKey}/reading.json`), summary: L(`${V2}/traversal/${rowKey}/summary.json`),
    ledger: L(`${V2}/ledgers/${rowKey}/ledger-archive.json`) };
  const depKey = (c) => (c.dep != null ? String(c.dep) : `blog:${c.record?.url}`);
  const out = {
    row: rowKey,
    reader: run.row.status.readings,
    traversal: Object.fromEntries(["candidates-D.jsonl", "candidates-R.jsonl", "candidates-O.jsonl"].map((f) => [f, run.summary.sha256?.[f] === ex.summary.sha256?.[f] ? "identical" : "differs"])),
    admission: pr(run.reading.verdicts.map((v) => String(v.dep)), [...ex.reading.verdicts.map((v) => String(v.dep)), ...ex.ledger.filter((c) => c.record).map(depKey)]),
    archive_claims: pr(run.ledger.map((c) => qkey(depKey(c), c.quote)), ex.ledger.map((c) => qkey(depKey(c), c.quote))),
    field_claims: pr(Object.values(run.row.field_claims).map((c) => qkey(c.source, c.quote)), Object.values(ex.field.field_claims).map((c) => qkey(c.source, c.quote))),
    case: { got: run.row.ontology?.case?.value ?? null, want: ex.row.ontology?.case?.value ?? null },
    rho: { got: run.row.ontology?.rho?.value ?? null, want: ex.row.ontology?.rho?.value ?? null },
    composition: { KO_sentences: { got: run.row.objects.KO?.sentences?.length ?? null, want: ex.row.objects.KO?.sentences?.length ?? null },
      blocks: { got: run.row.measure?.blocks?.sequence ?? null, want: ex.row.measure?.blocks?.sequence ?? null },
      surviving: { got: run.row.measure?.["v0.9"]?.surviving ?? null, want: ex.row.measure?.["v0.9"]?.surviving ?? null } },
  };
  for (const k of ["admission", "archive_claims", "field_claims"]) { out[k].missed = out[k].missed.slice(0, 20); out[k].extra = out[k].extra.slice(0, 20); }
  return out;
}
