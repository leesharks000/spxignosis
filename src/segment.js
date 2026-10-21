// S1. Segment: sentences of the article body, each with its inline references.
import * as cheerio from "cheerio";
import { sha256 } from "./util.js";

// Parenthetical classical pointers, e.g. "(Soph. Ref., 34, 183b34 ff.)" -> Bekker locus.
const BEKKER = /\(([A-Z][\w.]*(?:\s[A-Z][\w.]*)*),?\s*(\d+),\s*(\d{2,4}[ab]\d{1,2})(?:\s*ff\.?)?\)/g;

function splitSentences(text) {
  // Conservative splitter: ends at . ! ? followed by space + capital/quote, skipping common abbreviations.
  const abbr = /\b(?:c|ca|cf|e\.g|i\.e|vol|ed|eds|trans|Soph|Ref|Rhet|Top|Metaph|Ph|ff|pp|p|St|Mr|Dr)\.$/i;
  const out = []; let buf = "";
  const parts = text.split(/(?<=[.!?]["”’)]?)\s+(?=["“(]?[A-Z0-9Α-Ω])/);
  for (const p of parts) {
    buf = buf ? `${buf} ${p}` : p;
    if (!abbr.test(buf.trim())) { out.push(buf.trim()); buf = ""; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

export function segment(pinned) {
  const $ = cheerio.load(pinned.html);
  // References: cite_note id -> text and links.
  const refs = {};
  $("ol.references > li[id^='cite_note']").each((_, li) => {
    const id = $(li).attr("id");
    const links = $(li).find("a.external").map((_, a) => $(a).attr("href")).get();
    const rt = $(li).find(".reference-text").clone(); rt.find("style").remove();
    refs[id] = { id, text: rt.text().replace(/\s+/g, " ").trim(), links: [...new Set(links)] };
  });
  const claims = [];
  let section = "lead";
  $("h2, h3, p, .mw-parser-output > ul > li, .mw-parser-output > ol > li").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if ($(el).closest("ol.references, .reflist, .navbox, .sidebar, .infobox").length) return;
    if (tag === "h2" || tag === "h3") { section = $(el).text().replace(/\[edit\]/g, "").trim(); return; }
    if (["See also", "References", "Notes", "External links", "Further reading", "Bibliography", "Sources"].includes(section)) return;
    // Mark footnote positions inline so they stay attached to their sentence.
    const p = $(el).clone();
    p.find("sup.reference").each((_, s) => {
      const href = $(s).find("a").attr("href") || "";
      $(s).replaceWith(` ⟦${href.replace(/^#/, "")}⟧`);
    });
    p.find("style, .mw-editsection").remove();
    const text = p.text().replace(/\s+/g, " ").trim();
    if (text.length < 20) return;
    for (const s of splitSentences(text)) {
      const noteIds = [...s.matchAll(/⟦([^⟧]+)⟧/g)].map((m) => m[1]);
      const clean = s.replace(/\s*⟦[^⟧]+⟧/g, "").trim();
      const pointers = [...clean.matchAll(BEKKER)].map((m) => ({ kind: "classical", work: m[1], chapter: m[2], locus: m[3], raw: m[0] }));
      claims.push({
        id: `W${claims.length + 1}`, section, text: clean, text_sha256: sha256(clean),
        footnotes: noteIds.map((n) => refs[n] || { id: n, missing: true }),
        pointers,
        cited: noteIds.length > 0 || pointers.length > 0,
      });
    }
  });
  return { claims, refs };
}
