"""Combat v2 renders (CHANGE_PLAN §16, docs/combat/v2/): a 60 v 60 clash (Black garden ants against fire-ant soldiers)
at the default zoom and closer, several seconds into the fight — run it against the base (LABEL=before, another dev
server via BASE) and this branch (LABEL=after) for side-by-side sheets — and, on this branch, riders on titans at the
default zoom, close up and with the climb debug overlay, a titan's shake-off and a short clip of the clash. Fails on
page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/combat_v2.py docs/combat/v2
     LABEL=before BASE=http://127.0.0.1:5174/ python3 tests/browser/combat_v2.py docs/combat/v2   (base checkout)
     ONLY=<name part>; CLIP=0 skips the clip
"""
import os, sys, time, subprocess, shutil
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
LABEL = os.environ.get("LABEL", "after")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "docs", "combat", "v2")
ONLY = os.environ.get("ONLY", "")
CLIP = os.environ.get("CLIP", "1") != "0"
os.makedirs(OUT, exist_ok=True)
res = []

S = lambda team, unit, n, lv=1, at=None: {"type": "arenaSpawn", "team": team, "unit": unit, "n": n, "level": lv, "at": at is not None, "x": at[0] if at else 0, "y": at[1] if at else 0}
CLASH = [S(0, "ant:lasius_worker", 50), S(0, "ant:lasius_worker", 10), S(1, "ant:fire_soldier", 50), S(1, "ant:fire_soldier", 10)]

CAM = """(c) => { const s = window.__session; const A = s.world.s.mode.arena; const r = s.view.surfaceRig;
  let x = c.x ?? A.cx, y = c.y ?? A.cy;
  if (c.fight) { const f = s.world.s.ants.filter(a => (a.state === 24 || a.state === 25 || a.state === 30) && a.id !== s.world.colony(a.colony).queen);
    if (f.length) { x = f.reduce((t, a) => t + a.x, 0) / f.length; y = f.reduce((t, a) => t + a.y, 0) / f.length; } }
  r.jumpTo(x, y, c.d); r.yaw = r.goalYaw = c.yaw ?? 0.6; if (c.p !== undefined) r.pitchBias = c.p; return [x, y]; }"""

STATS = """() => { const w = window.__session.world; const live = w.s.ants.filter(a => a.state !== 28 && a.id !== w.colony(a.colony).queen);
  return { alive: live.length, riding: w.s.ants.filter(a => (a.ridePh || 0) >= 1 && (a.ridePh || 0) <= 2).length,
           shake: w.s.creatures.map(c => c.data.shake || 0).join(',') } }"""


def page(ctx, teams, size=(1280, 760), debug=False):
    pg = ctx.new_page()
    pg.set_viewport_size({"width": size[0], "height": size[1]})
    pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    pg.goto(BASE + f"?play=1&mode=arena&teams={teams}&shot=1&q=low&seed=4&noui=1" + ("&climbdebug=1" if debug else ""), wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    return pg, errs


def shot(pg, name, cam):
    xy = pg.evaluate(CAM, cam)
    pg.evaluate("window.__step(2, 0.05)")
    time.sleep(0.1)
    pg.screenshot(path=os.path.join(OUT, name + ".png"))
    return xy


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context()
    # ---- the 60 v 60 clash: default zoom (230) and closer (110), at 10–16 s
    if not ONLY or "clash" in ONLY:
        pg, errs = page(ctx, 2)
        pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", CLASH)
        t = 0
        for at in (10, 12, 14, 16):
            pg.evaluate(f"window.__session.loop.advance({(at - t) * 20})")
            t = at
            shot(pg, f"clash60_{LABEL}_{at}s_default", {"d": 230, "p": 0, "fight": True})
            shot(pg, f"clash60_{LABEL}_{at}s_close", {"d": 110, "p": 0.1, "fight": True})
        st = pg.evaluate(STATS)
        res.append(f"{'PASS' if not errs else 'FAIL'}  clash60 {LABEL}: {st} {errs[:2]}")
        print(res[-1], flush=True)
        pg.close()
    if LABEL == "after":
        # ---- riders on a passive stag beetle: default zoom, close, debug overlay
        for name, debug, cam in (("titan_riders_default", False, {"d": 230, "p": 0}), ("titan_riders_close", False, {"d": 80, "p": 0.35}), ("titan_riders_debug", True, {"d": 80, "p": 0.35})):
            if ONLY and ONLY not in name:
                continue
            pg, errs = page(ctx, 2, debug=debug)
            pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", [{"type": "arenaStance", "team": 1, "stance": 2}, S(1, "cr:stagBeetle", 1, 1, (280, 280)), S(0, "ant:lasius_soldier", 45)])
            pg.evaluate("window.__session.loop.advance(240)")
            shot(pg, name, dict(cam, x=280, y=280))
            st = pg.evaluate(STATS)
            res.append(f"{'PASS' if not errs and st['riding'] > 0 else 'FAIL'}  {name}: {st} {errs[:2]}")
            print(res[-1], flush=True)
            pg.close()
        # ---- other titans with riders (passive): tarantula, giant mantis, giant centipede
        for name, kind, unit, d in (("tarantula_riders", "cr:tarantula", "ant:formica_worker", 150), ("giant_mantis_riders", "cr:giantMantis", "ant:aurimyrmex_worker", 170), ("scolopendra_riders", "cr:scolopendra", "ant:lasius_soldier", 200)):
            if ONLY and ONLY not in name:
                continue
            pg, errs = page(ctx, 2)
            pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", [{"type": "arenaStance", "team": 1, "stance": 2}, S(1, kind, 1, 1, (280, 280)), S(0, unit, 45)])
            pg.evaluate("window.__session.loop.advance(260)")
            shot(pg, name, {"x": 280, "y": 280, "d": d, "p": 0.3})
            st = pg.evaluate(STATS)
            res.append(f"{'PASS' if not errs and st['riding'] > 0 else 'FAIL'}  {name}: {st} {errs[:2]}")
            print(res[-1], flush=True)
            pg.close()
        # ---- a fighting stag beetle shakes its riders off (telegraphed)
        if not ONLY or "shake" in ONLY:
            pg, errs = page(ctx, 2)
            pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", [{"type": "arenaStance", "team": 1, "stance": 1}, S(1, "cr:stagBeetle", 1, 3, (280, 280)), S(0, "ant:lasius_soldier", 45, 3)])
            got = None
            for k in range(60):
                pg.evaluate("window.__session.loop.advance(10)")
                st = pg.evaluate(STATS)
                if st["shake"].startswith("1"):
                    got = k
                    break
            if got is not None:
                pg.evaluate("window.__session.loop.advance(14)")
                shot(pg, "titan_shakeoff_windup", {"d": 110, "p": 0.3, "fight": True})
                pg.evaluate("window.__session.loop.advance(8)")
                shot(pg, "titan_shakeoff_thrown", {"d": 110, "p": 0.3, "fight": True})
            res.append(f"{'PASS' if not errs and got is not None else 'FAIL'}  titan shake-off: {'seen' if got is not None else 'not seen'} {errs[:2]}")
            print(res[-1], flush=True)
            pg.close()
        # ---- a clip of the clash (4 frames a second from 9 to 17 s)
        if CLIP and (not ONLY or "clip" in ONLY) and shutil.which("ffmpeg"):
            pg, errs = page(ctx, 2, size=(960, 560))
            pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", CLASH)
            pg.evaluate("window.__session.loop.advance(180)")
            fr = os.path.join(OUT, "clash60_frames")
            os.makedirs(fr, exist_ok=True)
            xy = pg.evaluate(CAM, {"d": 140, "p": 0.05, "fight": True})
            for i in range(32):
                pg.evaluate("window.__session.loop.advance(5)")
                pg.evaluate(CAM, {"x": xy[0], "y": xy[1], "d": 140, "p": 0.05})
                pg.evaluate("window.__step(1, 0.05)")
                pg.screenshot(path=os.path.join(fr, f"f{i:03d}.png"))
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "8", "-i", os.path.join(fr, "f%03d.png"), "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", os.path.join(OUT, "clash60_after.mp4")], check=False)
            res.append(f"{'PASS' if not errs else 'FAIL'}  clip clash60_after.mp4 {errs[:2]}")
            print(res[-1], flush=True)
            pg.close()
    b.close()
print("FAILED" if any(r.startswith("FAIL") for r in res) else "combat v2 renders OK")
