"""Performance v6 (claude/performance/06-spec-performance-v6-no-hitches-ever.md §4): the hitch hunter. Plays each mode
like a person — drops armies in the arena and watches the fight close up to its end, pans and zooms over a big
match, dives underground and back, climbs into the trees, speeds the game up — and fails on any frame after loading
that did first-time work or took too long:

  * a shader program linked (anything compiled in play is a freeze on a Mac or an iPhone: everything a mode can show is
    compiled while loading);
  * a texture upload over 2 MB in one frame (new textures are made while loading; play only refreshes small ones);
  * the main thread's own time over 50 ms.

SwiftShader draws on the CPU here, so a frame's interval is the GPU's queue, not the game: the main thread's time,
the uploads and the compiles are what it reads. On a real machine the in-game lag recorder (menu → Graphics →
"Copy lag report") is the same check.

  tests/browser/with_server.sh python3 tests/browser/hitch_hunter.py            every scene (about 25 minutes here)
      SCEN=arena,skirmish  (some)  LIMIT=50 (ms)  TEX_MB=2  VW=640 VH=400  Q=high  OUT=report.json

Prints each scene's frames over the limits with what was in them (the profiler's parts, notes, GL work) and exits 1
when any scene failed.
"""
import json
import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
LIMIT = float(os.environ.get("LIMIT", "50"))
TEX_MB = float(os.environ.get("TEX_MB", "2"))
VW = int(os.environ.get("VW", "640"))
VH = int(os.environ.get("VH", "400"))
QUAL = os.environ.get("Q", "high")
OUT = os.environ.get("OUT", "")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

# the page's helpers: the camera moved as a person scrolls (the rig's goal, eased), the armies, the areas
HELPERS = """() => {
  const s = window.__session;
  const H = window.__hh = {};
  H.rig = () => (s.view.space === 'nest' ? s.view.nestRig : s.view.surfaceRig);
  H.look = (x, z, dist) => { const r = H.rig(); if (x !== null) r.goal.set(x, r.goal.y, z); r.goalDistance = dist; };
  H.orbit = (da) => { const r = H.rig(); r.goalYaw = (r.goalYaw ?? r.yaw) + da; };
  H.centre = () => { const t = s.world.terrain; return [t.width / 2, t.depth / 2]; };
  // the arena: a team's army (in fifties: the arena's most a drop)
  H.army = (team, unit, n) => { while (n > 0) { const k = Math.min(50, n); s.issue({ type: 'arenaSpawn', team, unit, n: k, level: 1, at: false, x: 0, y: 0 }); n -= k; } };
  H.stance = (team, st) => s.issue({ type: 'arenaStance', team, stance: st });
  // where the ants are thickest (the fight)
  H.fight = () => { let x = 0, y = 0, n = 0; for (const a of s.world.s.ants) if (a.space === 0 && a.hp > 0) { x += a.x; y += a.y; n++; } return n ? [x / n, y / n] : H.centre(); };
  H.toFight = (dist) => { const [x, y] = H.fight(); H.look(x, y, dist); };
  H.toggleView = () => s.toggleView();
  H.trees = () => s.toggleTrees();
  H.speed = (k) => s.setSpeed(k);
  H.over = () => { const A = s.world.s.mode.arena; return !!(A && A.winner >= 0); };
}"""

# each scene: the page, then (seconds after recording starts, what the person does)
SCENES = {
    "arena": (
        "play=1&mode=arena&seed=3&nocine=1",
        [
            # (8x from the start: a frame here is 1-5 s and moves the game 0.25 s at most at 1x — the fight must happen)
            (0, "H.speed(8)"),
            (1, "H.army(0, 'ant:fire_minor', 35); H.army(0, 'ant:fire_major', 10); H.army(1, 'ant:fire_minor', 35); H.army(1, 'ant:fire_major', 10); H.stance(0, 0); H.stance(1, 0)"),
            (4, "H.toFight(220)"),
            (10, "H.toFight(70)"),
            (16, "H.toFight(40); H.orbit(0.8)"),
            (22, "H.army(0, 'ant:nasute_soldier', 20); H.army(1, 'ant:rhy_soldier', 20)"),
            (26, "H.toFight(60)"),
            (32, "H.army(0, 'ant:aurimyrmex_blaster', 6); H.army(1, 'ant:hell_soldier', 10)"),
            (36, "H.toFight(50); H.orbit(-1.2)"),
            (44, "H.toFight(300)"),
            (50, "H.toFight(80)"),
        ],
        90,
    ),
    "skirmish": (
        "play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1",
        [
            (1, "H.look(null, null, 120)"),
            (6, "{ const [x, z] = H.centre(); H.look(x * 0.6, z * 0.7, 260); }"),
            (12, "{ const [x, z] = H.centre(); H.look(x * 1.4, z * 1.2, 90); }"),
            (18, "H.toggleView()"),
            (26, "H.look(null, null, 60)"),
            (32, "H.toggleView()"),
            (40, "H.speed(4)"),
            (46, "{ const [x, z] = H.centre(); H.look(x, z, 400); }"),
            (54, "H.speed(1); H.look(null, null, 50)"),
        ],
        64,
    ),
    "trees": (
        "play=1&seed=3&map=meadowPond&species=lasius&rival=formica,solenopsis,atta&developed=6&nocine=1&trees=1",
        [
            (1, "H.look(null, null, 150)"),
            (6, "H.trees()"),
            (16, "H.look(null, null, 80)"),
            (24, "H.trees()"),
            (32, "H.look(null, null, 250)"),
        ],
        40,
    ),
    "story": (
        "story=longNights&diff=normal&night=3&nocine=1&seed=7",
        [
            (1, "H.look(null, null, 140)"),
            (8, "H.speed(4)"),
            (20, "H.look(null, null, 60)"),
            (30, "H.speed(1)"),
        ],
        40,
    ),
}

HOOK = """() => {
  const p = window.__prof;
  if (p.__hh) return;
  p.__hh = [];
  const end = p.end.bind(p);
  p.end = function () {
    const cur = {};
    for (const k in this.cur) if (this.cur[k] > 1) cur[k] = +this.cur[k].toFixed(1);
    const g = this.gl;
    const cpu = performance.now() - this.cpuStart;
    const rec = { t: +(performance.now() / 1000).toFixed(2), cpu: +cpu.toFixed(1), links: g.links, compiles: g.compiles, texMB: +(g.texBytes / 1048576).toFixed(2), tex: g.texUploads, parts: cur, notes: this.notes.slice(0, 6) };
    end();
    if (p.__on) p.__hh.push(rec);
  };
}"""


def run_scene(pw, name, query, steps, secs):
    b = pw.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": VW, "height": VH})
    pg.set_default_timeout(1800000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    t0 = time.time()
    pg.goto(BASE + "?" + query + f"&q={QUAL}", wait_until="load")
    while time.time() - t0 < 1200 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    ready = time.time() - t0
    # (SwiftShader: the GPU's queue after loading can take minutes — wait until frames flow)
    tq = time.time()
    f0 = pg.evaluate("() => window.__prof.frame")
    while time.time() - tq < 900:
        time.sleep(3)
        if pg.evaluate("() => window.__prof.frame") - f0 >= 6:
            break
    pg.evaluate(HELPERS)
    pg.evaluate(HOOK)
    pg.evaluate("() => { window.__prof.__on = true; }")
    t1 = time.time()
    k = 0
    while time.time() - t1 < secs:
        while k < len(steps) and time.time() - t1 >= steps[k][0]:
            try:
                pg.evaluate("() => { const H = window.__hh; " + steps[k][1] + "; }")
            except Exception as e:  # a step that does not apply here (no arena, no trees) is skipped
                errs.append(f"step {steps[k][1][:40]}: {str(e)[:80]}")
            k += 1
        time.sleep(0.25)
    rec = pg.evaluate("() => { window.__prof.__on = false; return window.__prof.__hh; }")
    b.close()
    bad = [r for r in rec if r["cpu"] > LIMIT or r["links"] > 0 or r["texMB"] > TEX_MB]
    return {"scene": name, "ready": round(ready), "frames": len(rec), "bad": bad, "worst": max((r["cpu"] for r in rec), default=0), "errors": errs[:4]}


def main():
    names = [n for n in os.environ.get("SCEN", ",".join(SCENES)).split(",") if n]
    out = []
    with sync_playwright() as pw:
        for n in names:
            q, steps, secs = SCENES[n]
            r = run_scene(pw, n, q, steps, secs)
            out.append(r)
            mark = "FAIL" if r["bad"] else "ok"
            print(f"{mark:4s} {n}: {r['frames']} frames in play (ready in {r['ready']} s), worst main thread {r['worst']} ms, {len(r['bad'])} frames over the limits", flush=True)
            for f in sorted(r["bad"], key=lambda f: -f["cpu"])[:12]:
                parts = ", ".join(f"{k} {v}" for k, v in sorted(f["parts"].items(), key=lambda kv: -kv[1])[:6])
                gl = " ".join(x for x in [f"links {f['links']}" if f["links"] else "", f"tex {f['tex']} ({f['texMB']} MB)" if f["tex"] else ""] if x)
                print(f"       {f['cpu']:7.1f} ms  {gl}  | {parts} | {'; '.join(f['notes'])[:200]}")
            if r["errors"]:
                print("       page errors:", r["errors"])
    if OUT:
        json.dump(out, open(OUT, "w"))
    sys.exit(1 if any(r["bad"] for r in out) else 0)


main()
