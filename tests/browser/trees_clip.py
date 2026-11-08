"""The Trees layer: one short clip in four parts — ants climbing a trunk (from the ground), the canopy view rising over
the crown, a fight on a branch, and a fall (an ant flung off the branch, dropping to the ground). Frames from the
screenshot harness (a virtual clock), an MP4 and a GIF with ffmpeg.

Run: BASE=http://127.0.0.1:5173/ python3 tests/browser/trees_clip.py       (MAP, PARTS=climb,canopy,fight,fall, OUT)
Out: docs/trees/clips/trees.mp4, trees.gif (frames in trees_frames/, git-ignored)
"""
import os
import shutil
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
MAP = os.environ.get("MAP", "meadowPond")
PARTS = os.environ.get("PARTS", "climb,canopy,fight,fall").split(",")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(__file__), "..", "..", "docs", "trees", "clips"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
D = os.path.join(OUT, "trees_frames")
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
errs = []
frame = [0]

PREP = {
    "climb": """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const t = d.trunks[0]; const e = t.climbs[0];
      const site = d.sites[0]; const me = s.player;
      for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen) { a.space = 0; a.x = e.sx + (e.sx - t.x) * 1.2 + (Math.random() - 0.5) * 16; a.y = e.sy + (e.sy - t.y) * 1.2 + (Math.random() - 0.5) * 16; a.state = 0; }
      w.touch();
      s.issue({ type: 'placeMarker', i: 0, space: 63, x: site.x, y: site.y });
      for (const gr of me.groups) s.issue({ type: 'assignGroup', group: gr.id, marker: 0 });
      s.view.surfaceRig.jumpTo(e.sx, e.sy - 10, 95); }""",
    "canopy": """() => { const s = window.__session; const w = s.world; const t = w.s.trees.trunks[0];
      s.toggleTrees(); window.__step(14, 0.05); s.view.nestRig.jumpTo(t.x, t.y, 260); }""",
    "fight": """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const site = d.sites[0]; const me = s.player; const g = w.nestOf(63);
      let n = 0; for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen && n++ < 20) { a.space = 63; const ang = n * 0.9; const r = 3 + n * 0.9; a.x = site.x + Math.cos(ang) * r; a.y = site.y + Math.sin(ang) * r; if (!g.isAirAt(a.x, a.y)) { a.x = site.x; a.y = site.y; } a.state = 0; a.trunkT = 0; }
      w.touch();
      s.issue({ type: 'placeMarker', i: 0, space: 63, x: site.x, y: site.y });
      for (const gr of me.groups) s.issue({ type: 'assignGroup', group: gr.id, marker: 0 });
      s.issue({ type: 'sandboxSpawn', kind: 'wolfSpider', space: 63, x: site.x + 16, y: site.y + 6 });
      s.view.nestRig.jumpTo(site.x + 6, site.y + 2, 105); }""",
    "fall": """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const site = d.sites[0]; const me = s.player;
      for (const cr of w.s.creatures) cr.dead = true;
      // the fall as the sim does it on a fling in the trees (combat.ts flingAnt): to the ground at once, from the
      // canopy's height, dazed on landing — staged here so the clip catches the drop
      let n = 0; for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen) { if (n++ < 6) { a.space = 0; a.x = site.x + n * 3 - 9; a.y = site.y + (n % 2) * 4; a.state = 27; a.st = 0; a.fz = d.height + 1; a.fvz = 20; a.fvx = (n - 3) * 6; a.fvy = 10; a.fell = 1; a.trunkT = 0; } else { a.space = 0; a.x = 20; a.y = 20; } }
      w.touch();
      if (s.view.inTrees) { s.toggleTrees(); window.__step(14, 0.05); }
      s.view.surfaceRig.jumpTo(site.x, site.y + 40, 300); s.view.surfaceRig.pitchBias = -0.05; }""",
}
# frames per part and sim ticks between frames (6 frames a second of sim at 'every' 3–4 ticks)
PLAN = {"climb": (14, 6), "canopy": (6, 3), "fight": (12, 5), "fall": (14, 2)}
STATE = "() => { const w = window.__session.world; return { trees: w.s.ants.filter((a) => a.space === 63).length, climbing: w.s.ants.filter((a) => a.trunkT > 0).length, falling: w.s.ants.filter((a) => a.fell || a.fz > 0).length, flung: w.s.ants.filter((a) => a.state === 27).length }; }"

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_context(viewport={"width": 1120, "height": 660}).new_page()
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    t0 = time.time()
    pg.goto(BASE + f"?play=1&mode=sandbox&species=formica&rival=lasius&seed=3&map={MAP}&creatures=0&titans=0&shot=1&nocine=1&q=high&ticks=1&trees=1", wait_until="load")
    while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    pg.evaluate("window.__step(4, 0.05)")
    for part in PARTS:
        n, every = PLAN[part]
        pg.evaluate(PREP[part])
        for i in range(n):
            pg.evaluate(f"window.__step({every}, 0.05)")
            if part == "canopy":
                # a slow pull-back over the crown
                pg.evaluate(f"() => {{ const r = window.__session.view.nestRig; r.goalDistance = {260 + i * 25}; }}")
            pg.screenshot(path=os.path.join(D, f"f{frame[0]:03d}.jpg"), type="jpeg", quality=85)
            frame[0] += 1
            st = pg.evaluate(STATE)
            print(f"{time.time() - t0:6.0f}s  {part} {i}: {st}", flush=True)
    b.close()
mp4 = os.path.join(OUT, "trees.mp4")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "6", "-i", os.path.join(D, "f%03d.jpg"), "-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", mp4], check=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "6", "-i", os.path.join(D, "f%03d.jpg"), "-vf", "fps=6,scale=640:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", os.path.join(OUT, "trees.gif")], check=True)
print("errors:", errs[:6])
if errs:
    raise SystemExit(1)
