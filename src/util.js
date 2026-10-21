// Shared helpers: hashing, storage, polite HTTP.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const ROOT = new URL("..", import.meta.url).pathname;
export const STORE = process.env.GNOSIS_STORE || join(ROOT, "store");
export const UA = "SPXI-gnosis/0.1 (https://spxi.dev; service prototype)";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function save(rel, data) {
  const p = join(STORE, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 1));
  return p;
}
export function load(rel, json = true) {
  const p = join(STORE, rel);
  if (!existsSync(p)) return null;
  const t = readFileSync(p, "utf8");
  return json ? JSON.parse(t) : t;
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
