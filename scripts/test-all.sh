#!/bin/sh
# Runs every tier with the replay reader in a fresh store (seeded with replays, policies, snapshots and the calibration
# texts), then the probes. In replay the S7 passes for the specimen have no recordings, so the opening records them as
# not run and composes no row; the calibration probes run S7 end to end on /non row se-183b34 from its own readings.
set -e
cd "$(dirname "$0")/.."
S="${1:?usage: test-all.sh FRESH_STORE_DIR}"
[ -e "$S" ] && { echo "store dir exists; give a new one"; exit 1; }
mkdir -p "$S" && cp -r store/replays store/policies store/seed-*.html "$S"/
for d in snapshots calibration; do [ -d "store/$d" ] && cp -r "store/$d" "$S"/ || true; done
export GNOSIS_STORE="$S" GNOSIS_READER=replay
for t in check opening portable; do
  node scripts/run-replay.js 1361634710 $t | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log(d.tier,d.result,"reused="+d.reused,"max="+d.max_price_usd,"charge="+d.billing?.charge_usd,"completed="+d.summary.completed,"non="+(d.non?d.non.row+(d.non.composed?" composed":" not composed"):"-"),"portable="+!!d.portable,d.entries.join(" "))})'
done
node scripts/stand-in.js portable > /dev/null
node scripts/run-replay.js 1361634710 portable | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log("portable (stand-in row)",d.result,"max="+d.max_price_usd,"charge="+d.billing?.charge_usd,"non="+(d.non?d.non.row+(d.non.composed?" composed from_ledger="+d.non.from_ledger:" not composed"):"-"),"portable="+!!d.portable,JSON.stringify(d.portable_breaches));process.env.R=d.result;require("fs").writeFileSync(process.env.GNOSIS_STORE+"/last-portable",d.result)})'
node test/probes.js "$(cat "$S/last-portable")"
# The paid route refuses an unknown quote before the payment layer: 404, never a 402 challenge.
PORT=4431 GNOSIS_PAY_TO=0x0000000000000000000000000000000000000001 node src/server.js > "$S/server.log" 2>&1 &
SP=$!; sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" -XPOST localhost:4431/v1/openings/Q-doesnotexist)
kill $SP 2>/dev/null || true
[ "$code" = "404" ] && echo "ok   server: an unknown quote is refused with 404 before any payment challenge" || { echo "FAIL server: unknown quote answered $code"; exit 1; }
