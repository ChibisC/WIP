"""Switching probe (performance pass): a quick, synchronous look at what each switch costs. The game is stepped by
hand (?shot=1), so every frame's wall time is measured from here. Surface → each area (first time) → surface, twice;
prints each switch's first three frames and the profiler's hitch causes.

Run: tests/browser/with_server.sh python3 tests/browser/switch_probe.py   (Q=medium)
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
Q = os.environ.get("Q", "medium")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"]

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 1280, "height": 760})
    pg.set_default_timeout(1800000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    t0 = time.time()
    pg.goto(BASE + f"?play=1&shot=1&noui=1&nocine=1&q={Q}&seed=11&areas=1&species=lasius&rival=solenopsis&reveal=1&developed=6&ticks=40", wait_until="load")
    while not pg.evaluate("window.__ready===true"):
        time.sleep(0.3)
    load = time.time() - t0
    print(f"load {load:.1f} s", flush=True)
    pg.evaluate("window.__session.loop.advance(400)")
    areas = pg.evaluate("() => window.__session.areaTabs().map((t) => t.space)")

    def frames(label, n=4):
        mark = pg.evaluate("() => window.__prof ? window.__prof.hitches.length : 0")
        out = []
        for i in range(n):
            t = time.time()
            pg.evaluate("window.__step(1, 1/30)")
            out.append(round((time.time() - t) * 1000))
        h = pg.evaluate(f"() => {{ const p = window.__prof; return p ? p.hitches.slice({mark}).slice(0, 2).map((h) => Math.round(h.cpu) + ' ms: ' + h.causes.join('; ')) : []; }}")
        print(f"{label:28s} frames {out}  {h}", flush=True)
        return out

    frames("surface (warm)", 3)
    res = {}
    for rnd in range(2):
        for a in areas:
            pg.evaluate(f"() => {{ const s = window.__session; const v = s.view; s.viewedArea = {a}; v.setActiveNest({a}); v.space = 'nest'; v.onSpaceChanged && v.onSpaceChanged('nest'); }}")
            res[f"r{rnd} area {a}"] = frames(f"round {rnd + 1}: area {a}")
        pg.evaluate("() => { const v = window.__session.view; v.space = 'surface'; v.onSpaceChanged && v.onSpaceChanged('surface'); }")
        res[f"r{rnd} surface"] = frames(f"round {rnd + 1}: surface")
    print(json.dumps({"load": load, "frames": res, "errors": errs[:3]}))
    b.close()
