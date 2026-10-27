"""Jaws pass (docs/realism/jaws.md): mandible close-ups of the pilot species, top and side, closed and open,
for the side-by-side sheets against the reference photos.

  BASE=http://127.0.0.1:5174/ python3 tests/browser/jaws.py docs/realism/jaws/renders

Env: ONLY (comma list of names), LIGHT (default studio), W, H.
"""
import os, sys, time
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5174/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/jaws/renders"
ONLY = set(filter(None, os.environ.get("ONLY", "").split(",")))
LIGHT = os.environ.get("LIGHT", "studio")
W = int(os.environ.get("W", "1000"))
H = int(os.environ.get("H", "760"))
os.makedirs(OUT, exist_ok=True)

FIRE = "scene=antlab&ant=fire_minor"
MAJOR = "scene=antlab&ant=fire_major"
STAG = "scene=crlab&kind=stagBeetle&walk=0&speed=0"
SHOTS = {
    # fire ant worker: the head from above and from the side, jaws closed and open
    "fire_top": f"{FIRE}&cam=top&dist=1.7&tx=1.45",
    "fire_top_open": f"{FIRE}&cam=top&dist=1.7&tx=1.45&mopen=1",
    "fire_side": f"{FIRE}&cam=side&dist=1.7&tx=1.45&ty=0.3",
    "fire_front": f"{FIRE}&cam=front&dist=1.6&tx=1.45&ty=0.3",
    "fire_34": f"{FIRE}&cam=34&dist=1.9&tx=1.4&ty=0.3",
    "fire_whole_top": f"{FIRE}&cam=top&dist=7.6",
    "fire_head_top": f"{FIRE}&cam=top&dist=2.6&tx=1.15",
    "major_head_side": f"{MAJOR}&cam=side&dist=5.2&tx=2.4&ty=0.7",
    "stag_high": f"{STAG}&cam=game&dist=230&rot=2.4&tx=10",
    "major_top": f"{MAJOR}&cam=top&dist=3.6&tx=3.0",
    "major_side": f"{MAJOR}&cam=side&dist=3.6&tx=2.9&ty=0.6",
    "major_34": f"{MAJOR}&cam=34&dist=4&tx=2.8&ty=0.6",
    # stag beetle: the head and mandibles from above and the side, and the whole animal from above
    "stag_top": f"{STAG}&cam=top&dist=120&tx=22",
    "stag_side": f"{STAG}&cam=side&dist=120&tx=22&ty=10",
    "stag_34": f"{STAG}&cam=34&dist=130&tx=18&ty=8",
    "stag_whole_top": f"{STAG}&cam=top&dist=210",
    # one mandible from above, close (as photo stag_02)
    "stag_mand": f"{STAG}&cam=top&dist=70&tx=32&tz=-16",
    # allometry: majors to minors (photo stag_06)
    **{f"stag_size{k}": f"{STAG}&cam=top&dist=210&msize={k / 4}" for k in range(5)},
}


def shot(pg, q, path):
    t0 = time.time()
    pg.goto(BASE + "?" + q + f"&light={LIGHT}&tm=neutral&bloom=0&dof=0", wait_until="load", timeout=600000)
    while time.time() - t0 < 600 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.25)
    pg.wait_for_timeout(200)
    pg.screenshot(path=path, timeout=300000)
    print(f"{time.time() - t0:5.1f}s  {path}", flush=True)


errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": W, "height": H})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "ERR_" not in m.text)) else None)
    for name, q in SHOTS.items():
        if ONLY and name not in ONLY:
            continue
        shot(pg, q, os.path.join(OUT, f"{name}.png"))
    b.close()
print("errors:", errs[:8])
