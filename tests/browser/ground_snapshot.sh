#!/usr/bin/env bash
# Build a snapshot of this worktree and serve it on port ${PORT:-5183} (no hot reload), so long render jobs are not
# disturbed by edits. Usage: tests/browser/ground_snapshot.sh [outdir]   (kills an earlier snapshot server first)
cd "$(dirname "$0")/../.."
OUT=${1:-/tmp/ground-snapshot}
PORT=${PORT:-5183}
pgrep -f "[v]ite.js preview --port $PORT" | xargs -r kill
node node_modules/vite/bin/vite.js build --outDir "$OUT" --emptyOutDir >"$OUT.build.log" 2>&1 || { tail -20 "$OUT.build.log"; exit 1; }
nohup node node_modules/vite/bin/vite.js preview --outDir "$OUT" --port $PORT --host 127.0.0.1 --strictPort >"$OUT.serve.log" 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:$PORT/ && break; sleep 0.5; done
echo "snapshot on http://127.0.0.1:$PORT/ ($OUT)"
