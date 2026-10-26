"""Renders of every species' nest entrances (claude/maps/02-spec-nest-entrances §5): a surface close-up and a
gameplay-zoom view of each colony's main entrance, an extra entrance dug out and one plugged, and the player's
nest from above (entrance tunnels, extra-entrance spots, daylight). Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/entrance_renders.py   (PAGES=0,1,2  ONLY=<view name parts>)
Screenshots: docs/maps/entrances/<species>_<view>.jpg
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "")
MAP = os.environ.get("MAP", "testPond")
GROUPS = [int(g) for g in os.environ.get("PAGES", "0,1,2").split(",")]  # (bash keeps its own GROUPS variable)
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "maps", "entrances")
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
        # the player's fresh nest: the main tunnel and the two marked extra-entrance spots
        if want(f"{sp[0]}_spots"):
            pg.evaluate("""() => { const s = window.__session; s.view.space = 'nest'; const g = s.world.nest(0); const e = g.entrances[0]; const p = g.hexCenter(e); const r = s.view.nestRig; r.jumpTo(p.x, p.y + 60, 330); r.pitchBias = 0.6; }""")
            pg.evaluate("window.__step(3, 1/30)")
            pg.screenshot(path=os.path.join(OUT, f"{sp[0]}_spots.jpg"), type="jpeg", quality=84)
            note(f"{'PASS' if not errs else 'FAIL'}  {sp[0]}_spots {errs[:2]}")
        # dig out both extra-entrance spots of every colony, then plug the second extra of colony 0
        pg.evaluate("""() => {
          const w = window.__session.world;
          for (const c of w.s.colonies) { const g = w.nest(c.id); for (const s of [...g.spots]) for (const q of s) g.completeHex(q); }
        }""")
        pg.evaluate("window.__session.loop.advance(60)")
        info = pg.evaluate("""() => {
          const w = window.__session.world;
          const c0 = w.s.colonies[0];
          if (c0.entrances[2]) { c0.entrances[2].shut = 1; }
          return w.s.colonies.map((c) => ({ sp: c.species, ents: c.entrances.map((e) => [e.sx, e.sy]), ctr: [c.nx, c.ny] }));
        }""")
        pg.evaluate("window.__session.loop.advance(40)")
        # rebuild the entrance meshes on the next frame (they refresh every 30 frames in play)
        rebuild = "() => { const s = window.__session; s.mounds.frame = 0; s.mounds.entrances.frame = 0; }"
        for ci, c in enumerate(info):
            if gi == 2 and ci == 3:
                continue  # lasius again
            name = c["sp"]
            for vn, (k, dist, pitch, yaw) in {"close": (0, 70, 0.32, 0.9), "zoom": (0, 230, 0.55, 0.9), "extra": (1, 60, 0.32, 2.2)}.items():
                if not want(f"{name}_{vn}") or k >= len(c["ents"]):
                    continue
                x, z = c["ents"][k]
                t1 = time.time()
                pg.evaluate(f"""() => {{ const s = window.__session; s.view.space = 'surface'; const r = s.view.surfaceRig; r.jumpTo({x}, {z}, {dist}); r.yaw = r.goalYaw = {yaw}; r.pitchBias = {pitch}; }}""")
                pg.evaluate(rebuild)
                pg.evaluate("window.__step(3, 1/30)")
                pg.screenshot(path=os.path.join(OUT, f"{name}_{vn}.jpg"), type="jpeg", quality=84)
                note(f"{'PASS' if not errs else 'FAIL'}  {name}_{vn}  ({time.time() - t1:.0f} s) {errs[:2]}")
            if ci == 0 and want(f"{name}_plugged") and len(c["ents"]) > 2:
                x, z = c["ents"][2]
                pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig; r.jumpTo({x}, {z}, 60); r.yaw = r.goalYaw = 0.4; r.pitchBias = 0.35; }}""")
                pg.evaluate(rebuild)
                pg.evaluate("window.__step(3, 1/30)")
                pg.screenshot(path=os.path.join(OUT, f"{name}_plugged.jpg"), type="jpeg", quality=84)
                note(f"{'PASS' if not errs else 'FAIL'}  {name}_plugged")
        # the player's nest from above: tunnels, the plugged one capped, daylight
        if want(f"{sp[0]}_nest"):
            pg.evaluate("""() => { const s = window.__session; s.view.space = 'nest'; const w = s.world; const g = w.nest(0); const e = g.entrances[0]; const p = g.hexCenter(e); const r = s.view.nestRig; r.jumpTo(p.x, p.y + 30, 260); r.pitchBias = 0.5; }""")
            pg.evaluate("window.__step(3, 1/30)")
            pg.screenshot(path=os.path.join(OUT, f"{sp[0]}_nest.jpg"), type="jpeg", quality=84)
            note(f"{'PASS' if not errs else 'FAIL'}  {sp[0]}_nest {errs[:2]}")
        ctx.close()
    b.close()

bad = [r for r in res if r.startswith("FAIL")]
print(f"{len([r for r in res if r.startswith('PASS')])} rendered, {len(bad)} failed")
raise SystemExit(1 if bad else 0)
