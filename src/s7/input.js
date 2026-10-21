// The S7 input: one address of one entity, its transcript T, and its disclosed field B (EA-NEGONT-02 v0.9 §0.4, §3.1).
// Two adapters build it. fromWikipedia: T is a pinned revision, B is every source the revision cites. fromNonRow: T and
// B are an existing /non row's transcript and saved field texts, so the procedure can be re-run on the archive's own rows
// and scored against them (calibration, §5.4 of EA-WIKI-OPEN-01).
import * as cheerio from "cheerio";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../util.js";

export const ARCHIVE = process.env.GNOSIS_ARCHIVE || "/home/claude/alexanarch";
export const NON = join(ARCHIVE, "datasets/negative-of-the-negative/v2");

export const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The entity's strings, taken from the article itself: its title, and the bold and language-tagged names of its lead.
export function leadAliases(pinned) {
  const $ = cheerio.load(pinned.html);
  const lead = $("p").filter((_, el) => $(el).text().trim().length > 40).first();
  const names = new Set([pinned.title]);
  lead.find("b").each((_, el) => names.add($(el).text().trim()));
  lead.find("[lang]").each((_, el) => names.add($(el).text().trim()));
  const out = [];
  for (const n of [...names].filter((n) => n.length >= 4)) {
    const latin = /^[\p{Script=Latin}\p{N}\p{P}\s]+$/u.test(n);
    out.push({ pattern: latin ? `\\b${reEsc(n)}\\b` : reEsc(n), flags: latin ? "i" : "", from: n === pinned.title ? "title" : "lead" });
  }
  return out;
}

export function fromWikipedia(pinned, claims, sources) {
  const field = [], seen = new Map();
  const cites = {};
  for (const c of claims) {
    cites[c.id] = [];
    for (const s of sources[c.id] || []) {
      const k = s.kind === "classical" ? `classical|${s.url}|${s.scope}` : `${s.kind}|${s.final_url || s.url || s.citation || s.note}`;
      if (!seen.has(k)) {
        const id = `B${field.length + 1}`;
        seen.set(k, id);
        field.push({ id, kind: s.kind, card: s.kind === "classical" ? `${s.edition} (${s.scope})` : (s.citation || s.url || "").replace(/\s+/g, " ").slice(0, 300),
          url: s.final_url || s.url || null, text: s.text || "", text_sha256: s.text_sha256 || null, availability: s.availability,
          fetched: s.retrieved ? `gnosis S2, ${s.retrieved.slice(0, 10)} (verbatim save; text extracted by code)` : `not fetchable: ${s.availability}` });
      }
      cites[c.id].push(seen.get(k));
    }
  }
  const text = claims.map((c) => c.text).join("\n");
  return {
    kind: "wikipedia",
    row: `${slug(pinned.title)}`,
    entity: { slug: slug(pinned.title), name: pinned.title, type: "C (public entity: the subject of an encyclopedia article)" },
    address: { string: pinned.url, surface: "Wikipedia (pinned revision)", auth: "public revision", date: (pinned.retrieved || "").slice(0, 10), oldid: pinned.oldid },
    T: { kind: "wikipedia-revision", text, sha256: sha256(text), html_sha256: pinned.html_sha256, url: pinned.url, licence: pinned.licence,
      claims: claims.map((c) => ({ id: c.id, section: c.section, text: c.text, cites: cites[c.id] })) },
    field,
    aliases: leadAliases(pinned),
  };
}

export function fromNonRow(rowKey, savedDir) {
  const row = JSON.parse(readFileSync(join(NON, "rows", `${rowKey}.json`), "utf8"));
  const fieldLedger = JSON.parse(readFileSync(join(ARCHIVE, row.ledger.field), "utf8"));
  const tPath = join(ARCHIVE, row.objects.T.path);
  const T = existsSync(tPath) ? readFileSync(tPath, "utf8") : "";
  const summary = JSON.parse(readFileSync(join(NON, "traversal", rowKey, "summary.json"), "utf8"));
  const field = fieldLedger.field.filter((b) => b.saved?.text).map((b) => {
    const p = join(savedDir, b.saved.text);
    const text = existsSync(p) ? readFileSync(p, "utf8") : "";
    return { id: b.id, kind: "card", card: b.card, url: b.url, text, text_sha256: text ? sha256(text) : null,
      availability: text ? "fetched" : "unavailable", fetched: b.fetched, expected_sha256: b.sha256?.text || null };
  });
  return {
    kind: "non-row", row: rowKey,
    entity: { slug: row.entity, name: summary.entity || row.entity, type: row.type },
    address: { string: row.address, surface: row.surface, auth: row.auth, date: row.epoch },
    T: { kind: "transcript", path: row.objects.T.path, register: row.objects.T.register, cards: row.objects.T.cards, inline_source_labels: row.objects.T.inline_source_labels, text: T, sha256: sha256(T), claims: (row.objects.T.claims || []).map((c, i) => (typeof c === "string" ? { id: `T${i + 1}`, text: c } : { id: c.id || `T${i + 1}`, text: c.text || c.claim || "" })) },
    field,
    aliases: summary.config.aliases,
    traversal_config: summary.config,
    prefix: (JSON.parse(readFileSync(join(ARCHIVE, row.ledger.archive), "utf8"))[0]?.id.match(/^[A-Za-z]+/) || [null])[0],
  };
}
