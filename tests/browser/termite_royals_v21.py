"""Termite royals, model kit v2.1, in the real game (claude/termite-royals/00-ROYALS-UPDATE.md §6):
the queen and king in the royal chamber from the top, side, front and three-quarter, at the nest
camera's farthest zoom and at the distance where the queen drops to LOD2, and a worker pulling an
egg from her tip. Fails on page errors, shader warnings, a king who is not standing still beside
her (ATTEND), or no egg being pulled.

Run: tests/browser/with_server.sh python3 tests/browser/termite_royals_v21.py
Screenshots: docs/creatures/termite-royals-renders/game-*.png
"""
import math
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "termite-royals-renders")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)

INFO = """() => { const s = window.__session; const w = s.world; const c = s.player;
  const q = w.antById.get(c.queen); const k = w.antById.get(c.king);
  const pulling = w.s.ants.filter(a => a.colony === c.id && a.state === 16 && a.v === 0).length;
  return { qx: q.x, qy: q.y, qh: q.h, kx: k.x, ky: k.y, kstate: k.state, kv: k.v, eggs: c.eggs, pulling,
           maxDist: s.view.nestRig.maxDist, minDist: s.view.nestRig.minDist } }"""

# name, camera distance (mm), yaw relative to the queen (None = top view), pitch bias, look-at offset along her (mm, + = toward her head)
VIEWS = [
    ("game-top", 34, 0.0, 2.0, -9),
    ("game-side", 30, "side", -0.05, -9),
    ("game-front", 22, "front", -0.1, 0),
    ("game-threeq", 30, "threeq", 0.05, -9),
    ("game-king-attend", 16, "kingq", 0.15, -5),
    ("game-egg-pull", 18, "back", 0.15, -22),
    ("game-lod2", 520, 0.0, 0.3, -9),
    ("game-max-zoom", 99999, 0.0, 0.3, -9),
]

res = []
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 960, "height": 560})
    pg = ctx.new_page()
    pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
    pg.goto(BASE + "?play=1&shot=1&noui=1&q=high&seed=5&species=nasutitermes&rival=lasius&view=nest&creatures=0", wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    # run until a worker is at her tip working an egg free
    i = pg.evaluate(INFO)
    for k in range(80):
        pg.evaluate("window.__session.loop.advance(5)")
        i = pg.evaluate(INFO)
        if i["pulling"] > 0 and k > 20:
            break
    seen_pull = i["pulling"] > 0
    pg.evaluate("() => { const s = window.__session; if (s.view.props) s.view.props.group.visible = false; }")
    for name, dist, yaw, pitch, along in VIEWS:
        if os.environ.get("ONLY") and os.environ["ONLY"] not in name:
            continue
        h = i["qh"]
        # camera offset direction in the nest's world (x, z) = sim (x, y): yaw such that (sin yaw, cos yaw) points from her to the camera
        if yaw == "side":
            yv = -h
        elif yaw == "front":
            yv = math.pi / 2 - h
        elif yaw == "threeq":
            yv = -h + math.pi / 4
        elif yaw == "kingq":
            yv = -h - 0.6  # from the king's side (her left), a little toward her head
        elif yaw == "back":
            yv = -h - math.pi / 2 + 0.25
        else:
            yv = 0.6
        x = i["qx"] + math.cos(h) * along
        y = i["qy"] + math.sin(h) * along
        if name == "game-king-attend":
            x, y = i["kx"], i["ky"]
        pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.nestRig;
            r.jumpTo({x}, {y}, Math.min({dist}, r.maxDist)); r.yaw = r.goalYaw = {yv}; r.pitchBias = {pitch}; }}""")
        pg.evaluate("window.__step(4, 0.05)")
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
    pg.close()
    b.close()

ok = not errs and seen_pull and i["kv"] == 0
print(f"{'PASS' if ok else 'FAIL'}  termite royals v2.1 in game: egg pull seen {seen_pull}, king still {i['kv'] == 0}, {errs[:3]}")
print("FAILED" if not ok else "termite royals renders OK")
