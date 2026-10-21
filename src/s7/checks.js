// Code checks on a composition (EA-NEGONT-02 v0.9 §5; the composition rules of the /non briefs). Every check records;
// none prevents (§5.7). Heuristic checks are labelled as such.
import { units } from "./compose.js";
import { norm } from "../validate.js";

const STOPW = new Set("the a an and or of to in on for with by as is are was were be been this that these those it its from at which who not no but into than then there their they he she his her has have had do does did also what where when more most such only other same so can may one two".split(" "));
const contentTerms = (s) => (norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]{4,}/gu) || []).filter((w) => !STOPW.has(w));
// Grounding floor, set from the archive's own rows (2026-10-21): across se-183b34, theophrastus, model-collapse and
// howl, 5 of 158 units share under 30% of their content words with their cited quotes; the median is 55–79%.
export const GROUNDING_FLOOR = 0.3;

const GRADED = new Set(["interpretation", "hypothesis", "stipulation"]);
const GRADE = /\b(is|are|was|were) (read|held|defined|specified|stated|proposed|argued|said|taken|construed|described|reported|given)\b|\breads?\b|\bholds?\b|\bdefines?\b|\bargues?\b|\bproposes?\b|\bsuggests?\b|\bhypothes|\bon (the|its|this) reading\b|\baccording to\b|\b(by|in) [^.]{0,40}\baccount\b|\bon [^.]{0,40}\bview\b|\bsays?\b|\bstates?\b|\bcalls?\b|\bnames?\b|\bwrites?\b|\bmay\b|\bmight\b|\bwould\b|\btreats?\b|\bcounts?\b|\bmarks?\b|\brecords?\b|\b(almost certainly|probably|possibly|likely|perhaps|arguably|apparently)\b/i;
const unquoted = (s) => s.replace(/“[^”]*”|"[^"]*"|‘[^’]*’|(^|[\s(])'[^']*'(?=[\s.,;:)]|$)/g, " ");
const BANNED = [/\bnot\b[^.;:!?]{1,80}?,?\s+but\b/i, /\brather than\b/i, /\bnot\b[^.;:!?]{1,60},\s*only\b/i];

// Word-level similarity, 2·LCS/(|a|+|b|).
function sim(a, b) {
  const x = a.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [], y = b.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!x.length || !y.length) return 0;
  const dp = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) { let prev = 0; for (let j = 1; j <= y.length; j++) { const t = dp[j]; dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = t; } }
  return (2 * dp[y.length]) / (x.length + y.length);
}

export function checkComposition(c, { fieldClaims, archiveLedger, caseValue }) {
  const A = Object.fromEntries(archiveLedger.map((x) => [x.id, x]));
  const byId = { ...Object.fromEntries(Object.entries(fieldClaims).map(([id, v]) => [id, { id, ...v }])), ...A };
  const breaches = [];
  const all = (obj) => [...(obj?.sentences || []).flatMap((s) => s.claims || []), ...(obj?.lede?.claims || []),
    ...(obj?.sections || []).flatMap((s) => (s.items || []).flatMap((i) => i.claims || [])), ...(obj?.rail || []).flatMap((r) => r.claims || []), ...(obj?.open || []).flatMap((o) => o.rests_on || [])];
  for (const [k, obj] of Object.entries({ KO: c.KO, P: c.P, KO_B: c.KO_B, P_B: c.P_B })) {
    for (const id of all(obj)) {
      if (!byId[id]) breaches.push({ check: "claim-id", at: k, detail: `unknown claim ${id}` });
      else if (!byId[id].quote_ok) breaches.push({ check: "quote", at: k, detail: `cites ${id}, whose quote was not found in its source` });
      if ((k === "KO_B" || k === "P_B") && A[id]) breaches.push({ check: "field-arm", at: k, detail: `the field-only arm cites archive claim ${id}` });
    }
  }
  if (!(c.KO?.sentences || []).length) breaches.push({ check: "structure", detail: "a knowledge object with no sentences" });
  if (!c.P?.lede?.text) breaches.push({ check: "structure", detail: "a compression with no lede" });
  // Coverage (§5.1, C_ex): every carried claim is composed somewhere, or logged in the channel.
  const carried = [...Object.keys(fieldClaims).filter((id) => fieldClaims[id].quote_ok), ...archiveLedger.filter((x) => x.quote_ok).map((x) => x.id)];
  const composed = new Set([...all(c.KO), ...all(c.P), ...(c.channel || []).flatMap((x) => x.claims || [])]);
  // Composition by lineage (§3.6): an instance is carried when a claim of its lineage is composed.
  const lineageOf = Object.fromEntries(archiveLedger.map((x) => [x.id, x.lineage || x.id]));
  const composedLineages = new Set([...composed].map((id) => lineageOf[id]).filter(Boolean));
  for (const x of archiveLedger) if (x.quote_ok && composedLineages.has(x.lineage || x.id)) composed.add(x.id);
  const uncovered = carried.filter((id) => !composed.has(id));
  if (uncovered.length) breaches.push({ check: "coverage", detail: `${uncovered.length} carried claims neither composed nor logged in the channel`, claims: uncovered });
  // Kernel coverage at popup grain (§5.2): each source's kernel in the compression's body or rail.
  const pc = new Set(all(c.P));
  const kern = [...Object.entries(fieldClaims).filter(([, v]) => v.kernel && v.quote_ok).map(([id]) => id), ...archiveLedger.filter((x) => x.kernel && x.quote_ok).map((x) => x.id)];
  const kmiss = kern.filter((id) => !pc.has(id));
  if (kmiss.length) breaches.push({ check: "kernel-coverage", detail: `${kmiss.length} source kernels absent from the compression's body and rail`, claims: kmiss });
  // Sentence rules.
  for (const u of [...units(c), ...units({ KO: c.KO_B, P: c.P_B }).map((x) => ({ ...x, id: `B:${x.id}` }))]) {
    const own = unquoted(u.text || "");
    if (BANNED.some((r) => r.test(own))) breaches.push({ check: "construction", at: u.id, detail: "a construction that negates one term to assert another" });
    const ev = (u.claims || []).map((id) => byId[id]).filter(Boolean);
    const pool = ev.map((x) => `${x.quote} ${x.locus} ${x.date || ""} ${x.dep || ""}`).join(" ");
    const nums = (own.replace(/\b[A-Z][A-Za-z]*(?:-[A-Z0-9]+)+\b/g, " ").match(/(?<![#\w-])\d[\d.,–-]*\d|(?<![#\w-])\d(?![\w])/g) || []).filter((n) => !/^(1|2|3|4|5|6|7|8|9)$/.test(n));
    const unsupported = nums.filter((n) => !pool.includes(n.replace(/[.,]$/, "")));
    if (unsupported.length) breaches.push({ check: "numbers", at: u.id, detail: `numbers no cited quote or locus gives: ${unsupported.join(", ")}` });
    const ts = contentTerms(u.text || ""), qpool = new Set(contentTerms(ev.map((x) => x.quote).join(" ")));
    const share = ts.length ? ts.filter((w) => qpool.has(w)).length / ts.length : 1;
    if (!(u.claims || []).length) breaches.push({ check: "grounding", at: u.id, detail: "a unit that cites no claim" });
    else if (share < GROUNDING_FLOOR) breaches.push({ check: "grounding (heuristic)", at: u.id, detail: `${Math.round(share * 100)}% of the unit's content words occur in the quotes it cites (floor ${GROUNDING_FLOOR * 100}%)`, share: Math.round(share * 1000) / 1000 });
    if (ev.length && ev.every((x) => GRADED.has(x.modality)) && !GRADE.test(own)) breaches.push({ check: "grade (heuristic)", at: u.id, detail: "every cited claim is graded (interpretation, hypothesis or stipulation) and the sentence carries no grade in its grammar" });
  }
  // The measure (§4.10), the opening run (§5.10) and the blocks (§4.1).
  const KO = (c.KO?.sentences || []).map((s) => s.text), KB = (c.KO_B?.sentences || []).map((s) => s.text);
  const positions = KB.map((b) => { let best = -1, bs = 0; KO.forEach((k, i) => { const v = sim(b, k); if (v > bs) { bs = v; best = i; } }); return bs >= 0.95 ? best + 1 : null; });
  const surviving = positions.filter((p) => p !== null).length;
  const seq = (c.KO?.sentences || []).map((s) => { const f = (s.claims || []).some((id) => fieldClaims[id]), a = (s.claims || []).some((id) => A[id]); return f && a ? "M" : f ? "F" : a ? "A" : "?"; }).join("");
  const head = (seq.match(/^F*/) || [""])[0].length, tail = (seq.match(/A*$/) || [""])[0].length;
  const openingRun = surviving >= 2 && positions.slice(0, surviving).every((p, i) => p === i + 1);
  const measure = {
    rule: "v0.9 §4.10: KO_B sentences surviving in the KO at similarity ≥ 0.95, with positions (similarity: 2·LCS/(|a|+|b|) over words)",
    "v0.9": { surviving, of: KB.length, positions },
    opening_run: { rule: "v0.9 §5.10 (equal-terms case): the field-only KO's sentences as the KO's opening run in their own order", breach: caseValue === "equal" && openingRun },
    blocks: { rule: "v0.9 §4.1: sentences typed by the ledgers of the claims they cite (F field-only, A archive-only, M both)", sequence: seq, field_only_head: head, archive_only_tail: tail, breach: caseValue === "equal" && head >= 3 && tail >= 3 },
  };
  if (measure.opening_run.breach) breaches.push({ check: "opening-run", detail: "the field-only KO opens the KO as a run" });
  if (measure.blocks.breach) breaches.push({ check: "blocks", detail: `the KO opens with ${head} field-only sentences and closes with ${tail} archive-only ones` });
  return { breaches, measure, byId };
}
