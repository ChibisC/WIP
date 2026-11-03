"""Titans dig into nests (claude/creatures/01-spec-digging-titans.md): clips of a titan digging a hole wider and walking
through a nest, breaking the soil it touches. Frames from the screenshot harness (a virtual clock), then MP4 clips with
ffmpeg. Fails on page errors.

Run: BASE=http://127.0.0.1:5173/ python3 tests/browser/titan_dig.py   (KIND=tarantula,stagBeetle,scolopendra)
Clips: docs/creatures/digging/<kind>_surface.mp4, <kind>_nest.mp4 (frames in docs/creatures/digging/<kind>_*_frames/)
"""
import os
import shutil
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
KINDS = os.environ.get("KIND", "tarantula").split(",")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "digging")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
FRAMES = {"surface": int(os.environ.get("SURF_FRAMES", "40")), "nest": int(os.environ.get("NEST_FRAMES", "36"))}
os.makedirs(OUT, exist_ok=True)
errs = []


def wait_ready(pg, t0, limit=900):
    while time.time() - t0 < limit and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


def clip(pg, kind, part, url, every):
    d = os.path.join(OUT, f"{kind}_{part}_frames")
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    t0 = time.time()
    pg.goto(url, wait_until="load")
    wait_ready(pg, t0)
    print(f"  {kind} {part}: loaded in {time.time() - t0:.0f} s", flush=True)
    for i in range(FRAMES[part]):
        pg.evaluate(f"window.__step({every}, 0.05)")
        pg.screenshot(path=os.path.join(d, f"f{i:03d}.jpg"), type="jpeg", quality=85)
    mp4 = os.path.join(OUT, f"{kind}_{part}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "8", "-i", os.path.join(d, "f%03d.jpg"), "-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", mp4], check=True)
    print(f"  {kind} {part}: {mp4} [{time.time() - t0:.0f} s]", flush=True)


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_context(viewport={"width": 1280, "height": 760}).new_page()
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    for kind in KINDS:
        common = f"?mode=skirmish&species=lasius&seed=3&creatures=0&titans=0&titanRaid={kind}&shot=1&nocine=1&q=high"
        # on the surface: it walks up, digs the hole wider (soil flying), breaks through (a frame every 0.75 s)
        clip(pg, kind, "surface", BASE + common + "&ticks=20&dist=170", 15)
        # underground: in through the flower and on through the ground to the queen (a frame every 0.5 s)
        clip(pg, kind, "nest", BASE + common + "&ticks=545&view=nest&nest=1", 10)
    b.close()
bad = [e for e in errs if "favicon" not in e]
print("FAIL: page errors: " + " | ".join(bad[:5]) if bad else "titan digging clips done")
