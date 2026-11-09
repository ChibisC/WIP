"""Performance v4 (claude/performance/04-spec-performance-v4-on-screen-spikes-story.md §1): a recorded stretch of normal
play in the real page, every frame's main-thread time and its parts kept (the profiler's own numbers, core/profiler.ts),
to find the frames over 33 ms and what was in them. Run it with the trees on and off on the same seed.

  tests/browser/with_server.sh python3 tests/browser/spike_session.py
      Q="play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1"  (the game)
      TREES=1 (adds trees=1)  SECS=90 (recorded)  WARM=20  PAN=1 (the camera pans now and then)  VW=480 VH=300
      OUT=report.json  NORENDER=1 (the GL draw calls stubbed out: the main thread's own work at full frame rate)
      SUBS=1 (time each surface renderer's update on its own: surfAnts, surfFood, surfBars, …)

Prints the count of frames whose main-thread time is over 33 ms and 50 ms, the parts of each (largest first) with the
GL work and garbage-collection drops in them, and a per-part summary (frames where the part alone was over 8 ms).
SwiftShader draws on the CPU here, so the frame times are long; the main thread's own parts are what to read.
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
Q = os.environ.get("Q", "play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1")
TREES = os.environ.get("TREES", "") == "1"
SECS = float(os.environ.get("SECS", "90"))
WARM = float(os.environ.get("WARM", "20"))
PAN = os.environ.get("PAN", "1") == "1"
VW = int(os.environ.get("VW", "480"))
VH = int(os.environ.get("VH", "300"))
OUT = os.environ.get("OUT", "")
NORENDER = os.environ.get("NORENDER", "") == "1"
SUBS = os.environ.get("SUBS", "1") == "1"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

# every frame: the main thread's time, its parts over 0.5 ms, GL work and a heap drop
HOOK = """() => {
  const p = window.__prof;
  if (p.__rec) return;
  p.__rec = [];
  const end = p.end.bind(p);
  let heap = 0;
  p.end = function () {
    const cur = {};
    for (const k in this.cur) if (this.cur[k] > 0.5) cur[k] = +this.cur[k].toFixed(1);
    const g = this.gl;
    const cpu = performance.now() - this.cpuStart;
    const mem = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const gc = heap && mem < heap - 2 * 1048576 ? +((heap - mem) / 1048576).toFixed(1) : 0;
    heap = mem;
    const notes = this.notes.slice(0, 4);
    end();
    const subs = {};
    if (window.__subs) { for (const k in window.__subs) if (window.__subs[k] > 0.5) subs[k] = +window.__subs[k].toFixed(1); window.__subs = {}; }
    const sim = window.__session && window.__session.sim;
    const tk = sim ? sim.tickMs : 0;
    const tick = window.__session ? window.__session.world.s.tick : 0;
    if (p.__on) p.__rec.push({ t: +(performance.now() / 1000).toFixed(2), cpu: +cpu.toFixed(1), tickMs: +tk.toFixed(1), tick, parts: cur, subs, links: g.links, tex: g.texUploads, buf: +(g.bufBytes / 1048576).toFixed(2), gc, notes });
  };
}"""

# the session's per-space renderers, each update timed on its own (its ms added to the frame's record as "sub:<name>")
SUBJS = """() => {
  const s = window.__session;
  window.__subs = {};
  const names = ['surfAnts', 'surfFood', 'surfBars', 'surfDecor', 'surfCreatures', 'mounds', 'teamRings', 'digRings', 'surfMarkers', 'surfTrail', 'surfHit', 'surfCombat', 'surfFx', 'treeDecor'];
  for (const n of names) {
    const o = s[n];
    if (!o || typeof o.update !== 'function' || o.__timed) continue;
    const f = o.update.bind(o);
    o.__timed = true;
    o.update = (...a) => { const t = performance.now(); const r = f(...a); window.__subs[n] = (window.__subs[n] || 0) + performance.now() - t; return r; };
  }
  for (const [sp, nv] of s.nests) {
    if (nv.__timed) continue;
    nv.__timed = true;
    const f = nv.update.bind(nv);
    nv.update = (...a) => { const t = performance.now(); const r = f(...a); window.__subs['nestView' + sp] = (window.__subs['nestView' + sp] || 0) + performance.now() - t; return r; };
    const h = nv.updateHexes.bind(nv);
    nv.updateHexes = (...a) => { const t = performance.now(); const r = h(...a); window.__subs['hexes' + sp] = (window.__subs['hexes' + sp] || 0) + performance.now() - t; return r; };
  }
}"""

PANJS = """(k) => {
  const r = window.__session.view.surfaceRig;
  const t = window.__session.world.terrain;
  const a = k * 1.7;
  r.goal.x = t.width * (0.5 + 0.32 * Math.cos(a));
  r.goal.z = t.depth * (0.5 + 0.32 * Math.sin(a));
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": VW, "height": VH})
    pg.set_default_timeout(1800000)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    url = BASE + "?" + Q + ("&trees=1" if TREES else "") + "&q=low"
    pg.goto(url, wait_until="load")
    pg.wait_for_function("window.__ready === true", timeout=1800000)
    pg.evaluate(HOOK)
    if SUBS:
        pg.evaluate(SUBJS)
    if NORENDER:
        pg.evaluate("() => { const r = window.__session.view.renderer; r.render = function () {}; }")
    time.sleep(WARM)
    pg.evaluate("() => { window.__prof.__rec.length = 0; window.__prof.__on = true; }")
    t0 = time.time()
    k = 0
    while time.time() - t0 < SECS:
        time.sleep(min(6, SECS - (time.time() - t0)) if SECS - (time.time() - t0) > 0 else 0)
        if PAN:
            k += 1
            pg.evaluate(PANJS, k)
    rec = pg.evaluate("() => { window.__prof.__on = false; return window.__prof.__rec; }")
    info = pg.evaluate("() => ({ ants: __session.world.s.ants.length, creatures: __session.world.s.creatures.length, trees: !!__session.world.s.trees, tick: __session.world.s.tick })")
    b.close()

n = len(rec)
over33 = [f for f in rec if f["cpu"] > 33]
over50 = [f for f in rec if f["cpu"] > 50]
avg = sum(f["cpu"] for f in rec) / max(1, n)
print(f"{'trees on' if TREES else 'trees off'}: {n} frames in {SECS:.0f} s · main thread avg {avg:.1f} ms · over 33 ms {len(over33)}, over 50 ms {len(over50)} · {info}")
by = {}
for f in rec:
    for p, ms in f["parts"].items():
        s = by.setdefault(p, [0, 0.0, 0.0])
        s[1] += ms
        if ms > 8:
            s[0] += 1
        s[2] = max(s[2], ms)
# the worker's tick time as each new frame arrived (a tick over 40 ms delays the next state; worker mode)
ticks = {}
for f in rec:
    ticks[f["tick"]] = max(ticks.get(f["tick"], 0), f["tickMs"])
slow = sorted(((t, ms) for t, ms in ticks.items() if ms > 40), key=lambda x: -x[1])
print(f"sim: {len(ticks)} ticks seen, avg {sum(ticks.values()) / max(1, len(ticks)):.1f} ms, over 40 ms {len(slow)}: " + ", ".join(f"#{t} {ms:.0f}" for t, ms in slow[:12]))
print("parts: " + ", ".join(f"{p} avg {v[1] / max(1, n):.2f} max {v[2]:.0f} (over 8 ms in {v[0]})" for p, v in sorted(by.items(), key=lambda kv: -kv[1][1])))
sb = {}
for f in rec:
    for p, ms in f.get("subs", {}).items():
        x = sb.setdefault(p, [0, 0.0, 0.0])
        x[1] += ms
        x[2] = max(x[2], ms)
        if ms > 8:
            x[0] += 1
if sb:
    print("renderers: " + ", ".join(f"{p} avg {v[1] / max(1, n):.2f} max {v[2]:.0f} (over 8 ms in {v[0]})" for p, v in sorted(sb.items(), key=lambda kv: -kv[1][1])))
for f in sorted(over33, key=lambda f: -f["cpu"])[:25]:
    parts = ", ".join(f"{p} {ms:.0f}" for p, ms in sorted(f["parts"].items(), key=lambda kv: -kv[1]) if ms > 2)
    subs = ", ".join(f"{p} {ms:.0f}" for p, ms in sorted(f.get("subs", {}).items(), key=lambda kv: -kv[1]) if ms > 2)
    if subs:
        parts += " [" + subs + "]"
    extra = " ".join(x for x in [f"links {f['links']}" if f["links"] else "", f"tex {f['tex']}" if f["tex"] else "", f"buf {f['buf']} MB" if f["buf"] > 0.25 else "", f"GC {f['gc']} MB" if f["gc"] else ""] if x)
    print(f"  {f['t']:.1f} s  {f['cpu']:.0f} ms: {parts} {extra} {'; '.join(f['notes'])}")
print("page errors:", errors[:3])
if OUT:
    with open(OUT, "w") as fh:
        json.dump({"trees": TREES, "q": Q, "info": info, "frames": rec}, fh)
