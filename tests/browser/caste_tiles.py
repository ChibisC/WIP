"""Renders for the caste looks (user note 2026-11-02 10:40: every caste's tile its own colour and texture, and the same
look in the UI for pheromone markers and building). One nest holds a pair of built brood tiles for every caste of every
species: an overview at gameplay zoom, then a close-up of each caste's tiles (labelled on a contact sheet). Then two
colonies' screens with the UI on: build panel buttons and the marker panel's group cards. Fails on page errors or
shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/caste_tiles.py   (ONLY=overview,close,ui)
Screenshots: docs/realism/caste-tiles/
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "overview,close,ui")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "realism", "caste-tiles")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
res = []


def note(r):
    res.append(r)
    print(r, flush=True)


# a block of dug hexes beside the queen's chamber; each caste two tiles stacked in one column, ten columns a band
PLACE_JS = """async (which) => {
  const { placeTile, tileAt } = await import('/src/sim/tiles.ts');
  const { hasBroodLook, casteLook } = await import('/src/render/casteLook.ts');
  const { CASTES } = await import('/src/sim/species.ts');
  const s = window.__session; const w = s.world; const c = s.player; const g = w.nest(c.id);
  const castes = which === 'all' ? Object.keys(CASTES).filter(hasBroodLook) : c.castes.filter(hasBroodLook);
  const qt = c.tiles.find((t) => t.type === 'queen');
  const qc = qt.q % g.cols, qr = Math.floor(qt.q / g.cols);
  const per = which === 'all' ? 10 : castes.length;
  const bands = Math.ceil(castes.length / per);
  // the block: to the right of the chamber if it fits, else to the left
  let c0 = qc + 4; if (c0 + per + 1 >= g.cols) c0 = Math.max(1, qc - 4 - per);
  let r0 = Math.max(1, Math.min(g.rows - bands * 3 - 1, qr - Math.floor(bands * 3 / 2)));
  const out = [];
  castes.forEach((cs, i) => {
    const col = c0 + (i % per), row = r0 + Math.floor(i / per) * 3;
    const qs = [row * g.cols + col, (row + 1) * g.cols + col];
    for (const q of qs) { if (!g.isHexDug(q)) g.completeHex(q); if (!tileAt(c, q) && !g.isEntrance(q)) placeTile(w, c, 'brood', q, cs, true); }
    const a = g.hexCenter(qs[0]), b = g.hexCenter(qs[1]);
    out.push({ caste: cs, name: CASTES[cs].name, species: CASTES[cs].species, colour: casteLook(cs).colour, pattern: casteLook(cs).pattern, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });
  // dig a margin round the block so the tiles sit on an open floor
  for (let row = r0 - 1; row <= r0 + bands * 3; row++) for (let col = c0 - 1; col <= c0 + per; col++) {
    const q = row * g.cols + col; if (q >= 0 && q < g.cols * g.rows && !g.isHexDug(q)) g.completeHex(q); }
  if (!c.castes.length) return out;
  for (const cs of castes) if (!c.castes.includes(cs)) c.castes.push(cs);
  c.tileVersion = (c.tileVersion || 0) + 1;
  return out;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    if "overview" in ONLY or "close" in ONLY:
        ctx = b.new_context(viewport={"width": 1280, "height": 760})
        errs = []
        pg = ctx.new_page()
        pg.set_default_timeout(900000)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
        t0 = time.time()
        pg.goto(BASE + "?play=1&shot=1&noui=1&q=high&seed=3&creatures=0&teams=2&map=testPond&species=lasius&rival=formica&ticks=40", wait_until="load")
        while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        note(f"loaded in {time.time() - t0:.0f} s")
        spots = pg.evaluate(PLACE_JS, "all")
        note(f"placed {len(spots)} castes")
        pg.evaluate("() => { const s = window.__session; s.viewedArea = 1; s.view.setActiveNest(1); s.view.space = 'nest'; }")
        pg.evaluate("window.__step(2, 1/30)")
        g = pg.evaluate("() => { const g = window.__session.world.nestOf(1); return { R: g.R }; }")
        cx = sum(s["x"] for s in spots) / len(spots)
        cy = sum(s["y"] for s in spots) / len(spots)
        if "overview" in ONLY:
            for vn, k, pitch in (("overview", 30, 0.62), ("overview_low", 22, 0.42)):
                pg.evaluate(f"() => {{ const g = window.__session.world.nestOf(1); const r = window.__session.view.nestRig; r.jumpTo({cx}, {cy} + g.R * 0.4, g.R * {k}); r.pitchBias = {pitch}; }}")
                pg.evaluate("window.__step(4, 1/30)")
                pg.screenshot(path=os.path.join(OUT, f"{vn}.jpg"), type="jpeg", quality=86)
                note(f"{'PASS' if not errs else 'FAIL'}  {vn} {errs[:2]}")
        if "close" in ONLY:
            for s in spots:
                pg.evaluate(f"() => {{ const g = window.__session.world.nestOf(1); const r = window.__session.view.nestRig; r.jumpTo({s['x']}, {s['y']} + g.R * 0.2, g.R * 6); r.pitchBias = 0.7; }}")
                pg.evaluate("window.__step(3, 1/30)")
                pg.screenshot(path=os.path.join(OUT, f"close_{s['caste']}.jpg"), type="jpeg", quality=84, clip={"x": 340, "y": 130, "width": 600, "height": 500})
                note(f"{'PASS' if not errs else 'FAIL'}  close {s['caste']} ({s['colour']} {s['pattern']}) {errs[:2]}")
            with open(os.path.join(OUT, "castes.txt"), "w") as f:
                for s in spots:
                    f.write(f"{s['caste']}\t{s['species']}\t{s['name']}\t{s['colour']}\t{s['pattern']}\n")
        ctx.close()
    if "ui" in ONLY:
        # the UI: each colony's own castes on brood tiles, groups sent to markers, build panel open
        for sp, rival in (("formica", "lasius"), ("eciton", "atta"), ("nasutitermes", "lasius")):
            ctx = b.new_context(viewport={"width": 1280, "height": 760})
            errs = []
            pg = ctx.new_page()
            pg.set_default_timeout(900000)
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
            t0 = time.time()
            pg.goto(BASE + f"?play=1&shot=1&q=high&seed=3&creatures=0&teams=2&map=testPond&species={sp}&rival={rival}&ticks=40", wait_until="load")
            while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
                time.sleep(0.5)
            spots = pg.evaluate(PLACE_JS, "own")
            pg.evaluate("""async () => {
              const { assignGroup, placeMarker } = await import('/src/sim/markers.ts');
              const s = window.__session; const w = s.world; const c = s.player;
              s.viewedArea = c.id + 1; s.view.setActiveNest(c.id + 1); s.view.space = 'nest';
              // two markers on the surface beside the anthill; every other group sent out to one of them
              const e = c.entrances[0];
              placeMarker(w, c, 0, 0, e.sx + 70, e.sy + 10); placeMarker(w, c, 1, 0, e.sx - 60, e.sy + 40);
              c.groups.filter((g) => g.type !== 'queen' && g.caste).forEach((g, i) => { if (i % 2) assignGroup(w, c, g.id, (i >> 1) % 2); });
              for (let i = 0; i < 10; i++) s.loop.advance(1);
            }""")
            cx = sum(s["x"] for s in spots) / len(spots)
            cy = sum(s["y"] for s in spots) / len(spots)
            pg.evaluate(f"() => {{ const g = window.__session.world.nestOf(window.__session.player.id + 1); const r = window.__session.view.nestRig; r.jumpTo({cx}, {cy} + g.R * 0.4, g.R * 16); r.pitchBias = 0.6; }}")
            pg.evaluate("window.__step(6, 1/30)")
            pg.screenshot(path=os.path.join(OUT, f"ui_{sp}.jpg"), type="jpeg", quality=88)
            note(f"{'PASS' if not errs else 'FAIL'}  ui_{sp} {errs[:2]}")
            ctx.close()
    b.close()

bad = [r for r in res if r.startswith("FAIL")]
print(f"{len([r for r in res if r.startswith('PASS')])} rendered, {len(bad)} failed")
raise SystemExit(1 if bad else 0)
