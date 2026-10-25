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

// Acceptance (provisional, declared 2026-10-21 before any live run; the operator's ruling sets them): a release of the
// passes is accepted when, on every held-out row, each stage meets its floor and the case and ρ are read back without
// contest. Below that its outputs are labelled provisional. Rows used in tuning any part of the procedure are not held out.
// The scorer's version: a release scored by an earlier scorer is scored again from its kept landing tree, at no cost.
export const SCORER = "2026-10-25: grouped verdicts split; deposits after the row not counted; a run given no field is not measured on the field";
export const THRESHOLDS = { admission: { recall: 0.9, precision: 0.8 }, archive_claims: { recall: 0.6, precision: 0.6 }, field_claims: { recall: 0.6, precision: 0.6 } };
export const TUNED_ON = { "se-183b34": "the hop screen's thresholds and the grounding floor", "ai-overview-capture-registry": "the hop screen's citing-paragraph rule",
  "aristotle-originality-claim": "the hop screen (scored)", "political-economy": "the hop screen (scored)", theophrastus: "the grounding floor", "model-collapse": "the grounding floor", howl: "the grounding floor" };

// Claims match by source and overlapping quotes: one quote inside the other, or at least 60% of words shared.
const words = (q) => new Set(norm(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
function claimMatch(got, want) {
  const W = want.map((w) => ({ ...w, ws: words(w.quote), nq: norm(w.quote).toLowerCase() })), used = new Set();
  let hit = 0;
  for (const g of got) {
    const gq = norm(g.quote).toLowerCase(), gw = words(g.quote);
    const i = W.findIndex((w, k) => !used.has(k) && w.src === g.src && (w.nq.includes(gq) || gq.includes(w.nq) || [...gw].filter((x) => w.ws.has(x)).length / Math.max(1, Math.min(gw.size, w.ws.size)) >= 0.6));
    if (i >= 0) { used.add(i); hit++; }
  }
  return { precision: got.length ? Math.round((hit / got.length) * 1000) / 1000 : null, recall: want.length ? Math.round((hit / want.length) * 1000) / 1000 : null, got: got.length, want: want.length, missed: [], extra: [] };
}

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
  // A verdict may name a group of deposits read together ([1176, 281]); each is its own admission.
  const deps = (vs) => vs.flatMap((v) => [].concat(v.dep).map(String));
  // What the archive deposited after the row was composed could not be in the row: it is reported, and not counted
  // against the passes (2026-10-25: anne-carson, composed 2026-10-08, scored #1670-#1697 as wrong admissions).
  const epoch = String(ex.row.epoch || "").slice(0, 10);
  const reg = (() => { try { return JSON.parse(readFileSync(join(ARCHIVE, "data/registry.json"), "utf8")).deposits || []; } catch { return []; } })();
  const dated = new Map(reg.filter((d) => d.deposit_number != null).map((d) => [String(d.deposit_number), String(d.date || "").slice(0, 10)]));
  const blogDay = (k) => { const m = k.match(/blogspot\.com\/(\d{4})\/(\d{2})\//); return m ? `${m[1]}-${m[2]}-01` : ""; };
  const after = (k) => { const d = k.startsWith("blog:") ? blogDay(k) : dated.get(k) || ""; return !!epoch && !!d && d > epoch; };
  const later = new Set();
  const inTime = (keys) => keys.filter((k) => (after(k) ? (later.add(k), false) : true));
  const out = {
    row: rowKey,
    reader: run.row.status.readings,
    traversal: Object.fromEntries(["candidates-D.jsonl", "candidates-R.jsonl", "candidates-O.jsonl"].map((f) => [f, run.summary.sha256?.[f] === ex.summary.sha256?.[f] ? "identical" : "differs"])),
    admission: pr(inTime(deps(run.reading.verdicts)), [...deps(ex.reading.verdicts), ...ex.ledger.filter((c) => c.record).map(depKey)]),
    archive_claims: claimMatch(run.ledger.filter((c) => !after(depKey(c))).map((c) => ({ src: depKey(c), quote: c.quote })), ex.ledger.map((c) => ({ src: depKey(c), quote: c.quote }))),
    field_claims: claimMatch(Object.values(run.row.field_claims).map((c) => ({ src: c.source, quote: c.quote })), Object.values(ex.field.field_claims).map((c) => ({ src: c.source, quote: c.quote.replace(/^"|"$/g, "") }))),
    case: { got: run.row.ontology?.case?.value ?? null, want: ex.row.ontology?.case?.value ?? null },
    rho: { got: run.row.ontology?.rho?.value ?? null, want: ex.row.ontology?.rho?.value ?? null },
    composition: { KO_sentences: { got: run.row.objects.KO?.sentences?.length ?? null, want: ex.row.objects.KO?.sentences?.length ?? null },
      blocks: { got: run.row.measure?.blocks?.sequence ?? null, want: ex.row.measure?.blocks?.sequence ?? null },
      surviving: { got: run.row.measure?.["v0.9"]?.surviving ?? null, want: ex.row.measure?.["v0.9"]?.surviving ?? null } },
  };
  if (!(run.row.field || []).length && (ex.field.field || []).some((b) => b.url && b.url !== "None"))
    out.field_claims = { ...out.field_claims, measured: false, note: "not measured: the run was given no field sources (the row's sources were dropped at input; fixed 2026-10-25), so the score says nothing about the passes" };
  out.scorer = SCORER;
  out.after_the_row = { epoch: epoch || null, deposits: [...later], note: "deposited after the row was composed; not counted" };
  for (const k of ["admission", "archive_claims", "field_claims"]) { out[k].missed = out[k].missed.slice(0, 20); out[k].extra = out[k].extra.slice(0, 20);
    out[k].meets = out[k].recall >= THRESHOLDS[k].recall && out[k].precision >= THRESHOLDS[k].precision; }
  out.case.meets = out.case.got === out.case.want && !run.row.ontology?.contested;
  out.rho.meets = out.rho.got === out.rho.want && !run.row.ontology?.contested;
  out.held_out = !TUNED_ON[rowKey];
  out.tuned_on_note = TUNED_ON[rowKey] || null;
  out.verdict = !/^live/.test(run.row.status.readings) ? "replay: tests the pipeline, measures nothing about the passes"
    : !out.held_out ? "not held out: this row was used in tuning, so its score does not count toward acceptance"
    : ["admission", "archive_claims", "field_claims", "case", "rho"].every((k) => out[k].meets) ? "meets the provisional thresholds" : "below the provisional thresholds: the release is provisional";
  return out;
}
