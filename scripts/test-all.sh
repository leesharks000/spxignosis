#!/bin/sh
# Runs every tier with the replay reader in a fresh store (seeded with replays, policies, snapshots and the calibration
# texts), then the probes. In replay the S7 passes for the specimen have no recordings, so the opening records them as
# not run and composes no row; the calibration probes run S7 end to end on /non row se-183b34 from its own readings.
set -e
cd "$(dirname "$0")/.."
S="${1:?usage: test-all.sh FRESH_STORE_DIR}"
[ -e "$S" ] && { echo "store dir exists; give a new one"; exit 1; }
mkdir -p "$S" && for f in store/replays store/policies store/seed-*.html; do [ -e "$f" ] && cp -r "$f" "$S"/; done; true
for d in snapshots calibration; do [ -d "store/$d" ] && cp -r "store/$d" "$S"/ || true; done
export GNOSIS_STORE="$S" GNOSIS_READER=replay
for t in check opening commission portable; do
  node scripts/run-replay.js 1361634710 $t | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log(d.tier,d.result,"reused="+d.reused,"max="+d.max_price_usd,"charge="+d.billing?.charge_usd,"completed="+d.summary.completed,"non="+(d.non?d.non.row+(d.non.composed?" composed":" not composed"):"-"),"portable="+!!d.portable,d.entries.join(" "))})'
done
node scripts/stand-in.js portable > /dev/null
node scripts/run-replay.js 1361634710 portable | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log("portable (stand-in row)",d.result,"max="+d.max_price_usd,"charge="+d.billing?.charge_usd,"non="+(d.non?d.non.row+(d.non.composed?" composed from_ledger="+d.non.from_ledger:" not composed"):"-"),"portable="+!!d.portable,JSON.stringify(d.portable_breaches));process.env.R=d.result;require("fs").writeFileSync(process.env.GNOSIS_STORE+"/last-portable",d.result)})'
node test/probes.js "$(cat "$S/last-portable")"
node scripts/checkpoint-probe.js
# A composed row with a landing tree, as a live commission leaves it: one listed when composed, one found from its pointer.
mkdir -p "$S/landable" "$S/results/by-state" "$S/results/R-landtest00000002"
echo '{"result_id":"R-landtest00000001","row":"row-one","execution_key":"k1","row_sha256":"aa","complete":true,"attested":false,"composed_at":"2026-10-25T00:00:00Z"}' > "$S/landable/R-landtest00000001.json"
echo '{"result_id":"R-landtest00000002","non_row":"row-two","s7_complete":true}' > "$S/results/by-state/landtest2.json"
echo '{"composed":true,"row_key":"row-two","complete":true,"manifest":{"key":"k2","files":[{"path":"datasets/negative-of-the-negative/v2/rows/row-two.json","sha256":"bb"}]}}' > "$S/results/R-landtest00000002/s7.json"
# The paid route refuses an unknown quote before the payment layer: 404, never a 402 challenge.
PORT=4431 GNOSIS_PAY_TO=0x0000000000000000000000000000000000000001 node src/server.js > "$S/server.log" 2>&1 &
SP=$!; sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" -XPOST localhost:4431/v1/openings/Q-doesnotexist)
land=$(curl -s localhost:4431/v1/landable)
kill $SP 2>/dev/null || true
echo "$land" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);const one=d.landable.find(l=>l.result_id==="R-landtest00000001"),two=d.landable.find(l=>l.result_id==="R-landtest00000002");const reused=d.landable.find(l=>l.result_id===process.argv[1]);if(!one||two?.row_sha256!=="bb"||reused){console.log("FAIL landable: "+JSON.stringify(d.landable));process.exit(1)}console.log("ok   landable: composed rows are listed for the archive with their row hash, from the list and from the result pointer; a row reused from the ledger is not")})' "$(cat "$S/last-portable")"
[ "$code" = "404" ] && echo "ok   server: an unknown quote is refused with 404 before any payment challenge" || { echo "FAIL server: unknown quote answered $code"; exit 1; }
