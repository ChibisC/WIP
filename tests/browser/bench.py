"""The benchmark (?bench=1) in headless Chromium: runs every scene and saves the report.

The build machine has no GPU (SwiftShader), so the frame times only compare builds with each other; the counts
(draw calls, triangles, programs, textures, GL work, hitches and their causes) are real.

Run: tests/browser/with_server.sh python3 tests/browser/bench.py   (BSECS=20 BROUNDS=10 Q=medium ONLY=feel,fight VW=480 VH=300 OUT=docs/performance/bench-<tag>.txt)
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
BSECS = os.environ.get("BSECS", "20")
BROUNDS = os.environ.get("BROUNDS", "10")
Q = os.environ.get("Q", "medium")
ONLY = os.environ.get("ONLY", "")
# a small viewport keeps SwiftShader (no GPU here) near real time, so the feel numbers mean something
VW = int(os.environ.get("VW", "1280"))
VH = int(os.environ.get("VH", "760"))
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(__file__), "..", "..", "docs", "performance", "bench-latest.txt"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"]
os.makedirs(os.path.dirname(OUT), exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": VW, "height": VH})
    pg = ctx.new_page()
    pg.set_default_timeout(3600000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: print(m.text[:240], flush=True) if m.text.startswith("[bench]") else None)
    t0 = time.time()
    pg.goto(BASE + f"?bench=1&q={Q}&bsecs={BSECS}&brounds={BROUNDS}" + (f"&bonly={ONLY}" if ONLY else ""), wait_until="load")
    # (each scene reloads the page; brounds rides along only on the first scene's URL, so pass it through sessionStorage)
    while time.time() - t0 < 7200:
        try:
            done = pg.evaluate("!!window.__bench")
        except Exception:
            done = False
        if done:
            break
        time.sleep(2)
    rep = pg.evaluate("window.__bench ? window.__bench.text : null")
    res = pg.evaluate("window.__bench ? window.__bench.results : null")
    print(f"benchmark finished in {time.time() - t0:.0f} s; page errors: {errs[:3]}")
    if rep:
        open(OUT, "w").write(rep + "\n")
        open(OUT.replace(".txt", ".json"), "w").write(json.dumps(res, indent=1))
        print(rep)
    b.close()
raise SystemExit(0 if rep and not errs else 1)
