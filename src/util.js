// Shared helpers: hashing, storage, polite HTTP.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const ROOT = new URL("..", import.meta.url).pathname;
// SEED is the store as committed: policy texts, snapshots, calibration replays. It is read-only on Vercel.
export const SEED = join(ROOT, "store");
// STORE is where this process writes. On Vercel only /tmp is writable, and it is neither shared between instances nor
// kept between requests, so there every record is also written to Vercel Blob (private), which is: the durable copy.
export const STORE = process.env.GNOSIS_STORE || (process.env.VERCEL ? "/tmp/gnosis-store" : SEED);
export const BLOB = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) && process.env.GNOSIS_BLOB !== "off";
const BLOB_PREFIX = "store/";
let blobMod = null;
const blob = async () => (blobMod ||= await import("@vercel/blob"));
export const UA = "SPXI-gnosis/0.1 (https://spxi.dev; service prototype)";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const typeOf = (rel) => rel.endsWith(".json") ? "application/json" : rel.endsWith(".html") ? "text/html; charset=utf-8" : rel.endsWith(".jsonld") ? "application/ld+json" : "text/plain; charset=utf-8";

// Records are written locally and, where Blob is configured, to Blob; a write is complete when both are.
export async function save(rel, data) {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 1);
  const p = join(STORE, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  if (BLOB) {
    const { put } = await blob();
    await put(BLOB_PREFIX + rel, body, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: typeOf(rel) });
  }
  return p;
}

// Read order: what this process wrote, the committed seed, then Blob (the latest version, uncached). Records that more
// than one process writes (an order's progress, quote, receipt, refund and result pointer; the worker's queues; the
// calibration) are read from Blob first, since this process's copy may be older than another's write (2026-10-25: an
// instance that had queued an order showed it queued while the worker ran and delivered it).
const SHARED = /^(progress|quotes|receipts|refunds|delivered|jobs|worker|calibration|settlements|landable)\//;
async function fromBlob(rel, json) {
  const { get } = await blob();
  const r = await get(BLOB_PREFIX + rel, { access: "private", useCache: false }).catch((e) => { if (e?.name === "BlobNotFoundError") return null; throw e; });
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  const t = await new Response(r.stream).text();
  return json ? JSON.parse(t) : t;
}
export async function load(rel, json = true) {
  if (BLOB && SHARED.test(rel)) { const v = await fromBlob(rel, json); if (v !== null) return v; }
  for (const base of STORE === SEED ? [STORE] : [STORE, SEED]) {
    const p = join(base, rel);
    if (existsSync(p)) { const t = readFileSync(p, "utf8"); return json ? JSON.parse(t) : t; }
  }
  if (!BLOB || SHARED.test(rel)) return null;
  return fromBlob(rel, json);
}

// The names directly under a directory of the store, from every layer.
export async function list(relDir) {
  const names = new Set();
  for (const base of STORE === SEED ? [STORE] : [STORE, SEED]) {
    const d = join(base, relDir);
    if (existsSync(d)) for (const f of readdirSync(d)) names.add(f);
  }
  if (BLOB) {
    const { list: blist } = await blob();
    const prefix = BLOB_PREFIX + relDir.replace(/\/?$/, "/");
    let cursor;
    do {
      const r = await blist({ prefix, cursor, mode: "folded" });
      for (const b of r.blobs) names.add(b.pathname.slice(prefix.length));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
  }
  return [...names];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wikimedia rules: identify the client, keep concurrency low, honour Retry-After on 429.
let inflight = 0;
export async function politeFetch(url, { tries = 5, accept } = {}) {
  while (inflight >= 3) await sleep(100);
  inflight++;
  try {
    let wait = 2000;
    for (let i = 0; i < tries; i++) {
      const res = await fetch(url, { headers: { "User-Agent": UA, ...(accept ? { Accept: accept } : {}) } });
      if (res.status !== 429 && res.status !== 503) {
        const body = await res.text();
        return { status: res.status, body, url: res.url, contentType: res.headers.get("content-type") || "" };
      }
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : wait);
      wait *= 2;
    }
    return { status: 429, body: "", url, contentType: "" };
  } finally {
    inflight--;
  }
}
