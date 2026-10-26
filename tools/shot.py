#!/usr/bin/env python3
"""Headless screenshot harness for visual review.

Usage: python3 tools/shot.py "<query>" out.png [width] [height] [timeout_s] [extra_wait_ms]
Loads http://127.0.0.1:5173/?<query>, waits for window.__ready === true,
waits extra_wait_ms, then saves a screenshot. Console errors are printed.
If window.__shotScript is defined by the page it can be driven via ?script=...
"""
import sys, time
from playwright.sync_api import sync_playwright

query = sys.argv[1] if len(sys.argv) > 1 else ""
out = sys.argv[2] if len(sys.argv) > 2 else "shot.png"
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1280
h = int(sys.argv[4]) if len(sys.argv) > 4 else 720
timeout = float(sys.argv[5]) if len(sys.argv) > 5 else 120
extra = int(sys.argv[6]) if len(sys.argv) > 6 else 500
js = sys.argv[7] if len(sys.argv) > 7 else ""
import os
base = os.environ.get("SHOT_BASE", "http://127.0.0.1:5173/")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl",
                                "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": w, "height": h})
    logs = []
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    t0 = time.time()
    pg.goto(base + ("?" + query if query else ""), wait_until="load", timeout=int(timeout * 1000))
    ok = False
    while time.time() - t0 < timeout:
        try:
            if pg.evaluate("window.__ready === true"):
                ok = True
                break
        except Exception:
            pass
        time.sleep(0.25)
    if js:
        for part in js.split(";;"):
            part = part.strip()
            if part.startswith("key:"):
                pg.keyboard.press(part[4:])
            elif part.startswith("wait:"):
                pg.wait_for_timeout(int(part[5:]))
            elif part.startswith("waitfor:"):
                pg.wait_for_function(part[8:], timeout=int(timeout*1000))
            elif part.startswith("shot:"):
                pg.screenshot(path=part[5:], timeout=240000)
            elif part:
                pg.evaluate(part)
    if extra > 0:
        pg.wait_for_timeout(extra)
    info = None
    try:
        info = pg.evaluate("window.__shotInfo ? JSON.stringify(window.__shotInfo) : null")
    except Exception:
        pass
    pg.screenshot(path=out, timeout=240000)
    print(f"ready={ok} t={time.time()-t0:.1f}s -> {out}")
    if info:
        print("info:", info)
    for l in logs:
        if "[error]" in l or "pageerror" in l or "[warning]" in l or "[log]" in l:
            print(l[:6000] if "Shader Error" in l else l[:400])
    b.close()
