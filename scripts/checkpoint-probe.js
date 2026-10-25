#!/usr/bin/env node
// The reading checkpoint (2026-10-25): a second run on the same input starts from the first run's reading, makes no
// reading pass, and composes the same row; the stages and their charges follow what delivered.
import { join } from "node:path";
import { runS7 } from "../src/s7/run.js";
import { fromNonRow } from "../src/s7/input.js";
import { STORE } from "../src/util.js";
import { stageCharge, s7Stages } from "../src/cost.js";
const t = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) process.exitCode = 1; };
const input = () => fromNonRow("se-183b34", join(STORE, "calibration/se-183b34"));
const a = await runS7(input(), { service: { name: "SPXI-gnΩsis", version: "probe" } });
const b = await runS7(input(), { service: { name: "SPXI-gnΩsis", version: "probe" } });
t("checkpoint: the second run reads from the first run's checkpoint", !!b.run.stages.reading.from_checkpoint && b.run.stages.reading.cost_usd === 0);
const fresh = [...new Set(b.run.calls.filter((c) => !c.from_checkpoint).map((c) => c.stage))];
t(`checkpoint: only construction passes run again (${fresh.join(", ") || "none"})`, fresh.every((s) => ["compose", "delta", "audit"].includes(s)) && a.run.calls.some((c) => !["compose", "delta", "audit"].includes(c.stage)));
t("checkpoint: the same ontology is settled", JSON.stringify(a.row.ontology?.case) === JSON.stringify(b.row.ontology?.case) && a.row.ontology?.rho?.value === b.row.ontology?.rho?.value);
t("checkpoint: the reading is delivered", a.run.stages.reading.delivered && b.run.stages.reading.delivered);
const q = s7Stages({ stages: { admission: 0.5, extraction: 1, ontology: 0.2, composition: 0.3, delta: 0.05, audit: 0.05 } });
t("stages: priced apart at twice the estimate", q.reading.price_usd === 3.4 && q.construction.price_usd === 0.8);
t("stages: a stage that did not deliver is not charged", stageCharge({ name: "construction", delivered: false, cost_usd: 0.3 }, q.construction) === 0);
t("stages: a delivered reading is charged at twice its measured cost", stageCharge({ name: "reading", delivered: true, cost_usd: 1.2 }, q.reading) === 2.4);
t("stages: never above the quoted line", stageCharge({ name: "reading", delivered: true, cost_usd: 5 }, q.reading) === 3.4);
t("stages: a reading from the checkpoint at the ledgered rate", stageCharge({ name: "reading", delivered: true, from_checkpoint: "x", cost_usd: 0 }, q.reading) === 0.1);
