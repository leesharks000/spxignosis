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
node test/calibrate-probe.js
# A composed row with a landing tree, as a live commission leaves it: one listed when composed, one found from its pointer.
mkdir -p "$S/landable" "$S/results/by-state" "$S/results/R-landtest00000002"
echo '{"result_id":"R-landtest00000001","row":"row-one","execution_key":"k1","row_sha256":"aa","complete":true,"attested":false,"composed_at":"2026-10-25T00:00:00Z"}' > "$S/landable/R-landtest00000001.json"
echo '{"result_id":"R-landtest00000002","non_row":"row-two","s7_complete":true}' > "$S/results/by-state/landtest2.json"
mkdir -p "$S/delivered"; echo '{"result_id":"R-landtest00000001"}' > "$S/delivered/Q-landtest1.json"; echo '{"result_id":"R-landtest00000002"}' > "$S/delivered/Q-landtest2.json"
mkdir -p "$S/landable"; echo '{"result_id":"R-landtest00000003","row":"row-three","execution_key":"k3","row_sha256":"cc","complete":true,"attested":false,"composed_at":"2026-10-25T00:00:00Z"}' > "$S/landable/R-landtest00000003.json"
echo '{"composed":true,"row_key":"row-two","complete":true,"manifest":{"key":"k2","files":[{"path":"datasets/negative-of-the-negative/v2/rows/row-two.json","sha256":"bb"}]}}' > "$S/results/R-landtest00000002/s7.json"
# The paid route refuses an unknown quote before the payment layer: 404, never a 402 challenge.
PORT=4431 GNOSIS_PAY_TO=0x0000000000000000000000000000000000000001 node src/server.js > "$S/server.log" 2>&1 &
SP=$!; sleep 3
code=$(curl -s -o /dev/null -w "%{http_code}" -XPOST localhost:4431/v1/openings/Q-doesnotexist)
land=$(curl -s localhost:4431/v1/landable)
ev=$(curl -s localhost:4431/v1/results/$(cat "$S/last-portable")/evidence; curl -s localhost:4431/v1/results/$(cat "$S/last-portable")/composition)
front=$(curl -s -H "Accept: text/html" localhost:4431/); asjson=$(curl -s -H "Accept: application/json" localhost:4431/ | head -c 200)
ordr=$(curl -s -o /dev/null -w "%{http_code}" localhost:4431/order/Q-0123456789abcdef); badord=$(curl -s -o /dev/null -w "%{http_code}" "localhost:4431/order/x%3Cscript%3E"); apip=$(curl -s localhost:4431/api)
kill $SP 2>/dev/null || true
echo "$ev" | grep -qE '"(charge_usd|margin_usd)"' && { echo "FAIL billing: a result record serves a charge or margin"; exit 1; } || echo "ok   billing: a result's evidence and composition are served with no charge and no margin"
[ -s "$S/billing/$(cat "$S/last-portable").json" ] && echo "ok   billing: the charge is kept privately beside the result" || { echo "FAIL billing: no private billing record"; exit 1; }
echo "$land" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);const one=d.landable.find(l=>l.result_id==="R-landtest00000001"),two=d.landable.find(l=>l.result_id==="R-landtest00000002");const reused=d.landable.find(l=>l.result_id===process.argv[1]),unpaid=d.landable.find(l=>l.result_id==="R-landtest00000003");if(!one||two?.row_sha256!=="bb"||reused||unpaid){console.log("FAIL landable: "+JSON.stringify(d.landable));process.exit(1)}console.log("ok   landable: composed rows are listed for the archive with their row hash, from the list and from the result pointer; a row reused from the ledger is not, and a row its order did not pay for is not")})' "$(cat "$S/last-portable")"
[ "$code" = "404" ] && echo "ok   server: an unknown quote is refused with 404 before any payment challenge" || { echo "FAIL server: unknown quote answered $code"; exit 1; }
# A capture's answer (2026-10-25): the transcript without the transcriber's note, the operator's turns, the source cards
# and the surface's chrome; the first AI-answer quote had priced 55 "sentences" from an answer of 16.
node --input-type=module -e '
import { readFileSync } from "fs"; const { answerText } = await import("./src/run.js");
const F = JSON.parse(readFileSync("test/fixtures/captures-answer.json", "utf8"));
const split = (t) => t.split(/\n+|(?<=[.!?])\s+(?=[A-Z“"\x27(])/).map((s) => s.trim()).filter((s) => s.length > 2);
const [g, b, m] = F.map((c) => split(answerText(c)));
const ok = g.length === 16 && g[0].startsWith("SPXI-gnΩsis is a specific technical service layer") && !g.some((s) => /BetaPro by Global X|AI responses may include|You said/.test(s))
  && b.length === 1 && b[0].startsWith("\"SPXI (Semantic Packet") && m.length > 5 && !m.some((s) => /^\[|is Lee Sharks a myth\? search/.test(s));
console.log(ok ? "ok   capture answer: the answer read without its note, turns, cards and chrome (16, 1, " + m.length + " sentences)" : "FAIL capture answer: " + JSON.stringify([g.length, b, m.slice(0, 3)])); if (!ok) process.exit(1);' || exit 1
# The front door (2026-10-25): a person gets the request forms; an agent asking for JSON gets the description; an order has
# its page and the card checkout returns to it; the operations inventory and the deployment's configuration are on /api.
echo "$front" | grep -q 'id="p-construct"' && echo "$front" | grep -q 'Get a free quote' && ! echo "$front" | grep -q '/tmp' && echo "ok   pages: the front page carries the request forms and no deployment internals" || { echo "FAIL pages: front page"; exit 1; }
echo "$asjson" | grep -q '"service"' && echo "ok   pages: GET / still answers JSON to an agent" || { echo "FAIL pages: GET / JSON"; exit 1; }
[ "$ordr" = "200" ] && [ "$badord" = "404" ] && echo "ok   pages: an order has its page, and a malformed id is refused" || { echo "FAIL pages: order $ordr / $badord"; exit 1; }
echo "$apip" | grep -q 'GET /v1/quotes/{quote_id}/status' && echo "ok   pages: /api lists the operations" || { echo "FAIL pages: /api"; exit 1; }
grep -q 'success_url: `${base}/order/' src/payments.js && echo "ok   pages: the card checkout returns to the order page" || { echo "FAIL pages: checkout return"; exit 1; }
# The first adversarial test (2026-10-25): its seven defects reproduced against the code and shown fixed, the unit-level
# ones in a fresh store of their own, the payment and execution ones against a server with a fake Stripe key.
mkdir -p "$S/break-unit" "$S/break-http"
GNOSIS_STORE="$S/break-unit" node test/break-probe.mjs
node test/break-http.mjs "$S/break-http"
# The random request (2026-10-26): the pick is a cited sentence of a pinned article, or an object from the pool asked, and is described.
node test/random-probe.mjs || exit 1
# The free route never calls a model (2026-10-27): a recorded sentence is served from the ledger, or quoted.
mkdir -p "$S/free-route" && GNOSIS_STORE="$S/free-route" node test/free-route-probe.mjs || exit 1
# The erasure audit (2026-10-29): the free screen calls no model; atoms from the source by two agreeing readings; the module's metrics.
mkdir -p "$S/audit" && GNOSIS_STORE="$S/audit" GNOSIS_BLOB=off node test/audit-probe.mjs || exit 1
