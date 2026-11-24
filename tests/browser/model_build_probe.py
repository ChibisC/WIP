"""Performance v6: what building each ant model costs after loading (the arena's spawn freeze: a model built in the
frame its first ant is drawn). Opens an empty arena, then builds every caste the arena panel can spawn in the surface
renderer, one at a time, and prints each build's time and the GL work in it.

  tests/browser/with_server.sh python3 tests/browser/model_build_probe.py   (VW=640 VH=400 Q=high)
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
VW = int(os.environ.get("VW", "640"))
VH = int(os.environ.get("VH", "400"))
QUAL = os.environ.get("Q", "high")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

PROBE = """async () => {
  const s = window.__session;
  const r = s.surfAnts;
  const p = window.__prof;
  const out = [];
  const list = s.spawnableMorphs ? s.spawnableMorphs() : [];
  for (const m of list) {
    if (r.has(m)) { out.push({ m, ms: -1 }); continue; }
    const g0 = { links: p.gl.links, tex: p.gl.texUploads };
    const t0 = performance.now();
    r.prepare([m]);
    const ms = performance.now() - t0;
    out.push({ m, ms: +ms.toFixed(0), notes: p.notes.slice(-2) });
    await new Promise((res) => setTimeout(res, 0));
  }
  return out;
}"""


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        pg = b.new_page(viewport={"width": VW, "height": VH})
        t0 = time.time()
        pg.goto(BASE + f"?play=1&mode=arena&seed=3&nocine=1&q={QUAL}", wait_until="load")
        while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        print(f"ready in {time.time() - t0:.0f} s", flush=True)
        time.sleep(5)
        res = pg.evaluate(PROBE)
        b.close()
    tot = 0
    for x in res:
        if x["ms"] >= 0:
            tot += x["ms"]
        print(f"  {x['m']:28s} {x['ms']:6d} ms  {' | '.join(x.get('notes', []))[:160]}")
    print(f"total {tot} ms for {sum(1 for x in res if x['ms'] >= 0)} models ({sum(1 for x in res if x['ms'] < 0)} already built)")


main()
