// Publication as observed stages: composed (the row exists) → checked (the code checks ran and the audit is complete)
// → landed (the archive checkout holds the row file with the landing tree's hash) → public (the entity's /non page answers
// and names the row). Each stage is observed when asked for, never assumed; landing itself is the operator's act.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE } from "./input.js";
import { sha256 } from "../util.js";

export async function publicationState(s7, { fetchPublic = true } = {}) {
  if (!s7?.composed) return { state: "not composed", stages: { composed: false } };
  const rowRel = `datasets/negative-of-the-negative/v2/rows/${s7.row_key}.json`;
  const want = (s7.manifest?.files || []).find((f) => f.path === rowRel)?.sha256;
  const local = join(ARCHIVE, rowRel);
  const landed = !!want && existsSync(local) && sha256(readFileSync(local)) === want;
  const checked = !!s7.audit?.ran && !!s7.audit?.complete;
  let pub = { observed: false, detail: "not checked" };
  if (fetchPublic && landed) {
    try {
      const r = await fetch(s7.non_url, { signal: AbortSignal.timeout(8000) });
      const body = r.ok ? await r.text() : "";
      pub = { observed: true, status: r.status, names_row: body.includes(s7.row_key) };
    } catch (e) { pub = { observed: false, detail: `unreachable from here: ${String(e.message || e).slice(0, 80)}` }; }
  }
  const isPublic = pub.observed && pub.status === 200 && pub.names_row;
  return { state: isPublic ? "public" : landed ? "landed" : checked ? "checked" : "composed",
    stages: { composed: true, checked, landed, public: pub }, row: s7.row_key, url: s7.non_url, row_sha256: want || null,
    provenance: s7.provenance || null,
    ...(s7.provenance?.class === "attested" ? { hold: "T is a composition the caller attests and the service did not observe: the row is held from landing until the registry's intake seats the composition as a capture" } : {}),
    note: landed ? null : "the row awaits landing in the archive (the operator's act); its landing tree is held by the service under its execution key" };
}
