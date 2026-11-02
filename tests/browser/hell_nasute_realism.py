"""Realism rework for hell ants and nasute termites (CHANGE_PLAN §21): lab renders per unit, view and light.

  tests/browser/with_server.sh python3 tests/browser/hell_nasute_realism.py <out dir>

Env:
  UNITS   comma list (default: every unit below)
  VIEWS   comma list of side,top,front,34,macro,jaw (default side,34,macro)
  LIGHTS  comma list of overcast,forest,sunny,backlit (default overcast,forest)
  EXTRA   extra query appended to every shot (e.g. "mopen=1")
  W, H    image size (default 1000 x 680)
  BASE    dev server (default http://127.0.0.1:5173/)
Writes <out>/<unit>_<view>_<light>.png and fails on page errors.
"""
import os, sys, time
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/hell-nasute/renders"
W = int(os.environ.get("W", "1000"))
H = int(os.environ.get("H", "680"))
EXTRA = os.environ.get("EXTRA", "")
os.makedirs(OUT, exist_ok=True)

# unit: (lab key, model length in world units (about mm), extra query)
UNITS = {
    "hell_worker": ("hell_worker", 5.75, "mopen=0.45"),
    "hell_soldier": ("hell_soldier", 7.44, "mopen=0.35"),
    "hell_queen": ("hell_queen", 9.2, "mopen=0.3"),
    "nasute_worker": ("termite_worker", 4.43, ""),
    "nasute_soldier": ("termite_nasute", 5.0, ""),
    "nasute_major": ("termite_major", 6.52, ""),
    "nasute_king": ("termite_king", 8.36, ""),
    "nasute_queen": ("termite_queen", 25.4, ""),  # (head and thorax close-ups: see OVERRIDE)
    "nasute_presoldier": ("termite_nasute", 5.0, "tan=0"),
    # the review's calibration anchor B: the game's previous best realism ant
    "anchor_fire": ("fire_minor", 2.96, ""),
    # the sickle-jaw termites share the kit: rendered before and after to prove they did not change
    "sickle_worker": ("termite_rhy_worker", 6.14, ""),
    "sickle_soldier": ("termite_rhy_soldier", 5.4, ""),
    "sickle_king": ("termite_rhy_king", 8.88, ""),
    "sickle_queen": ("termite_rhy_queen", 26.1, ""),
}
# view: camera query from the unit length L (mm)
VIEWS = {
    "side": lambda L: f"cam=fside&dist={L * 2.05:.2f}&ty={L * 0.06:.2f}",
    "top": lambda L: f"cam=top&dist={L * 2.6:.2f}",
    "front": lambda L: f"cam=front&dist={L * 1.15:.2f}&tx={L * 0.3:.2f}&ty={L * 0.08:.2f}",
    "34": lambda L: f"cam=34&dist={L * 2.3:.2f}",
    "macro": lambda L: f"cam=34&dist={L * 1.2:.2f}&tx={L * 0.22:.2f}&ty={L * 0.08:.2f}",
    "jaw": lambda L: f"cam=side&dist={L * 0.8:.2f}&tx={L * 0.36:.2f}&ty={L * 0.1:.2f}",
}
# per-unit camera overrides: the physogastric queens' heads sit at the front of a 25 mm body
OVERRIDE = {
    ("nasute_queen", "macro"): "cam=34&dist=13&tx=2&ty=1.5",
    ("nasute_queen", "front"): "cam=front&dist=16&tx=3&ty=2.5",
    ("nasute_queen", "jaw"): "cam=side&dist=9&tx=3&ty=1",
    ("nasute_queen", "side"): "cam=fside&dist=46&tx=-9&ty=1.5",
    ("nasute_queen", "34"): "cam=34&dist=50&tx=-9",
    ("nasute_queen", "top"): "cam=top&dist=62&tx=-9",
    ("sickle_queen", "macro"): "cam=34&dist=13&tx=2&ty=1.5",
    ("sickle_queen", "side"): "cam=fside&dist=46&tx=-9&ty=1.5",
    ("sickle_queen", "34"): "cam=34&dist=50&tx=-9",
}
DOF = {"side": 0.5, "top": 0.4, "front": 0.7, "34": 1.0, "macro": 1.3, "jaw": 0.8}
units = [u for u in os.environ.get("UNITS", ",".join(k for k in UNITS if not k.startswith(("sickle", "anchor")))).split(",") if u]
views = [v for v in os.environ.get("VIEWS", "side,34,macro").split(",") if v]
lights = [l for l in os.environ.get("LIGHTS", "overcast,forest").split(",") if l]

errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": W, "height": H})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_" not in m.text else None)
    for u in units:
        key, L, q0 = UNITS[u]
        for v in views:
            for li in lights:
                q = f"scene=antlab&ants={key}&{OVERRIDE.get((u, v)) or VIEWS[v](L)}&light={li}&dof={DOF[v]}&grains=500&grainmm=0.09&grain=0.03&aostr=1&amp=0&{q0}&{EXTRA}"
                path = os.path.join(OUT, f"{u}_{v}_{li}.png")
                t0 = time.time()
                pg.goto(BASE + "?" + q, wait_until="load", timeout=600000)
                while time.time() - t0 < 600 and not pg.evaluate("window.__ready===true"):
                    time.sleep(0.25)
                pg.wait_for_timeout(150)
                pg.screenshot(path=path, timeout=300000)
                print(f"{time.time() - t0:5.1f}s  {path}", flush=True)
    b.close()
bad = [e for e in errs if "favicon" not in e]
if bad:
    print("PAGE ERRORS:\n" + "\n".join(bad[:20]))
    sys.exit(1)
