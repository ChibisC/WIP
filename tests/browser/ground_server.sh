#!/usr/bin/env bash
# Like with_server.sh, on port 5181 (the ground-realism worktree's own server, so it never touches another checkout's).
cd "$(dirname "$0")/../.."
node node_modules/vite/bin/vite.js --port 5181 --host 127.0.0.1 --strictPort >/tmp/vite-ground.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:5181/ && break; sleep 0.5; done
"$@"
