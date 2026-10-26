"""Visual checks for the species render work, in the real game and the lab:
glue on an ant (lab), a nasute firing (glue stream + glue on its target), a hell
ant holding its prey off the ground, Saiy-Ants in the gold surge, the termite
nest in carton with larvae and a pale presoldier, and the Gold Surge group
button. Saves screenshots next to the other renders; fails on page errors or
shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/species_fx.py
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures")
ONLY = os.environ.get("ONLY", "")
res = []
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]


def watch(pg, errs):
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("marker missing" in m.text or "THREE.WebGLProgram" in m.text or "Error" in m.text) else None)


def wait_ready(pg, t=300):
    t0 = time.time()
    while time.time() - t0 < t and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


STATS = """() => { const s = window.__session; const w = s.world; const me = s.player.id;
  const a = w.s.ants.filter(x => x.colony === me && x.state !== 28);
  return { gold: a.filter(x => (x.surgeT||0) > 0).length, firing: a.filter(x => x.fire).length,
           held: w.s.ants.filter(x => x.heldBy && x.state !== 28).length, hold: a.filter(x => x.holdId).length,
           rooted: w.s.ants.filter(x => (x.root||0) > w.s.tick).length } }"""

FOCUS = """([key, dist]) => { const s = window.__session; const w = s.world; const me = s.player.id;
  const a = w.s.ants.filter(x => x.colony === me && x.space === 0 && x.state !== 28);
  let pick = null;
  if (key === 'fire') pick = a.find(x => x.fire && x.tgt);
  if (key === 'hold') pick = a.find(x => x.holdId);
  if (key === 'gold') pick = a.find(x => (x.surgeT||0) > 0);
  if (!pick && a.length) pick = a[0];
  if (!pick) return null;
  let x = pick.x, y = pick.y;
  if (key === 'fire') { const t = w.antById.get(pick.tgt); if (t) { x = (x + t.x) / 2; y = (y + t.y) / 2; } }
  s.view.surfaceRig.jumpTo(x, y, dist); s.view.surfaceRig.pitchBias = 0.85;
  // verification close-ups: leaves, pebbles and grass out of the way
  if (s.view.props) s.view.props.group.visible = false; if (s.view.grass) s.view.grass.mesh.visible = false;
  return { x, y, id: pick.id } }"""

GAME = [
    # folder, name, query, wait-for key, camera distance
    ("nasutitermes-renders", "game_fire_glue", "species=nasutitermes&rival=lasius&battle=nasute_soldier:6,lasius_worker:6", "firing", 24),
    ("nasutitermes-renders", "game_major_glue", "species=nasutitermes&rival=formica&battle=nasute_major:4,formica_worker:6", "rooted", 22),
    ("hell-ant-renders", "game_hold", "species=hell&rival=lasius&battle=hell_worker:6,lasius_worker:6", "hold", 14),
    ("hell-ant-renders", "game_impale", "species=hell&rival=formica&battle=hell_soldier:4,formica_worker:5", "hold", 16),
    ("aurimyrmex-renders", "game_gold", "species=aurimyrmex&rival=lasius&battle=aurimyrmex_worker:6,lasius_worker:6", "gold", 18),
]

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 960, "height": 560})
    # ---- lab: termite glue clinging to ants
    for name, q in [("ant_glue_lasius", "ants=lasius_worker&cam=34&glue=1"), ("ant_glue_formica_half", "ants=formica_worker&cam=side&amp=0&glue=0.5")]:
        if ONLY and ONLY not in name:
            continue
        pg = ctx.new_page()
        errs = []
        watch(pg, errs)
        pg.goto(BASE + "?scene=antlab&ao=0&dof=0&" + q, wait_until="load")
        wait_ready(pg, 120)
        time.sleep(0.5)
        pg.screenshot(path=os.path.join(ROOT, "nasutitermes-renders", name + ".png"))
        res.append(f"{'PASS' if not errs else 'FAIL'}  lab {name} {errs[:3]}")
        pg.close()
    # ---- game battles: step until the effect shows, then a close shot
    for folder, name, query, key, dist in GAME:
        if ONLY and ONLY not in name:
            continue
        pg = ctx.new_page()
        pg.set_default_timeout(600000)
        errs = []
        watch(pg, errs)
        pg.goto(BASE + f"?play=1&shot=1&noui=1&q=low&seed=5&creatures=0&{query}", wait_until="load")
        wait_ready(pg)
        st = {}
        seen = False
        for k in range(60):
            # fast-forward the sim without drawing (SwiftShader frames are slow), then draw a few
            pg.evaluate("window.__session.loop.advance(5)")
            st = pg.evaluate(STATS)
            if st.get(key, 0) > 0:
                seen = True
                break
        # a few more ticks so the look has eased in (glue, gold)
        pg.evaluate("window.__step(6, 0.05)")
        f = pg.evaluate(FOCUS, ["fire" if key in ("firing", "rooted") else key, dist])
        pg.evaluate("window.__step(2, 0.05)")
        pg.screenshot(path=os.path.join(ROOT, folder, name + ".png"))
        ok = seen and not errs
        res.append(f"{'PASS' if ok else 'FAIL'}  {folder}/{name} {key} seen={seen} {st} {errs[:3]}")
        pg.close()
    # ---- the termite nest: carton, larvae and a pale presoldier
    if not ONLY or "nest" in ONLY:
        pg = ctx.new_page()
        pg.set_default_timeout(600000)
        errs = []
        watch(pg, errs)
        pg.goto(BASE + "?play=1&shot=1&noui=1&q=low&seed=5&species=nasutitermes&rival=lasius&ticks=900&view=nest", wait_until="load")
        wait_ready(pg)
        info = pg.evaluate("""() => { const s = window.__session; const w = s.world; const c = s.player;
          const lv = w.s.brood.filter(b => b.colony === c.id && b.stage === 1);
          // render check only: dress one larva up as late soldier brood (the presoldier)
          if (lv.length) { lv[0].caste = 'nasute_soldier'; lv[0].t = 0.9; }
          const q = w.antById.get(c.queen); s.view.nestRig.jumpTo(q.x, q.y, 32);
          return { larvae: lv.length, carton: s.view.nestStage ? 1 : 0 } }""")
        pg.evaluate("window.__step(4, 0.05)")
        pg.screenshot(path=os.path.join(ROOT, "nasutitermes-renders", "game_nest_carton_brood.png"))
        res.append(f"{'PASS' if not errs and info['larvae'] > 0 else 'FAIL'}  nasutitermes-renders/game_nest_carton_brood {info} {errs[:3]}")
        pg.close()
    # ---- the Gold Surge button on a Saiy-Ant group card (full UI)
    if not ONLY or "button" in ONLY:
        pg = ctx.new_page()
        pg.set_default_timeout(600000)
        errs = []
        watch(pg, errs)
        pg.goto(BASE + "?play=1&shot=1&q=low&seed=5&species=aurimyrmex&rival=lasius&ticks=1200", wait_until="load")
        wait_ready(pg)
        pg.evaluate("window.__step(4, 0.05)")
        n = pg.evaluate("() => document.querySelectorAll('.gc-surge').length")
        tip = pg.evaluate("() => { const b = document.querySelector('.gc-surge'); return b ? b.dataset.tip : '' }")
        pg.screenshot(path=os.path.join(ROOT, "aurimyrmex-renders", "ui_surge_button.png"))
        if n:
            box = pg.evaluate("() => { const r = document.querySelector('.gc-surge').closest('.gcard').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }")
            pg.screenshot(path=os.path.join(ROOT, "aurimyrmex-renders", "ui_surge_button_card.png"), clip={"x": max(0, box[0] - 30), "y": max(0, box[1] - 30), "width": box[2] + 60, "height": box[3] + 60})
            pg.click(".gc-surge")
            pg.evaluate("window.__step(3, 0.05)")
            gold = pg.evaluate(STATS)["gold"]
        else:
            gold = -1
        res.append(f"{'PASS' if n > 0 and not errs else 'FAIL'}  aurimyrmex-renders/ui_surge_button buttons={n} goldAfterClick={gold} tip={tip[:60]!r} {errs[:3]}")
        pg.close()
    b.close()

for r in res:
    print(r)
print("FAILED" if any(r.startswith("FAIL") for r in res) else "all species fx renders OK")
