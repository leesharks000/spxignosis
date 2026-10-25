// S8–S9. The opened article (HTML) and W3C Web Annotations anchored to the pinned revision.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderOpenedHTML(comp, pinned) {
  const rows = comp.entries.map((e) => {
    const account = e.status === "uncited" ? `<p class="acct">${esc(e.note)}</p>`
      : e.status === "unread" || e.status === "withheld" ? `<p class="acct">Not opened: ${esc(e.note || e.status)}</p>`
      : e.status === "contested" ? `<p class="acct"><b>Contested.</b> The two independent readings differ on ${esc((e.differs || []).join(", ") || "a measured distinction")}; both are given.</p>${(e.readings || []).map((r, i) => `<p class="acct"><b>Reading ${i + 1}.</b> ${esc(r.paraphrase)} <span class="meta">support: ${esc((r.support || []).join(", "))} · attributization: ${esc(r.attributization ?? r.converted)} · retained authority: ${esc(r.retained_authority ?? r.retains_authority)}</span></p>`).join("")}`
      : `${e.innocent_reading ? `<p class="acct"><b>The innocent reading.</b> ${esc(e.innocent_reading)}${e.innocent_reading_fails_at ? ` <i>It fails at:</i> ${esc(e.innocent_reading_fails_at)}` : ""}</p>` : ""}
         <p class="acct"><b>What the ${e.cited === false ? "article's other sources say" : "cited source says"}.</b> ${esc(e.what_the_source_says)}</p>
         ${e.operation ? `<p class="acct"><b>Its operation.</b> ${esc(e.operation)}${e.converted ? " — restated in the sentence as a property of the entity." : ""}</p>` : ""}
         ${e.changes.length ? `<ul class="acct">${e.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
         ${e.five_part ? `<dl class="acct"><dt>Support</dt><dd>${esc(e.five_part.support)}</dd><dt>What the sentence changes</dt><dd>${esc(e.five_part.changes)}</dd><dt>Alternative reading</dt><dd>${esc(e.five_part.alternative)}</dd><dt>Status</dt><dd>${esc(e.five_part.status)}</dd><dt>What would revise it</dt><dd>${esc(e.five_part.revision)}</dd></dl>` : ""}
         ${e.invitation && (e.invitation.codes || []).some((x) => x !== "not-applicable") ? `<p class="meta">Invitation: ${esc((e.invitation.codes || []).join(", "))}${e.invitation.note ? ` (${esc(e.invitation.note)})` : ""} · ${esc(e.invitation.status)}</p>` : ""}
         <p class="meta">Support: ${esc((e.support || []).join(", ") || e.status)}${e.support_source ? ` (${esc(e.support_source.join(", "))})` : ""} · attributization: ${esc(e.attributization?.value ?? e.converted)} · retained authority: ${esc(e.retained_authority?.value ?? "unknown")} · status ${esc(e.status)} · sources: ${e.sources.map((s) => `<a href="${esc(s.url)}">${esc(s.ref)}</a> (${esc(s.located ? s.located + ", " : "")}${esc(s.availability)})`).join(", ")}</p>`;
    const arch = e.archive && (e.archive.claims || []).length ? `<p class="acct"><b>The archive${e.archive.bears && e.archive.bears !== "none" ? ` ${esc(e.archive.bears)}` : ""}.</b> ${esc(e.archive.note || "")}</p><ul class="acct">${e.archive.claims.map((x) => `<li><a href="${esc(x.url)}">${x.dep ? `#${esc(x.dep)}` : "blog"} ${esc(x.locus)}</a>: “${esc(x.quote)}”</li>`).join("")}</ul>` : "";
    return `<section id="${esc(e.id)}"><blockquote cite="${esc(comp.article.url)}"><span class="wp" data-licence="CC BY-SA 4.0">${esc(e.sentence)}</span> <a class="rev" href="${esc(comp.article.url)}">rev. ${esc(comp.article.oldid)}</a></blockquote>${account}${arch}</section>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opened: ${esc(comp.article.title)}</title>
<style>:root{--bg:#fffdf8;--fg:#1d1b16;--mut:#6b6458;--rule:#e5dfd2}@media (prefers-color-scheme:dark){:root{--bg:#16140f;--fg:#ece6d8;--mut:#a59e90;--rule:#2d2a22}}
body{background:var(--bg);color:var(--fg);font:17px/1.55 Georgia,serif;max-width:46rem;margin:0 auto;padding:1.5rem 16px}
blockquote{margin:1.4rem 0 .4rem;padding-left:.9rem;border-left:3px solid var(--rule)}.rev,.meta{color:var(--mut);font-size:.85em}.acct{margin:.3rem 0 .3rem .9rem}</style>
<link rel="canonical" href="${esc(comp.article.url)}"></head><body>
<h1>${esc(comp.article.title)}, opened</h1>
${comp.non ? `<p class="meta">The entity's /non row: <a href="${esc(comp.non.entity_page)}">${esc(comp.non.entity_page)}</a> · ${comp.non.composed ? `${esc(comp.non.case)} case, ρ = ${esc(comp.non.rho)}` : "not composed in this run"}.</p>` : ""}
<p class="meta">Wikipedia revision <a href="${esc(comp.article.url)}">${esc(comp.article.oldid)}</a> (CC BY-SA 4.0). Each sentence is kept verbatim and followed by its reading: the innocent reading first, then what its sources say (its own, and those the article cites elsewhere, marked). ${esc(comp.service.name)} ${esc(comp.service.version)} · result ${esc(comp.result_id)}. ${esc(comp.notice)}</p>
${rows}
<p class="meta">The readings on this page are licensed <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, attributed to SPXI-gnΩsis and result ${esc(comp.result_id)}; the Wikipedia sentences remain CC BY-SA 4.0, attributed to the revision.</p>
</body></html>`;
}

export function annotations(comp) {
  return {
    "@context": "http://www.w3.org/ns/anno.jsonld", type: "AnnotationCollection", label: `${comp.service.name} opening of ${comp.article.title}`, rights: "https://creativecommons.org/licenses/by/4.0/",
    first: { type: "AnnotationPage", items: comp.entries.filter((e) => e.what_the_source_says).map((e) => ({
      type: "Annotation", motivation: "assessing", id: `urn:gnosis:${comp.result_id}:${e.id}`,
      body: { type: "TextualBody", format: "text/plain", value: `${e.what_the_source_says}${e.changes.length ? " Changes: " + e.changes.join("; ") : ""}` },
      target: { source: comp.article.url, selector: { type: "TextQuoteSelector", exact: e.sentence } },
    })) },
  };
}
