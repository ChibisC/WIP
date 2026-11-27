"""Performance v7: the Saiy-Ants' middle-distance hair, before and after (for the user's choice). One arena page per
variant (`?saiyStrands=N`, the strands a lock on the middle-distance model; 3 is the game's): an army of Saiy-Ant
workers and soldiers held still, the camera at distances where they are drawn with the middle-distance model,
screenshots, and the GPU breakdown's ant draws (ms, triangles) at the first distance.

  tests/browser/with_server.sh python3 tests/browser/saiy_hair_compare.py   VARIANTS=3,1,0  DISTS=110,75  OUT=dir
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
VARIANTS = os.environ.get("VARIANTS", "3,1,0").split(",")
DISTS = [float(x) for x in os.environ.get("DISTS", "110,75").split(",")]
OUT = os.environ.get("OUT", "saiy-hair")
VW = int(os.environ.get("VW", "1280"))
VH = int(os.environ.get("VH", "760"))
GPU = os.environ.get("GPU", "1") == "1"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

FRAMES = """() => window.__prof.frame"""


def wait_frames(pg, k, limit=900):
    f0 = pg.evaluate(FRAMES)
    t0 = time.time()
    while pg.evaluate(FRAMES) - f0 < k and time.time() - t0 < limit:
        time.sleep(0.5)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        for var in VARIANTS:
            b = p.chromium.launch(args=ARGS)
            pg = b.new_page(viewport={"width": VW, "height": VH})
            pg.set_default_timeout(1800000)
            t0 = time.time()
            pg.goto(BASE + f"?play=1&mode=arena&seed=3&nocine=1&q=high&saiyStrands={var}", wait_until="load")
            while time.time() - t0 < 1200 and not pg.evaluate("window.__ready===true"):
                time.sleep(0.5)
            wait_frames(pg, 4)
            pg.evaluate("""() => { const s = window.__session; for (const t of [0, 1]) s.issue({ type: 'arenaStance', team: t, stance: 2 });
                s.issue({ type: 'arenaSpawn', team: 0, unit: 'ant:aurimyrmex_worker', n: 30, level: 1, at: false, x: 0, y: 0 });
                s.issue({ type: 'arenaSpawn', team: 0, unit: 'ant:aurimyrmex_soldier', n: 20, level: 1, at: false, x: 0, y: 0 }); }""")
            wait_frames(pg, 4)
            for d in DISTS:
                pg.evaluate(f"""() => {{ const s = window.__session; let x = 0, y = 0, n = 0; for (const a of s.world.s.ants) if (a.colony === s.world.s.mode.arena.teams[0].colony && a.hp > 0 && a.space === 0) {{ x += a.x; y += a.y; n++; }}
                    const r = s.view.surfaceRig; r.jumpTo(x / n, y / n, {d}); r.goalYaw = r.yaw = 0.6; }}""")
                wait_frames(pg, 4)
                lod = pg.evaluate("() => window.__session.surfaceAntStats.lod.slice()")
                path = f"{OUT}/strands{var}_d{int(d)}.png"
                pg.screenshot(path=path, timeout=1800000)
                print(f"strands {var} dist {d:.0f}: LOD close/mid/far {lod} -> {path}", flush=True)
                if GPU and d == DISTS[0]:
                    g = pg.evaluate("() => import('/src/dev/gpuBreakdown.ts').then((m) => new Promise((res) => m.measureGpu(window.__session, 4, res)))")
                    ants = {x['name']: round(x['ms']) for x in g.get('drawMs', []) if x['name'].startswith('ants')}
                    tris = {x['name']: x['tris'] for x in g.get('draws', []) if x['name'].startswith('ants')}
                    sh = next((x['ms'] for x in g['passes'] if x['name'].startswith('shadow')), 0)
                    print(f"   GPU frame {g['frameMs']:.0f} ms, shadows {sh:.0f}; ants draws ms {ants} tris {tris}", flush=True)
            b.close()


main()
