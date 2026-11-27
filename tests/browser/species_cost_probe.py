"""Performance v7: what each species costs to draw (the user: "lag especially with the Saiy-Ants"). One arena page; for
each caste in turn an army of N is dropped in for team 0 and held still (passive), the camera is put on it at a few
distances, and the frames are recorded: the frame interval (on SwiftShader the GPU's work: the CPU rasterizes),
the main thread's time and parts, draw calls, triangles and the ants' detail levels (LOD0 / LOD1 / impostor). Then
the army is cleared and the next caste comes. The same place, camera and count for each, so the costs compare.

  tests/browser/with_server.sh python3 tests/browser/species_cost_probe.py
      CASTES=aurimyrmex_soldier,fire_major,...  N=60  DISTS=50,120,300  FRAMES=5  VW=640 VH=400 Q=high
"""
import os
import statistics
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
CASTES = os.environ.get("CASTES", "aurimyrmex_soldier,aurimyrmex_worker,aurimyrmex_blaster,fire_major,fire_minor,lasius_soldier,atta_media,hell_soldier").split(",")
N = int(os.environ.get("N", "60"))
DISTS = [float(x) for x in os.environ.get("DISTS", "50,120,300").split(",")]
FRAMES = int(os.environ.get("FRAMES", "5"))
VW = int(os.environ.get("VW", "640"))
VH = int(os.environ.get("VH", "400"))
QUAL = os.environ.get("Q", "high")
# GPU=1: also the GPU breakdown at each distance (dev/gpuBreakdown.ts: every pass, then every draw, waited for — the
# ants' draws by detail level, their triangles and milliseconds)
GPU = os.environ.get("GPU", "") == "1"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

HOOK = """() => {
  const p = window.__prof;
  if (p.__sc) return;
  p.__sc = [];
  const end = p.end.bind(p);
  let last = 0;
  p.end = function () {
    const cpu = performance.now() - this.cpuStart;
    const now = performance.now();
    const cur = {};
    for (const k in this.cur) if (this.cur[k] > 0.5) cur[k] = +this.cur[k].toFixed(1);
    end();
    const s = window.__session;
    const st = s.surfAnts.stats;
    p.__sc.push({ gap: last ? now - last : 0, cpu, parts: cur, calls: p.frameCalls, tris: p.frameTris, lod: st.lod.slice(), drawn: st.drawn, links: this.lastGl ? this.lastGl.links : 0 });
    last = now;
  };
}"""


def frames_now(pg):
    return pg.evaluate("() => window.__prof.__sc.length")


def wait_frames(pg, k, limit=600):
    f0 = frames_now(pg)
    t0 = time.time()
    while frames_now(pg) - f0 < k and time.time() - t0 < limit:
        time.sleep(0.5)
    return pg.evaluate(f"() => window.__prof.__sc.slice({f0})")


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        pg = b.new_page(viewport={"width": VW, "height": VH})
        pg.set_default_timeout(1800000)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        t0 = time.time()
        pg.goto(BASE + f"?play=1&mode=arena&seed=3&nocine=1&q={QUAL}", wait_until="load")
        while time.time() - t0 < 1200 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        print(f"ready in {time.time() - t0:.0f} s", flush=True)
        pg.evaluate(HOOK)
        wait_frames(pg, 6, 900)  # (the GPU's queue after loading)
        print("frames flowing", flush=True)
        pg.evaluate("() => { const s = window.__session; for (const t of [0, 1]) s.issue({ type: 'arenaStance', team: t, stance: 2 }); }")
        rows = []
        gpurows = []
        for cs in CASTES:
            pg.evaluate(f"() => {{ const s = window.__session; s.issue({{ type: 'arenaClear', team: 0 }}); let n = {N}; while (n > 0) {{ const k = Math.min(50, n); s.issue({{ type: 'arenaSpawn', team: 0, unit: 'ant:{cs}', n: k, level: 1, at: false, x: 0, y: 0 }}); n -= k; }} }}")
            wait_frames(pg, 3)
            for d in DISTS:
                # (the camera on the army's middle)
                pg.evaluate(f"() => {{ const s = window.__session; let x = 0, y = 0, n = 0; for (const a of s.world.s.ants) if (a.colony === s.world.s.mode.arena.teams[0].colony && a.hp > 0 && a.space === 0) {{ x += a.x; y += a.y; n++; }} if (n) s.view.surfaceRig.jumpTo(x / n, y / n, {d}); }}")
                wait_frames(pg, 3)  # (the cut, the detail levels settling)
                fr = wait_frames(pg, FRAMES)
                gap = statistics.median([f["gap"] for f in fr])
                cpu = statistics.median([f["cpu"] for f in fr])
                tris = statistics.median([f["tris"] for f in fr])
                calls = statistics.median([f["calls"] for f in fr])
                lod = fr[-1]["lod"]
                rows.append((cs, d, gap, cpu, tris, calls, lod, fr[-1]["drawn"]))
                print(f"  {cs:22s} dist {d:5.0f}: frame {gap:7.0f} ms  main {cpu:6.1f} ms  tris {tris / 1000:7.0f}k  calls {calls:4.0f}  LOD0/1/imp {lod}  drawn {fr[-1]['drawn']}", flush=True)
                if GPU:
                    g = pg.evaluate("() => import('/src/dev/gpuBreakdown.ts').then((m) => new Promise((res) => m.measureGpu(window.__session, 4, res)))")
                    ants = {d2['name']: d2['ms'] for d2 in g.get('drawMs', []) if d2['name'].startswith('ants')}
                    atris = {d2['name']: d2['tris'] for d2 in g.get('draws', []) if d2['name'].startswith('ants')}
                    passes = ", ".join(f"{x['name']} {x['ms']:.0f}" for x in g['passes'][:5])
                    print(f"      GPU frame {g['frameMs']:.0f} ms [{passes}] ants draws ms {ants} tris {atris}", flush=True)
                    gpurows.append((cs, d, g['frameMs'], sum(ants.values()), sum(atris.values())))
        b.close()
    print("\nby distance (frame ms, relative to fire_major):")
    for d in DISTS:
        ref = next((r for r in rows if r[0] == "fire_major" and r[1] == d), None)
        for r in [r for r in rows if r[1] == d]:
            rel = f"{r[2] / ref[2]:.2f}×" if ref and ref[2] else ""
            print(f"  dist {d:5.0f} {r[0]:22s} {r[2]:7.0f} ms {rel:7s} tris {r[4] / 1000:6.0f}k")
    if GPU:
        print("\nGPU (every draw waited for): the ants' draws, ms a frame and triangles")
        for r in gpurows:
            print(f"  dist {r[1]:5.0f} {r[0]:22s} frame {r[2]:7.0f} ms  ants {r[3]:7.0f} ms  {r[4] / 1000:6.0f}k tris")
    print("page errors:", errs[:3])


main()
