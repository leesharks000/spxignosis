// The /non row, in the shape of the dataset's own rows (datasets/negative-of-the-negative/v2), with its ledgers,
// traversal, reading and a panel entry, written as a landing tree that mirrors the archive's paths. Third-party field
// texts are not written into it; their hashes are. A Wikipedia revision's text is written with its licence.
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { STORE, sha256 } from "../util.js";

const V2 = "datasets/negative-of-the-negative/v2";
const words = (t) => (t || "").match(/[A-Za-z0-9'’-]+/g)?.length || 0;
const numbered = (ko) => ko && { ...ko, sentences: (ko.sentences || []).map((s, i) => ({ n: i + 1, para: s.para ?? 0, text: s.text, claims: s.claims || [] })) };

// Every T is marked as what it is (operator, 2026-10-21: "it is fine to construct novel entities as long as they are
// marked as such"). Falsification is a mismarking; the class says who produced T and what was observed.
export function provenanceOf(input) {
  const T = input.T || {};
  if (input.kind !== "entity") return T.kind === "transcript" ? { class: "seated", statement: "the row's own transcript, seated in the archive" } : { class: "observed", statement: "the encyclopedia revision, fetched and hashed by the service" };
  if (T.capture) return { class: "seated", statement: "a capture seated in the Capture Registry by its intake", registry: T.capture.slug };
  if (T.supplied && T.discernment?.mode === "attested composition") return { class: "attested", statement: T.discernment.provenance, held: T.discernment.landing };
  if (T.supplied) return { class: T.discernment?.mode === "novel entity" ? "novel" : "composed by the caller", statement: T.discernment?.provenance };
  if (input.commission === "construct" && T.kind !== "constructed") return { class: "construction", statement: `no composition at an address is read: the ${input.object_kind === "operator" ? "operator" : "entity"} is composed from the archive and the sources the caller named` };
  if (T.kind === "constructed") return { class: "constructed", statement: "the article constructed by the service under Wikipedia's content policies, notability not applied" };
  return { class: "null", statement: "no composition at the address" };
}

export function buildRow(run) {
  const { input, onto, composition: c, checks, audit, arch, field, verdicts, release } = run;
  const r = input.row, date = new Date().toISOString().slice(0, 10);
  const fieldClaims = Object.fromEntries(Object.entries(field.claims).map(([id, x]) => [id, { source: x.source, locus: x.locus, quote: x.quote, claim: x.claim, modality: x.modality, kind: x.kind, kernel: !!x.kernel, const: !!x.const, lineage: x.lineage, quote_ok: x.quote_ok }]));
  const fieldSources = Object.fromEntries(input.field.map((b) => [b.id, b.card]));
  const aOk = arch.ledger.filter((x) => x.quote_ok).length, fOk = Object.values(field.claims).filter((x) => x.quote_ok).length;
  const live = run.mode === "live";
  const breaches = [...(release.warnings || []).map((w) => ({ check: "archive-release", detail: w })),
    ...(run.budget?.exhausted ? [{ check: "budget", detail: `the execution budget ($${run.budget.budget_usd}) was spent before every pass ran; the row is composed from what was read` }] : []),
    ...(run.budget?.failed_calls ? [{ check: "failed-calls", detail: `${run.budget.failed_calls} model calls failed; their passes are recorded as not read` }] : []), ...(onto.breaches || []), ...(checks?.breaches || []), ...(audit?.breaches || [])];
  const caseV = onto.case?.value, rhoV = onto.rho?.value;
  const T = input.kind === "entity"
    ? { path: input.T.text ? `${V2}/intake/${r}-${input.address.date.replace(/-/g, "")}/T-transcript.txt` : null, kind: input.T.kind, sha256: input.T.sha256, words: words(input.T.text), cards: input.field.length, inline_source_labels: 0,
        claims: input.T.claims.map((x) => `${x.id} ${x.text}`), wikipedia: input.T.wikipedia, note: input.T.note,
        ...(input.T.capture ? { capture_registry: input.T.capture } : {}), ...(input.T.source ? { source: input.T.source } : {}),
        provenance: provenanceOf(input), ...(input.T.discernment ? { discernment: input.T.discernment } : {}) }
    : input.kind === "wikipedia"
    ? { path: `${V2}/intake/${r}-${input.address.oldid}/T-revision.txt`, sha256: input.T.sha256, words: words(input.T.text), cards: input.field.length, inline_source_labels: input.T.claims.reduce((n, x) => n + (x.cites || []).length, 0), url: input.T.url, licence: "CC BY-SA 4.0 (Wikipedia contributors; the revision URL is the attribution)",
        claims: input.T.claims.map((x) => `${x.id} ${x.text}`), note: "T is the pinned Wikipedia revision, sentence by sentence; its disclosed field B is every source the revision cites (EA-NEGONT-02 v0.9 §0.4 applied to an encyclopedia article: the article is the composition at the address)." }
    : { path: input.T.path || null, register: input.T.register, cards: input.T.cards ?? input.field.length, inline_source_labels: input.T.inline_source_labels ?? 0, sha256: input.T.sha256, words: words(input.T.text), claims: input.T.claims.map((x) => `${x.id} ${x.text}`), note: "re-run by SPXI-gnΩsis from the row's own transcript" };
  const status = {
    procedure: `EA-NEGONT-02 v0.9, #1690${caseV ? `: ${caseV === "equal" ? "equal-terms" : caseV} case, ρ = ${rhoV}` : ""}, read by SPXI-gnΩsis ${run.service?.version || ""} (${run.protocol}); archive subset selected under §3.4 D/R/O with the hop (scripts/non_traverse.py at archive commit ${(release.archive_commit || "").slice(0, 12)}), admission by two independent reading passes, the hop screened by string and read; composed from the entity's ledgers; the composer read the ledgers, never the transcript`,
    ledger: `unaudited (§3.8: one extractor per ledger); field quotes located verbatim in the saved source texts ${fOk}/${Object.keys(field.claims).length}; archive quotes located verbatim in the deposit texts ${aOk}/${arch.ledger.length}`,
    frozen: false,
    readings: live ? `live (${run.models.reading}; triage ${run.models.triage})` : "replay: no model was called in this run; every pass is a recording, named in composition_gnosis.passes",
  };
  const row = {
    ...(input.kind === "entity" ? { commission: input.commission || null, object_kind: input.object_kind || "entity", ...(input.object_description ? { object_description: input.object_description } : {}) } : {}),
    row: r, entity: input.entity.slug, address: input.address.string, addresses: [{ address: input.address.string, surface: input.address.surface, date: input.address.date }],
    epoch: date, type: input.entity.type, surface: input.address.surface, auth: input.address.auth, status, spec: "EA-NEGONT-02 v0.9, #1690",
    objects: { T: { ...T, provenance: T.provenance || provenanceOf(input) } },
    field: input.field.map((b) => ({ id: b.id, card: b.card, url: b.url, role: "field B", sha256: { text: b.text_sha256 }, availability: b.availability, fetched: b.fetched })),
    field_claims: fieldClaims, field_sources: fieldSources,
    ledger: { archive: `${V2}/ledgers/${r}/ledger-archive.json`, field: `${V2}/ledgers/${r}/field.json`, selection: `${V2}/traversal/${r}/`, audit: null },
    breaches,
    ...(run.dro?.works?.length ? { works: { rule: "scanned, not read: the deposits the registry gives as by the entity (or by a name the caller counts as its)", count: run.dro.works.length, deposits: run.dro.works } } : {}),
    ...(run.dro?.division?.scanned ? { division: run.dro.division } : {}),
    composition_gnosis: { service: run.service, protocol: run.protocol, mode: run.mode, models: run.models, archive_release: release, passes: run.calls, cost_usd: run.cost_usd, seconds: run.seconds, ...(run.stages ? { stages: run.stages } : {}) },
  };
  if (onto.status === "read" || onto.status === "read (single pass)" || onto.status === "contested") {
    row.ontology = { composition: caseV, case: onto.case, E_F: onto.E_F, E_A: onto.E_A, rho: onto.rho, translation: onto.translation,
      receiving_texts: caseV === "equal" ? "equal-terms case: every field claim composed as received, beside the archive claims it stands with" : "witness case: each field claim carried whole beside its translation, with its receiving text where located",
      t_alignment: onto.t_alignment, ...(onto.contested ? { contested: onto.contested } : {}) };
  }
  if (c) {
    const KO = { title: c.KO?.title || input.entity.name, genre: `knowledge object, ${caseV === "equal" ? "equal-terms" : caseV} case, under EA-NEGONT-02 v0.9 (#1690)`, status: `composed ${date} by SPXI-gnΩsis; not frozen`, ...numbered(c.KO), field_claims: fieldClaims, field_sources: fieldSources };
    const KO_B = { title: c.KO_B?.title || input.entity.name, arm: "B (the field alone)", genre: "the same plan, the field alone", status: `draft ${date}; not frozen`, ...numbered(c.KO_B), field_claims: fieldClaims, field_sources: fieldSources };
    row.objects = { T,
      KO, P: { ...c.P, genre: "the compression: AIO's interaction grammar (lede, headed clusters, bolded labels, card rail), composed from the knowledge object", status: `composed ${date} from the knowledge object; not frozen`, entity: `Composed under v0.9, ${caseV} case (ρ = ${rhoV})` },
      P_B: { ...c.P_B, arm: "B (the field alone)", genre: "popup — the compression, composed from the field ledger alone", status: `composed ${date} from the field ledger alone; not frozen`, entity: "The field at its full resolution, with no archive claims admitted." },
      KO_B,
      L_B: { words: words(KO_B.sentences.map((s) => s.text).join(" ")), text: KO_B.sentences.map((s) => s.text).join(" "), note: "L_F(B) is realized as the field arm's expansion (objects.KO_B)." },
      L_BA: { words: words(KO.sentences.map((s) => s.text).join(" ")), text: KO.sentences.map((s) => s.text).join(" "), rail: [], note: `L(B ∪ A), the ${caseV} case, realized as the knowledge object (objects.KO); its rail is the compression's (objects.P.rail).` } };
    row.delta = c.delta; row.kernel = c.kernel || []; row.measure = checks?.measure; row.channel = c.channel || [];
    row.audit = audit ? { rule: "v0.9 §5.3: reverse entailment by two raters; every unit needs a judgment from both", ran: audit.ran, complete: !!audit.complete, units: audit.units, unjudged: audit.missing || [], agreement: audit.agreement, breaches: audit.breaches.length } : null;
  } else {
    row.objects.note = onto.status === "contested" ? "composition withheld: the two ontology readings differ and no rule settles which is taken; both are carried in ontology.contested" : `composition not run: ontology ${onto.status}`;
  }
  return row;
}

function lineages(ledger) {
  const m = new Map();
  for (const c of ledger) {
    const k = c.lineage || c.claim;
    if (!m.has(k)) m.set(k, { lineage: k, ledgered: [], instances: new Set() });
    m.get(k).ledgered.push(c.id); m.get(k).instances.add(c.dep ?? `blog:${c.record?.published} ${c.record?.title}`);
  }
  return [...m.values()].map((l) => { const inst = [...l.instances].sort((a, b) => (typeof a === typeof b ? (a < b ? -1 : 1) : typeof a === "number" ? -1 : 1)); const nums = inst.filter((x) => typeof x === "number"); return { ...l, instances: inst, earliest: nums.length ? Math.min(...nums) : inst[0] }; });
}

export function writeLanding(run, row) {
  const { input, trav, travH, dro, hop, arch, field, verdicts } = run;
  const blogFile = run.blog?.D?.length ? "candidates-BLOG.jsonl" : null;
  // Each opening's tree is kept under its execution key and never overwritten; the entity's current row is a choice
  // made at landing, and earlier openings stay inspectable.
  const base = join(STORE, "s7", input.row, "runs", run.key, "landing");
  const put = (rel, data) => { const p = join(base, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 1) + "\n"); return rel; };
  const files = [];
  files.push(put(`${V2}/rows/${input.row}.json`, row));
  files.push(put(`${V2}/ledgers/${input.row}/ledger-archive.json`, arch.ledger.map(({ read, ...c }) => ({ ...c, offset_basis: "NFC text of the deposit file" }))));
  files.push(put(`${V2}/ledgers/${input.row}/field.json`, { field: row.field, field_claims: row.field_claims, note: "Saved source texts are held by the service, by hash; third-party texts are not redistributed." }));
  for (const f of ["candidates-D.jsonl", "candidates-R.jsonl", "candidates-O.jsonl"]) { const src = join(trav.dir, f); if (existsSync(src)) { mkdirSync(join(base, V2, "traversal", input.row), { recursive: true }); copyFileSync(src, join(base, V2, "traversal", input.row, f)); files.push(`${V2}/traversal/${input.row}/${f}`); } }
  if (existsSync(join(travH.dir, "candidates-H.jsonl"))) { copyFileSync(join(travH.dir, "candidates-H.jsonl"), join(base, V2, "traversal", input.row, "candidates-H.jsonl")); files.push(`${V2}/traversal/${input.row}/candidates-H.jsonl`); }
  if (blogFile) files.push(put(`${V2}/traversal/${input.row}/${blogFile}`, run.blog.D.map((c) => JSON.stringify(c)).join("\n") + "\n"));
  const summary = { ...JSON.parse(readFileSync(join(travH.dir || trav.dir, "summary.json"), "utf8")), blog: run.blog ? { corpus: "data/blog-index.json (posts the blog–deposit map does not assign to a deposit)", index_sha256: run.blog.index_sha256, posts_scanned: run.blog.posts_scanned, D_sentences: run.blog.D.length, D_posts: new Set(run.blog.D.map((c) => c.dep)).size } : null };
  files.push(put(`${V2}/traversal/${input.row}/summary.json`, summary));
  const reading = {
    row: input.row, pass: `SPXI-gnΩsis reading, ${row.epoch}`, procedure: "EA-NEGONT-02 v0.9 §3.4 D/R/O with the hop. Admission by reading, two independent passes; a deposit on which they differ is admitted and marked extraction_contested, with both readings (§3.8). Hop candidates screened by string (a sentence that cites a deposit admitted by reading, names the entity, or shares two of the admitted passages' rare words) and the screened ones read.",
    reader: row.status.readings, candidate_files: Object.fromEntries(Object.entries({ ...trav.files, ...(travH.files || {}) }).filter(([k]) => k.startsWith("candidates-"))),
    verdicts, not_admitted: [...dro.not_admitted, ...hop.not_admitted], lineages: lineages(arch.ledger), observations: [],
    counts: { candidate_deposits_DRO: new Set([...trav.D, ...trav.R, ...trav.O].map((c) => c.dep)).size, blog_posts_scanned: run.blog?.posts_scanned, blog_candidate_posts: new Set((run.blog?.D || []).map((c) => c.dep)).size, hop_candidates: (travH.H || []).length, hop_screened: hop.screened, admitted: verdicts.length,
      admitted_by_hop: hop.verdicts.length, scanned_not_read: dro.division?.scanned?.deposits || 0, works_scanned: (dro.works || []).length, contested: [...dro.contested, ...hop.contested].length, archive_claims: arch.ledger.length, lineages: lineages(arch.ledger).length },
  };
  files.push(put(`${V2}/traversal/${input.row}/reading.json`, reading));
  if (input.kind === "entity" && input.T.text) files.push(put(row.objects.T.path, `${input.T.text}\n`));
  if (input.kind === "wikipedia") files.push(put(row.objects.T.path, `${input.T.text}\n\n— Wikipedia, "${input.entity.name}", revision ${input.address.oldid}: ${input.T.url}. Text by Wikipedia contributors, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).\n`));
  const panel = { entity: input.entity.slug, name: input.entity.name, type: input.entity.type,
    source: `SPXI-gnΩsis opening, ${row.epoch} (${row.status.readings})`,
    stage: `composed ${row.epoch} under EA-NEGONT-02 v0.9, #1690${row.ontology ? `, ${row.ontology.composition} case, ρ = ${row.ontology.rho?.value}` : ""} (draft, not frozen; ledgers unaudited; ${row.breaches.length} breaches recorded)`,
    addresses: [{ address: input.address.string, note: `T: ${input.address.surface}, ${input.address.date}` }] };
  files.push(put(`landing/panel-entry.json`, panel));
  const manifest = { row: input.row, key: run.key, files: files.map((f) => ({ path: f, sha256: sha256(readFileSync(join(base, f))) })), note: "Each path mirrors the archive's; landing copies the tree and adds the panel entry to panel.json." };
  put("landing/manifest.json", manifest);
  return { dir: base, files, manifest };
}
