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
  const fieldLedger = row.ledger?.field && existsSync(join(ARCHIVE, row.ledger.field)) ? JSON.parse(readFileSync(join(ARCHIVE, row.ledger.field), "utf8")) : { field: [] };
  const tPath = join(ARCHIVE, row.objects.T?.path || "-");
  const T = existsSync(tPath) ? readFileSync(tPath, "utf8") : "";
  const summary = JSON.parse(readFileSync(join(NON, "traversal", rowKey, "summary.json"), "utf8"));
  // Every disclosed source with an address is carried. The rows record what was fetched (a description, a date, a hash) and
  // do not save the text, so a source with no saved text is carried without one, for the caller to fetch (calibration
  // does, pinned to the date the row read it); before 2026-10-25 such sources were dropped, and every calibration row ran
  // with no field at all.
  const field = (fieldLedger.field || []).filter((b) => b.saved?.text || (b.url && b.url !== "None")).map((b) => {
    const p = savedDir && b.saved?.text ? join(savedDir, b.saved.text) : "";
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
    prefix: existsSync(join(ARCHIVE, row.ledger?.archive || "-")) ? (JSON.parse(readFileSync(join(ARCHIVE, row.ledger.archive), "utf8"))[0]?.id.match(/^[A-Za-z]+/) || [null])[0] : null,
  };
}

// fromEntity: an entity with no encyclopedia article. /non admits what exists; Wikipedia's notability standard is
// Wikipedia's admission rule and gates nothing here. The caller names the entity and its strings, and may supply
// a composition at an address (a transcript, with its surface and date) and sources (URLs, fetched and hashed as B).
// With no transcript, T is the null composition (#1690 §2.2: "A null composition, a refusal, a body with no source is a
// transcript"), and the encyclopedia's absence at the entity's title is checked and recorded as an observation.
export function fromEntity(spec, { sources = [], wikipedia = null } = {}) {
  const name = String(spec.name || "").trim();
  const operator = spec.kind === "operator";
  // An operator's strings are the phrases in which it is performed and in which entities speak it; its name is a label
  // and is matched only when the caller lists it among them.
  const strings = [...new Set([...(operator ? [] : [name]), ...(operator ? spec.strings || [] : spec.aliases || [])].map((s) => String(s).trim()).filter((s) => s.length >= 3))];
  const aliases = strings.map((n) => {
    const latin = /^[\p{Script=Latin}\p{N}\p{P}\s]+$/u.test(n);
    return { pattern: latin ? `\\b${reEsc(n)}\\b` : reEsc(n), flags: latin ? "i" : "", from: n === name ? "name" : "alias (caller)" };
  });
  const field = sources.map((s, i) => ({ id: `B${i + 1}`, kind: "supplied", card: (s.title || s.url || "").slice(0, 300), url: s.final_url || s.url, text: s.text || "", text_sha256: s.text_sha256 || null,
    availability: s.availability, fetched: s.retrieved ? `gnosis, ${s.retrieved.slice(0, 10)} (verbatim save; text extracted by code)` : `not fetchable: ${s.availability}` }));
  const tr = spec.transcript?.text ? String(spec.transcript.text) : "";
  const sentences = tr ? tr.split(/\n+|(?<=[.!?])\s+(?=[A-Z“"'(])/).map((s) => s.trim()).filter((s) => s.length > 2) : [];
  const address = spec.address || name.toLowerCase();
  return {
    kind: "entity",
    row: operator ? `op-${slug(name)}` : slug(name),
    object_kind: operator ? "operator" : "entity", object_description: operator ? String(spec.description || "") : undefined,
    commission: spec.commission || (tr ? "open" : "construct"),
    entity: { slug: operator ? `op-${slug(name)}` : slug(name), name, type: operator ? "Op (an operator: the operation an entity form conceals, composed as its own object)" : spec.type || "C (an entity the encyclopedia does not hold; its type is read from its defining papers)" },
    address: { string: address, surface: tr ? (spec.transcript.surface || "Google AI Overview") : "none (null composition)", auth: tr ? (spec.transcript.auth || "signed out, incognito") : "—",
      date: (spec.transcript?.date || new Date().toISOString()).slice(0, 10) },
    T: { kind: tr ? "transcript" : "null", text: tr, sha256: sha256(tr), claims: sentences.map((t, i) => ({ id: `T${i + 1}`, text: t, cites: [] })), wikipedia,
      capture: spec.transcript?.capture ? { slug: spec.transcript.capture.slug, entry: spec.transcript.capture.entry, obs_id: spec.transcript.capture.obs_id, addr_id: spec.transcript.capture.addr_id, q: spec.transcript.capture.q, registry: "data/EA-WG-CAPTURES-01.json" } : undefined,
      note: spec.transcript?.capture ? "T is the composition layer's own article of the entity: the capture seated at its bare address (the closed-ontology article); B is that capture's source cards" : tr ? "a composition at the address, supplied by the caller" : "the null composition: no composition at the address was supplied, and the encyclopedia holds no article at the entity's title (observed at the quote); the entity's absence there is itself the observation the row begins from" },
    field, aliases, works_by: spec.works_by || [],
  };
}

// The closed-ontology article (operator, 2026-10-21: "the existing captures can serve as the closed ontology wiki").
// For an entity the encyclopedia does not hold, the composition layer's own article of it is in the Capture Registry: the
// observations seated at the entity's bare addresses (its name; "who is <name>"). The most recent observation there with a
// substantive transcript is T; its source cards are B; every other observation at those addresses, and the captures at
// the entity's other addresses, are carried as records of T.
let CAPS = null;
// A caller may name which seated capture is T (by its observation id or slug), among those at any address naming the
// entity; it may never supply one. The registry's own intake decides what a capture is.
export function capturesFor(names, { pick = null } = {}) {
  if (!CAPS) { const p = join(ARCHIVE, "data/EA-WG-CAPTURES-01.json"); CAPS = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).entries : []; }
  const low = names.map((n) => n.toLowerCase().trim());
  const bare = new Set(low.flatMap((n) => [n, `who is ${n}`, `who is ${n}?`, `tell me about ${n}`, `${n}?`]));
  const any = low.map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  const obs = [], related = [];
  for (const e of CAPS) {
    const q = String(e.q || "").toLowerCase().trim();
    if (!any.some((r) => r.test(q))) continue;
    const list = (e.observations && e.observations.length ? e.observations : [e]).map((o) => ({ ...o, q: o.q || e.q, slug: o.slug || e.slug, entry: e.slug }));
    for (const o of list) (bare.has(q) ? obs : related).push({ slug: o.slug, entry: o.entry, q: o.q, date: o.date, surface: o.surface, auth: o.auth, obs_id: o.obs_id, addr_id: o.addr_id,
      transcript: o.transcript || "", chars: (o.transcript || "").length, cite_list: o.cite_list || [] });
  }
  const usable = obs.filter((o) => o.chars >= 300).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (pick) {
    const chosen = [...obs, ...related].find((o) => o.obs_id === pick || o.slug === pick);
    if (!chosen) throw new Error(`no capture ${pick} is seated in the Capture Registry at an address naming the entity`);
    if (chosen.chars < 300) throw new Error(`capture ${pick} carries no substantive transcript (${chosen.chars} characters)`);
    return { primary: chosen, picked: true, bare: obs.map(({ transcript, cite_list, ...o }) => o), related: related.map(({ transcript, cite_list, ...o }) => o) };
  }
  return { primary: usable[0] || null, bare: obs.map(({ transcript, cite_list, ...o }) => o), related: related.map(({ transcript, cite_list, ...o }) => o) };
}
