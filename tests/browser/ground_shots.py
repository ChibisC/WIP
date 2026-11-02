"""Render-only ground sheets (docs/maps/realism/): views of a map at close, gameplay and far zoom, under the map's own
light and overcast. Fails loudly on shader errors.

Run: tests/browser/ground_server.sh python3 tests/browser/ground_shots.py
  env: MAP=testTerrace  VIEWS="name:cx,cz,dist,yaw,pitch;…"  TAG=r1  OVERCAST=0/1  W=1280 H=760
"""
import io
import os
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5181/")
MAP = os.environ.get("MAP", "testTerrace")
TAG = os.environ.get("TAG", "now")
OVERCAST = os.environ.get("OVERCAST", "0") == "1"
W = int(os.environ.get("W", "1280"))
H = int(os.environ.get("H", "760"))
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "maps", "realism", "shots")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
views = []
for part in os.environ.get("VIEWS", "far:240,240,520,0.6,0.5;game:130,240,230,0.6,0;close:125,215,70,2.4,-0.25").split(";"):
    name, v = part.split(":")
    views.append((name, [float(x) for x in v.split(",")]))

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": W, "height": H})
    pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("WebGLProgram" in m.text or "ERROR" in m.text or "Error" in m.text or "[patch" in m.text) else None)
    t0 = time.time()
    pg.goto(BASE + f"?play=1&shot=1&noui=1&q=high&seed=5&creatures=0&species=lasius&rival=lasius&map={MAP}&ticks=30", wait_until="load")
    while time.time() - t0 < 600 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    print(f"loaded {MAP} in {time.time() - t0:.0f} s", flush=True)
    pg.evaluate("window.__session.loop.paused = true")
    if OVERCAST:
        pg.evaluate("() => { const v = window.__session.view; v.storm = 1; v.stormShown = 1; }")
    for name, (cx, cz, dist, yaw, pitch) in views:
        t1 = time.time()
        pg.evaluate(f"() => {{ const r = window.__session.view.surfaceRig; r.jumpTo({cx}, {cz}, {dist}); r.yaw = r.goalYaw = {yaw}; r.pitchBias = {pitch}; }}")
        pg.evaluate("window.__step(8, 1/30)")
        im = Image.open(io.BytesIO(pg.screenshot()))
        fn = os.path.join(OUT, f"{MAP}_{name}{'_overcast' if OVERCAST else ''}_{TAG}.jpg")
        im.convert("RGB").save(fn, quality=88)
        print(f"  {name}: {fn} [{time.time() - t1:.0f} s]", flush=True)
    if errs:
        print("ERRORS:", "\n".join(errs[:8]), flush=True)
    b.close()
