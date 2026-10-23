// Archive-grounded sentences (operator, 2026-10-23: "lets add the archive grounded sentences at near-basic prices").
// A commission composes the entity's /non row once, from the archive's own procedure; the row's ontology pass aligns
// each sentence of T to the archive's claims on it. A sentence request in mode=grounded is served that alignment from a
// complete commissioned row, found by the sentence's text in the row's T, so a later revision that keeps the sentence is
// grounded too. The row's release is disclosed beside the archive's current one. No row, no grounding: the caller is
// offered the commission, and S7 is never run for one sentence.
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { load, list } from "./util.js";

export const V2 = "datasets/negative-of-the-negative/v2";
const norm = (s) => String(s || "").normalize("NFKC").replace(/\[\s*(\d+|[a-z]|citation needed|note \d+)\s*\]/gi, " ")
  .replace(/[“”"‘’']/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

// One alignment entry of a row, with the archive claims it names resolved against the row's archive ledger.
export function archiveOn(a, ledger) {
  const byA = Object.fromEntries((ledger || []).map((c) => [c.id, c]));
  return { bears: a.bears, note: a.note, claims: (a.archive_claims || []).filter((id) => byA[id]).map((id) => ({ id, dep: byA[id].dep, record: byA[id].record, locus: byA[id].locus, quote: byA[id].quote,
    url: byA[id].dep ? `https://www.alexanarch.org/s/records/${byA[id].dep}/` : byA[id].record?.url })) };
}

export function readLanding(landing, rowKey) {
  const rd = (rel) => (landing && existsSync(join(landing, rel)) ? JSON.parse(readFileSync(join(landing, rel), "utf8")) : null);
  return { row: rd(`${V2}/rows/${rowKey}.json`), ledger: rd(`${V2}/ledgers/${rowKey}/ledger-archive.json`) || [] };
}

// The newest complete commissioned row for this entity whose T holds the sentence, with the sentence's alignment.
export async function groundingFor(rowKey, text, currentRelease = null) {
  const rel = `s7/${rowKey}/by-key`;
  if (!rowKey) return null;
  const t = norm(text), found = [];
  for (const f of (await list(rel)).filter((x) => x.endsWith(".json"))) {
    const s7 = await load(`${rel}/${f}`);
    if (!s7?.complete || !s7.landing) continue;
    const { row, ledger } = readLanding(s7.landing, rowKey);
    // The row keeps T's sentences as "W3 the sentence" (row.js); an object form is read as well.
    const claim = (row?.objects?.T?.claims || []).map((c) => (typeof c === "string" ? { id: c.split(" ")[0], text: c.slice(c.indexOf(" ") + 1) } : c)).find((c) => norm(c.text) === t);
    if (!claim) continue;
    const a = (row.ontology?.t_alignment || []).find((x) => x.t === claim.id);
    found.push({ key: s7.key || f.replace(/\.json$/, ""), composed: s7.created || null, release: s7.release?.commit || null,
      revision: row.address?.oldid ?? row.objects?.T?.url?.match(/oldid=(\d+)/)?.[1] ?? null, sentence_id: claim.id, non_url: s7.non_url || null,
      archive: a ? archiveOn(a, ledger) : { bears: "none recorded", note: "the row's alignment records no archive claim on this sentence", claims: [] } });
  }
  if (!found.length) return null;
  const g = found.sort((x, y) => (x.composed < y.composed ? 1 : -1))[0];
  const cur = currentRelease?.commit ?? currentRelease ?? null;
  return { ...g, current_release: cur, archive_moved: !!(g.release && cur && g.release !== cur),
    note: g.release && cur && g.release !== cur ? "the row was composed at an earlier archive release; deposits since then are not in this grounding, and a commission recomposes it" : undefined };
}
