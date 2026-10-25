// Publication as observed stages: composed (the row exists) → checked (the code checks ran and the audit is complete)
// → landed (the archive checkout holds the row file with the landing tree's hash) → public (the entity's /non page answers
// and names the row). Each stage is observed when asked for, never assumed; the archive's landing workflow lands composed rows by itself.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE } from "./input.js";
import { sha256 } from "../util.js";

export async function publicationState(s7, { fetchPublic = true } = {}) {
  if (!s7?.composed) return { state: "not composed", stages: { composed: false } };
  const rowRel = `datasets/negative-of-the-negative/v2/rows/${s7.row_key}.json`;
  const want = (s7.manifest?.files || []).find((f) => f.path === rowRel)?.sha256;
  // Landed is observed in the archive's repository: the local checkout where there is one (the worker), else the
  // archive's main branch as published (the deployed service holds no archive; 2026-10-25: it could never observe a
  // landing). Its row file must hash to the landing tree's.
  const local = join(ARCHIVE, rowRel);
  let landed = !!want && existsSync(local) && sha256(readFileSync(local)) === want;
  let landedAt = landed ? "the archive checkout" : null;
  if (!landed && want && fetchPublic) {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/leesharks000/alexanarch/main/${rowRel}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok && sha256(await r.text()) === want) { landed = true; landedAt = "the archive's main branch"; }
    } catch {}
  }
  const checked = !!s7.audit?.ran && !!s7.audit?.complete;
  let pub = { observed: false, detail: "not checked" };
  // Public means the site serves this version of the row: the row file the site serves hashes to the landing tree's
  // hash. A page that names the row's slug is recorded, and proves nothing about which version it shows.
  if (fetchPublic && landed) {
    try {
      const r = await fetch(`https://www.alexanarch.org/${rowRel}`, { signal: AbortSignal.timeout(8000) });
      const body = r.ok ? await r.text() : "";
      const page = await fetch(s7.non_url, { signal: AbortSignal.timeout(8000) }).then(async (p) => ({ status: p.status, names_row: p.ok && (await p.text()).includes(s7.row_key) })).catch(() => null);
      pub = { observed: true, status: r.status, served_sha256: body ? sha256(body) : null, version_matches: !!body && sha256(body) === want, page };
    } catch (e) { pub = { observed: false, detail: `unreachable from here: ${String(e.message || e).slice(0, 80)}` }; }
  }
  const isPublic = pub.observed && pub.status === 200 && pub.version_matches;
  return { state: isPublic ? "public" : landed ? "landed" : checked ? "checked" : "composed",
    stages: { composed: true, checked, landed, ...(landedAt ? { landed_observed_in: landedAt } : {}), public: pub }, row: s7.row_key, url: s7.non_url, row_sha256: want || null,
    provenance: s7.provenance || null,
    ...(s7.provenance?.class === "attested" ? { hold: "T is a composition the caller attests and the service did not observe: the row is held from landing until the registry's intake seats the composition as a capture" } : {}),
    note: landed ? null : "the row awaits landing in the archive, which its landing workflow does by itself; its landing tree is held by the service under its execution key" };
}
