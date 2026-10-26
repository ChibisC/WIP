"""Realism pass, pilot (docs/realism/pilot): the stag beetle boss against tropical fire ants in the battle arena,
at gameplay and far zoom, and a frame strip of it walking, grabbing, lifting, tossing and rearing to slam.
Run against one dev server per build (BASE=…) and name the output: before/after.

  BASE=http://127.0.0.1:5173/ python3 tests/browser/realism_pilot.py docs/realism/pilot before
"""
import os, sys, time
from playwright.sync_api import sync_playwright
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/realism/pilot"
TAG = sys.argv[2] if len(sys.argv) > 2 else "after"
STRIP = os.environ.get("STRIP", "1") == "1"
os.makedirs(OUT, exist_ok=True)
errs = []
S = lambda team, unit, n, at=None: {"type": "arenaSpawn", "team": team, "unit": unit, "n": n, "level": 1, "at": at is not None, "x": at[0] if at else 0, "y": at[1] if at else 0}

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 1280, "height": 760})
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "marker missing" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    pg.goto(BASE + "?play=1&mode=arena&teams=2&shot=1&q=high&seed=4&noui=1", wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    A = pg.evaluate("(() => { const A = window.__session.world.s.mode.arena; return [A.cx, A.cy]; })()")
    cx, cy = A
    pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", [S(0, "cr:stagBeetle", 1, (cx - 40, cy)), S(1, "ant:fire_minor", 30, (cx + 60, cy)), S(1, "ant:fire_major", 4, (cx + 70, cy + 10))])
    # the strip: the ants hold still (passive) so the beetle's own moves read clearly
    if os.environ.get("PASSIVE", "1") == "1":
        pg.evaluate("(c) => window.__session.issue(c)", {"type": "arenaStance", "team": 1, "stance": 2})
    pg.evaluate("window.__session.loop.advance(2)")
    st = lambda: pg.evaluate("(() => { const c = window.__session.world.s.creatures.find(c => c.kind === 'stagBeetle'); return c ? [c.state, c.st, c.x, c.y, c.h, c.hp / c.maxHp] : null; })()")

    def cam(d, pitch, yaw=None, at=None):
        s = st()
        x, y = (s[2], s[3]) if (s and at is None) else (at or (cx, cy))
        pg.evaluate("(c) => { const r = window.__session.view.surfaceRig; r.jumpTo(c.x, c.y, c.d); r.pitchBias = c.p; if (c.yaw !== null) { r.yaw = r.goalYaw = c.yaw; } }", {"x": x, "y": y, "d": d, "p": pitch, "yaw": yaw})

    def shot(name, d, pitch, yaw=None, clip=None):
        cam(d, pitch, yaw)
        pg.evaluate("window.__step(3, 1/30)")
        time.sleep(0.2)
        path = os.path.join(OUT, f"{TAG}_{name}.png")
        pg.screenshot(path=path, clip=clip)
        print("saved", path, st(), flush=True)

    # the stag beetle in the grab phase (under 75 % health), walking at the ants
    pg.evaluate("(() => { const c = window.__session.world.s.creatures.find(c => c.kind === 'stagBeetle'); c.hp = c.maxHp * 0.6; })()")
    pg.evaluate("window.__session.loop.advance(30)")
    # the fire ants: their group at gameplay zoom and close (the stag beetle out of the picture)
    ac = pg.evaluate("(() => { const s = window.__session; const a = s.world.s.ants.filter(a => a.caste === 'fire_minor'); return [a.reduce((t, x) => t + x.x, 0) / a.length, a.reduce((t, x) => t + x.y, 0) / a.length]; })()")
    for name, d, pitch in [("ants_gameplay_zoom", 70, 0.6), ("ants_close", 22, 0.32)]:
        cam(d, pitch, 2.4, at=(ac[0], ac[1]))
        pg.evaluate("window.__step(3, 1/30)")
        time.sleep(0.2)
        pg.screenshot(path=os.path.join(OUT, f"{TAG}_{name}.png"))
        print("saved", name, flush=True)
    shot("gameplay_zoom", 160, 0.55, 2.4)
    shot("far_zoom", 520, 0.75, 2.4)
    shot("macro_stag", 70, 0.35, 2.2)

    def side_yaw():
        # look at the beetle from its left side, a little in front
        s = st()
        import math
        # the rig puts the camera at (sin yaw, cos yaw) from the target; the beetle faces (cos h, sin h)
        return -s[4] + 0.45 if s else None

    if STRIP:
        CS = {"WindUp": 8, "Lift": 19, "Strike": 18, "Rear": 15}
        want = [("1_walk", lambda s: s[0] in (0, 1) and s[1] > 0.3), ("2_windup", lambda s: s[0] == CS["WindUp"] and s[1] > 0.6), ("3_lift", lambda s: s[0] == CS["Lift"] and s[1] > 0.45), ("4_toss", lambda s: s[0] == CS["Strike"] and s[1] > 0.12)]
        for name, cond in want:
            ok = False
            for _ in range(20 * 30):
                s = st()
                if s and cond(s):
                    ok = True
                    break
                pg.evaluate("window.__session.loop.advance(1)")
            if ok:
                # the lift and the toss closer, to see the ants in the antlers
                shot("strip_" + name, 120 if name in ("3_lift", "4_toss") else 190, -1.0, side_yaw())
            else:
                print("no", name, st(), flush=True)
        # enraged: rear up and slam
        pg.evaluate("(() => { const c = window.__session.world.s.creatures.find(c => c.kind === 'stagBeetle'); c.hp = c.maxHp * 0.3; c.data.rearT = 0; })()")
        for name, cond in [("5_rear", lambda s: s[0] == CS["Rear"] and s[1] > 0.85), ("6_slam", lambda s: s[0] == CS["Rear"] and s[1] > 1.3)]:
            ok = False
            for _ in range(20 * 30):
                s = st()
                if s and cond(s):
                    ok = True
                    break
                pg.evaluate("window.__session.loop.advance(1)")
            if ok:
                shot("strip_" + name, 190, -1.0, side_yaw())
            else:
                print("no", name, st(), flush=True)
    b.close()
print("errors:", errs[:5])
