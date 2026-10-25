// One model pass of S7, live or replayed. Every pass returns JSON, its usage, and how it was produced.
// Live: the Claude API, the stage's instructions and the shared material marked for prompt caching.
// Replay: a recording under store/replays/s7/<row>/<stage>/<id>.json, labelled in every result.
import { load } from "../util.js";
import { callCost, estimateTokens } from "../cost.js";
import { thinkingFor, THINKING } from "../reader.js";

export const S7_PROTOCOL = "gnosis-S7/0.1 (EA-NEGONT-02 v0.9, #1690)";
export const mode = () => ((process.env.GNOSIS_READER || "anthropic") === "replay" ? "replay" : "live");

export const MODELS = {
  triage: process.env.GNOSIS_TRIAGE_MODEL || "claude-haiku-5-5",
  reading: process.env.GNOSIS_MODEL || "claude-sonnet-5-5",
  thinking: THINKING === "on" ? "model default" : "up-front thinking off", // recorded with every row (composition_gnosis.models)
};

function parseJSON(text) {
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(m ? m[0] : text);
}

async function live({ system, shared, task, model, maxTokens = 8000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set: the live S7 passes cannot run");
  const content = [];
  if (shared) content.push({ type: "text", text: shared, cache_control: { type: "ephemeral" } });
  content.push({ type: "text", text: task });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    // Sampling parameters are omitted: Sonnet 5.5 rejects non-default values and Haiku 5.5 asks callers to omit them.
    // Up-front thinking is off for the S7 passes as for the readings (reader.js thinkingFor, 2026-10-24).
    body: JSON.stringify({ model, max_tokens: maxTokens, ...(thinkingFor(model) ? { thinking: thinkingFor(model) } : {}),
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`S7 pass HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return { text: j.content.map((c) => c.text || "").join(""), usage: j.usage };
}

// A ledger of every pass the run made: stage, id, how, model, usage, cost. The run carries an execution budget. Before
// each call the pass reserves its worst case (its input at the input rate, its output limit at the output rate); a call
// whose reservation would carry spending past the budget is recorded as not run, and the row is composed from what was
// read (a marked partial result). Usage is billed before the reply is parsed, so a reply that does not parse still
// counts. A call that fails is recorded with its error and returns nothing; the run continues. One log can serve a
// whole job (the construction and S7 share it), so the budget is the job's.
// A part of the budget can be held for later stages (2026-10-25): while it is held, the earlier passes may not spend
// into it, so the investigation cannot consume what the composition and its audit need to finish.
export function passLog({ budget_usd = Infinity } = {}) {
  let ceiling = budget_usd;
  const calls = [];
  const spent = () => calls.reduce((n, c) => n + (c.cost_usd || 0), 0);
  let held = 0;
  return {
    calls, get budget_usd() { return ceiling; },
    hold(usd) { held = Math.max(0, usd || 0); },
    // The construction may spend up to what the buyer paid for the archive's work (2026-10-25: "it should deliver when
    // possible"); the allowance stops the reading, never a paid construction.
    raise(usd) { if (usd > ceiling) ceiling = usd; },
    held() { return held; },
    exhausted() { return calls.some((c) => c.how === "not run: execution budget exhausted"); },
    async run({ row, stage, id, system, shared, task, model, maxTokens = 8000 }) {
      if (mode() === "replay") {
        const r = await load(`replays/s7/${row}/${stage}/${id}.json`);
        const entry = { stage, id, how: r ? `replay: ${r.recorded || "recorded"}` : "not run: no recording", model: r?.model || null, usage: null, cost_usd: 0 };
        calls.push(entry);
        return r ? r.out : null;
      }
      const reserve = callCost(model, { input_tokens: estimateTokens(`${system || ""}${shared || ""}${task || ""}`), output_tokens: maxTokens }) || 0;
      if (spent() + reserve > ceiling - held) { calls.push({ stage, id, how: "not run: execution budget exhausted", model, usage: null, cost_usd: 0, reserve_usd: Math.round(reserve * 1e4) / 1e4, ...(held ? { held_for_construction_usd: Math.round(held * 1e4) / 1e4 } : {}) }); return null; }
      // A call that fails, or whose reply does not parse, is made once more at twice the output limit: most replies
      // that do not parse were cut off at the limit (2026-10-25: one hop batch of the second commission of Sophistical
      // Refutations). Both attempts are recorded; only a pass that fails twice is a hole in the run.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const limit = attempt === 1 ? maxTokens : Math.min(maxTokens * 2, 32000);
        let text, usage;
        try { ({ text, usage } = await live({ system, shared, task, model, maxTokens: limit })); }
        catch (e) { calls.push({ stage, id, how: `${attempt === 1 ? "retried" : "failed"}: ${String(e.message || e).slice(0, 200)}`, model, usage: null, cost_usd: 0, attempt }); continue; }
        const cost_usd = callCost(model, usage) || 0;
        try {
          const out = parseJSON(text);
          calls.push({ stage, id, how: `live:${model}`, model, usage, cost_usd, sampling: "model defaults", ...(attempt > 1 ? { attempt, max_tokens: limit } : {}) });
          return out;
        } catch (e) {
          calls.push({ stage, id, how: attempt === 1 ? "retried: the reply did not parse as JSON (its usage is billed)" : "failed: the reply did not parse as JSON (its usage is billed)", model, usage, cost_usd, attempt });
        }
      }
      return null;
    },
    cost() { return Math.round(calls.reduce((n, c) => n + (c.cost_usd || 0), 0) * 1e5) / 1e5; },
  };
}
