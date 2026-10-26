"""Renders for the Termants (claude/termyrms package, plan Step 8): the four hybrid castes (side, top, front,
three-quarter; LOD1), and in the game: stolen-caste ants (amber tint) beside Termant workers and soldiers, a glued
enemy, the queen and king in the nest with a carton wall, and the Genome tab.
Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/termant_renders.py   (ONLY=<name part> for one scene;
BASE=http://127.0.0.1:5174/ for another server)
Screenshots: docs/creatures/termant-renders/
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "termant-renders")
ONLY = os.environ.get("ONLY", "")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
res = []
FOUR = "termant_worker,termant_soldier,termant_king,termant_queen"


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
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text and "TUNNEL" not in m.text) else None)
    return pg


def lab(ctx, name, q, size=(1400, 600)):
    if ONLY and ONLY not in name:
        return
    errs = []
    pg = page(ctx, errs)
    pg.set_viewport_size({"width": size[0], "height": size[1]})
    pg.goto(BASE + "?scene=antlab&" + q, wait_until="load")
    wait_ready(pg, 120)
    time.sleep(1)
    pg.screenshot(path=os.path.join(OUT, name + ".png"))
    note(f"{'PASS' if not errs else 'FAIL'}  {name} {errs[:2]}")
    pg.close()


# stolen Red Wood Ant sprayers among Termant workers and soldiers by the entrance, and a glued enemy worker
STOLEN_JS = """async () => {
  const { makeAnt } = await import('/src/sim/factory.ts');
  const { genomeOf } = await import('/src/sim/termants.ts');
  const s = window.__session; const w = s.world; const c = s.player; const e = c.entrances[0];
  genomeOf(c).samples.formica = 13;
  for (let i = 0; i < 25; i++) s.loop.advance(1);
  // an open, flat spot near the entrance (no props within 40 mm)
  let ox = e.sx + 60, oy = e.sy;
  const props = w.terrain.props || [];
  outer: for (const R of [60, 90, 120, 160]) for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; const x = e.sx + Math.cos(a) * R, y = e.sy + Math.sin(a) * R;
    let ok = x > 90 && y > 90 && x < w.terrain.width - 90 && y < w.terrain.depth - 90;
    for (let r = 0; ok && r <= 40; r += 8) for (let q = 0; ok && q < 10; q++) ok = w.walkable(0, x + Math.cos(q * 0.63) * r, y + Math.sin(q * 0.63) * r);
    for (const pr of props) if (ok && Math.hypot(pr.x - x, pr.y - y) < 40 + (pr.len ?? 0) * 0.5 + pr.scale * 8) ok = false;
    for (let r = 0; ok && r <= 40; r += 8) for (let q = 0; ok && q < 10; q++) ok = Math.abs(w.terrain.walkHeight(x + Math.cos(q * 0.63) * r, y + Math.sin(q * 0.63) * r) - w.terrain.walkHeight(x, y)) < 3;
    if (ok) { ox = x; oy = y; break outer; } }
  const put = (col, caste, dx, dy, h) => { const a = makeAnt(w, col, caste, 0, ox + dx, oy + dy, h); a.task = 'guard'; a.state = 0; a.st = 99; return a; };
  const row = [['termant_worker', -14, -5], ['termant_soldier', -6, -6], ['formica_rapid', 3, -6], ['termant_worker', 11, -5],
               ['formica_rapid', -11, 5], ['termant_soldier', -2, 5], ['termant_worker', 6, 6], ['formica_rapid', 14, 5]];
  for (const [cs, dx, dy] of row) put(c.id, cs, dx, dy, 0.2);
  // the rival's own sprayer for comparison (no tint), and a glued rival worker
  const rid = w.s.colonies.find((o) => o.id !== c.id).id;
  put(rid, 'formica_rapid', 22, -1, 2.8);
  const foe = put(rid, 'formica_worker', 0, 16, -1.2);
  foe.glueT = w.s.tick + 20 * 600;
  w.reindex();
  return { ox, oy, stolen: c.castes.includes('formica_rapid') };
}"""


def stolen(ctx, name, dist, pitch):
    if ONLY and ONLY not in name:
        return
    errs = []
    pg = page(ctx, errs)
    pg.set_viewport_size({"width": 1200, "height": 700})
    pg.goto(BASE + "?play=1&shot=1&noui=1&q=low&seed=5&creatures=0&species=termant&rival=formica", wait_until="load")
    wait_ready(pg)
    info = pg.evaluate(STOLEN_JS)
    pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig; r.jumpTo({info['ox']}, {info['oy']}, {dist}); r.pitchBias = {pitch};
        if (s.view.grass) s.view.grass.mesh.visible = false; }}""")
    pg.evaluate("window.__step(4, 0.05)")
    pg.screenshot(path=os.path.join(OUT, name + ".png"))
    note(f"{'PASS' if not errs and info['stolen'] else 'FAIL'}  {name} stolen caste unlocked {info['stolen']} {errs[:2]}")
    pg.close()


# the royal pair in the nest (one queen, the king beside her; no replacement queens) and a carton wall beside them
NEST_JS = """async () => {
  const { makeAnt } = await import('/src/sim/factory.ts');
  const { placeTile, tileAt } = await import('/src/sim/tiles.ts');
  const s = window.__session; const w = s.world; const c = s.player; const g = w.nest(c.id);
  const q0 = w.antById.get(c.queen);
  const ch = c.tiles.find((t) => t.type === 'queen');
  for (let i = 0; i < 4; i++) makeAnt(w, c.id, 'termant_worker', q0.space, q0.x + 9 + i * 2, q0.y + 3, 0).tile = ch.q;
  // a carton wall on a free dug hex near the royal chamber
  let wq = -1, best = 1e9;
  for (let k = 0; k < g.cols * g.rows; k++) { if (!g.isHexDug(k) || g.isEntrance(k) || tileAt(c, k)) continue;
    const p = g.hexCenter(k); const d = Math.hypot(p.x - q0.x, p.y - q0.y); if (d < best) { best = d; wq = k; } }
  if (wq >= 0) placeTile(w, c, 'carton', wq, undefined, true);
  w.reindex();
  for (let i = 0; i < 3; i++) s.loop.advance(20);
  const k = c.king ? w.antById.get(c.king) : null;
  return { qx: q0.x, qy: q0.y, wall: wq, alive: c.alive, king: !!k };
}"""


def nest(ctx, name, dist):
    if ONLY and ONLY not in name:
        return
    errs = []
    pg = page(ctx, errs)
    pg.set_viewport_size({"width": 1100, "height": 650})
    pg.goto(BASE + "?play=1&shot=1&noui=1&q=low&seed=5&creatures=0&species=termant&rival=lasius&view=nest", wait_until="load")
    wait_ready(pg)
    info = pg.evaluate(NEST_JS)
    pg.evaluate(f"""() => {{ const s = window.__session; s.view.nestRig.jumpTo({info['qx']}, {info['qy']}, {dist}); }}""")
    pg.evaluate("window.__step(4, 0.05)")
    pg.screenshot(path=os.path.join(OUT, name + ".png"))
    ok = not errs and info["alive"] and info["king"] and info["wall"] >= 0
    note(f"{'PASS' if ok else 'FAIL'}  {name} king beside the queen {info['king']}, carton wall hex {info['wall']} {errs[:2]}")
    pg.close()


# the Genome tab, with one caste raised, one ready-and-waiting, samples toward others
GENOME_JS = """async () => {
  const { genomeOf } = await import('/src/sim/termants.ts');
  const s = window.__session; const c = s.player; const G = genomeOf(c);
  G.samples.formica = 14; G.samples.lasius = 9; G.samples.eciton = 6; G.samples['cr:wolfSpider'] = 3;
  for (let i = 0; i < 25; i++) s.loop.advance(1);
  c.wood = 37;
  const tab = [...document.querySelectorAll('.bp-tab')].pop(); tab.click();
  return { tabs: document.querySelectorAll('.bp-tab').length, rows: document.querySelectorAll('.gn-row').length, stolen: G.stolen.slice() };
}"""


def genome(ctx, name):
    if ONLY and ONLY not in name:
        return
    errs = []
    pg = page(ctx, errs)
    pg.set_viewport_size({"width": 1280, "height": 760})
    pg.goto(BASE + "?play=1&shot=1&q=low&seed=5&creatures=0&species=termant&rival=formica,lasius", wait_until="load")
    wait_ready(pg)
    time.sleep(1)
    info = pg.evaluate(GENOME_JS)
    pg.evaluate("window.__step(3, 0.05)")
    time.sleep(0.5)
    pg.screenshot(path=os.path.join(OUT, name + ".png"))
    box = pg.evaluate("() => { const r = document.querySelector('.bp').getBoundingClientRect(); return { x: r.x - 8, y: r.y - 40, width: r.width + 16, height: r.height + 48 }; }")
    pg.screenshot(path=os.path.join(OUT, name + "_panel.png"), clip=box)
    ok = not errs and info["tabs"] == 3 and info["rows"] >= 8 and "formica_rapid" in info["stolen"]
    note(f"{'PASS' if ok else 'FAIL'}  {name} tabs {info['tabs']}, rows {info['rows']}, stolen {info['stolen']} {errs[:2]}")
    pg.close()


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1400, "height": 600})
    for cam in ["side", "top", "front", "34"]:
        extra = "&dist=46" if cam == "top" else ""
        lab(ctx, f"models_{cam}", f"ants={FOUR}&cam={cam}&lod=0{extra}")
    lab(ctx, "models_lod1", f"ants={FOUR}&cam=34&lod=1")
    lab(ctx, "soldier_head_34", "ant=termant_soldier&cam=34&lod=0&tx=3&dist=10", (1000, 700))
    lab(ctx, "worker_34", "ant=termant_worker&cam=34&lod=0&dist=12", (1000, 700))
    # the tint: the Red Wood Ants' own rapid sprayer and soldier beside the same castes raised by Termants (amber)
    lab(ctx, "tint_stolen_vs_own", "ants=formica_rapid,formica_rapid,lasius_soldier,lasius_soldier&tints=0,1,0,1&cam=34&lod=0", (1300, 560))
    stolen(ctx, "stolen_close", 34, 0.45)
    stolen(ctx, "stolen_far", 90, 0.6)
    nest(ctx, "nest_royals_carton", 34)
    genome(ctx, "genome_tab")
    b.close()

print("FAILED" if any(r.startswith("FAIL") for r in res) else "termant renders OK")
