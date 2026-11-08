"""Saiy-Ant Blaster clips (claude/saiy-ants/09-spec-saiy-blaster.md §6, docs/creatures/aurimyrmex-renders/): short
real-time clips of the arena, the game's own sim, renderer, effects and camera:

  orbs      six Blasters (normal form, gold held off) firing white-blue orbs at black garden ant workers
  beam      six Blasters in the gold form: four gold orbs and the fifth shot, the beam, down a line of workers
  line      Saiy-Ant soldiers holding a melee line, Blasters behind it, against fire ant soldiers

Each clip is `SECS` (default 6) s of game time at 10 frames a second (played back in real time) plus a still of its
busiest frame. Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/blaster_clips.py docs/creatures/aurimyrmex-renders
     ONLY=<clip name part>; FRAMES=<n> (default 60); STILLS=1 (keep every frame as a .jpg too)
"""
import os, sys, time, subprocess, shutil
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "aurimyrmex-renders")
ONLY = os.environ.get("ONLY", "")
FRAMES = int(os.environ.get("FRAMES", "60"))
STILLS = os.environ.get("STILLS", "0") == "1"
os.makedirs(OUT, exist_ok=True)
res = []

S = lambda team, unit, n, at=None: {"type": "arenaSpawn", "team": team, "unit": unit, "n": n, "level": 1, "at": at is not None, "x": at[0] if at else 0, "y": at[1] if at else 0}

CAM = """(c) => { const s = window.__session; const A = s.world.s.mode.arena; const r = s.view.surfaceRig;
  let x = c.x ?? A.cx, y = c.y ?? A.cy;
  if (c.fight) { const f = s.world.s.ants.filter(a => (a.state === 24 || a.state === 25 || a.state === 30) && a.id !== s.world.colony(a.colony).queen);
    if (f.length) { x = f.reduce((t, a) => t + a.x, 0) / f.length; y = f.reduce((t, a) => t + a.y, 0) / f.length; } }
  r.jumpTo(x, y, c.d); r.yaw = r.goalYaw = c.yaw ?? 0.6; if (c.p !== undefined) r.pitchBias = c.p; return [x, y]; }"""

# gold held off (the orbs clip: the normal form's white-blue), or switched on for every Blaster now (the beam clip; the
# shot counter set to 3, so the beam is its second shot in gold rather than its fifth — staged, to fit the clip)
GOLD = """(on) => { const s = window.__session; for (const a of s.world.s.ants) { if (!a.caste.startsWith('aurimyrmex')) continue;
  if (on) { a.surgeCd = 0; if (a.caste === 'aurimyrmex_blaster') a.shotN = 3; } else { a.surgeT = 0; a.surgeCd = 1e6; } } }"""
# what is on screen now: orbs and beams (for the still: the busiest frame)
BUSY = """() => { const fx = window.__session.surfFx.blast; return fx.liveOrbs + 4 * fx.liveBeams; }"""

# name: (setup commands, gold (None: as the game decides), seconds to advance before recording, camera)
CLIPS = {
    "orbs": ([S(0, "ant:aurimyrmex_blaster", 6, (255, 300)), S(1, "ant:lasius_worker", 14, (330, 300))], False, 2.0, {"d": 75, "p": 0.32, "yaw": 0.35, "fight": True}),
    "beam": ([S(0, "ant:aurimyrmex_blaster", 6, (255, 300)), S(1, "ant:lasius_worker", 24, (335, 300))], True, 2.0, {"d": 80, "p": 0.32, "yaw": 0.35, "fight": True}),
    "line": ([S(0, "ant:aurimyrmex_soldier", 12, (262, 300)), S(0, "ant:aurimyrmex_blaster", 8, (238, 300)), S(1, "ant:fire_soldier", 30, (335, 300))], None, 5.0, {"d": 110, "p": 0.34, "yaw": 0.35, "fight": True}),
}


def page(ctx):
    pg = ctx.new_page()
    pg.set_viewport_size({"width": 960, "height": 560})
    pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    pg.goto(BASE + "?play=1&mode=arena&teams=2&shot=1&q=low&seed=4&noui=1", wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    return pg, errs


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context()
    for name, (cmds, gold, pre, cam) in CLIPS.items():
        if ONLY and ONLY not in name:
            continue
        pg, errs = page(ctx)
        pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", cmds)
        pg.evaluate("window.__session.loop.advance(2)")
        if gold is not None:
            pg.evaluate(GOLD, gold)
        steps = int(pre * 20)
        for _ in range(steps // 10):
            pg.evaluate("window.__session.loop.advance(10)")
            if gold is False:
                pg.evaluate(GOLD, False)
        xy = pg.evaluate(CAM, cam)
        fr = os.path.join(OUT, name + "_frames")
        os.makedirs(fr, exist_ok=True)
        best, besti = -1, 0
        for i in range(FRAMES):
            pg.evaluate("window.__session.loop.advance(2)")
            if gold is False:
                pg.evaluate(GOLD, False)
            pg.evaluate(CAM, dict(cam, x=xy[0], y=xy[1], fight=False))
            pg.evaluate("window.__step(1, 0.05)")
            n = pg.evaluate(BUSY)
            if n > best:
                best, besti = n, i
            pg.screenshot(path=os.path.join(fr, f"f{i:03d}.png"))
        if shutil.which("ffmpeg"):
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "10", "-i", os.path.join(fr, "f%03d.png"), "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", os.path.join(OUT, name + ".mp4")], check=False)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(fr, f"f{besti:03d}.png"), "-q:v", "3", os.path.join(OUT, name + ".jpg")], check=False)
            if STILLS:
                for i in range(FRAMES):
                    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(fr, f"f{i:03d}.png"), "-q:v", "4", os.path.join(OUT, f"{name}_{i:03d}.jpg")], check=False)
            shutil.rmtree(fr)
        res.append(f"{'PASS' if not errs else 'FAIL'}  {name} (busiest frame {besti}: {best}) {errs[:2]}")
        print(res[-1], flush=True)
        pg.close()
    b.close()
print("FAILED" if any(r.startswith("FAIL") for r in res) else "blaster clips OK")
