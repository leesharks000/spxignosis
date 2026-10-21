// The reader receives the passages of a source that bear on the claim, not the whole source.
// The full text stays in the hashed snapshot; the validator checks quotations against the full text.
import { norm } from "./validate.js";

const STOP = new Set("the a an and or of to in on for with by as is are was were be been this that these those it its from at which who whom whose not no but into than then there their they he she his her has have had do does did also".split(" "));

function terms(s) {
  return [...new Set(norm(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u).filter((w) => (/^\d+$/.test(w) || w.length > 2) && !STOP.has(w)))];
}

// Score fixed windows by overlap with the claim's terms (accents folded); return the best few, in order.
export function windows(text, claim, { size = 1800, step = 600, keep = 3, extraTerms = [] } = {}) {
  if (!text) return { passages: [], coverage: 0 };
  if (text.length <= size * keep) return { passages: [{ start: 0, end: text.length, text }], coverage: 1, whole: true };
  const want = [...terms(claim), ...extraTerms.flatMap(terms)];
  const fold = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const scored = [];
  for (let s = 0; s < text.length; s += step) {
    const w = fold.slice(s, s + size);
    let score = 0;
    for (const t of want) if (/^\d+$/.test(t) ? new RegExp(`(^|\\D)${t}(\\D|$)`).test(w) : w.includes(t)) score += /^\d+$/.test(t) ? 3 : t.length > 6 ? 2 : 1;
    scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of scored) {
    if (picked.length >= keep || c.score === 0) break;
    if (picked.some((p) => Math.abs(p.s - c.s) < size)) continue;
    picked.push(c);
  }
  if (!picked.length) picked.push({ s: 0 });
  picked.sort((a, b) => a.s - b.s);
  // The opening of the source travels with the passages, so the reader knows what it is reading.
  if (!picked.some((p) => p.s === 0)) picked.unshift({ s: 0, head: true });
  const passages = picked.map((p) => ({ start: p.s, end: Math.min(text.length, p.s + size), text: text.slice(p.s, p.s + (p.head ? 600 : size)), ...(p.head ? { role: "head" } : {}) }));
  return { passages, coverage: passages.reduce((n, p) => n + (p.end - p.start), 0) / text.length };
}

// Division markers counted by code, so a claim about a work's structure can be checked
// without sending the whole source. Returns e.g. { Part: { count: 34, max: 34 } }.
export function structure(text) {
  const out = {};
  for (const m of (text || "").matchAll(/(?:^|\n|\s{2,})(Part|Chapter|Book|Section|BOOK|CHAPTER|PART)\s+([0-9]+|[IVXLC]+)\b/g)) {
    const k = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : null;
    out[k] = out[k] || { count: 0, max: 0 };
    out[k].count++; if (n && n > out[k].max) out[k].max = n;
  }
  return out;
}
