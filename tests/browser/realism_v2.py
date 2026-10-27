"""Realism pass v2 (docs/realism/pilot-v2): lab renders of the two pilots at the reference photo angles.

For the tropical fire ant worker (ant lab) and the stag beetle (creature lab): side, top, front (head),
three-quarter and macro close-up, each under the overcast and sunny presets; a backlit side view (light
through legs, antennae and hairs); part masks for the colour statistics; and, with BEFORE=<url>, the same
cameras rendered from the old build.

  AFTER=http://127.0.0.1:5174/ BEFORE=http://127.0.0.1:5173/ python3 tests/browser/realism_v2.py docs/realism/pilot-v2/renders

Env: TM (tone mapping: neutral|agx|aces, default neutral), ONLY (comma list of names to render), W, H.
"""
import os, sys, time
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
AFTER = os.environ.get("AFTER", "http://127.0.0.1:5174/")
BEFORE = os.environ.get("BEFORE", "")
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/pilot-v2/renders"
TM = os.environ.get("TM", "neutral")
ONLY = set(filter(None, os.environ.get("ONLY", "").split(",")))
W = int(os.environ.get("W", "1200"))
H = int(os.environ.get("H", "760"))
os.makedirs(OUT, exist_ok=True)

ANT = "scene=antlab&ant=fire_minor"
STAG = "scene=crlab&kind=stagBeetle&walk=0.35&speed=0.4"
# name: (subject query, camera query, ground, depth of field)
VIEWS = {
    "fire_side": (ANT, "cam=fside&dist=5.2&ty=0.3", "grains=500&grainmm=0.09", 0.5),
    "fire_top": (ANT, "cam=top&dist=7.6", "grains=500&grainmm=0.09", 0.4),
    "fire_front": (ANT, "cam=front&dist=2.4&tx=1.1&ty=0.35", "grains=400&grainmm=0.09", 0.7),
    "fire_34": (ANT, "cam=34", "grains=500&grainmm=0.09", 1.2),
    "fire_macro": (ANT, "cam=34&dist=2.2&tx=0.5&ty=0.4", "grains=300&grainmm=0.09", 1.4),
    # specimen-photo style profiles (studio light: the animal on white paper)
    "fire_profile": (ANT, "cam=side&dist=4.6&ty=0.35", "", 0.25),
    "stag_side": (STAG, "cam=fside&dist=190&ty=7", "grains=500&grainmm=1.4&litter=10", 0.5),
    "stag_top": (STAG, "cam=top&dist=210", "grains=500&grainmm=1.4&litter=10", 0.4),
    "stag_front": (STAG, "cam=front&dist=120&tx=18&ty=8", "grains=400&grainmm=1.4&litter=8", 0.7),
    "stag_34": (STAG, "cam=34", "grains=500&grainmm=1.4&litter=10", 1.1),
    "stag_macro": (STAG, "cam=34&dist=95&tx=14&ty=8", "grains=400&grainmm=1.2", 1.3),
}
LIGHTS = [l for l in os.environ.get("LIGHTS", "overcast,sunny").split(",") if l]
# a macro photo's character: a little grain, contact occlusion
LENS = os.environ.get("LENS", "grain=0.035&aostr=1")
BACKLIT = ["fire_side", "stag_side"]


def shot(pg, base, q, path):
    t0 = time.time()
    pg.goto(base + "?" + q, wait_until="load", timeout=600000)
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
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "marker missing" in m.text or (m.type == "error" and "ERR_" not in m.text)) else None)
    for name, (subj, cam, ground, dof) in VIEWS.items():
        if ONLY and name not in ONLY:
            continue
        for light in LIGHTS:
            shot(pg, AFTER, f"{subj}&{cam}&{ground}&light={light}&tm={TM}&dof={dof}&{LENS}", os.path.join(OUT, f"after_{name}_{light}.png"))
        if name in BACKLIT and os.environ.get("BACKLIT", "1") == "1":
            shot(pg, AFTER, f"{subj}&{cam}&{ground}&light=backlit&tm={TM}&dof={dof}&{LENS}", os.path.join(OUT, f"after_{name}_backlit.png"))
        if os.environ.get("MASKS", "1") == "1":
            shot(pg, AFTER, f"{subj}&{cam}&mask=1", os.path.join(OUT, f"mask_{name}.png"))
        # (the old build has no elevated side camera: no before shot for those views)
        if BEFORE and "fside" not in cam:
            shot(pg, BEFORE, f"{subj}&{cam}&dof={dof}", os.path.join(OUT, f"before_{name}.png"))
    b.close()
print("errors:", errs[:8])
