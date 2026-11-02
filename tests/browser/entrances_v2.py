"""Renders of every species' anthill and nest entrance after the one-entrance rework (user spec 2026-11-01: one wide
7-hex entrance underground, three surface holes per anthill). For each colony: the anthill close up and at gameplay
zoom on the surface, and its nest's entrance close up and at gameplay zoom underground; plus the surface minimap
(a queen crown and three hole dots per anthill). Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/entrances_v2.py   (PAGES=0,1,2  ONLY=<view name parts>)
Screenshots: docs/maps/entrances-v2/<species>_<view>.jpg
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "")
MAP = os.environ.get("MAP", "testPond")
GROUPS = [int(g) for g in os.environ.get("PAGES", "0,1,2").split(",")]  # (bash keeps its own GROUPS variable)
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "maps", "entrances-v2")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)

# four colonies a page (the test map has four sites): the player first, then rivals
PAGES = [
    ["lasius", "formica", "atta", "solenopsis"],
    ["eciton", "plagiaria", "hell", "aurimyrmex"],
    ["termant", "nasutitermes", "rhynchotermes", "lasius"],
]

res = []


def note(r):
    res.append(r)
    print(r, flush=True)


def want(name):
    return not ONLY or any(o in name for o in ONLY.split(","))


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    for gi in GROUPS:
        sp = PAGES[gi]
        ctx = b.new_context(viewport={"width": 1280, "height": 760})
        errs = []
        pg = ctx.new_page()
        pg.set_default_timeout(900000)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
        t0 = time.time()
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=high&seed=3&creatures=0&teams=4&map={MAP}&species={sp[0]}&rival={','.join(sp[1:])}&ticks=40", wait_until="load")
        while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        note(f"loaded {','.join(sp)} in {time.time() - t0:.0f} s")
        # a minute of play: ants coming and going through the holes
        pg.evaluate("window.__session.loop.advance(60 * 20)")
        info = pg.evaluate("""() => {
          const w = window.__session.world;
          return w.s.colonies.map((c) => {
            const n = c.entrances.length;
            const x = c.entrances.reduce((s, e) => s + e.sx / n, 0);
            const y = c.entrances.reduce((s, e) => s + e.sy / n, 0);
            const far = Math.max(...c.entrances.map((e) => Math.hypot(e.sx - x, e.sy - y)));
            return { id: c.id, sp: c.species, ctr: [x, y], far, holes: n, through: c.entrances.map((e) => e.n || 0) };
          });
        }""")
        rebuild = "() => { const s = window.__session; s.mounds.frame = 0; s.mounds.entrances.frame = 0; }"
        for ci, c in enumerate(info):
            if gi == 2 and ci == 3:
                continue  # lasius again
            name = c["sp"]
            note(f"     {name}: {c['holes']} holes, {c['far']:.0f} mm from the anthill's centre, traffic {c['through']}")
            x, z = c["ctr"]
            for vn, (dist, pitch, yaw) in {"close": (max(75, c["far"] * 3.6), 0.34, 0.9), "zoom": (230, 0.55, 0.9)}.items():
                if not want(f"{name}_{vn}"):
                    continue
                t1 = time.time()
                pg.evaluate(f"""() => {{ const s = window.__session; s.view.space = 'surface'; const r = s.view.surfaceRig; r.jumpTo({x}, {z}, {dist}); r.yaw = r.goalYaw = {yaw}; r.pitchBias = {pitch}; }}""")
                pg.evaluate(rebuild)
                pg.evaluate("window.__step(3, 1/30)")
                pg.screenshot(path=os.path.join(OUT, f"{name}_{vn}.jpg"), type="jpeg", quality=84)
                note(f"{'PASS' if not errs else 'FAIL'}  {name}_{vn}  ({time.time() - t1:.0f} s) {errs[:2]}")
            # underground: the nest's one wide entrance, close up and at gameplay zoom
            for vn, (k, pitch) in {"nestclose": (13, 0.62), "nestzoom": (30, 0.55)}.items():
                if not want(f"{name}_{vn}"):
                    continue
                ok = pg.evaluate(f"""() => {{
                  const s = window.__session; const w = s.world; const space = {c['id']} + 1;
                  const nv = s.nests.get(space); if (!nv) return false;
                  s.viewedArea = space; s.view.setActiveNest(space); s.view.space = 'nest';
                  const g = w.nestOf(space); const q = g.entrances[0]; const p = g.hexCenter(q); const r = s.view.nestRig;
                  r.jumpTo(p.x, p.y + g.R * 0.6, g.R * {k}); r.pitchBias = {pitch};
                  return true; }}""")
                if not ok:
                    note(f"SKIP  {name}_{vn} (no nest view)")
                    continue
                pg.evaluate("window.__step(4, 1/30)")
                pg.screenshot(path=os.path.join(OUT, f"{name}_{vn}.jpg"), type="jpeg", quality=84)
                note(f"{'PASS' if not errs else 'FAIL'}  {name}_{vn} {errs[:2]}")
        # the surface minimap: a crown at each anthill's centre, three dots on its holes
        if want("minimap") and gi == 0:
            pg.goto(BASE + f"?play=1&shot=1&q=high&seed=3&creatures=0&teams=4&map={MAP}&species={sp[0]}&rival={','.join(sp[1:])}&ticks=40", wait_until="load")
            t0 = time.time()
            while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
                time.sleep(0.5)
            pg.evaluate("() => { const s = window.__session; s.view.space = 'surface'; }")
            pg.evaluate("window.__step(6, 1/30)")
            pg.screenshot(path=os.path.join(OUT, "minimap.jpg"), type="jpeg", quality=84)
            note(f"{'PASS' if not errs else 'FAIL'}  minimap {errs[:2]}")
        ctx.close()
    b.close()

bad = [r for r in res if r.startswith("FAIL")]
print(f"{len([r for r in res if r.startswith('PASS')])} rendered, {len(bad)} failed")
raise SystemExit(1 if bad else 0)
