# Browser interaction tests

Real mouse and keyboard input against the running game (Playwright + Chromium, software WebGL).
Start the dev server first (`npx vite --port 5173 --host 127.0.0.1`), then:

```
python3 tests/browser/ui_test.py    # drag cards, marker headers, hotkeys, tile placement, nest tabs, stance, ability, menu
python3 tests/browser/ui_test2.py   # camera wheel/pan, tile select/upgrade/remove, all six columns, ants reach nest + surface markers, follow
python3 tests/browser/ui_dig.py     # dig painting and repaint-to-clear
```

Screenshots go to `$SHOTS` (default `/tmp`). Each line prints PASS or FAIL.
