"""Model redo for the Saiy-Ants and the sickle-jaw termites (claude/realism/10-spec-saiy-ant-sickle-jaw-models.md):
lab renders per unit, view and light (from tests/browser/hell_nasute_realism.py).

  tests/browser/with_server.sh python3 tests/browser/saiy_sickle_realism.py <out dir>

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
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/saiy_sickle_renders"
W = int(os.environ.get("W", "1000"))
H = int(os.environ.get("H", "680"))
EXTRA = os.environ.get("EXTRA", "")
# review round 2: a finer, denser macro ground with litter, contact shadows, stronger contact occlusion (ROUND=1: the round-1 look)
R1 = os.environ.get("ROUND", "2") == "1"
GROUND = "grains=500&grainmm=0.09" if R1 else "grains=1400&grainmm=0.06&contact=1"
AOSTR = "1" if R1 else "1.5"
os.makedirs(OUT, exist_ok=True)

# unit: (lab key, model length in world units (about mm), extra query)
UNITS = {
    "saiy_worker": ("saiy_worker", 6.0, "mopen=0.3"),
    "saiy_soldier": ("saiy_soldier", 9.0, "mopen=0.25"),
    "saiy_queen": ("saiy_queen", 14.0, "mopen=0.2"),
    "saiy_gold": ("saiy_worker", 6.0, "mopen=0.3&gold=1"),
    # the Saiy-Ant Blaster (spec saiy-ants/09): at rest (a faint glow), aiming (jaws wide, the mouth lit), gold
    "saiy_blaster": ("saiy_blaster", 6.6, "mopen=0.3&mglow=0.1"),
    "saiy_blaster_aim": ("saiy_blaster", 6.6, "mopen=1&mglow=0.9"),
    "saiy_blaster_gold": ("saiy_blaster", 6.6, "mopen=1&mglow=0.9&gold=1"),
    "sickle_worker": ("termite_rhy_worker", 6.14, ""),
    "sickle_soldier": ("termite_rhy_soldier", 5.4, ""),
    "sickle_presoldier": ("termite_rhy_presoldier", 5.4, ""),
    "sickle_gape": ("termite_rhy_soldier", 5.4, "mopen=1"),
    "sickle_larva": ("termite_rhy_larva", 5.8, ""),
    "sickle_king": ("termite_rhy_king", 8.88, ""),
    "sickle_queen": ("termite_rhy_queen", 26.1, ""),
    # Termants (spec 09 §3: the realistic hybrid redesign)
    "termant_worker": ("termant_worker", 5.0, "mopen=0.3"),
    "termant_soldier": ("termant_soldier", 7.0, "mopen=0.2"),
    "termant_queen": ("termant_queen", 12.0, "mopen=0.2"),
    "termant_king": ("termant_king", 7.5, "mopen=0.2"),
    # the calibration anchor: the fire ant pilot (rated 9-10 by the user)
    "anchor_fire": ("fire_minor", 2.96, ""),
    # the conehead termites share the termite kit: rendered before and after to prove they did not change
    "nasute_worker": ("termite_worker", 4.43, ""),
    "nasute_soldier": ("termite_nasute", 5.0, ""),
    "nasute_king": ("termite_king", 8.36, ""),
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
    ("sickle_queen", "macro"): "cam=34&dist=13&tx=2&ty=1.5",
    ("sickle_queen", "front"): "cam=front&dist=16&tx=3&ty=2.5",
    ("sickle_queen", "jaw"): "cam=side&dist=9&tx=3&ty=1",
    ("sickle_queen", "side"): "cam=fside&dist=62&tx=-2&ty=1.5",
    ("sickle_queen", "34"): "cam=34&dist=68&tx=-2",
    ("sickle_queen", "top"): "cam=top&dist=80&tx=-2",
}
DOF = {"side": 0.8, "top": 0.4, "front": 0.7, "34": 1.0, "macro": 1.3, "jaw": 0.8}
units = [u for u in os.environ.get("UNITS", ",".join(k for k in UNITS if not k.startswith(("nasute", "anchor")))).split(",") if u]
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
                q = f"scene=antlab&ants={key}&{OVERRIDE.get((u, v)) or VIEWS[v](L)}&light={li}&dof={DOF[v]}&{GROUND}&grain=0.03&aostr={AOSTR}&amp=0&{q0}&{EXTRA}"
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
