// The portable tier: the entity's knowledge object, as the opening's /non row composed it, delivered as a package
// that can be carried to any surface and checked there. The KO is composed from the cited sources and the archive,
// never from the article's text (EA-NEGONT-02 v0.9 §4: the composer reads the ledgers, never the transcript); it is
// released as /non is, CC BY 4.0. The article's own sentences appear only in the record of T against L(B), each marked
// as a CC BY-SA 4.0 span attributed to the revision. Units the reverse entailment audit found not entailed by their
// cited claims are marked in place. (Not legal advice.)
import { save, sha256 } from "./util.js";

export const PACKAGE_PROTOCOL = "gnosis-portable/0.2 (the /non knowledge object)";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function claimIndex(row, ledger) {
  const by = {};
  for (const [id, c] of Object.entries(row.field_claims || {})) by[id] = { id, kind: "field", label: row.field_sources?.[c.source] || c.source, locus: c.locus, quote: c.quote, modality: c.modality, url: (row.field || []).find((b) => b.id === c.source)?.url };
  for (const c of ledger) by[c.id] = { id: c.id, kind: "archive", label: c.dep ? `#${c.dep}` : `blog: ${c.record?.title}`, locus: c.locus, quote: c.quote, modality: c.modality, url: c.dep ? `https://www.alexanarch.org/s/records/${c.dep}/` : c.record?.url };
  return by;
}

function paras(ko) {
  const out = [];
  for (const s of ko.sentences || []) { if (!out[s.para]) out[s.para] = []; out[s.para].push(s); }
  return out.filter(Boolean);
}

export function packageRow(row, ledger, { result_id, service, article, audit, rowUrl }) {
  const ko = row.objects.KO, P = row.objects.P;
  const by = claimIndex(row, ledger);
  const flagged = new Set((audit?.breaches || []).filter((b) => b.check === "reverse-entailment").map((b) => b.at));
  const unjudged = new Set(audit?.missing || []);
  const MARK = " [not entailed by its cited claims: reverse entailment audit]", UNJ = " [not checked: the audit returned no judgment for this unit]";
  const unitMark = (id) => (flagged.has(id) ? MARK : unjudged.has(id) ? UNJ : "");
  const ledeClaims = (P.lede?.claims || []).filter((id) => by[id]);
  const cited = [...new Set([...ledeClaims, ...(ko.sentences || []).flatMap((s) => s.claims || []), ...(P.open || []).flatMap((o) => o.rests_on || [])])].filter((id) => by[id]);
  const verification = !audit?.ran ? "reverse entailment audit not run (replay mode has no recorded audit)"
    : !audit.complete ? `reverse entailment audit incomplete: ${(audit.missing || []).length} of ${audit.units} units unjudged; ${flagged.size} marked`
    : `reverse entailment audit by two raters (agreement ${audit.agreement}); ${flagged.size} units marked`;
  const unitState = (id) => (!audit?.ran ? "not audited" : flagged.has(id) ? "not entailed" : unjudged.has(id) ? "unjudged" : "entailed");
  const md = [
    `# ${ko.title}`, "", `**${ko.title}** ${P.lede?.text || ""}${unitMark("P-lede")} ${ledeClaims.map((c) => `[${c}]`).join("")}`, "",
    ...paras(ko).flatMap((p) => [p.map((s) => `${s.text}${unitMark(`KO${s.n}`)} ${(s.claims || []).map((c) => `[${c}]`).join("")}`).join(" "), ""]),
    ...((P.open || []).length ? ["## Open questions", "", ...P.open.map((o) => `- ${o.question} (rests on ${(o.rests_on || []).join(", ")}; ${o.modality}). What would resolve it: ${o.would_resolve}`), ""] : []),
    "## Claims", "", ...cited.map((id) => { const c = by[id]; return `- **${id}** ${c.label}, ${c.locus} (${c.modality}): “${c.quote}”${c.url ? ` <${c.url}>` : ""}`; }), "",
    "## The article at the address", "",
    `What the encyclopedia composes from the sources it cites (T against L(B)): ${row.delta?.T_vs_LB || ""}`, "",
    `What admission adds (L(B) against L(B ∪ A)): ${row.delta?.LB_vs_LBA || ""}`, "",
    `Case: ${row.ontology?.case?.value} · ρ = ${row.ontology?.rho?.value}. Verification: ${verification}.`, "",
    `Composed by ${service.name} ${service.version} under EA-NEGONT-02 v0.9 (#1690), result ${result_id}; the entity's public /non row: ${rowUrl}. The knowledge object is composed from the sources the Wikipedia article “${article.title}” (revision ${article.oldid}, <${article.url}>) cites and from the Crimson Hexagonal Archive, and is released under CC BY 4.0. Sentences of the Wikipedia article quoted in this package are by its contributors under CC BY-SA 4.0.`,
  ].join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ko.title)}</title>
<style>:root{--bg:#fffdf8;--fg:#1d1b16;--mut:#6b6458;--flag:#a33}@media (prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#ece6d8;--mut:#a59e90;--flag:#e88}}body{background:var(--bg);color:var(--fg);font:17px/1.6 Georgia,serif;max-width:46rem;margin:0 auto;padding:1.5rem 16px}.c,.m{color:var(--mut);font-size:.82em}.flag{color:var(--flag);font-size:.82em}q.wp{font-style:italic}</style>
<script type="application/ld+json">${JSON.stringify(jsonld(row, by, cited, { result_id, service, article, rowUrl, ledeState: unitState("P-lede"), verificationText: verification })).replace(/</g, "\\u003c")}</script></head><body>
<h1>${esc(ko.title)}</h1><p><b>${esc(ko.title)}</b> ${esc(P.lede?.text || "")}${unitMark("P-lede") ? ` <span class="flag">${esc(unitMark("P-lede").trim())}</span>` : ""} ${ledeClaims.map((c) => `<a class="c" href="#c-${esc(c)}">[${esc(c)}]</a>`).join("")}</p>
${paras(ko).map((p) => `<p>${p.map((s) => `${esc(s.text)}${unitMark(`KO${s.n}`) ? ` <span class="flag">${esc(unitMark(`KO${s.n}`).trim())}</span>` : ""} ${(s.claims || []).map((c) => `<a class="c" href="#c-${esc(c)}">[${esc(c)}]</a>`).join("")}`).join(" ")}</p>`).join("\n")}
${(P.open || []).length ? `<h2>Open questions</h2><ul>${P.open.map((o) => `<li>${esc(o.question)} <span class="m">rests on ${esc((o.rests_on || []).join(", "))}; ${esc(o.modality)}. What would resolve it: ${esc(o.would_resolve)}</span></li>`).join("")}</ul>` : ""}
<h2>Claims</h2><ol>${cited.map((id) => { const c = by[id]; return `<li id="c-${esc(id)}"><b>${esc(id)}</b> ${c.url ? `<a href="${esc(c.url)}">${esc(c.label)}</a>` : esc(c.label)}, ${esc(c.locus)} <span class="m">(${esc(c.modality)})</span>: “${esc(c.quote)}”</li>`; }).join("")}</ol>
<h2>The article at the address</h2><p>${esc(row.delta?.T_vs_LB || "")}</p><p>${esc(row.delta?.LB_vs_LBA || "")}</p>
<p class="m">Case: ${esc(row.ontology?.case?.value)} · ρ = ${esc(row.ontology?.rho?.value)} · ${esc(verification)}.</p>
<p class="m">Composed by ${esc(service.name)} ${esc(service.version)} under EA-NEGONT-02 v0.9 (#1690), result ${esc(result_id)}; the entity's public <a href="${esc(rowUrl)}">/non row</a>. Composed from the sources the Wikipedia article “${esc(article.title)}” (<a href="${esc(article.url)}">revision ${esc(article.oldid)}</a>) cites and from the Crimson Hexagonal Archive; released under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Sentences of the Wikipedia article quoted here are by its contributors under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.</p>
</body></html>`;
  const files = {
    "article.md": md, "article.html": html,
    "article.jsonld": JSON.stringify(jsonld(row, by, cited, { result_id, service, article, rowUrl, ledeState: unitState("P-lede"), verificationText: verification }), null, 1),
    "article.json": JSON.stringify({ title: ko.title, lede: { ...P.lede, verification: unitState("P-lede") }, sentences: (ko.sentences || []).map((s) => ({ ...s, verification: unitState(`KO${s.n}`) })), open: P.open, verification, claims: Object.fromEntries(cited.map((id) => [id, by[id]])), case: row.ontology?.case?.value, rho: row.ontology?.rho?.value, delta: row.delta, audit }, null, 1),
    "LICENSE.txt": `The knowledge object in this package is composed by ${service.name} from the sources the Wikipedia article "${article.title}" (revision ${article.oldid}, ${article.url}) cites and from the Crimson Hexagonal Archive, and is released under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/. Sentences of the Wikipedia article quoted in this package are by its contributors, licensed CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/. Quotations of other sources are short quotations for commentary, attributed in place.\n`,
  };
  return { files, verification, flagged: [...flagged], unjudged: [...unjudged] };
}

function jsonld(row, by, cited, { result_id, service, article, rowUrl, ledeState = "not audited", verificationText = "" }) {
  return {
    "@context": "https://schema.org", "@type": "Article", name: row.objects.KO.title, abstract: row.objects.P.lede?.text,
    additionalProperty: [{ "@type": "PropertyValue", name: "lede verification", value: ledeState }, { "@type": "PropertyValue", name: "verification", value: verificationText }],
    about: { "@type": "Thing", name: row.objects.KO.title }, isBasedOn: [{ "@type": "Dataset", name: "The Negative of the Negative (/non)", url: rowUrl }],
    citation: [...new Set(cited.map((id) => by[id].url).filter(Boolean))],
    license: "https://creativecommons.org/licenses/by/4.0/",
    creator: { "@type": "SoftwareApplication", name: service.name, softwareVersion: service.version }, identifier: result_id,
    mentions: { "@type": "CreativeWork", name: article.title, url: article.url, license: "https://creativecommons.org/licenses/by-sa/4.0/" },
  };
}

export async function writePackage(dir, pkg, meta) {
  for (const [n, body] of Object.entries(pkg.files)) await save(`${dir}/${n}`, body);
  const manifest = { ...meta, protocol: PACKAGE_PROTOCOL, verification: pkg.verification, flagged_units: pkg.flagged, files: Object.fromEntries(Object.entries(pkg.files).map(([n, b]) => [n, sha256(b)])) };
  await save(`${dir}/manifest.json`, manifest);
  return manifest;
}
