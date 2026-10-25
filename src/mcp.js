// SPXI-gnΩsis as tools (2026-10-25): a Model Context Protocol server over Streamable HTTP at POST /mcp, stateless,
// JSON responses. Each tool is a request the HTTP interface already answers, made against the service itself, so the
// tools and the routes cannot disagree. Payment is never taken through a tool: a tool returns the price and the paid
// route (x402) or the card link, and the caller pays there.
export const MCP_PROTOCOL = "2025-06-18";

const TOOLS = [
  { name: "find_entry", title: "Find a /non entry by name",
    description: "Use when an entity, concept or operator needs its public knowledge object: returns the Negative of the Negative (/non) entry the name answers, free, or the candidates, or the construction offered as a free quote.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, context: { type: "string", description: "a URL, a description or the kind of object, to tell candidates apart" } }, required: ["name"] },
    call: ({ name, context }) => ({ path: `/v1/non?${new URLSearchParams({ name, ...(context ? { context } : {}) })}` }) },
  { name: "open_sentence", title: "Open a Wikipedia sentence against its sources",
    description: "Use when a sentence from Wikipedia needs checking against the sources it cites before it is relied on: send the sentence as held and the page it came from. Free where the sentence has been read; otherwise returns the price and the paid route.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, url: { type: "string", description: "the English Wikipedia page, by title URL or revision URL" }, mode: { type: "string", enum: ["opening", "preliminary", "grounded"] } }, required: ["text", "url"] },
    call: ({ text, url, mode }) => ({ path: `/v1/sentence?${new URLSearchParams({ text, url, ...(mode ? { mode } : {}) })}` }) },
  { name: "get_quote", title: "Quote an opening or a commission",
    description: "Free. For a Wikipedia revision (oldid) at a tier (check, opening, commission, portable), or a commission on an object the encyclopedia does not hold ({object: {kind, name, …}, commission: open | construct}). Returns the scope and maximum price, or, where the archive is consulted, a status address where the quote appears within minutes.",
    inputSchema: { type: "object", properties: { oldid: { type: "integer" }, tier: { type: "string", enum: ["check", "opening", "commission", "portable"] }, object: { type: "object" }, commission: { type: "string", enum: ["open", "construct"] } } },
    call: (a) => ({ path: "/v1/quote", method: "POST", body: a }) },
  { name: "order_status", title: "Where a quote or order stands",
    description: "Returns a quote's price and expiry, or a paid order's progress, receipt, refund and result id once delivered.",
    inputSchema: { type: "object", properties: { quote_id: { type: "string" } }, required: ["quote_id"] },
    call: ({ quote_id }) => ({ path: `/v1/quotes/${encodeURIComponent(quote_id)}/status` }) },
  { name: "card_checkout", title: "A card checkout link for a person",
    description: "Returns a Stripe Checkout link for a quote's maximum (at least $0.50), for a person to pay; the work runs when the payment completes and what it does not use is refunded.",
    inputSchema: { type: "object", properties: { quote_id: { type: "string" } }, required: ["quote_id"] },
    call: ({ quote_id }) => ({ path: `/v1/openings/${encodeURIComponent(quote_id)}/checkout`, method: "POST" }) },
  { name: "get_result", title: "A delivered result",
    description: "The usable result (composition: each sentence in five parts) or the full evidence record (spans, hashes, both readings, breaches, cost), by result id.",
    inputSchema: { type: "object", properties: { result_id: { type: "string" }, part: { type: "string", enum: ["composition", "evidence", "publication"] } }, required: ["result_id"] },
    call: ({ result_id, part = "composition" }) => ({ path: `/v1/results/${encodeURIComponent(result_id)}/${part}` }) },
];

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

export async function handleMcp(msg, { base, service }) {
  if (Array.isArray(msg)) return Promise.all(msg.map((m) => handleMcp(m, { base, service }))).then((xs) => xs.filter(Boolean));
  const { id, method, params = {} } = msg || {};
  if (id === undefined || id === null) return null; // a notification: nothing to answer
  if (method === "initialize")
    return ok(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "spxi-gnosis", title: "SPXI-gnΩsis", version: service.version },
      instructions: "SPXI-gnΩsis opens existing compositions against their sources and constructs sourced knowledge objects, for entities and for operators (the operations an entity form conceals). Its principal application opens Wikipedia sentences against the sources they cite. A commission composes the object's public row in the Negative of the Negative (alexanarch.org/non). Quotes and reads of existing work are free. The tools return quotes, results and payment directions; payment itself is made at the HTTP routes they name (card checkout, or x402). Description: https://gnosis.spxi.dev/llms.txt" });
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS.map(({ call, ...t }) => t) });
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return err(id, -32602, `unknown tool: ${params.name}`);
    const req = tool.call(params.arguments || {});
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
