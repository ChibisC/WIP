"""Animation pass: the stress scene (four fire-ant colonies, 1000+ ants, creatures and bosses) with the old
motion and with the animation pass, same seed and camera, frame and tick times side by side.

  BASE=http://127.0.0.1:5174/ python3 tests/browser/anim_stress.py docs/realism/animation/stress.json

Software rendering (SwiftShader) runs the vertex shaders on the CPU, so the frame time includes the planted-
feet solve; the absolute numbers are far below a GPU's, the ratio is what counts.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5174/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/animation/stress.json"
SECS = int(os.environ.get("SECS", "40"))
PER = int(os.environ.get("ANTS", "260"))
CR = int(os.environ.get("CREATURES", "24"))
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    for anim in ("1", "2"):
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        url = f"{BASE}?stress=1&ants={PER}&creatures={CR}&bosses=4&secs={SECS}&species=solenopsis,solenopsis,solenopsis,solenopsis&anim={anim}&q=medium"
        t0 = time.time()
        pg.goto(url, wait_until="load", timeout=600000)
        while time.time() - t0 < SECS + 600 and not pg.evaluate("!!window.__stress"):
            time.sleep(1)
        r = pg.evaluate("window.__stress")
        res["before" if anim == "1" else "after"] = r
        print(anim, json.dumps(r), flush=True)
        pg.close()
    b.close()
if res.get("before") and res.get("after"):
    res["frameRatio"] = res["after"]["frameAvg"] / max(1e-6, res["before"]["frameAvg"])
os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
json.dump(res, open(OUT, "w"), indent=1)
print("frame time after / before:", res.get("frameRatio"))
