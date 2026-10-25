// The scorer, on a seated row scored against itself (2026-10-25): a run that admits a grouped verdict's deposits one by one
// is not marked as missing and adding them; a deposit made after the row was composed is reported and not counted; a run
// given no field sources is not measured on the field.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { calibrate } from "../src/s7/calibrate.js";
import { ARCHIVE } from "../src/s7/input.js";

const row = "anne-carson", V2 = "datasets/negative-of-the-negative/v2";
const read = (rel) => JSON.parse(readFileSync(join(ARCHIVE, rel), "utf8"));
const dir = mkdtempSync(join(tmpdir(), "calprobe-"));
const put = (rel, v) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), JSON.stringify(v)); };
const R = read(`${V2}/rows/${row}.json`), reading = read(`${V2}/traversal/${row}/reading.json`);
R.status = { ...(R.status || {}), readings: "live (probe)" };
put(`${V2}/rows/${row}.json`, { ...R, field: [] });
put(`${V2}/traversal/${row}/reading.json`, { ...reading, verdicts: [...reading.verdicts.flatMap((v) => [].concat(v.dep).map((d) => ({ ...v, dep: d }))), { dep: 1697, strata: ["R"], reason: "probe: deposited after the row" }] });
put(`${V2}/traversal/${row}/summary.json`, read(`${V2}/traversal/${row}/summary.json`));
put(`${V2}/ledgers/${row}/ledger-archive.json`, read(`${V2}/ledgers/${row}/ledger-archive.json`));
const s = calibrate(row, dir);
let bad = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) bad++; };
ok(s.admission.recall === 1 && s.admission.precision === 1, `calibration: grouped verdicts are split, so the row's own admissions score 1 and 1 (got ${s.admission.recall}, ${s.admission.precision})`);
ok(s.after_the_row.deposits.includes("1697"), "calibration: a deposit made after the row was composed is reported and not counted");
ok(s.archive_claims.recall === 1 && s.archive_claims.precision === 1, `calibration: the row's own archive claims score 1 and 1 (got ${s.archive_claims.recall}, ${s.archive_claims.precision})`);
ok(s.field_claims.measured === false, "calibration: a run given no field sources is not measured on the field");
process.exit(bad ? 1 : 0);
