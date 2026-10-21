#!/bin/sh
# Lands a gnosis /non row into an overlay of the archive (scripts and the /non dataset copied, everything else linked)
# and runs the archive's own build_non.py there, so the row is rendered exactly as /non would render it. Writes nothing
# in the archive. Usage: render-check.sh LANDING_DIR OVERLAY_DIR
set -e
L="${1:?landing dir}"; O="${2:?overlay dir (new)}"; A="${GNOSIS_ARCHIVE:-/home/claude/alexanarch}"
[ -e "$O" ] && { echo "overlay exists; give a new one"; exit 1; }
mkdir -p "$O/datasets"
cp -r "$A/scripts" "$O/scripts"
cp -r "$A/datasets/negative-of-the-negative" "$O/datasets/negative-of-the-negative"
for x in "$A"/*; do b=$(basename "$x"); [ -e "$O/$b" ] || ln -s "$x" "$O/$b"; done
rm -f "$O/non" "$O/sitemap-non.xml"; mkdir -p "$O/non"
cp -r "$L/datasets/." "$O/datasets/"
/usr/bin/python3.12 -I - "$L/landing/panel-entry.json" "$O/datasets/negative-of-the-negative/v2/panel/panel.json" <<'PY'
import json, sys
e = json.load(open(sys.argv[1])); p = json.load(open(sys.argv[2]))
p["entities"] = [x for x in p["entities"] if x["entity"] != e["entity"]] + [e]
json.dump(p, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
PY
cd "$O" && /usr/bin/python3.12 scripts/build_non.py
