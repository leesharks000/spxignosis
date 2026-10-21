// One model pass of S7, live or replayed. Every pass returns JSON, its usage, and how it was produced.
// Live: the Claude API, the stage's instructions and the shared material marked for prompt caching.
// Replay: a recording under store/replays/s7/<row>/<stage>/<id>.json, labelled in every result.
import { load } from "../util.js";
import { callCost } from "../cost.js";

export const S7_PROTOCOL = "gnosis-S7/0.1 (EA-NEGONT-02 v0.9, #1690)";
export const mode = () => ((process.env.GNOSIS_READER || "anthropic") === "replay" ? "replay" : "live");

export const MODELS = {
  triage: process.env.GNOSIS_TRIAGE_MODEL || "claude-haiku-5-5",
  reading: process.env.GNOSIS_MODEL || "claude-sonnet-5-5",
};

function parseJSON(text) {
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(m ? m[0] : text);
}

async function live({ system, shared, task, model, maxTokens = 8000, temperature = 0 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set: the live S7 passes cannot run");
  const content = [];
  if (shared) content.push({ type: "text", text: shared, cache_control: { type: "ephemeral" } });
  content.push({ type: "text", text: task });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`S7 pass HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return { out: parseJSON(j.content.map((c) => c.text || "").join("")), usage: j.usage };
}

// A ledger of every pass the run made: stage, id, how, model, usage, cost. The run carries an execution budget: once
// spent cost reaches it, later passes are recorded as not run and the row is composed from what was read (a marked
// partial result). A call that fails is recorded with its error and returns nothing; the run continues.
export function passLog({ budget_usd = Infinity } = {}) {
  const calls = [];
  const spent = () => calls.reduce((n, c) => n + (c.cost_usd || 0), 0);
  return {
    calls, budget_usd,
    exhausted() { return calls.some((c) => c.how === "not run: execution budget exhausted"); },
    async run({ row, stage, id, system, shared, task, model, maxTokens, temperature }) {
      if (mode() === "replay") {
        const r = load(`replays/s7/${row}/${stage}/${id}.json`);
        const entry = { stage, id, how: r ? `replay: ${r.recorded || "recorded"}` : "not run: no recording", model: r?.model || null, usage: null, cost_usd: 0 };
        calls.push(entry);
        return r ? r.out : null;
      }
      if (spent() >= budget_usd) { calls.push({ stage, id, how: "not run: execution budget exhausted", model, usage: null, cost_usd: 0 }); return null; }
      try {
        const { out, usage } = await live({ system, shared, task, model, maxTokens, temperature });
        calls.push({ stage, id, how: `live:${model}`, model, usage, cost_usd: callCost(model, usage) || 0 });
        return out;
      } catch (e) {
        calls.push({ stage, id, how: `failed: ${String(e.message || e).slice(0, 200)}`, model, usage: null, cost_usd: 0 });
        return null;
      }
    },
    cost() { return Math.round(calls.reduce((n, c) => n + (c.cost_usd || 0), 0) * 1e5) / 1e5; },
  };
}
