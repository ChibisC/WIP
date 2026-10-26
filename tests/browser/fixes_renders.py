"""Renders for the 2026-10-25 fixes (user notes): the Nasute and Sickle-Jaw workers side by side (model kit v2.2),
the Sickle-Jaw guard line along the workers' route, ants planted round a centipede (with the F3 hitbox overlay),
and undiggable stone in the nest. Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/fixes_renders.py   (ONLY=<name part> for one scene)
Screenshots: docs/creatures/fixes-renders/
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "fixes-renders")
ONLY = os.environ.get("ONLY", "")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
res = []


def note(r):
    res.append(r)
    print(r, flush=True)


def wait_ready(pg, t=300):
    t0 = time.time()
    while time.time() - t0 < t and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


def page(ctx, errs):
    pg = ctx.new_page()
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
    return pg


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1200, "height": 700})

    # ---- the two workers, same scale (kit v2.2)
    for cam in ["side", "top", "34"]:
        name = f"workers_{cam}"
        if ONLY and ONLY not in name:
            continue
        errs = []
        pg = page(ctx, errs)
        pg.goto(BASE + f"?scene=antlab&ants=termite_worker,termite_rhy_worker&cam={cam}&lod=0", wait_until="load")
        wait_ready(pg, 120)
        time.sleep(4)
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        note(f"{'PASS' if not errs else 'FAIL'}  {name} {errs[:2]}")
        pg.close()

    # ---- the Sickle-Jaw guard line: a leaf-litter patch 140 mm out, workers and soldiers sent to it
    if not ONLY or ONLY in "guard_line":
        errs = []
        pg = page(ctx, errs)
        pg.goto(BASE + "?play=1&shot=1&noui=1&q=low&seed=5&creatures=0&species=rhynchotermes&rival=lasius&battle=rhy_soldier:20", wait_until="load")
        wait_ready(pg)
        info = pg.evaluate("""async () => {
          const { placeLitter } = await import('/src/sim/mapGen.ts');
          const { Rng } = await import('/src/core/rng.ts');
          const s = window.__session; const w = s.world; const c = s.player; const e = c.entrances[0];
          let mx = e.sx + 140, my = e.sy;
          for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; const x = e.sx + Math.cos(a) * 140, y = e.sy + Math.sin(a) * 140;
            if (x > 40 && y > 40 && x < w.terrain.width - 40 && y < w.terrain.depth - 40 && w.walkable(0, x, y)) { mx = x; my = y; break; } }
          placeLitter(w, new Rng(1), mx, my);
          for (const f of w.s.food) if (f.from === 'litter' && Math.hypot(f.x - mx, f.y - my) < 1) f.amount = f.max = 1e4;
          s.issue({ type: 'placeMarker', i: 0, space: 0, x: mx, y: my });
          for (const g of c.groups) s.issue({ type: 'assignGroup', group: g.id, marker: 0 });
          return { mx, my, ex: e.sx, ey: e.sy };
        }""")
        for k in range(40):
            pg.evaluate("window.__session.loop.advance(40)")
        n = pg.evaluate("() => window.__session.world.s.ants.filter(a => a.caste === 'rhy_soldier' && a.state === 22).length")
        pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig;
            r.jumpTo(({info['mx']} + {info['ex']}) / 2, ({info['my']} + {info['ey']}) / 2, 175); r.pitchBias = 0.6;
            if (s.view.grass) s.view.grass.mesh.visible = false; }}""")
        pg.evaluate("window.__step(3, 0.05)")
        pg.screenshot(path=os.path.join(OUT, "guard_line.png"))
        note(f"{'PASS' if not errs else 'FAIL'}  guard_line rally {n} {errs[:2]}")
        pg.close()

    # ---- ants planted round a centipede, hitboxes drawn (F3 overlay)
    if not ONLY or ONLY in "planted_centipede":
        errs = []
        pg = page(ctx, errs)
        pg.goto(BASE + "?play=1&shot=1&noui=1&q=low&seed=5&creatures=0&species=formica&rival=lasius&spawn=lithobius&battle=formica_worker:16&hitboxes=1", wait_until="load")
        wait_ready(pg)
        pg.evaluate("() => { for (const c of window.__session.world.s.creatures) c.hp = c.maxHp = 1e7; }")
        for k in range(60):
            pg.evaluate("window.__session.loop.advance(5)")
            if pg.evaluate("() => window.__session.world.s.ants.filter(a => a.state === 25 && a.gKind === 4).length") >= 8:
                break
        pg.evaluate("window.__session.loop.advance(40)")
        pg.evaluate("""() => { const s = window.__session; const cr = s.world.s.creatures[0]; const r = s.view.surfaceRig;
            r.jumpTo(cr.x, cr.y, 70); r.pitchBias = 0.5; if (s.view.grass) s.view.grass.mesh.visible = false; if (s.view.props) s.view.props.group.visible = false; }""")
        pg.evaluate("window.__step(3, 0.05)")
        pg.screenshot(path=os.path.join(OUT, "planted_centipede.png"))
        note(f"{'PASS' if not errs else 'FAIL'}  planted_centipede {errs[:2]}")
        pg.close()

    # ---- undiggable stone in the nest, zoomed out
    if not ONLY or ONLY in "nest_stones":
        errs = []
        pg = page(ctx, errs)
        pg.goto(BASE + "?play=1&shot=1&q=high&seed=5&creatures=0&species=lasius&rival=formica&view=nest", wait_until="load")
        wait_ready(pg)
        pg.evaluate("window.__session.loop.advance(40)")
        pg.evaluate("() => { const r = window.__session.view.nestRig; r.jumpTo(r.goal.x, r.goal.z, r.distance * 2.2); }")
        pg.evaluate("window.__step(3, 0.05)")
        pg.screenshot(path=os.path.join(OUT, "nest_stones.png"))
        note(f"{'PASS' if not errs else 'FAIL'}  nest_stones {errs[:2]}")
        pg.close()
    b.close()

print("FAILED" if any(r.startswith("FAIL") for r in res) else "fix renders OK")
