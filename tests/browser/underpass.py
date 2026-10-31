"""Under-pass clips (combat v2.2, CHANGE_PLAN §20, docs/combat/underpass.md), docs/combat/underpass/<LABEL>/: short
real-time clips in the arena, recorded on main before the change (LABEL=before) and after it (LABEL=after):

  minims_through_majors  a column of five Atta majors standing across the way and eight minims running to a beetle
                         beyond it: round the column, or straight under it?
  atta_mixed_beetle      4 Atta majors + 20 minims v a ground beetle (the majors' ring, minims where they fit)
  eciton_raid            3 Eciton soldiers, 3 porters and 30 workers v 12 Red wood ants: workers among the long legs
  from_beneath           25 fire-ant minors v 2 Atta majors: small foes under a tall enemy ant's body
  outline_top            the same as minims_through_majors from above: outlines of the minims under the majors (after)

Each clip is 6 s of game time at 10 frames a second, low over the ground (from above for outline_top), plus a still of
its last frame. Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/underpass.py docs/combat/underpass
     LABEL=before … (default after); ONLY=<clip name part>; COMBATDEBUG=1 for the debug view
"""
import os, sys, time, subprocess, shutil
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
LABEL = os.environ.get("LABEL", "after")
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "docs", "combat", "underpass")
OUT = os.path.join(ROOT, LABEL)
ONLY = os.environ.get("ONLY", "")
DEBUG = os.environ.get("COMBATDEBUG", "0") == "1"
os.makedirs(OUT, exist_ok=True)
res = []

S = lambda team, unit, n, lv=1, at=None: {"type": "arenaSpawn", "team": team, "unit": unit, "n": n, "level": lv, "at": at is not None, "x": at[0] if at else 0, "y": at[1] if at else 0}
PASSIVE = lambda team: {"type": "arenaStance", "team": team, "stance": 2}

# a column of team 0's majors standing across the way at x (head to tail along y, facing +y), held still
# (pinned: they do not walk; nothing about them is drawn differently), and the minims put in a block west of it
COLUMN = """(o) => { const s = window.__session; const w = s.world; const T = w.s.mode.arena.teams[0];
  const mine = w.s.ants.filter((a) => a.colony === T.colony);
  const big = mine.filter((a) => a.caste === o.tall), small = mine.filter((a) => a.caste === o.small);
  big.forEach((a, i) => { a.x = a.px = o.x; a.y = a.py = o.y + (i - (big.length - 1) / 2) * o.gap; a.h = a.ph = Math.PI / 2; a.pinned = 1e9; });
  small.forEach((a, i) => { a.x = a.px = o.x - 26 - (i % 2) * 4; a.y = a.py = o.y + (Math.floor(i / 2) - 1.5) * 4; a.h = a.ph = 0; });
  w.reindex(); return [big.length, small.length]; }"""

CAM = """(c) => { const s = window.__session; const A = s.world.s.mode.arena; const r = s.view.surfaceRig;
  let x = c.x ?? A.cx, y = c.y ?? A.cy;
  if (c.cr !== undefined) { const k = s.world.s.creatures.filter((q) => !q.dead); if (k.length) { x = k[0].x; y = k[0].y; } }
  if (c.fight) { const f = s.world.s.ants.filter(a => (a.state === 24 || a.state === 25 || a.state === 30) && a.id !== s.world.colony(a.colony).queen);
    if (f.length) { x = f.reduce((t, a) => t + a.x, 0) / f.length; y = f.reduce((t, a) => t + a.y, 0) / f.length; } }
  r.jumpTo(x, y, c.d); r.yaw = r.goalYaw = c.yaw ?? 0.6; if (c.p !== undefined) r.pitchBias = c.p; return [x, y]; }"""

WALK = ([S(0, "ant:atta_major", 5, 1, (300, 300)), S(0, "ant:atta_minim", 8, 1, (270, 300)), S(1, "cr:groundBeetle", 1, 1, (360, 300)), PASSIVE(1)],
        {"tall": "atta_major", "small": "atta_minim", "x": 300, "y": 300, "gap": 14.7})
# name: (setup commands, column, seconds to advance before recording, camera)
CLIPS = {
    "minims_through_majors": (WALK[0], WALK[1], 0, {"x": 296, "y": 300, "d": 70, "p": -0.3, "yaw": 1.9}),
    "atta_mixed_beetle": ([S(0, "ant:atta_major", 4, 1, (280, 300)), S(0, "ant:atta_minim", 20, 1, (275, 300)), S(1, "cr:groundBeetle", 1, 1, (320, 300)), PASSIVE(1)], None, 3, {"d": 70, "p": -0.25, "cr": 0, "yaw": 1.2}),
    "eciton_raid": ([S(0, "ant:eciton_major", 3, 1, (270, 300)), S(0, "ant:eciton_submajor", 3, 1, (270, 300)), S(0, "ant:eciton_minor", 30, 1, (265, 300)), S(1, "ant:formica_worker", 12, 1, (320, 300))], None, 3, {"d": 90, "p": -0.25, "fight": True, "yaw": 1.2}),
    "from_beneath": ([S(0, "ant:atta_major", 2, 1, (300, 300)), S(1, "ant:fire_minor", 25, 1, (325, 300))], None, 3, {"d": 60, "p": -0.25, "fight": True, "yaw": 1.2}),
    "outline_top": (WALK[0], WALK[1], 1.6, {"x": 300, "y": 300, "d": 60, "p": 0.5, "yaw": 0.6}),
}


def page(ctx):
    pg = ctx.new_page()
    pg.set_viewport_size({"width": 960, "height": 560})
    pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    pg.goto(BASE + "?play=1&mode=arena&teams=2&shot=1&q=low&seed=4&noui=1" + ("&combatdebug=1" if DEBUG else ""), wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    return pg, errs


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context()
    for name, (cmds, col, pre, cam) in CLIPS.items():
        if ONLY and ONLY not in name:
            continue
        pg, errs = page(ctx)
        pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", cmds)
        pg.evaluate("window.__session.loop.advance(1)")
        if col:
            print(name, "column", pg.evaluate(COLUMN, col), flush=True)
        if pre:
            pg.evaluate(f"window.__session.loop.advance({int(pre * 20)})")
        xy = pg.evaluate(CAM, cam)
        fr = os.path.join(OUT, name + "_frames")
        os.makedirs(fr, exist_ok=True)
        for i in range(60):
            pg.evaluate("window.__session.loop.advance(2)")
            pg.evaluate(CAM, dict(cam, x=xy[0], y=xy[1], fight=False) if "cr" not in cam else cam)
            pg.evaluate("window.__step(1, 0.05)")
            pg.screenshot(path=os.path.join(fr, f"f{i:03d}.png"))
        if shutil.which("ffmpeg"):
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "10", "-i", os.path.join(fr, "f%03d.png"), "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", os.path.join(OUT, name + ".mp4")], check=False)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(fr, "f059.png"), "-q:v", "3", os.path.join(OUT, name + ".jpg")], check=False)
            shutil.rmtree(fr)
        res.append(f"{'PASS' if not errs else 'FAIL'}  {LABEL} {name} {errs[:2]}")
        print(res[-1], flush=True)
        pg.close()
    b.close()
print("FAILED" if any(r.startswith("FAIL") for r in res) else "under-pass clips OK")
