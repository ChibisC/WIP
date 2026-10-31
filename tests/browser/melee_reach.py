"""Creature melee reach clips (CHANGE_PLAN §18, user note 2026-10-31: "maybe a factor that makes them move so much is
that they all have too short of a range"), docs/combat/reach/<LABEL>/: short real-time clips of creatures fighting ants in
the arena with the hitboxes on, recorded on main before the change (LABEL=before) and after it (LABEL=after):

  stag_ring       a stag beetle and 40 Black garden soldiers: does it walk into its own attackers, or stand and pinch?
  six_beetles     45 workers against a group of 6 ground beetles: do the beetles chase round inside the ring?
  wolf_spider     a wolf spider and 12 workers: sprints and pounces, or grabs what its front legs reach?
  tarantula_mantis a tarantula and a mantis against 40 soldiers: lunges and turning, or strikes from where they stand?

Each clip is 6 s of game time at 10 frames a second (played back in real time) plus a still of its last frame; the
camera follows the first creature. Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/melee_reach.py docs/combat/reach
     LABEL=before … (default after); ONLY=<clip name part>
"""
import os, sys, time, subprocess, shutil
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
LABEL = os.environ.get("LABEL", "after")
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "docs", "combat", "reach")
OUT = os.path.join(ROOT, LABEL)
ONLY = os.environ.get("ONLY", "")
DEBUG = os.environ.get("COMBATDEBUG", "0") == "1"
os.makedirs(OUT, exist_ok=True)
res = []

S = lambda team, unit, n, lv=1, at=None: {"type": "arenaSpawn", "team": team, "unit": unit, "n": n, "level": lv, "at": at is not None, "x": at[0] if at else 0, "y": at[1] if at else 0}

CAM = """(c) => { const s = window.__session; const A = s.world.s.mode.arena; const r = s.view.surfaceRig;
  let x = c.x ?? A.cx, y = c.y ?? A.cy;
  if (c.cr !== undefined) { const k = s.world.s.creatures.filter((q) => !q.dead); if (k.length) { x = k[0].x; y = k[0].y; } }
  if (c.fight) { const f = s.world.s.ants.filter(a => (a.state === 24 || a.state === 25 || a.state === 30) && a.id !== s.world.colony(a.colony).queen);
    if (f.length) { x = f.reduce((t, a) => t + a.x, 0) / f.length; y = f.reduce((t, a) => t + a.y, 0) / f.length; } }
  r.jumpTo(x, y, c.d); r.yaw = r.goalYaw = c.yaw ?? 0.6; if (c.p !== undefined) r.pitchBias = c.p; return [x, y]; }"""

# name: (setup commands, seconds to advance before recording, camera)
CLIPS = {
    "stag_ring": ([S(1, "cr:stagBeetle", 1, 1, (300, 300)), S(0, "ant:lasius_soldier", 40)], 8, {"d": 190, "p": 0.35, "cr": 0}),
    "six_beetles": ([S(1, "cr:groundBeetle", 6, 1, (300, 300)), S(0, "ant:lasius_worker", 45)], 6, {"d": 150, "p": 0.35, "fight": True}),
    "wolf_spider": ([S(1, "cr:wolfSpider", 1, 1, (300, 300)), S(0, "ant:lasius_worker", 12)], 3, {"d": 75, "p": 0.4, "cr": 0}),
    "tarantula_mantis": ([S(1, "cr:tarantula", 1, 1, (250, 300)), S(1, "cr:mantis", 1, 1, (345, 300)), S(0, "ant:lasius_soldier", 40)], 5, {"x": 297, "y": 300, "d": 220, "p": 0.35}),
}


def page(ctx):
    pg = ctx.new_page()
    pg.set_viewport_size({"width": 960, "height": 560})
    pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    pg.goto(BASE + "?play=1&mode=arena&teams=2&shot=1&q=low&seed=4&noui=1&hitboxes=1" + ("&combatdebug=1" if DEBUG else ""), wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    return pg, errs


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context()
    for name, (cmds, pre, cam) in CLIPS.items():
        if ONLY and ONLY not in name:
            continue
        pg, errs = page(ctx)
        pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", cmds)
        pg.evaluate(f"window.__session.loop.advance({pre * 20})")
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
print("FAILED" if any(r.startswith("FAIL") for r in res) else "melee reach clips OK")
