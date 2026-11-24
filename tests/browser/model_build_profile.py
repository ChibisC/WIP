"""Performance v6: a CPU profile of building ant models after loading (where a first model of a species spends its
seconds). Opens an empty arena, starts the DevTools CPU profiler, builds MORPHS in the surface renderer, and prints the
functions with the most self time and the most total time.

  tests/browser/with_server.sh python3 tests/browser/model_build_profile.py   MORPHS=fire_minor,fire_major  TOP=30
"""
import os
import time
from collections import defaultdict
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
MORPHS = os.environ.get("MORPHS", "fire_minor,fire_major").split(",")
TOP = int(os.environ.get("TOP", "30"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        pg = b.new_page(viewport={"width": 640, "height": 400})
        t0 = time.time()
        pg.goto(BASE + "?play=1&mode=arena&seed=3&nocine=1&q=high", wait_until="load")
        while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        time.sleep(5)
        cdp = pg.context.new_cdp_session(pg)
        cdp.send("Profiler.enable")
        cdp.send("Profiler.setSamplingInterval", {"interval": 200})
        cdp.send("Profiler.start")
        ms = pg.evaluate("(ms) => { const r = window.__session.surfAnts; const out = []; for (const m of ms) { const t0 = performance.now(); r.prepare([m]); out.push([m, Math.round(performance.now() - t0)]); } return out; }", MORPHS)
        prof = cdp.send("Profiler.stop")["profile"]
        b.close()
    print("builds:", ms)
    nodes = {n["id"]: n for n in prof["nodes"]}
    parent = {}
    for n in prof["nodes"]:
        for c in n.get("children", []):
            parent[c] = n["id"]
    dt = defaultdict(float)
    samples = prof["samples"]
    deltas = prof["timeDeltas"]
    for sid, d in zip(samples, deltas):
        dt[sid] += d / 1000.0
    selft = defaultdict(float)
    tot = defaultdict(float)

    def name(n):
        cf = n["callFrame"]
        return f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1].split('?')[0]}:{cf['lineNumber'] + 1}"

    for sid, t in dt.items():
        n = nodes[sid]
        selft[name(n)] += t
        seen = set()
        cur = sid
        while cur in nodes:
            nm = name(nodes[cur])
            if nm not in seen:
                tot[nm] += t
                seen.add(nm)
            cur = parent.get(cur)
            if cur is None:
                break
    print("\nself time (ms):")
    for k, v in sorted(selft.items(), key=lambda kv: -kv[1])[:TOP]:
        print(f"  {v:8.0f}  {k}")
    print("\ntotal time (ms):")
    for k, v in sorted(tot.items(), key=lambda kv: -kv[1])[:TOP]:
        print(f"  {v:8.0f}  {k}")


main()
