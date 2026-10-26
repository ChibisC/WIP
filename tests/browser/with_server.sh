#!/usr/bin/env bash
# Run a browser check against a short-lived Vite dev server on 127.0.0.1:5173.
# Usage: tests/browser/with_server.sh python3 tests/browser/ui_areas.py [args…]
cd "$(dirname "$0")/../.."
# run vite's own script (not through npx) so the trap below stops the server itself
node node_modules/vite/bin/vite.js --port 5173 --host 127.0.0.1 --strictPort >/tmp/vite-test.log 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:5173/ && break; sleep 0.5; done
"$@"
