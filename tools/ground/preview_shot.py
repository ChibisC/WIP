"""Screenshot the ground layer preview (tools/ground/preview.html) — dev server on BASE (ground_server.sh).
Usage: python3 tools/ground/preview_shot.py out.jpg "cell=300&cols=4&mm=90"
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5181/")
out = sys.argv[1]
qs = sys.argv[2] if len(sys.argv) > 2 else ""
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 1400, "height": 1300})
    pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    t0 = time.time()
    pg.goto(BASE + "tools/ground/preview.html?" + qs, wait_until="load")
    while time.time() - t0 < 900 and not pg.evaluate("window.__previewReady===true"):
        if errs:
            break
        time.sleep(0.3)
    box = pg.evaluate("(() => { const c = document.getElementById('c'); return [c.width, c.height]; })()")
    pg.screenshot(path=out, clip={"x": 0, "y": 0, "width": box[0], "height": box[1]}, type="jpeg", quality=90)
    print(f"preview {out} in {time.time() - t0:.1f} s", flush=True)
    if errs:
        print("ERRORS:", "\n".join(errs[:10]))
    b.close()
