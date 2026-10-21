// About and by (operator, 2026-10-21): "it is important to distinguish material about lee sharks from material by lee
// sharks. the first is the relevant smaller subset that requires reading... the second requires scanning. reading the
// whole thing would be commissioning a large book, not a wiki article."
//
// Where the entity is also an author in the archive (the registry names it, or a name the caller counts as its, as a
// creator), the archive's mentions of it divide in two. Material about the entity is read: a deposit whose registry
// title, subject triple or description makes the entity its topic, and any sentence that predicates something of the
// entity (each distinct sentence read once; its repetitions join its lineage). Material by the entity, and every other
// mention, is scanned: enumerated by code into a works ledger and a mention count, with no model call. Price then
// follows what is about the entity, never the volume of what it wrote. Where the entity is no author in the archive,
// every mention is the archive's bearing on it, and the D/R/O reading of #1690 §3.4 stands unchanged.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { registry } from "./archive.js";
import { ARCHIVE } from "./input.js";

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const PER_DEPOSIT = 6;

export function heteronymNames() {
  const p = join(ARCHIVE, "datasets/heteronyms/heteronyms.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).name; } catch { return null; } }).filter((n) => n && n.length > 3);
}

// The names whose works count as the entity's: its own strings, and any the caller names (for the archive's author,
// "heteronyms" counts every heteronym in the archive's registry of them).
export function authorNames(input) {
  const own = input.aliases.map((a) => new RegExp(a.pattern, a.flags?.includes("i") ? "i" : ""));
  const extra = (input.works_by || []).flatMap((n) => (n === "heteronyms" ? heteronymNames() : [n]));
  const extraRe = extra.length ? [new RegExp(`\\b(${extra.map(reEsc).join("|")})\\b`, "i")] : [];
  return [...own, ...extraRe];
}

export function worksLedger(input) {
  const names = authorNames(input);
  return [...registry().values()].filter((d) => names.some((r) => r.test(String(d.creator || ""))))
    .map((d) => ({ dep: d.deposit_number, title: String(d.title || "").slice(0, 200), date: d.date, creator: String(d.creator || "").slice(0, 120), axn: d.axn }))
    .sort((a, b) => a.dep - b.dep);
}

function predication(input) {
  const alt = input.aliases.map((a) => a.pattern).join("|");
  const V = "is|was|has|had|holds|held|writes|wrote|argues|argued|names|named|calls|called|coined|coins|defines|defined|teaches|taught|built|builds|founded|operates|claims|describes|presents|speaks|becomes|became|remains|appears|signs|publishes|published|lives|works|worked|studied|says|said";
  return new RegExp(`(?:${alt})\\s+(?:${V})\\b|\\b(?:heteronym|poet|author|figure|persona|scholar|teacher|writer)\\s+(?:${alt})|(?:${alt})\\s*\\((?:a|an|the)\\s`, "i");
}

// A longer name that contains the entity's own string is another name (the archive's Mary Lee Sharks contains Lee
// Sharks); its occurrences are struck before the entity's strings are matched.
export function longerNames(input) {
  const own = input.aliases.map((a) => new RegExp(a.pattern, "i"));
  return [...new Set([...heteronymNames(), ...(input.works_by || []).filter((n) => n !== "heteronyms")])]
    .filter((n) => own.some((r) => r.test(n) && n.replace(r, "").trim() !== ""));
}
const strike = (s, longer) => longer.reduce((t, n) => t.replace(new RegExp(reEsc(n), "gi"), " "), String(s || ""));

// Strikes the byline forms of the entity's name from a title or description: "by", "Author:", "Depositor:", a name
// followed by an ORCID, a middle dot, an imprint or a series, a name set between dashes or closing a title, a
// citation's "(Name; Press…)", and the possessive that names a work as the entity's. What remains names it as a topic.
function unbylined(s, input, longer) {
  const N = `(?:${input.aliases.map((a) => a.pattern).join("|")})`;
  let t = strike(s, longer);
  for (const p of [
    `\\b(?:by|from|authors?|depositor|creator|edited by|translated(?: and edited)? by|filed through|filed by|signed|credits?)\\s*:?\\**\\s*\\**\\s*${N}`,
    `${N}(?=\\s*(?:\\(?\\s*ORCID|·|Crimson Hexagonal|Semantic Economy Institute|MANUS|Journ|[—–]\\s*(?:New Human|minting|Author)|,\\s*(?:with|MANUS)|;\\s))`,
    `[—–]\\s*${N}\\s*(?=[—–]|$)`,
    `${N}['’]s\\b`,
    `\\battribut\\w*\\s+(?:\\w+\\s+){0,2}to\\s+${N}`,
    `${N}(?=[^.]{0,40}\\b(?:author|co-author|credited|wrote|writes|claimant|founder)s?\\b)`,
    `${N}(?=\\s+Originally)`,
  ]) t = t.replace(new RegExp(p, "gi"), " ");
  return t;
}

export function topicOf(d, input, names, longer = longerNames(input)) {
  if (!d) return null;
  const own = input.aliases.map((a) => new RegExp(a.pattern, a.flags?.includes("i") ? "i" : ""));
  const any = (s) => own.some((r) => r.test(String(s || "")));
  const alt = input.aliases.map((a) => a.pattern).join("|");
  if (any(unbylined(d.title, input, longer))) return "title";
  // A subject triple whose subject is the entity itself, or a relation of it (its role, its provenance, a parable of it);
  // a work's authorship triple, a search string or a translator line is not.
  const subj = (d.entities || []).some((e) => {
    const s = strike(e.subject ?? e.s ?? e[0] ?? "", longer), p = String(e.predicate ?? e.p ?? e[1] ?? "");
    if (!any(s) || /^\s*["“]?(translated|search|query|author|edited|by)\b/i.test(s)) return false;
    if (/\b(relation\w*|role|provenance|parable|heteronym|identity|profile)\b/i.test(s)) return true;
    const rest = own.reduce((x, r) => x.replace(new RegExp(r.source, "gi"), " "), s).replace(/[^\p{L}]+/gu, " ").trim();
    return !/^(created_by|minted|author|written|translated)/i.test(p) && rest.split(" ").filter(Boolean).length <= 2;
  });
  if (subj) return "subject";
  // A description is about the entity when, its bylines struck, it predicates of the entity or presents, names,
  // describes, profiles or searches for it.
  const u = unbylined(String(d.description || "").slice(0, 400), input, longer);
  const aboutVerb = new RegExp(`\\b(?:present\\w*|establish\\w*|nam(?:e|es|ed|ing)|identif\\w*|describ\\w*|profil\\w*|about|concern\\w*|regarding|quer(?:y|ies)|search\\w*|disambiguat\\w*)\\s+(?:of\\s+|the\\s+)?["“]?(?:${alt})`, "i");
  if (any(u) && (predication(input).test(u) || aboutVerb.test(u))) return "description";
  // Keywords name a deposit's index terms; they make no deposit about the entity (its sentences may still predicate).
  return null;
}

// A deposit read for its topic is read as #1690 reads any admitted deposit (whole, or its opening and bearing
// paragraphs past the size cap). A deposit read for a predication alone is read at the predicating paragraphs and
// their neighbours, and seeds no hop: the hop follows what is about the entity, never the citations among its works.
export const readsWhole = (division, dep) => division.mode === "bearing" || division.basisOf?.[dep] === "topic";

export function divide(input, candidates, isByline) {
  const works = worksLedger(input);
  if (!works.length) return { mode: "bearing", read: candidates, scanned: null, works: [], basisOf: {} };
  const names = authorNames(input), reg = registry(), pred = predication(input);
  const own = input.aliases.map((a) => new RegExp(a.pattern, a.flags?.includes("i") ? "i" : ""));
  const byDep = new Map(), once = new Set();
  // D, R and O repeat a sentence that is in more than one stratum; it is read once here.
  for (const c of candidates) { const k = `${c.dep}|${c.para}|${c.sent}`; if (once.has(k)) continue; once.add(k); if (!byDep.has(c.dep)) byDep.set(c.dep, []); byDep.get(c.dep).push(c); }
  const read = [], seen = new Set(), basis = {}, longer = longerNames(input);
  let scannedDeps = 0, scannedSentences = 0, bylines = 0, otherNames = 0;
  for (const [dep, cs] of byDep) {
    const live = cs.filter((c) => { if (!own.some((r) => r.test(strike(c.sentence, longer)))) { otherNames++; return false; } const b = isByline(c.sentence, own); if (b) bylines++; return !b; });
    const tp = typeof dep === "number" ? topicOf(reg.get(dep), input, names, longer) : null;
    const pr = live.filter((c) => pred.test(strike(c.sentence, longer))).filter((c) => { const k = c.sentence.replace(/\W+/g, " ").trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const take = tp ? [...pr, ...live.filter((c) => !pr.includes(c))] : pr;
    if (take.length) { for (const c of take.slice(0, PER_DEPOSIT)) read.push({ ...c, about: tp ? `topic: ${tp}` : "predication" }); basis[tp ? "topic" : "predication"] = (basis[tp ? "topic" : "predication"] || 0) + 1; }
    else { scannedDeps++; scannedSentences += live.length; }
  }
  const basisOf = Object.fromEntries([...new Set(read.map((c) => c.dep))].map((d) => [d, read.find((c) => c.dep === d).about.startsWith("topic") ? "topic" : "predication"]));
  return { mode: "about and by", read, works, basisOf,
    scanned: { deposits: scannedDeps, sentences: scannedSentences, bylines, other_names: { names: longer, sentences: otherNames }, works: works.length, read_deposits: Object.values(basis).reduce((a, b) => a + b, 0), basis,
      rule: "material about the entity is read (topic by registry title or description with its bylines struck, or a subject triple of the entity itself; or a sentence that predicates of it, each distinct sentence once, at most " + PER_DEPOSIT + " per deposit); material by it, and every other mention, is scanned" } };
}
