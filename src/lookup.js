// The name request (EA-WIKI-OPEN-01 §11.3, built 2026-10-25): an object by its name, with no identifier. Where /non
// holds an entry the name answers, the entry is returned, free; where several could, the candidates are returned with
// what tells them apart; where none does, the construction is offered as a free quote, and nothing is priced or run
// until the caller asks for it. The entries are read from /non's published table of contents, kept an hour.
const NON_INDEX_URL = process.env.GNOSIS_NON_INDEX || "https://www.alexanarch.org/non/index.json";
let IDX = null, AT = 0;

async function index() {
  if (IDX && Date.now() - AT < 3600e3) return IDX;
  const r = await fetch(NON_INDEX_URL, { headers: { "User-Agent": "SPXI-gnosis (https://gnosis.spxi.dev)" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`the /non table of contents answered HTTP ${r.status}`);
  IDX = (await r.json()).entities || []; AT = Date.now();
  return IDX;
}

const fold = (s) => String(s || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s) => new Set(fold(s).split(" ").filter((w) => w.length > 2));

export async function lookupName(name, { context = "" } = {}) {
  const q = fold(name);
  if (!q) return { status: 400, body: { error: "name is required" } };
  const entries = await index();
  const strings = (e) => [e.name, e.entity, ...(e.addresses || [])].map(fold);
  const exact = entries.filter((e) => strings(e).includes(q));
  const qw = words(name), cw = words(context);
  const near = entries.filter((e) => !exact.includes(e)).map((e) => {
    const ew = words([e.name, ...(e.addresses || [])].join(" "));
    const hit = [...qw].filter((w) => ew.has(w)).length;
    return { e, score: hit / Math.max(1, qw.size) + (cw.size ? [...cw].filter((w) => ew.has(w)).length * 0.1 : 0) };
  }).filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.e);
  const card = (e) => ({ name: e.name, entity: e.entity, axn: e.axn || null, type: e.type, case: e.case || null, composed: !!e.has_ko,
    composer: e.composer_class, stage: e.stage, record: e.record_url, data: e.json_url, addresses: e.addresses });
  const construct = { request: "POST /v1/quote", body: { commission: "construct", object: { kind: "entity", name } },
    note: "a free quote, priced by the archive worker within minutes; nothing is charged until the quote is paid. For an operator, object.kind is \"operator\" with its strings." };
  // An operator is extended as an operator, with its description and strings to be restated (2026-10-25: the lookup of
  // the first operator offered to extend it as an entity).
  const isOp = (e) => String(e?.entity || "").startsWith("op-") || /^Op\b/.test(String(e?.type || ""));
  const extendOf = (e) => isOp(e)
    ? { request: "POST /v1/quote", body: { commission: "construct", object: { kind: "operator", name: e.name || name, description: "<what the operation is>", strings: ["<the phrases in which it is performed>"] } },
        note: "the entry is free as composed; recomposing it against a changed source or a new archive release is new work, quoted the same way, with the operator's description and strings" }
    : { ...construct, note: "the entry is free as composed; recomposing it against a changed source or a new archive release is new work, quoted the same way" };
  if (exact.length === 1) return { status: 200, body: { state: "found", price_usd: 0, entry: card(exact[0]), extend: extendOf(exact[0]) } };
  if (exact.length > 1 || near.length) return { status: 200, body: { state: exact.length > 1 ? "several" : "candidates", price_usd: 0,
    candidates: [...exact, ...near].map(card), note: "no single entry answers the name; the context (a URL, a description, the kind of object) tells them apart, or the object is constructed", construct } };
  return { status: 404, body: { state: "not in /non", price_usd: 0, name, construct } };
}
