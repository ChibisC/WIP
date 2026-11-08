#!/usr/bin/env bash
# A/B the simulation's speed (performance v3): the same scene in a reference checkout and in this one, alternately,
# REPS times; prints each run and the medians. The hash lists must match for the result to count (same results).
#   tools/perf/ab.sh <ref-dir> <scene> <ants> [ticks=300] [reps=3]
REF=$1; SCENE=$2; ANTS=$3; TICKS=${4:-300}; REPS=${5:-3}
HERE=$(cd "$(dirname "$0")/../.." && pwd)
A=(); B=()
# (bundled, as the game's build is: tools/perf/bundle.sh)
T=$(mktemp -d)
"$HERE/tools/perf/bundle.sh" "$REF" $T/ref.mjs
"$HERE/tools/perf/bundle.sh" "$HERE" $T/this.mjs
for i in $(seq 1 $REPS); do
  a=$(node $T/ref.mjs $SCENE $ANTS $TICKS 2>/dev/null | tail -1)
  b=$(node $T/this.mjs $SCENE $ANTS $TICKS 2>/dev/null | tail -1)
  echo "ref  $a"; echo "this $b"
  A+=($(echo "$a" | sed -E 's/.*tick avg ([0-9.]+).*/\1/')); B+=($(echo "$b" | sed -E 's/.*tick avg ([0-9.]+).*/\1/'))
  ha=$(echo "$a" | sed -E 's/.*hash ([0-9a-f]+).*/\1/'); hb=$(echo "$b" | sed -E 's/.*hash ([0-9a-f]+).*/\1/')
done
med() { printf '%s\n' "$@" | sort -g | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}'; }
ma=$(med "${A[@]}"); mb=$(med "${B[@]}")
echo "median: ref $ma ms, this $mb ms ($(awk -v a=$ma -v b=$mb 'BEGIN{printf "%+.1f %%", (b-a)/a*100}')); final hash $( [ "$ha" = "$hb" ] && echo SAME || echo DIFFERENT )"
