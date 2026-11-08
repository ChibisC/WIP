#!/usr/bin/env bash
# Same results as a reference build (performance v3): the stress scenes' canonical hash lists (tools/perf/canon.ts)
# from a reference checkout and from this one must be identical.
#   tools/perf/same.sh <ref-dir | ref.json> [scenes=fight,economy,nests,ten,titan,tunnel] [ants=500,1000] [ticks=200]
# (a ref.json — a reference run's --out, same scenes, ants and ticks — is used as it is: no second run)
REF=$1; SCENES=${2:-fight,economy,nests,ten,titan,tunnel}; ANTS=${3:-500,1000}; TICKS=${4:-200}
HERE=$(cd "$(dirname "$0")/../.." && pwd)
T=$(mktemp -d)
if [ -f "$REF" ]; then cp "$REF" $T/ref.json; else
(cd "$REF" && npx vite-node tools/perf/simBench.ts -- $SCENES $ANTS $TICKS --out $T/ref.json > $T/ref.log 2>&1) &
fi
(cd "$HERE" && npx vite-node tools/perf/simBench.ts -- $SCENES $ANTS $TICKS --out $T/this.json > $T/this.log 2>&1)
wait
python3 - "$T/ref.json" "$T/this.json" <<'PY'
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
bad = 0
for x, y in zip(a, b):
    same = x['hashes'] == y['hashes']
    bad += not same
    print(f"{x['scene']:8} {x['ants']:5}: {'same' if same else 'DIFFERENT'} ({len(x['hashes'])} hashes)  ref {x['avg']:6.2f} ms  this {y['avg']:6.2f} ms")
print('ALL SAME' if not bad and len(a) == len(b) else f'{bad} DIFFER')
PY
