"""Sickle-Jaw Termites in the game (implement-sickle-jaw-termites §8): every caste in the model lab in four views
(side, top, front, three-quarter), then real games: a grab-and-squirt close up, a free squirt at a target too big to
grab, a battle, the damp-soil nest with the queen and king, and leaf-litter foraging on the surface. Fails on page
errors, shader warnings or no hold seen.

Run: tests/browser/with_server.sh python3 tests/browser/sickle_renders.py   (ONLY=<name part> for one scene)
Screenshots: docs/creatures/rhynchotermes-renders/
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "rhynchotermes-renders")
ONLY = os.environ.get("ONLY", "")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
res = []


def note(r):
    res.append(r)
    print(r, flush=True)

CASTES = "termite_rhy_worker,termite_rhy_soldier,termite_rhy_king,termite_rhy_queen,termite_rhy_larva"


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


HELD = """() => { const w = window.__session.world;
  const v = w.s.ants.filter(a => a.heldBy && w.antById.get(a.heldBy) && w.antById.get(a.heldBy).caste === 'rhy_soldier');
  const s = v.length ? w.antById.get(v[0].heldBy) : null;
  return { held: v.length, x: s ? s.x : 0, y: s ? s.y : 0, h: s ? s.h : 0, ramp: s ? Math.min(1, (s.rampN || 0) / 120) : 0 } }"""

# a soldier squirting a target too big to grab (counted as "held" so the camera frames it)
FIRING = """() => { const w = window.__session.world;
  const v = w.s.ants.filter(a => a.caste === 'rhy_soldier' && a.fire && a.state !== 36 && a.state !== 37 && a.tgt);
  const s = v.length ? v[0] : null;
  return { held: v.length, x: s ? s.x : 0, y: s ? s.y : 0, h: s ? s.h : 0, ramp: s ? Math.min(1, (s.rampN || 0) / 120) : 0 } }"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1200, "height": 700})
    # ---- the model lab: all castes, four views
    for cam in ["side", "top", "front", "34"]:
        name = f"lab_castes_{cam}"
        if ONLY and ONLY not in name:
            continue
        errs = []
        pg = page(ctx, errs)
        pg.goto(BASE + f"?scene=antlab&ants={CASTES}&cam={cam}&lod=0", wait_until="load")
        time.sleep(6)
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        note(f"{'PASS' if not errs else 'FAIL'}  {name} {errs[:2]}")
        pg.close()
    for name, extra in [("lab_soldier_threat", "&tstate=16"), ("lab_soldier_lunge", "&tstate=14&statet=0.4")]:
        if ONLY and ONLY not in name:
            continue
        errs = []
        pg = page(ctx, errs)
        pg.goto(BASE + f"?scene=antlab&ants=termite_rhy_soldier&cam=34&lod=0{extra}", wait_until="load")
        time.sleep(6)
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        note(f"{'PASS' if not errs else 'FAIL'}  {name} {errs[:2]}")
        pg.close()

    # ---- in the game
    GAMES = [
        ("game_hold", "species=rhynchotermes&rival=lasius&battle=rhy_soldier:6,lasius_soldier:6", 9, True),
        ("game_battle", "species=rhynchotermes&rival=formica&battle=rhy_soldier:8,formica_worker:8", 45, True),
        ("game_free_squirt", "species=rhynchotermes&rival=atta&battle=rhy_soldier:4,atta_major:1", 16, False),
    ]
    for name, query, dist, need_hold in GAMES:
        if ONLY and ONLY not in name:
            continue
        errs = []
        pg = page(ctx, errs)
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=low&seed=5&creatures=0&{query}", wait_until="load")
        wait_ready(pg)
        h = {"held": 0}
        for k in range(150):
            pg.evaluate("window.__session.loop.advance(4)")
            h = pg.evaluate(HELD if need_hold else FIRING)
            if h["held"] and h["ramp"] > (0.6 if need_hold else 0.3):
                break
        if h["held"]:
            pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig;
                r.jumpTo({h['x']}, {h['y']}, {dist}); r.yaw = r.goalYaw = {-h['h']} + 0.7; r.pitchBias = -0.1;
                if (s.view.props) s.view.props.group.visible = false; if (s.view.grass) s.view.grass.mesh.visible = false; }}""")
        else:
            pg.evaluate(f"""() => {{ const s = window.__session; const w = s.world; const me = s.player.id;
                const m = w.s.ants.filter(a => a.colony === me && a.space === 0 && a.state !== 28);
                if (!m.length) return; const x = m.reduce((t, a) => t + a.x, 0) / m.length, y = m.reduce((t, a) => t + a.y, 0) / m.length;
                s.view.surfaceRig.jumpTo(x, y, {dist}); if (s.view.grass) s.view.grass.mesh.visible = false; }}""")
        pg.evaluate("window.__step(3, 0.05)")
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        if name == "game_hold" and h["held"]:
            # the same hold from above, side-on to the soldier
            pg.evaluate(f"""() => {{ const r = window.__session.view.surfaceRig; r.yaw = r.goalYaw = {-h['h']} + Math.PI / 2; r.pitchBias = 0.5; }}""")
            pg.evaluate("window.__step(2, 0.05)")
            pg.screenshot(path=os.path.join(OUT, name + "_above.png"))
        firing = pg.evaluate("() => window.__session.world.s.ants.filter(a => a.caste === 'rhy_soldier' && a.fire).length")
        ok = not errs and h["held"] > 0 and firing > 0
        note(f"{'PASS' if ok else 'FAIL'}  {name} held {h['held']} ramp {h.get('ramp', 0):.2f} squirting {firing} {errs[:2]}")
        pg.close()

    # ---- the nest: damp soil, queen and king; the surface: leaf litter and workers carrying it
    for name in ["game_nest", "game_litter"]:
        if ONLY and ONLY not in name:
            continue
        errs = []
        pg = page(ctx, errs)
        view = "&view=nest" if name == "game_nest" else ""
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=low&seed=7&creatures=0&species=rhynchotermes&rival=lasius{view}", wait_until="load")
        wait_ready(pg)
        if name == "game_litter":
            pg.evaluate("""() => { const s = window.__session; const w = s.world; const c = s.player; const e = c.entrances[0];
              const ps = w.s.food.filter(f => f.from === 'litter' && f.space === 0).sort((a, b) => Math.hypot(a.x - e.sx, a.y - e.sy) - Math.hypot(b.x - e.sx, b.y - e.sy));
              if (ps.length) s.issue({ type: 'placeMarker', i: 0, space: 0, x: ps[0].x, y: ps[0].y });
              for (const g of c.groups) s.issue({ type: 'assignGroup', group: g.id, marker: 0 }); }""")
            for k in range(40):
                pg.evaluate("window.__session.loop.advance(60)")
                if pg.evaluate("""() => { const w = window.__session.world; const me = window.__session.player.id;
                    return w.s.ants.filter(a => a.colony === me && a.space === 0 && a.carryId && (w.foodById.get(a.carryId) || {}).from === 'litterchip').length }""") >= 2:
                    break
        else:
            pg.evaluate("window.__session.loop.advance(200)")
        if name == "game_nest":
            pg.evaluate("""() => { const s = window.__session; const q = s.world.antById.get(s.player.queen);
              s.view.nestRig.jumpTo(q.x - Math.cos(q.h) * 9, q.y - Math.sin(q.h) * 9, 42); s.view.nestRig.pitchBias = 0.2; }""")
        else:
            pg.evaluate("""() => { const s = window.__session; const w = s.world; const me = s.player.id;
              const carriers = w.s.ants.filter(a => a.colony === me && a.space === 0 && a.carryId && (w.foodById.get(a.carryId) || {}).from === 'litterchip');
              const m = window.__session.player.markers[0]; const pt = (m && m.space === 0 && m.x !== undefined && m.placed !== false ? m : null) || carriers[0] || w.s.food.find(f => f.from === 'litter' && f.space === 0);
              if (pt) s.view.surfaceRig.jumpTo(pt.x, pt.y, 30); s.view.surfaceRig.pitchBias = 0.15;
              if (s.view.grass) s.view.grass.mesh.visible = false; }""")
        pg.evaluate("window.__step(3, 0.05)")
        pg.screenshot(path=os.path.join(OUT, name + ".png"))
        info = pg.evaluate("""() => { const w = window.__session.world; const me = window.__session.player.id;
          return { litter: w.s.food.filter(f => f.from === 'litter').length, carrying: w.s.ants.filter(a => a.colony === me && a.carryId && (w.foodById.get(a.carryId) || {}).from === 'litterchip').length } }""")
        note(f"{'PASS' if not errs else 'FAIL'}  {name} {info} {errs[:2]}")
        pg.close()
    b.close()

print("FAILED" if any(r.startswith("FAIL") for r in res) else "sickle-jaw renders OK")
