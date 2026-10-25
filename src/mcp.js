// SPXI-gnΩsis as tools (2026-10-25): a Model Context Protocol server over Streamable HTTP at POST /mcp, stateless,
// JSON responses. Each tool is a request the HTTP interface already answers, made against the service itself, so the
// tools and the routes cannot disagree. Payment is never taken through a tool: a tool returns the price and the paid
// route (x402) or the card link, and the caller pays there.
export const MCP_PROTOCOL = "2025-06-18";

// Each tool says when to use it, which tool answers the neighbouring question, and what it returns (2026-10-25: Glama's
// tool-quality score marked find_entry, get_quote and get_result C for want of when-to-use guidance, and flagged
// get_quote, order_status and open_sentence as overlapping on price and status).
const TOOLS = [
  { name: "find_entry", title: "Find a /non entry by name",
    description: "Use first when a person, work, concept, institution or operator needs a sourced knowledge object: looks the name up in the Negative of the Negative (/non), free. Returns the entry (its page, data and status) when one exists; the candidates and what tells them apart when the name is ambiguous; or, when none exists, the request for a free construction quote to pass to get_quote. Does not check a sentence (use open_sentence) and charges nothing.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "the object's name as you have it, e.g. \"Sophistical Refutations\" or \"Attributization\"" }, context: { type: "string", description: "optional: a URL, a description or the kind of object, to choose among candidates with the same name" } }, required: ["name"] },
    call: ({ name, context }) => ({ path: `/v1/non?${new URLSearchParams({ name, ...(context ? { context } : {}) })}` }) },
  { name: "open_sentence", title: "Check one Wikipedia sentence against its sources",
    description: "Use when one sentence from an English Wikipedia page must be checked against the sources it cites before it is quoted or relied on. Send the sentence exactly as it stands and the page's URL. Free when the sentence has already been read at the same state; otherwise returns its price (typically 22¢ opened) and the paid HTTP route (x402) that reads it. A text that is not the page's sentence exactly is answered with the page's closest sentences, nothing charged. For a whole article use get_quote with the article instead.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "the sentence exactly as it stands on the page (footnote markers may be left in)" }, url: { type: "string", description: "the English Wikipedia page, by title URL or revision URL" }, mode: { type: "string", enum: ["opening", "preliminary", "grounded"], description: "opening (default): two separately generated readings; preliminary: one pass on the small model; grounded: with the archive's claims, where a commissioned row holds the sentence" } }, required: ["text", "url"] },
    call: ({ text, url, mode }) => ({ path: `/v1/sentence?${new URLSearchParams({ text, url, ...(mode ? { mode } : {}) })}` }) },
  { name: "get_quote", title: "Price a whole article or a commission (free)",
    description: "Use to price work before paying: a whole Wikipedia article (article: its link or title, or oldid), read sentence by sentence at a tier, or a commission on an object (object with kind entity or operator, name, and for an operator its strings; commission construct or open). Free; returns a quote_id with each deliverable, its line and the maximum, or, for a commission, a quote_id whose price appears at order_status within minutes. Pay a quote over x402 at POST /v1/openings/{quote_id}, or have a person pay with card_checkout. For one sentence use open_sentence; to see whether an object already exists use find_entry first.",
    inputSchema: { type: "object", properties: {
      article: { type: "string", description: "an English Wikipedia article's link or title; its current revision is pinned" },
      oldid: { type: "integer", description: "a Wikipedia revision id, in place of article" },
      tier: { type: "string", enum: ["check", "opening", "commission", "portable"], description: "check: two passes on the small model; opening (default): two separately generated readings; commission: opened, then the archive consulted and a public /non row composed; portable: the commission and its knowledge object as a package" },
      object: { type: "object", description: "for a commission on an object: {kind: \"entity\" | \"operator\", name, description?, strings? (an operator's phrases), sources? (links)}" },
      commission: { type: "string", enum: ["open", "construct"], description: "construct: compose the object from the archive and its sources; open: read an AI answer seated in the Capture Registry for the name" } } },
    call: (a) => ({ path: "/v1/quote", method: "POST", body: a }) },
  { name: "order_status", title: "Where a quote or paid order stands",
    description: "Use after get_quote or a payment, with the quote_id: returns the state (estimating, quoted, paid and running, delivered, refunded), the quote with its lines and expiry, the order's progress, its receipt and refund, and, once delivered, the result_id to pass to get_result. Charges nothing and starts nothing.",
    inputSchema: { type: "object", properties: { quote_id: { type: "string", description: "the quote_id from get_quote, e.g. Q-0123456789abcdef" } }, required: ["quote_id"] },
    call: ({ quote_id }) => ({ path: `/v1/quotes/${encodeURIComponent(quote_id)}/status` }) },
  { name: "card_checkout", title: "A card payment link for a person",
    description: "Use when a person, not the agent, will pay a quote by card: returns a Stripe Checkout link (url) for the quote's maximum, at least $0.50. The work runs when the payment completes; the charge follows the work delivered, never above the quote, the rest refunded, and an order that delivers nothing is refunded in full (a card order quoted under $0.50 keeps the $0.50 minimum). An agent paying itself uses x402 at POST /v1/openings/{quote_id} instead.",
    inputSchema: { type: "object", properties: { quote_id: { type: "string", description: "the quote_id from get_quote" } }, required: ["quote_id"] },
    call: ({ quote_id }) => ({ path: `/v1/openings/${encodeURIComponent(quote_id)}/checkout`, method: "POST" }) },
  { name: "get_result", title: "Read a delivered result",
    description: "Use once order_status names a result_id: returns the delivered work. part composition (default): the usable result, each sentence's reading or the knowledge object; evidence: the full record behind it (quoted spans, source hashes, both readings, breaches, model cost); publication: whether the /non row is composed, checked, landed and public. Free to read.",
    inputSchema: { type: "object", properties: { result_id: { type: "string", description: "the result_id order_status returns, e.g. R-d744378a9776dfdb" }, part: { type: "string", enum: ["composition", "evidence", "publication"], description: "which part of the result (default composition)" } }, required: ["result_id"] },
    call: ({ result_id, part = "composition" }) => ({ path: `/v1/results/${encodeURIComponent(result_id)}/${part}` }) },
];

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

// A tool's arguments checked against its own published schema before anything is sent on (2026-10-25, the first
// adversarial test: params null reached params.name and the route answered an HTML 500).
const TYPES = { string: (v) => typeof v === "string", integer: (v) => Number.isInteger(v), number: (v) => typeof v === "number" && isFinite(v), object: (v) => v !== null && typeof v === "object" && !Array.isArray(v), array: Array.isArray, boolean: (v) => typeof v === "boolean" };
function badArguments(schema, args) {
  if (!TYPES.object(args)) return "arguments must be an object";
  for (const k of schema.required || []) if (args[k] === undefined || args[k] === null || args[k] === "") return `arguments.${k} is required`;
  for (const [k, v] of Object.entries(args)) {
    const p = schema.properties?.[k];
    if (!p) continue;
    if (p.type && TYPES[p.type] && !TYPES[p.type](v)) return `arguments.${k} must be ${p.type === "integer" ? "an integer" : `a ${p.type}`}`;
    if (p.enum && !p.enum.includes(v)) return `arguments.${k} must be one of ${p.enum.join(", ")}`;
  }
  return null;
}
export async function handleMcp(msg, { base, service }) {
  if (Array.isArray(msg)) return Promise.all(msg.map((m) => handleMcp(m, { base, service }))).then((xs) => xs.filter(Boolean));
  if (!msg || typeof msg !== "object") return err(null, -32600, "invalid request: a JSON-RPC 2.0 object is expected");
  const { id, method } = msg;
  if (id === undefined || id === null) return null; // a notification: nothing to answer
  if (msg.jsonrpc !== "2.0" || typeof method !== "string") return err(id, -32600, "invalid request: jsonrpc must be \"2.0\" and method a string");
  if (msg.params !== undefined && (msg.params === null || typeof msg.params !== "object" || Array.isArray(msg.params))) return err(id, -32602, "invalid params: params must be an object");
  const params = msg.params || {};
  if (method === "initialize")
    return ok(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "spxi-gnosis", title: "SPXI-gnΩsis", version: service.version },
      instructions: "SPXI-gnΩsis opens existing compositions against their sources and constructs sourced knowledge objects, for entities and for operators (the operations an entity form conceals). Its principal application opens Wikipedia sentences against the sources they cite. A commission composes the object's public row in the Negative of the Negative (alexanarch.org/non). Quotes and reads of existing work are free. The tools return quotes, results and payment directions; payment itself is made at the HTTP routes they name (card checkout, or x402). Description: https://gnosis.spxi.dev/llms.txt" });
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS.map(({ call, ...t }) => t) });
  if (method === "tools/call") {
    if (typeof params.name !== "string") return err(id, -32602, "invalid params: name, the tool to call, is required");
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return err(id, -32602, `unknown tool: ${params.name}`);
    const args = params.arguments === undefined ? {} : params.arguments;
    const bad = badArguments(tool.inputSchema, args);
    if (bad) return err(id, -32602, `invalid params for ${tool.name}: ${bad}`);
    let req;
    try { req = tool.call(args); } catch (e) { return err(id, -32602, `invalid params for ${tool.name}: ${String(e.message || e)}`); }
    try {
      const r = await fetch(base + req.path, { method: req.method || "GET", headers: { Accept: "application/json", ...(req.body ? { "Content-Type": "application/json" } : {}) },
        body: req.body ? JSON.stringify(req.body) : undefined, signal: AbortSignal.timeout(120000) });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { body: text.slice(0, 4000) }; }
      if (r.status === 402) data = { payment_required: true, price: r.headers.get("PAYMENT-REQUIRED") ? "see the PAYMENT-REQUIRED header of the HTTP route" : undefined, route: req.path, note: "new work: pay at this HTTP route over x402, or quote it and pay by card (card_checkout)", ...data };
      return ok(id, { content: [{ type: "text", text: JSON.stringify(data, null, 1).slice(0, 60000) }], structuredContent: data, isError: r.status >= 400 && r.status !== 402 });
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: `the request failed: ${String(e.message || e)}` }], isError: true });
    }
  }
  return err(id, -32601, `method not found: ${method}`);
}
