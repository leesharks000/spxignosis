// Composition by lineage (EA-NEGONT-02 v0.9 §3.6): "Composition gives a lineage one slot." Where a ledger is too large
// for one call, the ontology and composition passes receive one instance per lineage (its earliest, and every kernel
// claim), with the lineage's other instances listed by id, so every claim stays reachable and nothing is dropped.
import { estimateTokens } from "../cost.js";

export const LEDGER_TOKEN_LIMIT = 90000;

export function compactLedger(claims, limit = LEDGER_TOKEN_LIMIT) {
  const size = estimateTokens(JSON.stringify(claims));
  if (size <= limit) return { claims, compacted: false, size };
  const by = new Map();
  for (const c of claims) { const k = c.lineage || c.id; if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
  const out = [];
  for (const [lineage, cs] of by) {
    const sorted = cs.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    const keep = [sorted[0], ...sorted.slice(1).filter((c) => c.kernel)];
    for (const c of keep) out.push(c === sorted[0] && cs.length > 1 ? { ...c, lineage_instances: sorted.slice(1).filter((x) => !keep.includes(x)).map((x) => x.id) } : c);
  }
  return { claims: out, compacted: true, size, compacted_size: estimateTokens(JSON.stringify(out)), lineages: by.size, rule: "§3.6: one slot per lineage; the earliest instance and every kernel claim sent whole, the other instances by id" };
}
