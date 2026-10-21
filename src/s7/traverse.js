// S7a. The archive's bearing on an entity, by the archive's own procedure: scripts/non_traverse.py (EA-NEGONT-02 v0.9 §3.4),
// run unchanged from a configuration per address, against a named archive commit. Candidates by string only;
// admission is by reading (reading.js). The hop runs as the script's second pass, from what reading admits.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE } from "./input.js";
import { STORE, sha256 } from "../util.js";

const PY = process.env.GNOSIS_PYTHON || "/usr/bin/python3.12";

export function archiveRelease() {
  const git = (...a) => { try { return execFileSync("git", ["-C", ARCHIVE, ...a], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } };
  const reg = join(ARCHIVE, "data/registry.json"), cg = join(ARCHIVE, "data/citation-graph.json"), sc = join(ARCHIVE, "scripts/non_traverse.py");
  const h = (p) => (existsSync(p) ? sha256(readFileSync(p)) : null);
  return { archive_commit: git("rev-parse", "HEAD"), registry_sha256: h(reg), citation_graph_sha256: h(cg), traverse_script_sha256: h(sc) };
}

export function configFor(input, hopFrom) {
  const base = input.traversal_config ? { ...input.traversal_config } : {
    row: input.row, address: input.address.string, entity: input.entity.name, row_type: input.entity.type,
    aliases: input.aliases.map(({ pattern, flags }) => ({ pattern, flags })), classes: [],
    classes_note: "O-class not run: class membership must be sourced from the field or the archive by locus before the pass (§3.4); the aliases are the article's title and the names its lead gives.",
  };
  if (hopFrom) base.hop_from = [...hopFrom].sort((a, b) => a - b);
  else delete base.hop_from;
  return base;
}

// Runs the script into store/s7/<row>/<key>/traversal; the same config at the same release is reused.
export function traverse(input, { hopFrom = null, key } = {}) {
  const cfg = configFor(input, hopFrom);
  const rel = archiveRelease();
  const ck = sha256(JSON.stringify({ cfg, rel })).slice(0, 16);
  const dir = join(STORE, "s7", input.row, "traversal", `${hopFrom ? "hop" : "dro"}-${ck}`);
  if (!existsSync(join(dir, "summary.json"))) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg, null, 1));
    try { execFileSync(PY, ["-I", join(ARCHIVE, "scripts/non_traverse.py"), join(dir, "config.json"), "--out", dir], { stdio: ["ignore", "pipe", "pipe"], timeout: 600000 }); }
    catch (e) {
      // The script's last line prints its output path relative to the archive; for an outside path that print fails
      // after every file is written. Anything else is a real failure.
      const err = String(e.stderr || e.message);
      if (!(existsSync(join(dir, "summary.json")) && /is not in the subpath/.test(err))) throw new Error(`non_traverse.py failed: ${err.slice(-400)}`);
    }
  }
  const read = (n) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
  const files = Object.fromEntries(readdirSync(dir).map((f) => [f, sha256(readFileSync(join(dir, f)))]));
  return { dir, config: cfg, release: rel, summary, D: read("candidates-D.jsonl"), R: read("candidates-R.jsonl"), O: read("candidates-O.jsonl"), H: read("candidates-H.jsonl"), files };
}
