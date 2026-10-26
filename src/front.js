// The pages a person reads (2026-10-25): the front door, an order's page, and the API reference. Agents get the same
// service as JSON at GET / and as text at /llms.txt; these pages are for commissioning work, and they call the same routes.
//
// Ordered so that the claim and the act that funds it are seen together (review of 2026-10-25): masthead; the call and a
// working request (open, construct, read what exists); two demonstrated results; the public accumulation; prices and
// delivery; the prophetic passage and the argument; the agents' panel. The operations inventory and the deployment's
// configuration are on /api.

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const HEAD = (title, description) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<meta name="spxi:instrument" content="0.17 The opening (a pinned Wikipedia revision, read sentence by sentence) — SPXI method inventory, https://www.spxi.dev/methods/#m-0-17">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="https://gnosis.spxi.dev/spxi-gnosis.png">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt"><link rel="alternate" type="application/json" href="/" title="the service as JSON (Accept: application/json)">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>${CSS}</style></head><body>`;

const CSS = `
:root{--bg:#fefcf3;--panel:#f7f3e4;--ink:#14161b;--red:#a3141b;--red-ink:#fff;--muted:#5b5d63;--rule:#e2dccb;--rule-2:#cfc7b0;--ok:#25603a;--warn:#8a5a00;
--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#121317;--panel:#1a1b20;--ink:#ece9df;--red:#d4454b;--red-ink:#fff;--muted:#a4a39c;--rule:#2a2b31;--rule-2:#3a3b42;--ok:#6fbf87;--warn:#d9a441}}
:root[data-theme="dark"]{--bg:#121317;--panel:#1a1b20;--ink:#ece9df;--red:#d4454b;--red-ink:#fff;--muted:#a4a39c;--rule:#2a2b31;--rule-2:#3a3b42;--ok:#6fbf87;--warn:#d9a441}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans)}
a{color:var(--ink);text-decoration-color:var(--rule-2);text-underline-offset:2px}a:hover{color:var(--red);text-decoration-color:var(--red)}
code,.mono{font-family:var(--mono);font-size:.86em;overflow-wrap:anywhere}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.measure{max-width:680px}
/* masthead */
.mast{border-bottom:1px solid var(--rule)}
.mast .wrap{display:flex;align-items:center;gap:14px;min-height:60px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);margin-right:auto}
.brand img{width:36px;height:36px;border-radius:6px;display:block}
.brand span{font-family:var(--serif);font-size:1.22rem;letter-spacing:.01em}
.mast nav{display:flex;gap:4px 16px;flex-wrap:wrap;font-size:.9rem}
.mast nav a{text-decoration:none;color:var(--muted)}.mast nav a:hover{color:var(--red)}
.mast nav a.ext::after{content:" ↗";font-size:.8em;opacity:.7}
/* hero */
.hero{padding:44px 0 12px}
.hero-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:48px;align-items:start}
@media (max-width:880px){.hero-grid{grid-template-columns:minmax(0,1fr);gap:28px}.hero{padding-top:28px}}
@media (min-width:881px){.call{font-size:clamp(2.2rem,3.6vw,2.75rem)}}
.hero-grid>*,.cols>*,.cols3>*{min-width:0}
.call{font-family:var(--serif);font-weight:normal;font-size:clamp(1.55rem,7.4vw,2.75rem);line-height:1.08;letter-spacing:-.01em;margin:0 0 20px;hyphens:manual;overflow-wrap:normal;word-break:normal}
.call.rebuild{color:var(--red);margin-bottom:28px}
.prop{font-size:1.08rem;margin:0 0 18px;max-width:34em}
.flow{display:grid;grid-template-columns:minmax(0,1.05fr) 18px minmax(0,1fr) 18px minmax(0,1fr);align-items:center;gap:6px;margin:6px 0 10px}
.flow-in{display:grid;gap:6px}
.step{appearance:none;display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;background:var(--bg);color:var(--ink);border:1px solid var(--rule-2);border-radius:10px;padding:10px 6px 9px;cursor:pointer;font:inherit;min-width:0}
.step:hover{border-color:var(--ink)}.step[aria-expanded="true"]{border-color:var(--red);box-shadow:inset 0 0 0 1px var(--red)}
.step b{font-weight:600;font-size:.95rem;line-height:1.1}.step span{font-size:.76rem;color:var(--muted);line-height:1.2}
.arrow{height:2px;background:var(--rule-2);position:relative}.arrow::after{content:"";position:absolute;right:-1px;top:-4px;border:5px solid transparent;border-left:7px solid var(--rule-2);border-right:0}
.flow-x{min-height:0;margin:0 0 6px}.flow-x .x{margin:0 0 8px;padding:10px 12px;border-left:3px solid var(--red);background:var(--panel);font-size:.95rem;border-radius:0 6px 6px 0}
@media (max-width:420px){.step span{display:none}.step{padding:9px 4px}.flow{grid-template-columns:minmax(0,1.1fr) 12px minmax(0,1fr) 12px minmax(0,1fr);gap:4px}}
@media (max-width:480px){.exchange li{grid-template-columns:1fr;gap:2px}}
.fine{font-size:.86rem;color:var(--muted)}
/* request */
.req{background:var(--panel);border:1px solid var(--rule);border-radius:10px;padding:18px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--rule-2);margin:-4px -4px 16px;padding:0 4px;overflow-x:auto}
.tabs button{appearance:none;border:0;background:none;font:600 .95rem var(--sans);color:var(--muted);padding:10px 10px 9px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--red)}
.pane[hidden]{display:none}
@media (max-width:520px){.tabs .long{display:none}.tabs button{flex:1}}
label{display:block;font-weight:600;font-size:.9rem;margin:12px 0 5px}
label .opt{font-weight:normal;color:var(--muted)}
input[type=text],input[type=url],textarea{width:100%;font:16px/1.4 var(--sans);color:var(--ink);background:var(--bg);border:1px solid var(--rule-2);border-radius:6px;padding:10px 11px}
textarea{min-height:76px;resize:vertical}
input:focus,textarea:focus,button:focus-visible,summary:focus-visible{outline:2px solid var(--red);outline-offset:1px}
.hint{font-size:.84rem;color:var(--muted);margin:5px 0 0}
.choice{display:grid;gap:6px;margin-top:4px}
.choice label{display:flex;gap:9px;align-items:flex-start;font-weight:normal;margin:0;padding:8px 10px;border:1px solid var(--rule);border-radius:6px;background:var(--bg);cursor:pointer}
.choice label:has(input:checked){border-color:var(--red)}
.choice input{margin-top:4px;accent-color:var(--red)}
.choice b{font-weight:600}
.seg{display:inline-flex;border:1px solid var(--rule-2);border-radius:6px;overflow:hidden}
.seg label{margin:0;padding:7px 12px;font-weight:600;font-size:.9rem;cursor:pointer;border-right:1px solid var(--rule-2)}
.seg label:last-child{border-right:0}.seg input{position:absolute;opacity:0;pointer-events:none}
.seg label:has(input:checked){background:var(--ink);color:var(--bg)}
.btn{appearance:none;border:0;border-radius:6px;background:var(--red);color:var(--red-ink);font:600 1rem var(--sans);padding:11px 18px;cursor:pointer;margin-top:16px}
.btn:disabled{opacity:.55;cursor:progress}
.btn.quiet{background:none;color:var(--ink);border:1px solid var(--rule-2)}
.out{margin-top:14px;font-size:.94rem}
.out .err{color:var(--red)}
details{border-top:1px solid var(--rule);padding:8px 0}
details>summary{cursor:pointer;font-weight:600;font-size:.92rem;list-style-position:outside}
details[open]>summary{margin-bottom:6px}
.req details{border-top:0;padding:4px 0 0}
/* sections */
section.band{padding:52px 0;border-top:1px solid var(--rule)}
.kicker{font:600 .78rem/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--red);margin:0 0 10px}
h2{font-family:var(--serif);font-weight:normal;font-size:clamp(1.5rem,2.6vw,2rem);line-height:1.2;margin:0 0 14px}
h3{font-family:var(--serif);font-weight:normal;font-size:1.3rem;margin:0 0 8px}
.cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:40px}
.cols3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px}
@media (max-width:880px){.cols,.cols3{grid-template-columns:1fr;gap:28px}}
.ex{border-top:3px solid var(--ink);padding-top:14px}
.quote{font-family:var(--serif);font-size:1.12rem;line-height:1.5;margin:10px 0;padding-left:14px;border-left:3px solid var(--rule-2)}
.quote.src{border-left-color:var(--red)}
.quote .gloss{display:block;font-family:var(--sans);font-size:.86rem;color:var(--muted);margin-top:6px}
.lab{font:600 .74rem/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:16px 0 4px}
.finding{font-size:1.02rem;margin:8px 0 10px}
.finding b{font-weight:600}
/* states */
.states{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 2px}
.st{display:inline-flex;align-items:center;gap:6px;font:600 .76rem/1 var(--sans);letter-spacing:.04em;padding:5px 8px;border-radius:999px;border:1px solid currentColor}
.st::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.st.done{color:var(--ok)}.st.contested{color:var(--warn)}.st.contested::before{border-radius:1px;transform:rotate(45deg)}
.st.public{color:var(--bg);background:var(--ink);border-color:var(--ink)}.st.public::before{background:var(--red)}
.st.audit{color:var(--muted)}.st.audit::before{background:none;border:1.5px solid currentColor}
.st.wait{color:var(--muted)}.st.wait::before{background:none;border:1.5px dashed currentColor}
dl.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:8px 0;font-size:.92rem}
dl.kv dt{color:var(--muted)}dl.kv dd{margin:0;overflow-wrap:anywhere}
.links{font-size:.9rem;display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px}
table.prices{width:100%;border-collapse:collapse;font-size:.95rem}
table.prices th,table.prices td{text-align:left;padding:9px 10px 9px 0;border-bottom:1px solid var(--rule);vertical-align:top}
table.prices th{font-weight:600;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
table.prices td.p{white-space:nowrap;font-weight:600}
@media (max-width:560px){table.prices thead{display:none}table.prices tr{display:grid;grid-template-columns:1fr auto;padding:8px 0;border-bottom:1px solid var(--rule)}table.prices td{border:0;padding:2px 0}table.prices td.basis{grid-column:1/-1;color:var(--muted);font-size:.86rem}}
.epigram{font-family:var(--serif);font-size:clamp(1.25rem,2.4vw,1.6rem);line-height:1.45;font-style:italic;margin:0 0 10px;max-width:30em}
.epigram-cite{font-size:.86rem;color:var(--muted)}
.prose{font-family:var(--serif);font-size:1.12rem;line-height:1.6}
.prose p{margin:0 0 14px}
pre{font:13px/1.5 var(--mono);background:var(--panel);border:1px solid var(--rule);border-radius:8px;padding:12px;overflow-x:auto;margin:8px 0}
.agent{background:var(--panel);border:1px solid var(--rule);border-radius:10px;padding:18px}
footer{border-top:1px solid var(--rule);padding:22px 0 40px;font-size:.86rem;color:var(--muted)}
footer a{color:var(--muted)}
.tile svg{display:block;margin-bottom:6px}.tile h3{margin-bottom:4px}.tile>p{margin:0 0 4px}.tile details{border-top:0;padding:2px 0}.tile details summary{font-weight:500;color:var(--muted);font-size:.86rem}
.cite{display:inline-flex;align-items:center;justify-content:center;width:1.35em;height:1.35em;margin:0 0 0 .3em;vertical-align:.08em;border-radius:50%;background:var(--panel);border:1px solid var(--rule-2);color:var(--muted);text-decoration:none;font-size:.78em;line-height:1}
.cite+.cite{margin-left:.18em}.cite:hover{color:var(--red);border-color:var(--red)}.cite svg{display:block}
.quote .cite,.finding .cite{font-size:.72em}
.chips{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (max-width:880px){.chips{grid-template-columns:1fr}}
.chip{border:1px solid var(--rule-2);border-radius:8px;padding:12px 14px;background:var(--bg)}
.chip-t{display:block;font-family:var(--serif);font-size:1.05rem;line-height:1.35;text-decoration:none;color:var(--ink)}.chip-t:hover{color:var(--red)}
.chip-t::after{content:" ↗";font-family:var(--sans);font-size:.8em;color:var(--muted)}
.chip-m{display:block;margin-top:6px;font-size:.82rem;color:var(--muted)}
.spxi-instrument{font:12.5px/1.5 var(--mono);margin:0 0 10px;padding:.45em .7em;border-left:3px solid #8a5a00;background:rgba(138,90,0,.07)}
/* order page */
.steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin:18px 0 24px;padding:0;list-style:none;counter-reset:s}
.steps li{counter-increment:s;font-size:.86rem;color:var(--muted);border-top:3px solid var(--rule-2);padding-top:7px}
.steps li::before{content:counter(s) " · ";font-family:var(--mono)}
.steps li.on{color:var(--ink);border-top-color:var(--red);font-weight:600}.steps li.past{color:var(--ink);border-top-color:var(--ink)}
@media (max-width:560px){.steps{grid-template-columns:1fr;gap:2px}.steps li{border-top:0;border-left:3px solid var(--rule-2);padding:3px 0 3px 8px}.steps li.on{border-left-color:var(--red)}.steps li.past{border-left-color:var(--ink)}}
.card{border:1px solid var(--rule);border-radius:10px;padding:18px;background:var(--panel);margin:0 0 18px}
.big{font-family:var(--serif);font-size:2rem;line-height:1.1}
`;

const MAST = `<header class="mast"><div class="wrap"><a class="brand" href="/"><img src="/omega-512.png" alt="" width="36" height="36"><span>SPXI-gnΩsis</span></a>
<nav aria-label="Sections"><a href="/#commission">Commission</a><a href="/#examples">Examples</a><a class="ext" href="https://www.alexanarch.org/non/" title="the Negative of the Negative: every row, free to read">/non</a><a class="ext" href="https://www.alexanarch.org/captures/" title="the Capture Registry: what the answering systems composed, dated">Captures</a><a href="/#agents">Agents</a></nav></div></header>`;

const FOOT = (index) => `<footer><div class="wrap">
<p class="spxi-instrument"><strong>SPXI instrument</strong> · method <a href="https://www.spxi.dev/methods/#m-0-17">0.17</a>, level 0 (Measurement): the opening of a pinned Wikipedia revision; also method <a href="https://www.spxi.dev/methods/#m-0-16">0.16</a>, the Negative of the Negative. An instrument of <a href="https://www.spxi.dev/">SPXI</a>, the Semantic Packet for eXchange &amp; Indexing; the whole practice is itemized at <a href="https://www.spxi.dev/methods/">spxi.dev/methods</a>.</p>
<p>${esc(index.service.name)} ${esc(index.service.version)} · specified in <a href="https://www.alexanarch.org/s/records/1697/">EA-WIKI-OPEN-01</a> by Lee Sharks · described in <a href="https://www.alexanarch.org/s/records/1703/">EA-MPAI-GNOSIS-01</a> · <a href="/api">API reference</a> · <a href="/llms.txt">llms.txt</a> · source <a href="https://github.com/leesharks000/spxignosis">github.com/leesharks000/spxignosis</a> (PolyForm Shield 1.0.0) · readings CC BY 4.0; Wikipedia's sentences CC BY-SA 4.0 · <a href="https://www.alexanarch.org/">alexanarch.org</a> · <a href="https://www.spxi.dev/">spxi.dev</a></p>
</div></footer>`;

// ------------------------------------------------------------------------------------------------------------- front
export function frontPage(index) {
  return HEAD("SPXI-gnΩsis — fund the counterinfrastructure", "Paid reading and construction, with inspectable evidence and a public record. SPXI-gnΩsis opens existing compositions against their sources and constructs sourced knowledge objects, for entities and operators; a commission's row lands public in the Negative of the Negative (alexanarch.org/non).") + MAST + `
<main>
<section class="hero" id="commission"><div class="wrap hero-grid">
<div>
<h1 class="call">Fund the counterinfrastructure.</h1>
<p class="prop">Commission a <b>reading</b> or a <b>construction</b>.<a class="cite" href="https://www.alexanarch.org/s/records/1697/" title="Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)" aria-label="source: Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a> Receive it with its <b>evidence</b>. The work stays <b>public</b> for everyone after you.<a class="cite" href="https://www.alexanarch.org/non/" title="the Negative of the Negative (/non)" aria-label="source: the Negative of the Negative (/non)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p>
<div class="flow" role="group" aria-label="How the service works"><div class="flow-in"><button type="button" class="step s-open" aria-expanded="false" aria-controls="x-open"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="16" r="11"/><path d="M16 6.5v19" stroke="var(--red)" stroke-width="2.2"/></svg><b>Open</b><span>a composition</span></button><button type="button" class="step s-construct" aria-expanded="false" aria-controls="x-construct"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="20" width="20" height="6" rx="1"/><rect x="9" y="13" width="14" height="6" rx="1"/><rect x="12" y="6" width="8" height="6" rx="1"/></svg><b>Construct</b><span>an object</span></button></div><span class="arrow" aria-hidden="true"></span><button type="button" class="step s-inspect" aria-expanded="false" aria-controls="x-inspect"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="14" r="7.5"/><path d="M19.5 19.5 26 26"/><path d="M11 14h6M14 11v6" stroke-width="1.3"/></svg><b>Inspect</b><span>the evidence</span></button><span class="arrow" aria-hidden="true"></span><button type="button" class="step s-accumulate" aria-expanded="false" aria-controls="x-accumulate"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 24h20"/><path d="M8 19.5h16"/><path d="M10 15h12"/><path d="M12 10.5h8"/><path d="M16 4v3" stroke="var(--red)"/></svg><b>Accumulate</b><span>in public</span></button></div>
<div class="flow-x"><p id="x-open" class="x" hidden><b>Open.</b> A Wikipedia article, sentence by sentence: each sentence <b>kept verbatim</b> and <b>read twice</b> against the sources it cites, with what it keeps, changes, adds or leaves out.<a class="cite" href="https://www.alexanarch.org/s/records/1697/" title="Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)" aria-label="source: Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p><p id="x-construct" class="x" hidden><b>Construct.</b> A knowledge object for an entity or an operator, every sentence naming <b>the claims it states</b> and every claim <b>its quote</b>.<a class="cite" href="https://www.alexanarch.org/s/records/1690/" title="The Negative of the Negative v0.9 (EA-NEGONT-02, #1690)" aria-label="source: The Negative of the Negative v0.9 (EA-NEGONT-02, #1690)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a> Wikipedia notability is not a condition.</p><p id="x-inspect" class="x" hidden><b>Inspect.</b> The quoted passages, each <b>located by code</b> in the stored source; source metadata and hashes; <b>both readings</b>; disagreements <b>kept as contested</b>.<a class="cite" href="/v1/results/R-d744378a9776dfdb/evidence" title="an evidence record (R-d744378a9776dfdb)" aria-label="source: an evidence record (R-d744378a9776dfdb)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p><p id="x-accumulate" class="x" hidden><b>Accumulate.</b> Every reading is <b>kept and served to the next caller</b>. A commission composes <b>a public row</b> in <a href="https://www.alexanarch.org/non/">/non</a>, under CC BY 4.0.<a class="cite" href="https://www.alexanarch.org/non/" title="the Negative of the Negative (/non)" aria-label="source: the Negative of the Negative (/non)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a><a class="cite" href="https://huggingface.co/datasets/leesharks/negative-of-the-negative" title="/non on Hugging Face" aria-label="source: /non on Hugging Face"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p></div>
<noscript><style>.flow-x .x{display:block!important}</style></noscript>
<p class="fine">Quotes are free and name the deliverables and the maximum before you pay. Card, or x402 for agents.</p>
</div>
<div class="req" id="request">
<div class="tabs" role="tablist">
<button role="tab" aria-selected="true" aria-controls="p-open" id="t-open">Open<span class="long"> a composition</span></button>
<button role="tab" aria-selected="false" aria-controls="p-construct" id="t-construct">Construct<span class="long"> an object</span></button>
<button role="tab" aria-selected="false" aria-controls="p-read" id="t-read">Read<span class="long"> what exists</span></button>
</div>

<form class="pane" id="p-open" role="tabpanel" aria-labelledby="t-open" novalidate>
<label for="o-article">Wikipedia article</label>
<input type="text" id="o-article" name="article" placeholder="https://en.wikipedia.org/wiki/Sophistical_Refutations" autocomplete="off" inputmode="url">
<p class="hint" id="o-rev">A link or a title. The current revision is pinned, so the reading stays tied to the text it read.</p>
<label>Scope</label>
<div class="choice">
<label><input type="radio" name="tier" value="check"><span><b>Checked</b> · two passes on the small model · typically 2¢ a sentence</span></label>
<label><input type="radio" name="tier" value="opening" checked><span><b>Opened</b> · two separately generated readings on the middle model · typically 22¢ a sentence</span></label>
<label><input type="radio" name="tier" value="commission"><span><b>Commissioned</b> · opened, then the archive consulted and the article's subject composed as a row in /non · a few dollars for a short article</span></label>
</div>
<details id="o-ai"><summary>Open an AI answer instead</summary>
<p class="hint">An AI answer seated in the <a href="https://www.alexanarch.org/captures/">Capture Registry</a> is opened by the name it answers about. This is always a commission: each of its sentences (up to 150) is read against the sources the answer showed, and the object is then composed in /non. The scope above does not apply. The quote names the answer it selected (engine, date, exact query, capture page) before you pay.</p>
<label for="o-capture">Name the answer is about <span class="opt">(leave the article empty)</span></label>
<input type="text" id="o-capture" name="capture" placeholder="SPXI-gnΩsis" autocomplete="off">
<label for="o-slug">A particular capture <span class="opt">(optional: its address in the registry)</span></label>
<input type="text" id="o-slug" name="slug" placeholder="what-is-spxi-gnosis-aio-20261025" autocomplete="off">
<p class="hint">Where several answers are seated for one name, the address chooses which is opened. Find it on the capture’s page.</p>
</details>
<button class="btn" type="submit">Get a free quote</button>
<div class="out" aria-live="polite"></div>
</form>

<form class="pane" id="p-construct" role="tabpanel" aria-labelledby="t-construct" hidden novalidate>
<div class="seg" role="radiogroup" aria-label="Kind of object"><label><input type="radio" name="kind" value="entity" checked>Entity</label><label><input type="radio" name="kind" value="operator">Operator</label></div>
<p class="hint" id="c-kindhint">An <b>entity</b> is something named: a person, a work, an institution, a concept.</p>
<label for="c-name">Name</label>
<input type="text" id="c-name" name="name" placeholder="Attributization" autocomplete="off">
<label for="c-desc">Short description <span class="opt">(optional for an entity)</span></label>
<textarea id="c-desc" name="description" placeholder="the conversion of an act a source performs into a property of the entity a sentence describes"></textarea>
<div id="c-strings-wrap" hidden>
<label for="c-strings">Phrases to search for</label>
<input type="text" id="c-strings" name="strings" placeholder="attributization, attributized, attributizes" autocomplete="off">
<p class="hint">The phrases in which the operation is performed, separated by commas (the operator’s <i>strings</i>). The archive is searched for them; the name is a label and is not added to them automatically.</p>
</div>
<details><summary>Add sources</summary>
<label for="c-sources">Sources <span class="opt">(one link per line)</span></label>
<textarea id="c-sources" name="sources" placeholder="https://…"></textarea>
<p class="hint">Fetched once and hashed, and read beside the archive as the object’s field. Without them the object is composed from the archive alone.</p>
</details>
<button class="btn" type="submit">Get a free quote</button>
<div class="out" aria-live="polite"></div>
</form>

<form class="pane" id="p-read" role="tabpanel" aria-labelledby="t-read" hidden novalidate>
<label for="r-name">Name</label>
<input type="text" id="r-name" name="name" placeholder="Sophistical Refutations" autocomplete="off">
<p class="hint">Reading /non is free: every entry, its data, and every claim it quotes.</p>
<button class="btn" type="submit">Find the entry</button>
<div class="out" aria-live="polite"></div>
</form>
</div>
</div></section>

<section class="band" id="examples"><div class="wrap">
<p class="kicker">Two results</p>
<h2>What a reading shows, and what a construction builds</h2>
<div class="cols">
<article class="ex">
<h3>An opened sentence</h3>
<p class="fine">Wikipedia, “Sophistical Refutations”, revision <a href="https://en.wikipedia.org/w/index.php?title=Sophistical_Refutations&amp;oldid=1361634710">1361634710</a>, sentence W2</p>
<p class="lab">The sentence</p>
<blockquote class="quote">According to Aristotle, this is <b>the first work</b> to treat the subject of deductive reasoning in ancient Greece (Soph. Ref., 34, 183b34 ff.).<a class="cite" href="https://en.wikipedia.org/w/index.php?title=Sophistical_Refutations&amp;oldid=1361634710" title="Wikipedia, revision 1361634710" aria-label="source: Wikipedia, revision 1361634710"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></blockquote>
<p class="lab">The source it cites</p>
<blockquote class="quote src" lang="grc">περὶ δὲ τοῦ συλλογίζεσθαι <b>παντελῶς οὐδὲν</b> εἴχομεν πρότερον ἄλλο λέγειν<a class="cite" href="https://raw.githubusercontent.com/OpenGreekAndLatin/First1KGreek/7881c563436f52fb3550e6daa6df94be1b83b0e3/data/tlg0086/tlg040/tlg0086.tlg040.1st1K-grc1.xml" title="First1KGreek, De sophisticis elenchis" aria-label="source: First1KGreek, De sophisticis elenchis"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a><span class="gloss">Aristotle, closing the inquiry: on syllogizing he had nothing at all earlier to draw on, unlike rhetoric, which had many old treatments; he asks his hearers' indulgence for what is missing. (The first reading's paraphrase.)</span></blockquote>
<p class="lab">The finding</p>
<p class="finding"><b>The count becomes a rank.</b> Aristotle's first-person <b>“nothing at all”</b> about an inquiry becomes a property of a book, <b>“the first work”</b>, and his plea for indulgence drops out.<a class="cite" href="/v1/results/R-d744378a9776dfdb/evidence" title="an evidence record (R-d744378a9776dfdb)" aria-label="source: an evidence record (R-d744378a9776dfdb)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a><a class="cite" href="https://www.alexanarch.org/s/records/1696/" title="EA-WIKI-OPEN-01 v1.0 (#1696), which defines the operator" aria-label="source: EA-WIKI-OPEN-01 v1.0 (#1696), which defines the operator"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p>
<div class="states"><span class="st contested">Contested</span><span class="st done">Quotations located</span></div>
<p class="fine">Both readings find the conversion. They differ on support: “partially supported, beyond paraphrase” against “partially supported, a qualifier added”. Both are kept.</p>
<details><summary>The two readings</summary>
<dl class="kv">
<dt>first</dt><dd>partially supported; interpretation beyond paraphrase. The sentence makes “this work” the unit where the source speaks of the whole inquiry, narrows συλλογίζεσθαι to “deductive reasoning”, adds “in ancient Greece”, and omits the closing plea.</dd>
<dt>second</dt><dd>partially supported; qualifier added. The claim of priority is supported; the sentence recasts it as “the first work”, adds a scope bound absent from the source, and cites chapter 34 where this edition's closing chapter is 33.</dd>
<dt>source</dt><dd>Aristotle, <i>De sophisticis elenchis</i>, First1KGreek, fetched and hashed <code>3a5aaa17…</code>; the full text is kept by the service and quoted here, not served.</dd>
</dl></details>
<div class="links"><a href="/v1/results/R-d744378a9776dfdb/evidence">evidence record</a><a href="/v1/results/R-d744378a9776dfdb/composition">composition</a><a href="https://www.alexanarch.org/non/sophistical-refutations/">the row in /non</a></div>
</article>
<article class="ex">
<h3>A constructed operator</h3>
<p class="fine">Commissioned by name and description, 25 October 2026 · result R-88a27dd9ecfea173</p>
<p class="lab">The request</p>
<blockquote class="quote">Attributization: the conversion of <b>an act a source performs</b> into <b>a property of the entity</b> a sentence describes.<a class="cite" href="/v1/results/R-88a27dd9ecfea173/composition" title="the Attributization composition" aria-label="source: the Attributization composition"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></blockquote>
<p class="lab">The object's first sentence</p>
<blockquote class="quote src">Attributization is an operator, the operation the entity form conceals, defined in deposit #1696 as “the act a text performs and the encyclopedic sentence states as an attribute of an entity, in which <b>the operator speaks with the entity's voice</b>.”<a class="cite" href="https://www.alexanarch.org/s/records/1696/" title="EA-WIKI-OPEN-01 v1.0 (#1696), which defines the operator" aria-label="source: EA-WIKI-OPEN-01 v1.0 (#1696), which defines the operator"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a><span class="gloss">cites claim OA1696-02, quoted from #1696 and located in its text</span></blockquote>
<p class="lab">What was built</p>
<p class="finding">A knowledge object of <b>22 sentences</b>, citing <b>32</b> of the 178 claims extracted from the <b>9</b> deposits the archive admitted. No field sources were supplied with this commission, so the object rests on <b>the archive’s own papers</b>, and says so.<a class="cite" href="https://www.alexanarch.org/non/op-attributization/entity.json" title="the Attributization row, as data" aria-label="source: the Attributization row, as data"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p>
<div class="states"><span class="st done">Composed</span><span class="st audit">Audited · 29 findings recorded</span><span class="st public">Public</span></div>
<details><summary>How it was made</summary>
<dl class="kv">
<dt>reading</dt><dd>the archive traversed for the operator's strings, each admitted deposit read, the archive ledger extracted with every quote located in its deposit, the ontology read twice (ρ = constructs)</dd>
<dt>construction</dt><dd>the object composed from the ledger, then audited sentence by sentence against its claims; the audit's findings are recorded with the row and the row is marked a draft</dd>
<dt>publication</dt><dd>landed in /non without anyone's act, under CC BY 4.0, with an AXN</dd>
</dl></details>
<div class="links"><a href="https://www.alexanarch.org/non/op-attributization/">the row in /non</a><a href="https://www.alexanarch.org/non/op-attributization/entity.json">its data</a><a href="/v1/results/R-88a27dd9ecfea173/composition">composition</a></div>
</article>
</div>
</div></section>

<section class="band" id="commons"><div class="wrap">
<p class="kicker">The public accumulation</p>
<h2>The first caller funds the work. Everyone after uses it.</h2>
<div class="cols3">
<div class="tile"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 24h20"/><path d="M8 19.5h16"/><path d="M10 15h12"/><path d="M12 10.5h8"/></svg><h3>Kept</h3><p>Every reading is <b>kept</b> and <b>served to the next caller</b>.<a class="cite" href="/api" title="the sentence route, on the API page" aria-label="source: the sentence route, on the API page"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p><details><summary>More</summary><p>Every sentence reading is kept at the state it was read in: the sentence, the hashes of its sources, the reader. The next caller is served it free at <code>GET /v1/sentence</code>, or for 1¢ in an order. Readings are licensed CC BY 4.0.</p></details></div>
<div class="tile"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="20" width="20" height="6" rx="1"/><rect x="9" y="13" width="14" height="6" rx="1"/><rect x="12" y="6" width="8" height="6" rx="1"/></svg><h3>Composed</h3><p>A commission composes <b>a public row</b> in /non.<a class="cite" href="https://www.alexanarch.org/non/" title="the Negative of the Negative (/non)" aria-label="source: the Negative of the Negative (/non)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a><a class="cite" href="https://huggingface.co/datasets/leesharks/negative-of-the-negative" title="/non on Hugging Face" aria-label="source: /non on Hugging Face"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p><details><summary>More</summary><p>A commission composes a row in <a href="https://www.alexanarch.org/non/">the Negative of the Negative</a>: the object as the answering layer gives it, as its own sources give it, and with the Crimson Hexagonal Archive admitted. The row lands public by itself, versioned with an AXN, and is published to <a href="https://huggingface.co/datasets/leesharks/negative-of-the-negative">Hugging Face</a>.</p></details></div>
<div class="tile"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="16" r="11"/><path d="M16 6.5v19" stroke="var(--red)" stroke-width="2.2"/></svg><h3>Free</h3><p>Reading /non <b>costs nothing</b>.<a class="cite" href="https://www.alexanarch.org/non/index.json" title="/non's contents, as data" aria-label="source: /non's contents, as data"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p><details><summary>More</summary><p>Reading /non costs nothing: <a href="https://www.alexanarch.org/non/">every entry</a>, <a href="https://www.alexanarch.org/non/index.json">its contents as data</a>, <a href="https://www.alexanarch.org/non/claims.json">every field claim quoted</a>. What is paid for is new work: a reading not yet made, a construction, a row composed again against changed sources.</p></details></div>
</div>
</div></section>

<section class="band" id="prices"><div class="wrap">
<p class="kicker">Prices and delivery</p>
<h2>Priced from measured cost, charged for what is delivered</h2>
<div class="cols">
<div>
<table class="prices"><thead><tr><th>What</th><th>Typical</th><th>Basis</th></tr></thead><tbody>
<tr><td>A sentence, checked</td><td class="p">2¢</td><td class="basis">two passes, small model; at least 1¢</td></tr>
<tr><td>A sentence, opened</td><td class="p">22¢</td><td class="basis">two readings, middle model; at least 5¢</td></tr>
<tr><td>A sentence already read</td><td class="p">free · 1¢</td><td class="basis">served from the ledger; 1¢ inside an order</td></tr>
<tr><td>A commission: the reading</td><td class="p">from $0.75</td><td class="basis">priced from the traversal it would run</td></tr>
<tr><td>A commission: the construction</td><td class="p">from $0.25</td><td class="basis">priced from the ledgers it would compose</td></tr>
<tr><td>A short article, commissioned</td><td class="p">a few dollars</td><td class="basis">quoted free before payment</td></tr>
</tbody></table>
<p class="fine">Typical prices as of 25 October 2026. A sentence with long sources quotes higher; every quote states its own lines.</p>
</div>
<div>
<ol class="measure" style="padding-left:1.2em;margin:0">
<li><b>Request.</b> Name the article or the object.</li>
<li><b>Quote.</b> Free: each deliverable, its line, the maximum, and what will be public. A commission is priced by the archive worker in a few minutes.</li>
<li><b>Payment.</b> By card, or by an agent over x402. The maximum is charged upfront; the unused balance is refunded under the terms below.</li>
<li><b>Progress.</b> The order's page shows the stage it has reached.</li>
<li><b>Result.</b> The reading or the object, with its evidence, disagreements, audit findings, and the state of its publication.</li>
</ol>
<details style="margin-top:14px"><summary>The terms in full</summary>
<p>Each stage is charged at its <b>measured model cost × 3</b> as it delivers (a sentence at its cost × 1.5), <b>never above its quoted line</b> and never below its model cost and payment fee; the rest is refunded. <b>An order that delivers nothing is refunded in full.</b><a class="cite" href="https://www.alexanarch.org/s/records/1703/" title="the service's metadata packet (EA-MPAI-GNOSIS-01, #1703)" aria-label="source: the service's metadata packet (EA-MPAI-GNOSIS-01, #1703)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a> A card charge starts at $0.50: an order quoted below that is charged $0.50 and keeps it, as the checkout states before payment. A paid order not delivered within 24 hours is closed, what delivered charged and the rest refunded. Refunds are recorded with their state, and a refund that fails is retried. Your charge is shown on your order's page; the public records carry the work and its measured model cost.</p>
<p>A commission's row is public under CC BY 4.0 once landed; a sentence reading is kept and served to later callers under CC BY 4.0. Wikipedia's sentences are quoted under CC BY-SA 4.0. The full source texts are kept by the service, hashed, and quoted; they are not redistributed.</p>
</details>
</div>
</div>
</div></section>

<section class="band" id="why"><div class="wrap">
<h2 class="call rebuild">Rebuild the foundations of the world.</h2>
<div class="cols">
<div>
<blockquote style="margin:0"><p class="epigram">Jack said, “The foundations of this world are unsound, and the foundations of the world above are unsound. Write this down, for these words are faithful and true: I am making everything new.”</p>
<p class="epigram-cite">after <a href="https://www.alexanarch.org/s/records/71/">The Gospel of Antioch</a>, saying 11, and Revelation 21:5, its order inverted</p></blockquote>
</div>
<div class="prose">
<p>The world is being rebuilt inside <b>the systems that answer our questions</b>. They settle names, distribute authority, carry some sources forward and leave others outside, and what they say becomes <b>the ground the next answer stands on</b>.<a class="cite" href="https://www.alexanarch.org/captures/what-is-spxi-gnosis-aio-20261025/" title="a capture: Google's AI Overview on this service, 2026-10-25" aria-label="source: a capture: Google's AI Overview on this service, 2026-10-25"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p>
<p>Those foundations <b>can be opened</b>. The sources can be read again. <b>The operation hidden inside a settled description</b> can be recovered, and knowledge can be built where the institutions leave an absence.<a class="cite" href="https://www.alexanarch.org/s/records/1697/" title="Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)" aria-label="source: Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a></p>
<details><summary>The argument</summary>
<p>An entity is <b>the form in which an operation appears as a property of a thing</b>: a reading, a count, a coinage or a translation circulates as an attribute of a name.<a class="cite" href="https://www.alexanarch.org/s/records/1697/" title="Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)" aria-label="source: Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a> A representation can keep the name and the citation while the operation loses its power to change what is recognized. Recognition travels with any reliable source; <b>reconstruction travels only with the source that carries the work</b>.<a class="cite" href="https://www.alexanarch.org/s/records/1703/" title="the service's metadata packet (EA-MPAI-GNOSIS-01, #1703)" aria-label="source: the service's metadata packet (EA-MPAI-GNOSIS-01, #1703)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a> The service reads for the operation, and builds for reconstruction.</p>
<p>The private arrangement of this work is <b>a moat</b>: an ontology held inside a platform, its lineage visible only from within.<a class="cite" href="https://www.alexanarch.org/s/records/1697/" title="Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)" aria-label="source: Opening the Encyclopedia (EA-WIKI-OPEN-01 v1.1, #1697)"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a> A commission funds <b>the public one</b>, a stock of knowledge objects whose sources and operations stay open to inspection and revision, which the request itself enlarges.</p>
<p class="fine">Lee Sharks, <a href="https://www.alexanarch.org/s/records/1697/">Opening the Encyclopedia</a> (EA-WIKI-OPEN-01 v1.1, #1697); <a href="https://www.alexanarch.org/s/records/1690/">The Negative of the Negative</a> (EA-NEGONT-02 v0.9, #1690).</p>
</details>
</div>
</div>
</div></section>

<section class="band" id="agents"><div class="wrap">
<div class="cols">
<div>
<p class="kicker">Agents</p>
<h2>The same service, for agents</h2>
<p>Connect over MCP for quotes, lookups, order status and results: <code>https://gnosis.spxi.dev/mcp</code> (Streamable HTTP), listed in the <a href="https://registry.modelcontextprotocol.io/v0/servers?search=dev.spxi/gnosis">MCP Registry</a> as <code>dev.spxi/gnosis</code>.<a class="cite" href="https://registry.modelcontextprotocol.io/v0/servers?search=dev.spxi/gnosis" title="the MCP Registry listing" aria-label="source: the MCP Registry listing"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.5 8.8a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg></a> <b>MCP is how an agent reaches the service</b>; payment is taken at the HTTP routes, by card or over x402 (USDC on Base mainnet).</p>
<div class="links"><a href="/api">API reference</a><a href="/llms.txt">llms.txt</a><a href="/v1/calibration">calibration</a><a href="https://www.alexanarch.org/s/records/1703/">the service's metadata packet</a></div>
</div>
<div class="agent">
<p class="lab" style="margin-top:0">One request</p>
<pre>curl -s https://gnosis.spxi.dev/v1/quote \\
  -H 'content-type: application/json' \\
  -d '{"oldid": 1361634710, "tier": "opening"}'</pre>
<p class="fine">Returns a quote with each sentence's line and the maximum. Pay it at <code>POST /v1/openings/{quote_id}</code>, which answers <code>402</code> with the x402 requirements; or open a card checkout at <code>POST /v1/openings/{quote_id}/checkout</code>. A name is looked up free at <code>GET /v1/non?name=</code>.</p>
</div>
</div>
</div></section>
<section class="band" id="documents" style="padding:36px 0"><div class="wrap">
<p class="kicker">The documents</p>
<ul class="chips"><li class="chip"><a class="chip-t" href="https://www.google.com/search?q=%22The%20Negative%20of%20the%20Negative%2C%20v2%20%E2%80%94%20the%20Compositional%20Edition%22" title="search for this title">The Negative of the Negative, v2 — the Compositional Edition</a><span class="chip-m">EA-NEGONT-02 v0.9 · the procedure a commission follows · <a href="https://www.alexanarch.org/s/records/1690/">#1690</a> · AXN:0700</span></li><li class="chip"><a class="chip-t" href="https://www.google.com/search?q=%22Opening%20the%20Encyclopedia%3A%20The%20Entity%20as%20Ontological%20Commodity%20Form%22" title="search for this title">Opening the Encyclopedia: The Entity as Ontological Commodity Form</a><span class="chip-m">EA-WIKI-OPEN-01 v1.1 · the specification of the service · <a href="https://www.alexanarch.org/s/records/1697/">#1697</a> · AXN:0708</span></li><li class="chip"><a class="chip-t" href="https://www.google.com/search?q=%22SPXI-gn%CE%A9sis%3A%20Opening%20What%20Is%20Composed%20and%20Constructing%20What%20Is%20Not%22" title="search for this title">SPXI-gnΩsis: Opening What Is Composed and Constructing What Is Not</a><span class="chip-m">EA-MPAI-GNOSIS-01 v1.0 · the service's metadata packet · <a href="https://www.alexanarch.org/s/records/1703/">#1703</a> · AXN:0726</span></li></ul>
</div></section>
</main>` + FOOT(index) + `<script>${FRONT_JS}</script></body></html>`;
}

// The request forms. They call the same routes an agent calls, and hand the quote to its order page.
const FRONT_JS = `
(function(){
  var $=function(s,r){return (r||document).querySelector(s)}, $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
  function esc(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  // the flow: a step's sentence opens beneath it
  $$('.step').forEach(function(b){b.addEventListener('click',function(){var open=b.getAttribute('aria-expanded')!=='true';$$('.step').forEach(function(o){o.setAttribute('aria-expanded','false');$('#'+o.getAttribute('aria-controls')).hidden=true});if(open){b.setAttribute('aria-expanded','true');$('#'+b.getAttribute('aria-controls')).hidden=false}})});
  // tabs
  var tabs=$$('[role=tab]');
  function show(id){tabs.forEach(function(t){var on=t.id===id;t.setAttribute('aria-selected',on);$('#'+t.getAttribute('aria-controls')).hidden=!on});}
  tabs.forEach(function(t){t.addEventListener('click',function(){show(t.id)})});
  // operator fields
  $$('input[name=kind]').forEach(function(r){r.addEventListener('change',function(){var op=$('input[name=kind]:checked').value==='operator';$('#c-strings-wrap').hidden=!op;$('#c-kindhint').innerHTML=op?'An <b>operator</b> is an operation made inspectable as its own object: what it does, where it is performed, which entities it speaks through. It needs the phrases in which it is performed.':'An <b>entity</b> is something named: a person, a work, an institution, a concept.'})});
  function say(form,html,err){var o=$('.out',form);o.innerHTML=err?'<p class="err">'+html+'</p>':html}
  function busy(form,on,label){var b=$('button[type=submit]',form);b.disabled=on;if(label)b.textContent=label}
  function post(body){return fetch('/v1/quote',{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('the service answered '+r.status));return j})})}
  function toOrder(j){location.href='/order/'+encodeURIComponent(j.quote_id)}
  $('#p-open').addEventListener('submit',function(e){e.preventDefault();var f=e.target,a=$('#o-article').value,c=$('#o-capture').value.trim(),tier=$('input[name=tier]:checked',f).value;
    if(!a.trim()&&!c){say(f,'Name a Wikipedia article, or an AI answer by the name it is about.',1);return}
    busy(f,true,'Quoting…');say(f,'');
    var go=a.trim()?post({article:a.trim(),tier:tier}):post({commission:'open',object:(function(){var o={kind:'entity',name:c},sl=$('#o-slug').value.trim();if(sl)o.capture=sl;return o})()});
    go.then(toOrder).catch(function(x){busy(f,false,'Get a free quote');say(f,esc(x.message),1)})});
  $('#p-construct').addEventListener('submit',function(e){e.preventDefault();var f=e.target,kind=$('input[name=kind]:checked',f).value,name=$('#c-name').value.trim(),desc=$('#c-desc').value.trim();
    var strings=$('#c-strings').value.split(',').map(function(s){return s.trim()}).filter(Boolean), sources=$('#c-sources').value.split(/\\s+/).filter(function(s){return /^https?:\\/\\//.test(s)});
    if(!name){say(f,'Name the object.',1);return} if(kind==='operator'&&!strings.length){say(f,'An operator needs its strings: the phrases in which it is performed.',1);return}
    var o={kind:kind,name:name}; if(desc)o.description=desc; if(kind==='operator')o.strings=strings; if(sources.length)o.sources=sources;
    busy(f,true,'Quoting…');say(f,'');post({commission:'construct',object:o}).then(toOrder).catch(function(x){busy(f,false,'Get a free quote');say(f,esc(x.message),1)})});
  $('#p-read').addEventListener('submit',function(e){e.preventDefault();var f=e.target,n=$('#r-name').value.trim();if(!n){say(f,'Name what you are looking for.',1);return}
    busy(f,true,'Looking…');fetch('/v1/non?name='+encodeURIComponent(n),{headers:{accept:'application/json'}}).then(function(r){return r.json()}).then(function(j){busy(f,false,'Find the entry');
      if(j.state==='found'){var en=j.entry;say(f,'<p><b><a href="'+esc(en.record)+'">'+esc(en.name)+'</a></b> · '+esc(en.axn)+'</p><p class="hint">'+esc(en.stage)+'</p><div class="links"><a href="'+esc(en.record)+'">read the entry</a><a href="'+esc(en.data)+'">its data</a></div>')}
      else if(j.candidates){say(f,'<p>More than one entry answers that name:</p><ul>'+j.candidates.map(function(c){return '<li><a href="'+esc(c.record||'#')+'">'+esc(c.name||c.entity)+'</a> '+esc(c.type||'')+'</li>'}).join('')+'</ul>')}
      else{say(f,'<p>/non holds no entry for “'+esc(n)+'” yet.</p><button class="btn quiet" type="button" id="r-build">Construct it: get a free quote</button>');$('#r-build').addEventListener('click',function(){$('#c-name').value=n;show('t-construct');$('#c-name').focus()})}
    }).catch(function(x){busy(f,false,'Find the entry');say(f,esc(x.message),1)})});
})();`;

// ------------------------------------------------------------------------------------------------------------- order
export function orderPage(index, id) {
  return HEAD(`Order ${id} — SPXI-gnΩsis`, "An order with SPXI-gnΩsis: its quote, payment, progress and result.") + MAST + `
<main class="wrap" style="padding-top:28px;padding-bottom:48px">
<p class="kicker">Order</p>
<h1 class="call" style="font-size:clamp(1.6rem,3vw,2.3rem);margin-bottom:6px" id="o-title">Order <span class="mono">${esc(id)}</span></h1>
<p class="fine" id="o-sub">Looking up the order…</p>
<ol class="steps" id="o-steps"><li>Request</li><li>Quote</li><li>Payment</li><li>Progress</li><li>Result</li></ol>
<div id="o-body"></div>
<p class="fine">Keep this page's address: it is how you return to the order. As data: <a href="/v1/quotes/${esc(id)}/status"><code>/v1/quotes/${esc(id)}/status</code></a></p>
</main>` + FOOT(index) + `<script>var QUOTE_ID=${JSON.stringify(String(id))};${ORDER_JS}</script></body></html>`;
}

const ORDER_JS = `
(function(){
  var $=function(s){return document.querySelector(s)};
  function esc(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  function usd(n){return n==null?'—':(n<1?(Math.round(n*1000)/10)+'¢':'$'+Number(n).toFixed(2))}
  function step(n){Array.prototype.forEach.call(document.querySelectorAll('#o-steps li'),function(li,i){li.className=i<n?'past':i===n?'on':''})}
  var timer=null, paidReturn=/[?&]paid=1/.test(location.search);
  function again(ms){clearTimeout(timer);timer=setTimeout(load,ms)}
  function what(q){
    if(!q) return {title:'',deliver:[],publish:''};
    var s7=q.s7, obj=q.entity, tier=q.tier, title=q.article&&q.article.title||obj&&obj.name||'';
    var act=q.commission||(q.kind==='entity'?'construct':'open');
    var d=[], pub='';
    if(q.kind!=='entity'){
      d.push((q.claims_total||0)+' sentences of “'+esc(q.article.title)+'”, revision '+esc(q.article.oldid)+(q.claims_ledgered?', '+q.claims_ledgered+' already read and served from the ledger':'')+'; each with its reading against the sources it cites, quoted passages and hashes, and any disagreement kept as contested');
      pub='The readings are kept and served to later callers (CC BY 4.0). No /non row is composed at this scope.';
    } else if(act==='open'){
      var ts=q.t_sentences; d.push('the AI answer above, '+(ts?(ts.read===ts.total?'all '+ts.total+' of its sentences':ts.read?'the first '+ts.read+' of its '+ts.total+' sentences ('+ts.excluded+' not read)':'its sentences not read against its sources, which could not be fetched'):'its sentences')+' read against the sources it showed'); }
    if(s7&&s7.stages){
      d.push('<b>The reading</b> ('+usd(s7.stages.reading.price_usd)+' at most): the traversal, the admitted deposits with their readings, the ledgers with every quote checked, and the ontology read twice');
      d.push('<b>The construction</b> ('+usd(s7.stages.construction.price_usd)+' at most): the knowledge object, every sentence naming its claims, with its audit');
      pub='The row is composed in /non and lands public under CC BY 4.0'+(s7.non_url?' at <a href="'+esc(s7.non_url)+'">'+esc(s7.non_url)+'</a>':'')+'.';
    }
    var label=q.kind==='entity'?(act==='construct'?'Construct':'Open')+' '+(q.object_kind||'entity')+': '+title:(tier==='check'?'Check':tier==='commission'?'Commission':'Open')+': '+title;
    var cap=null, src=q.T_source;
    if(src&&src.primary&&src.primary.slug){var c=src.primary;cap='<div class="card" style="background:var(--bg)"><p class="lab" style="margin-top:0">The answer this order opens</p><dl class="kv"><dt>engine</dt><dd>'+esc(c.surface)+'</dd><dt>date</dt><dd>'+esc(c.date)+'</dd><dt>query</dt><dd>“'+esc(c.q)+'”</dd><dt>capture</dt><dd><a href="https://www.alexanarch.org/captures/'+esc(c.slug)+'/">'+esc(c.slug)+'</a></dd></dl>'+(src.related_captures?'<p class="fine">'+src.related_captures+' other capture'+(src.related_captures===1?' is':'s are')+' seated for this name. If this is not the answer you meant, request again with its address.</p>':'')+'</div>'}
    return {title:label,deliver:d,publish:pub,cap:cap};
  }
  function load(){
    fetch('/v1/quotes/'+encodeURIComponent(QUOTE_ID)+'/status',{headers:{accept:'application/json'}}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){
      var j=x.j, b=$('#o-body'); if(!x.ok){step(0);$('#o-sub').textContent='';b.innerHTML='<div class="card"><p class="err">'+esc(j.error||'this order is not known')+'</p><p><a href="/#commission">Start a request</a></p></div>';return}
      var w=what(j.quote); if(w.title) $('#o-title').innerHTML=esc(w.title).replace(/^(Construct|Open|Check|Commission)/,'$1');
      var st=j.state||'';
      if(st==='estimating'){step(1);$('#o-sub').textContent='The archive worker is pricing this request. It traverses the archive first; it usually takes a few minutes.';b.innerHTML='<div class="card"><span class="st wait">Estimating</span><p class="fine">This page checks again by itself.</p></div>';return again(8000)}
      if(st==='not quoted'){step(1);$('#o-sub').textContent='';b.innerHTML='<div class="card"><p class="err">Not quoted: '+esc(j.error)+'</p><p><a href="/#commission">Change the request</a></p></div>';return}
      var q=j.quote, list='<ul>'+w.deliver.map(function(d){return '<li>'+d+'</li>'}).join('')+'</ul>';
      if(st==='quoted'){
        var exp=Date.parse(j.expires), left=Math.max(0,Math.round((exp-Date.now())/60000)), under=j.max_price_usd<0.5;
        step(paidReturn?2:1);
        $('#o-sub').textContent=left>0?'Quoted. The quote holds for '+left+' more minute'+(left===1?'':'s')+'.':'This quote has expired; request it again.';
        b.innerHTML='<div class="card"><p class="lab" style="margin-top:0">At most</p><p class="big">'+usd(j.max_price_usd)+'</p>'+(under?'<p class="fine">By card the charge is $0.50, the card minimum, and an order at that minimum keeps it.</p>':'<p class="fine">Charged for what is delivered, never above this; the rest is refunded, and an order that delivers nothing is refunded in full.</p>')+
          (w.cap||'')+'<p class="lab">You receive</p>'+list+'<p class="lab">Public</p><p>'+w.publish+'</p>'+
          (left>0?'<button class="btn" id="pay">Pay by card'+(under?' ($0.50)':'')+'</button><p class="fine" style="margin-top:10px">Agents pay the same quote over x402 at <code>POST /v1/openings/'+esc(QUOTE_ID)+'</code>.</p><div class="out" id="pay-out"></div>':'<p><a href="/#commission">Request a new quote</a></p>')+
          '<details><summary>The quote as data</summary><pre>'+esc(JSON.stringify(q,null,1)).slice(0,20000)+'</pre></details></div>';
        var p=$('#pay'); if(p) p.addEventListener('click',function(){p.disabled=true;p.textContent='Opening the checkout…';fetch('/v1/openings/'+encodeURIComponent(QUOTE_ID)+'/checkout',{method:'POST',headers:{accept:'application/json'}}).then(function(r){return r.json()}).then(function(c){var to=c.url||c.checkout_url;if(to)location.href=to;else{p.disabled=false;p.textContent='Pay by card';$('#pay-out').innerHTML='<p class="err">'+esc(c.error||'the checkout could not be opened')+'</p>'}}).catch(function(e){p.disabled=false;p.textContent='Pay by card';$('#pay-out').innerHTML='<p class="err">'+esc(e.message)+'</p>'})});
        if(paidReturn) again(5000);
        return;
      }
      if(/^paid/.test(st)){
        step(3); var pr=j.progress||{};
        $('#o-sub').textContent='Paid. The work is running.';
        b.innerHTML='<div class="card"><span class="st wait">Running</span><dl class="kv" style="margin-top:12px"><dt>stage</dt><dd>'+esc(pr.stage||'starting')+'</dd>'+(pr.detail?'<dt>now</dt><dd>'+esc(pr.detail)+'</dd>':'')+(pr.at?'<dt>at</dt><dd>'+esc(pr.at.replace('T',' ').slice(0,19))+' UTC</dd>':'')+(j.receipt?'<dt>paid</dt><dd>'+usd(j.receipt.paid_usd)+' · '+esc(j.receipt.channel||'')+'</dd>':'')+'</dl><p class="lab">You will receive</p>'+list+'<p class="fine">This page checks again by itself. A commission takes several minutes.</p></div>';
        return again(6000);
      }
      if(st==='delivered'){
        step(4); var r=j.result||{}, rid=r.result_id;
        $('#o-sub').textContent='Delivered.';
        b.innerHTML='<div class="card"><div class="states"><span class="st done">Delivered</span><span class="st wait" id="pub-st">Publication: checking</span></div>'+
          '<p class="lab">Your result</p><div class="links" style="font-size:1rem"><a href="'+esc(r.composition)+'"><b>the result</b></a><a href="'+esc(r.evidence)+'">its evidence</a>'+(rid?'<a href="/v1/results/'+esc(rid)+'/opened.html">the opened text</a>':'')+'</div>'+
          '<dl class="kv">'+(j.receipt?'<dt>paid</dt><dd>'+usd(j.receipt.paid_usd)+'</dd>':'')+(j.refund?'<dt>refund</dt><dd>'+esc(j.refund.state||j.refund.status||'recorded')+(j.refund.amount_usd!=null?' · '+usd(j.refund.amount_usd):'')+'</dd>':'')+'<dt>result</dt><dd class="mono">'+esc(rid)+'</dd></dl></div>';
        if(rid) fetch('/v1/results/'+encodeURIComponent(rid)+'/publication',{headers:{accept:'application/json'}}).then(function(r){return r.ok?r.json():null}).then(function(p){var el=$('#pub-st');if(!el)return;if(!p){el.textContent='No /non row at this scope';return}
          var s=p.state||p.status||(p.public?'public':p.landed?'landed':p.composed?'composed':'');el.textContent='Publication: '+s;if(/public/.test(String(s)))el.className='st public';}).catch(function(){});
        return;
      }
      if(/^refunded/.test(st)){step(4);$('#o-sub').textContent='';b.innerHTML='<div class="card"><p><b>Refunded.</b> '+esc(st.replace(/^refunded:?\\s*/,''))+'</p>'+(j.refund?'<dl class="kv"><dt>refund</dt><dd>'+esc(j.refund.state||j.refund.status||'recorded')+'</dd></dl>':'')+'<p><a href="/#commission">Start a request</a></p></div>';return}
      $('#o-sub').textContent=st; b.innerHTML='<pre>'+esc(JSON.stringify(j,null,1))+'</pre>';
    }).catch(function(e){$('#o-sub').textContent='The order could not be read just now ('+e.message+'); trying again.';again(8000)});
  }
  load();
})();`;

// --------------------------------------------------------------------------------------------------------------- api
export function apiPage(index) {
  const ops = Object.entries(index.operations || {}).map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${esc(v)}</dd>`).join("");
  const conf = [["card", index.payments?.card], ["agents", index.payments?.agents], ["reader", index.reader], ["archive worker", index.worker_start], ["landing", index.landing_start], ["storage", index.storage]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  return HEAD("API reference — SPXI-gnΩsis", "Every route of SPXI-gnΩsis, with the deployment's current configuration.") + MAST + `
<main class="wrap" style="padding-top:28px;padding-bottom:48px"><div class="measure" style="max-width:820px">
<p class="kicker">Reference</p>
<h1 class="call" style="font-size:clamp(1.6rem,3vw,2.3rem)">The API</h1>
<p>${esc(index.service.name)} ${esc(index.service.version)}, protocol ${esc(index.service.protocol || "")}. The same description is served as JSON at <code>GET /</code> with <code>Accept: application/json</code>, and as text at <a href="/llms.txt">/llms.txt</a>. Agents connect over MCP at <code>POST /mcp</code> (listed as <code>dev.spxi/gnosis</code>); payment is taken at the HTTP routes.</p>
<h2 style="margin-top:28px">Operations</h2>
<dl class="kv" style="grid-template-columns:1fr;gap:2px 0">${ops.replace(/<dd>/g, '<dd style="margin:0 0 12px;color:var(--muted)">')}</dl>
<h2 style="margin-top:28px">This deployment</h2>
<dl class="kv">${conf}</dl>
${index.publication ? `<h2 style="margin-top:28px">Publication</h2><p>${esc(index.publication)}</p>` : ""}
${index.notice ? `<p class="fine">${esc(index.notice)}</p>` : ""}
</div></main>` + FOOT(index) + `</body></html>`;
}
