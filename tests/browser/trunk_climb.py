"""The trunk climb as a bark walk (game/trunkMount.ts): stills of ants at several heights on a trunk in the ground view,
one of an ant coming over the trunk top's rim in the trees view, and a short clip of the climb.

Run: BASE=http://127.0.0.1:5173/ python3 tests/browser/trunk_climb.py        (MAP, OUT)
Out: docs/trees/shots/climb_walk.jpg, climb_rim.jpg; docs/trees/clips/climb.gif
"""
import os
import shutil
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
MAP = os.environ.get("MAP", "meadowPond")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
SHOTS = os.environ.get("OUT", os.path.join(ROOT, "docs", "trees", "shots"))
CLIPS = os.path.join(ROOT, "docs", "trees", "clips")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(SHOTS, exist_ok=True)
os.makedirs(CLIPS, exist_ok=True)
D = os.path.join(CLIPS, "climb_frames")
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
errs = []

# six ants on the bark at heights 0 (just tipping up), 8, 20, 35, 50, 70 % of the climb; two coming down
STAGE = """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const t = d.trunks[0]; const e = t.climbs[0]; const me = s.player;
  const secs = d.height / d.height * 6; const ks = [0.02, 0.08, 0.2, 0.35, 0.5, 0.7, 0.3, 0.6]; let n = 0;
  for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen) {
    if (n < ks.length) { const up = n < 6; const k = ks[n]; a.space = up ? 63 : 0; a.state = 0; a.trunkT = (up ? 1 - k : k) * secs; a.trunkUp = up ? 1 : 0;
      const c = e; a.trunkX = c.sx; a.trunkY = c.sy; a.x = c.sx; a.y = c.sy; }
    else { a.space = 0; a.x = 20; a.y = 20; }
    n++; }
  w.touch(); w.s.paused = true;
  const ang = Math.atan2(e.sy - t.y, e.sx - t.x);
  s.view.surfaceRig.jumpTo(t.x + Math.cos(ang) * (t.r + 4), t.y + Math.sin(ang) * (t.r + 4), 150);
  s.view.surfaceRig.yaw = s.view.surfaceRig.goalYaw = Math.PI / 2 - ang; s.view.surfaceRig.pitchBias = -0.3; }"""
RIM = """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const t = d.trunks[0]; const me = s.player; const g = w.nestOf(63);
  if (!s.view.inTrees) { s.toggleTrees(); window.__step(14, 0.05); }
  const ks = [0.95, 0.975, 0.99, 0.9]; let n = 0;
  for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen) {
    if (n < ks.length) { a.space = 63; a.state = 0; a.trunkT = (1 - ks[n]) * 6; a.trunkUp = 1; const c = t.climbs[n % t.climbs.length]; a.trunkX = c.sx; a.trunkY = c.sy; const h = g.hexCenter(t.top); a.x = h.x; a.y = h.y; }
    else { a.space = 0; a.x = 20; a.y = 20; }
    n++; }
  w.touch();
  const h = g.hexCenter(t.top); s.view.nestRig.jumpTo(h.x, h.y, 90); }"""
CLIP = """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const t = d.trunks[0]; const e = t.climbs[0]; const me = s.player;
  if (s.view.inTrees) { s.toggleTrees(); window.__step(14, 0.05); }
  let n = 0; for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen) {
    if (n < 5) { a.space = 0; a.state = 0; a.trunkT = 0; a.x = e.sx + (e.sx - t.x) * 0.9 + (n - 2) * 3; a.y = e.sy + (e.sy - t.y) * 0.9 + (n % 2) * 3; } else { a.space = 0; a.x = 20; a.y = 20; }
    n++; }
  w.touch();
  const site = d.sites[0];
  s.issue({ type: 'placeMarker', i: 0, space: 63, x: site.x, y: site.y });
  for (const gr of me.groups) s.issue({ type: 'assignGroup', group: gr.id, marker: 0 });
  const ang = Math.atan2(e.sy - t.y, e.sx - t.x);
  s.view.surfaceRig.jumpTo(t.x + Math.cos(ang) * (t.r + 12), t.y + Math.sin(ang) * (t.r + 12), 80);
  s.view.surfaceRig.pitchBias = -0.55; }"""

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
    pg.evaluate(STAGE)
    pg.evaluate("window.__step(2, 0.05)")
    pg.screenshot(path=os.path.join(SHOTS, "climb_walk.jpg"), type="jpeg", quality=88)
    print(f"{time.time() - t0:6.0f}s  climb_walk", flush=True)
    pg.evaluate(RIM)
    pg.evaluate("window.__step(1, 0.05)")
    pg.screenshot(path=os.path.join(SHOTS, "climb_rim.jpg"), type="jpeg", quality=88)
    print(f"{time.time() - t0:6.0f}s  climb_rim", flush=True)
    if os.environ.get("CLIP") != "1":
        b.close(); raise SystemExit(0)
    pg.evaluate(CLIP)
    for i in range(36):
        pg.evaluate("window.__step(4, 0.05)")
        pg.screenshot(path=os.path.join(D, f"f{i:03d}.jpg"), type="jpeg", quality=85)
        st = pg.evaluate("() => { const w = window.__session.world; return w.s.ants.filter((a) => a.trunkT > 0).length; }")
        print(f"{time.time() - t0:6.0f}s  clip {i}: climbing {st}", flush=True)
    b.close()
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "5", "-i", os.path.join(D, "f%03d.jpg"), "-vf", "fps=5,scale=640:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", os.path.join(CLIPS, "climb.gif")], check=True)
print("errors:", errs[:6])
if errs:
    raise SystemExit(1)
