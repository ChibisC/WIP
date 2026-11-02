"""Frame cost of the surface (ground realism rule: don't regress frame cost; measured CPU-side).

For each map: the terrain build time (TerrainMesh + water + decor, the ground bake included), then at gameplay zoom
over a few camera positions: draw calls, triangles and shader programs (renderer.info), and the JavaScript time of
`view.frame` (scene update, culling, uniform uploads and the draw-call submission; the GPU's own time is not counted:
software GL here). Prints a line per map and writes JSON.

Run: tests/browser/ground_server.sh python3 tests/browser/ground_perf.py
  env: MAPS=…  BASE=http://127.0.0.1:5181/  OUT=docs/maps/realism/perf-<tag>.json  TAG=after  FRAMES=12
"""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5181/")
MAPS = os.environ.get("MAPS", "testTerrace,gardenBelow,fireBanks,meadowPond,forestFloor,riverbank,rainforest,savanna").split(",")
TAG = os.environ.get("TAG", "now")
FRAMES = int(os.environ.get("FRAMES", "12"))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.environ.get("OUT", os.path.join(ROOT, "docs", "maps", "realism", f"perf-{TAG}.json"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

MEASURE = """async ([frames]) => {
  const s = window.__session, v = s.view, r = v.renderer;
  const t = s.world.terrain;
  // terrain build cost: rebuild the surface world from scratch (bake cached: a game bakes once)
  const tb0 = performance.now();
  v.setTerrain(t);
  const build = performance.now() - tb0;
  const f0 = v.frame.bind(v);
  const times = [];
  const tm = v.terrainMesh;
  const rb0 = tm.rebuild.bind(tm);
  const rbt = [];
  tm.rebuild = () => { const a = performance.now(); rb0(); rbt.push(performance.now() - a); };
  v.frame = (dt, i) => { const a = performance.now(); f0(dt, i); times.push(performance.now() - a); };
  const spots = [[0.3, 0.3], [0.5, 0.5], [0.7, 0.4], [0.4, 0.7]];
  let calls = 0, tris = 0;
  for (const [fx, fz] of spots) {
    v.surfaceRig.jumpTo(t.width * fx, t.depth * fz, 230);
    window.__step(2, 1 / 30);
    r.info.reset && r.info.reset();
    window.__step(1, 1 / 30);
    calls = Math.max(calls, r.info.render.calls);
    tris = Math.max(tris, r.info.render.triangles);
    window.__step(frames, 1 / 30);
  }
  v.frame = f0;
  tm.rebuild = rb0;
  times.sort((a, b) => a - b);
  rbt.sort((a, b) => a - b);
  const med = (a) => a.length ? a[Math.floor(a.length / 2)] : 0;
  return { build, frameMed: med(times), frameP90: times[Math.floor(times.length * 0.9)] || 0, rebuildMed: med(rbt), calls, tris, programs: r.info.programs ? r.info.programs.length : 0, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
}"""

res = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    for M in MAPS:
        ctx = b.new_context(viewport={"width": 1280, "height": 760})
        pg = ctx.new_page()
        pg.set_default_timeout(1800000)
        t0 = time.time()
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=high&seed=5&creatures=1&species=lasius&rival=lasius&map={M}&ticks=30", wait_until="load")
        while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        pg.evaluate("window.__session.loop.paused = true")
        r = pg.evaluate(MEASURE, [FRAMES])
        res[M] = r
        print(f"{M}: build {r['build']:.0f} ms; frame (JS) median {r['frameMed']:.1f} ms, p90 {r['frameP90']:.1f} ms; terrain update {r['rebuildMed']:.3f} ms; {r['calls']} draw calls, {r['tris']/1000:.0f}k triangles, {r['programs']} programs, {r['geometries']} geometries, {r['textures']} textures [{time.time() - t0:.0f} s]", flush=True)
        ctx.close()
    b.close()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(res, open(OUT, "w"), indent=1)
print("wrote", OUT)
