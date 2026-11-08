#!/usr/bin/env bash
# Bundle a checkout's simBench into one plain JavaScript file (performance v3), as the game's production build bundles
# the worker: imports become direct bindings. vite-node's on-the-fly modules reach every imported function through a
# module object instead, which slows the small hot helpers (dmath's sq, dsin, …) several times over and skews both
# the totals and the profiles — time with the bundle.
#   tools/perf/bundle.sh <checkout-dir> <out.mjs>      then: node <out.mjs> [scenes] [ants] [ticks] [--out f] [--systems]
DIR=$1; OUT=$2
(cd "$DIR" && npx esbuild tools/perf/simBench.ts --bundle --platform=node --format=esm --target=es2022 --outfile="$OUT" --log-level=warning)
