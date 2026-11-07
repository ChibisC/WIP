"""Stag beetle leg review (docs/realism/stag/): every male size in side, top, front and three-quarter views,
in the rest, walking, attacking (wind-up, lift, toss, rear) and dead poses, for the before/after sheets.

  BASE=http://127.0.0.1:5173/ python3 tests/browser/stag_legs.py docs/realism/stag/before

Env: ONLY (comma list of names), SET (quick | full, default full), LIGHT (default studio), W, H.
"""
import os, sys, time
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/stag/renders"
ONLY = set(filter(None, os.environ.get("ONLY", "").split(",")))
SET = os.environ.get("SET", "full")
LIGHT = os.environ.get("LIGHT", "studio")
W = int(os.environ.get("W", "1000"))
H = int(os.environ.get("H", "760"))
os.makedirs(OUT, exist_ok=True)

STAG = "scene=crlab&kind=stagBeetle"
REST = f"{STAG}&walk=0&speed=0"
VIEWS = {
    "side": "cam=side&dist=215&ty=10",
    "top": "cam=top&dist=215",
    "front": "cam=front&dist=200&ty=12",
    "34": "cam=34&dist=230&ty=10",
}
# poses: the lab walks the beetle in, so `walk` and `phase` give a mid-stride frame
POSES = {
    "rest": REST,
    "walk": f"{STAG}&walk=2.5&speed=1&phase=0.3",
    "windup": f"{REST}&state=8&st=0.4",
    "lift": f"{REST}&state=19&st=0.5",
    "toss": f"{REST}&state=18&st=0.06",
    "rear": f"{REST}&state=15&st=0.9",
    "dead": f"{REST}&dead=1&deadT=2",
}
SHOTS = {}
# the titan (a major male, msize 1): every view in every pose
for pn, pq in POSES.items():
    for vn, vq in VIEWS.items():
        SHOTS[f"size4_{pn}_{vn}"] = f"{pq}&msize=1&{vq}"
# the smaller males (not yet in the game: the lab's msize): rest in every view, and a walk from the side
for k in range(4):
    for vn, vq in VIEWS.items():
        SHOTS[f"size{k}_rest_{vn}"] = f"{REST}&msize={k / 4}&{vq}"
    SHOTS[f"size{k}_walk_side"] = f"{POSES['walk']}&msize={k / 4}&{VIEWS['side']}"
# a close look at the fore legs from the side and from the front, low
SHOTS["size4_rest_fore_side"] = f"{REST}&msize=1&cam=side&dist=110&tx=30&ty=8"
SHOTS["size4_rest_fore_low"] = f"{REST}&msize=1&cam=low&dist=120&tx=30&ty=8"
QUICK = ["size4_rest_side", "size4_rest_top", "size4_rest_front", "size4_rest_34", "size4_rest_fore_side", "size4_rest_fore_low", "size4_walk_side"]


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
    names = QUICK if SET == "quick" else list(SHOTS)
    for name in names:
        if ONLY and name not in ONLY:
            continue
        shot(pg, SHOTS[name], os.path.join(OUT, f"{name}.png"))
    b.close()
print("errors:", errs[:8])
