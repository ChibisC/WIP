"""The Trees layer (claude/trees/01-spec-trees-layer.md §9): stills of the canopy map, the ground with the trunks and
climb points, the TREES bar, a climb, a branch fight and a fall. Fails on page errors.

Run: BASE=http://127.0.0.1:5173/ python3 tests/browser/trees.py   (STAGES=canopy,ground,bar,climb,leaf,fight,fall,off; MAP=meadowPond)
Stills: docs/trees/shots/<stage>.jpg
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
STAGES = os.environ.get("STAGES", "canopy,ground,bar,climb,leaf,fight,fall,off").split(",")
MAP = os.environ.get("MAP", "meadowPond")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(__file__), "..", "..", "docs", "trees", "shots"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
errs = []


def wait_ready(pg, t0, limit=900):
    while time.time() - t0 < limit and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


# the sim-side setup of each still, run in the page: returns nothing or a message
SETUP = {
    # the canopy over a tree, from above
    "canopy": """() => { const s = window.__session; const w = s.world; const t = w.s.trees.trunks[0]; s.view.nestRig.jumpTo(t.x, t.y, 330); s.view.nestRig.pitchBias = 0.35; }""",
    # the ground: a trunk's foot with its climb points
    "ground": """() => { const s = window.__session; const w = s.world; const t = w.s.trees.trunks[0]; s.view.surfaceRig.jumpTo(t.x + 20, t.y + 40, 150); }""",
    # the whole UI with the TREES bar, from the ground
    "bar": """() => { const s = window.__session; const w = s.world; const t = w.s.trees.trunks[0]; s.view.surfaceRig.jumpTo(t.x, t.y, 420); }""",
    # a group sent up: marker on a branch, ants climbing the trunk (seen from the ground)
    "climb": """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const t = d.trunks[0]; const g = w.nestOf(63);
      const site = d.sites.find((x) => (d.comps.charCodeAt(x.q) - 48) === t.comp) || d.sites[0];
      const me = s.player; const e = t.climbs[0];
      for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen) { a.space = 0; a.x = e.sx + (e.sx - t.x) * 2 + (Math.random() - 0.5) * 30; a.y = e.sy + (e.sy - t.y) * 2 + (Math.random() - 0.5) * 30; a.state = 0; }
      w.touch();
      s.issue({ type: 'placeMarker', i: 0, space: 63, x: site.x, y: site.y });
      for (const gr of me.groups) s.issue({ type: 'assignGroup', group: gr.id, marker: 0 });
      s.view.surfaceRig.jumpTo(e.sx, e.sy, 120); }""",
    # ants out on a leaf by the marker, in the trees view
    "leaf": """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const t = d.trunks[0];
      const site = d.sites.find((x) => (d.comps.charCodeAt(x.q) - 48) === t.comp) || d.sites[0];
      const me = s.player; const g = w.nestOf(63);
      let n = 0; for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen && n++ < 18) { a.space = 63; const ang = n * 0.7; const r = 4 + n * 1.1; a.x = site.x + Math.cos(ang) * r; a.y = site.y + Math.sin(ang) * r; if (!g.isAirAt(a.x, a.y)) { a.x = site.x; a.y = site.y; } a.state = 0; }
      w.touch();
      s.issue({ type: 'placeMarker', i: 0, space: 63, x: site.x, y: site.y });
      for (const gr of me.groups) s.issue({ type: 'assignGroup', group: gr.id, marker: 0 });
      s.view.nestRig.jumpTo(site.x, site.y, 95); }""",
    # a fight on a narrow branch: my ants against a wolf spider on the twig
    "fight": """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const t = d.trunks[0];
      const site = d.sites.find((x) => (d.comps.charCodeAt(x.q) - 48) === t.comp) || d.sites[0];
      const me = s.player; const g = w.nestOf(63);
      let n = 0; for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen && n++ < 20) { a.space = 63; const ang = n * 0.9; const r = 3 + n * 0.9; a.x = site.x + Math.cos(ang) * r; a.y = site.y + Math.sin(ang) * r; if (!g.isAirAt(a.x, a.y)) { a.x = site.x; a.y = site.y; } a.state = 0; }
      w.touch();
      s.issue({ type: 'placeMarker', i: 0, space: 63, x: site.x, y: site.y });
      for (const gr of me.groups) s.issue({ type: 'assignGroup', group: gr.id, marker: 0 });
      s.spawnKind = 'wolfSpider';
      s.issue({ type: 'sandboxSpawn', kind: 'wolfSpider', space: 63, x: site.x + 14, y: site.y + 6 });
      s.view.nestRig.jumpTo(site.x, site.y, 110); }""",
    # a fall: an ant flung off the branch, seen from the ground below
    "fall": """() => { const s = window.__session; const w = s.world; const d = w.s.trees; const t = d.trunks[0];
      const site = d.sites.find((x) => (d.comps.charCodeAt(x.q) - 48) === t.comp) || d.sites[0];
      const me = s.player; const g = w.nestOf(63);
      let n = 0; for (const a of w.s.ants) if (a.colony === me.id && a.id !== me.queen && n++ < 6) { a.space = 63; a.x = site.x + n * 2; a.y = site.y; a.state = 0; }
      w.touch();
      s.issue({ type: 'sandboxSpawn', kind: 'stagBeetle', space: 63, x: site.x + 18, y: site.y + 4 });
      s.view.surfaceRig.jumpTo(site.x, site.y + 10, 170); }""",
}
# which view each still is taken in, and how many ticks run first
VIEW = {"canopy": ("trees", 10), "ground": ("surface", 10), "bar": ("surface", 10), "climb": ("surface", 140), "leaf": ("trees", 60), "fight": ("trees", 120), "fall": ("surface", 36), "off": ("surface", 10)}

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_context(viewport={"width": 1280, "height": 760}).new_page()
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text[:300]) if ("THREE.WebGLProgram" in m.text or m.type == "error") else None)
    for stage in STAGES:
        view, ticks = VIEW[stage]
        t0 = time.time()
        trees = "" if stage == "off" else "&trees=1"
        pg.goto(BASE + f"?play=1&mode=sandbox&species=formica&rival=lasius&seed=3&map={MAP}&creatures=0&titans=0&shot=1&nocine=1&q=high&ticks=1{trees}&view={view}", wait_until="load")
        wait_ready(pg, t0)
        pg.evaluate("window.__step(2, 0.05)")
        info = pg.evaluate("() => { const s = window.__session; return { on: s.treesOn, bar: !!document.querySelector('.mm-trees') && !document.querySelector('.mm-trees').hidden, inTrees: s.view.inTrees, ants: s.world.s.ants.length }; }")
        if stage in SETUP:
            pg.evaluate(SETUP[stage])
        pg.evaluate(f"window.__step({ticks}, 0.05)")
        pg.wait_for_timeout(300)
        after = pg.evaluate("() => { const s = window.__session; const w = s.world; return { inTrees: s.view.inTrees, trees: w.s.ants.filter((a) => a.space === 63).length, climbing: w.s.ants.filter((a) => a.trunkT > 0).length, flung: w.s.ants.filter((a) => a.fell || (a.fz > 0)).length, bar: document.querySelector('.mm-trees') ? document.querySelector('.mm-trees').hidden : 'none' }; }")
        pg.screenshot(path=os.path.join(OUT, f"{stage}.jpg"), type="jpeg", quality=88)
        print(f"{time.time() - t0:5.1f}s  {stage}: {info} -> {after}", flush=True)
    b.close()
print("errors:", errs[:6])
if errs:
    raise SystemExit(1)
