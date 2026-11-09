"""Story camera flights (performance v4, claude/performance/04-spec-performance-v4-on-screen-spikes-story.md §4): each
chapter 1 level's opening flight in the real page, drawn (shader programs and textures made during the flight are what
stutters on a real GPU), from its first frame to the camera's return. For each level: frames, the main thread's
slowest frames and their parts, shader links, texture and buffer uploads and the profiler's notes during the flight.
SwiftShader draws on the CPU here: the frame times are long; links, uploads and the main thread's parts carry over.

  tests/browser/with_server.sh python3 tests/browser/story_flights.py      (LEVELS=garden,longNights,... OUT=f.json)
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
LEVELS = os.environ.get("LEVELS", "garden,longNights,fireBanks,spiderMother,antleredKing,highWater,cartonKingdom").split(",")
OUT = os.environ.get("OUT", "")
VW = int(os.environ.get("VW", "320"))
VH = int(os.environ.get("VH", "200"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

HOOK = """() => {
  const p = window.__prof;
  p.__rec = [];
  const end = p.end.bind(p);
  p.end = function () {
    const s = window.__session;
    if (s && s.cine) {
      const cur = {};
      for (const k in this.cur) if (this.cur[k] > 1) cur[k] = +this.cur[k].toFixed(1);
      const g = this.gl;
      p.__rec.push({ cpu: +(performance.now() - this.cpuStart).toFixed(1), parts: cur, links: g.links, tex: g.texUploads, buf: +(g.bufBytes / 1048576).toFixed(2), notes: this.notes.slice(0, 3) });
    }
    end();
  };
}"""

res = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    for lv in LEVELS:
        pg = b.new_page(viewport={"width": VW, "height": VH})
        pg.set_default_timeout(1800000)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE + f"?story={lv}&diff=normal&seed=7&q=low", wait_until="load")
        pg.wait_for_function("window.__ready === true", timeout=1800000)
        pg.evaluate(HOOK)
        # the flight starts on the story's first ticks; then wait for its end (at most 3 minutes here)
        started = False
        t0 = time.time()
        while time.time() - t0 < 60:
            if pg.evaluate("() => !!window.__session.cine"):
                started = True
                break
            time.sleep(0.5)
        t1 = time.time()
        while started and time.time() - t1 < 180 and pg.evaluate("() => !!window.__session.cine"):
            time.sleep(1)
        rec = pg.evaluate("() => window.__prof.__rec")
        slow = sorted(rec, key=lambda f: -f["cpu"])[:4]
        r = {
            "started": started,
            "frames": len(rec),
            "links": sum(f["links"] for f in rec),
            "tex": sum(f["tex"] for f in rec),
            "bufMB": round(sum(f["buf"] for f in rec), 2),
            "cpuAvg": round(sum(f["cpu"] for f in rec) / max(1, len(rec)), 1),
            "slowest": [{"cpu": f["cpu"], "parts": f["parts"], "links": f["links"], "tex": f["tex"], "notes": f["notes"]} for f in slow],
            "errors": errs[:2],
        }
        res[lv] = r
        print(lv, json.dumps(r), flush=True)
        pg.close()
    b.close()
if OUT:
    json.dump(res, open(OUT, "w"), indent=1)
