"""The golden set (performance pass, spec §4): fixed shots — same seed, same camera, the game stepped on a virtual clock
to a fixed tick — rendered before any optimization, then after each one, and compared (tools/golden-compare.py). Render
only: docs/performance/golden/<tag>/<name>.png.

Shots: every map's surface at close, gameplay and far zoom; the home nest and an enemy nest; each species' close-up (the
ant lab line-up); a big fight; water and a flood; a titan in a nest; day and night (The Long Nights); the low and
medium presets (high is every other shot).

Run: tests/browser/with_server.sh python3 tests/browser/golden.py   (TAG=before|after  ONLY=name,parts)
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
TAG = os.environ.get("TAG", "before")
ONLY = os.environ.get("ONLY", "")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "performance", "golden", TAG)
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
MAPS = ["meadowPond", "forestFloor", "riverbank", "rainforest", "savanna"]
SPECIES = {
    "lasius": "lasius_worker,lasius_soldier,lasius_queen",
    "formica": "formica_worker,formica_soldier,formica_mortar,formica_rapid",
    "atta": "atta_minim,atta_media,atta_soldier,atta_major",
    "solenopsis": "fire_minor,fire_soldier,fire_major",
    "eciton": "eciton_minor,eciton_submajor,eciton_media,eciton_major",
    "plagiaria": "plagiaria_worker,plagiaria_queen",
    "nasutitermes": "nasute_worker,nasute_soldier,nasute_major",
    "rhynchotermes": "rhy_worker,rhy_soldier",
    "hell": "hell_worker,hell_soldier",
    "aurimyrmex": "aurimyrmex_worker,aurimyrmex_soldier",
    "termant": "termant_worker,termant_soldier",
}
res = []


def note(r):
    res.append(r)
    print(r, flush=True)


def want(name):
    return not ONLY or any(o in name for o in ONLY.split(","))


GAME = "?play=1&shot=1&noui=1&nocine=1&q={q}&seed={seed}&creatures=1&ticks=40"


def load(pg, url, errs):
    errs.clear()
    t0 = time.time()
    pg.goto(BASE + url, wait_until="load")
    while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    return time.time() - t0


def shoot(pg, name, errs, steps=4):
    pg.evaluate(f"window.__step && window.__step({steps}, 1/30)")
    pg.screenshot(path=os.path.join(OUT, f"{name}.png"))
    note(f"{'PASS' if not errs else 'FAIL'}  {name} {errs[:2]}")


SURF_CAM = """([x, z, d, yaw, pitch]) => { const s = window.__session; s.view.space = 'surface'; const r = s.view.surfaceRig;
  r.jumpTo(x, z, d); r.yaw = r.goalYaw = yaw; r.pitchBias = pitch; }"""
NEST_CAM = """([space, x, z, k, pitch]) => { const s = window.__session; const v = s.view; s.viewedArea = space; v.setActiveNest(space);
  v.space = 'nest'; const g = s.world.nestOf(space); const r = v.nestRig; r.jumpTo(x, z, g.R * k); r.yaw = r.goalYaw = 0.6; r.pitchBias = pitch; }"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1280, "height": 760})
    pg = ctx.new_page()
    pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)

    # ---- every map: close, gameplay, far; on Meadow Pond also both nests and the two lower presets
    for m in MAPS:
        names = [f"map_{m}_{z}" for z in ("close", "play", "far")] + ([f"nest_home_{m}", f"nest_enemy_{m}"] if m == "meadowPond" else [])
        if not any(want(n) for n in names):
            continue
        load(pg, GAME.format(q="high", seed=5) + f"&map={m}&species=lasius&rival=formica", errs)
        pg.evaluate("window.__session.loop.advance(600)")
        info = pg.evaluate("""() => { const s = window.__session; const e = s.player.entrances[0]; const r = s.view.surfaceRig;
          return { x: e.sx, z: e.sy, max: r.maxDist, rival: s.world.s.colonies.find((c) => c.id !== s.player.id).id }; }""")
        for z, (d, pitch) in {"close": (45, 0.1), "play": (230, 0.0), "far": (info["max"] * 0.8, 0.0)}.items():
            n = f"map_{m}_{z}"
            if want(n):
                pg.evaluate(SURF_CAM, [info["x"] + 12, info["z"] + 8, d, 0.9, pitch])
                shoot(pg, n, errs)
        if m == "meadowPond":
            for who, cid in (("home", None), ("enemy", info["rival"])):
                n = f"nest_{who}_{m}"
                if not want(n):
                    continue
                sp = pg.evaluate(f"() => {{ const s = window.__session; const id = {cid if cid is not None else 's.player.id'}; const sp = id + 1;" +
                                 " const c = s.world.colony(id); const g = s.world.nestOf(sp); const q = c.tiles.find((t) => t.type === 'queen').q; const p = g.hexCenter(q); return [sp, p.x, p.y]; }")
                pg.evaluate(NEST_CAM, [sp[0], sp[1], sp[2] + 0, 20, 0.45])
                shoot(pg, n, errs)

    # ---- the lower presets (gameplay view on Meadow Pond)
    for q in ("low", "medium"):
        n = f"preset_{q}"
        if not want(n):
            continue
        load(pg, GAME.format(q=q, seed=5) + "&map=meadowPond&species=lasius&rival=formica", errs)
        pg.evaluate("window.__session.loop.advance(600)")
        x, z = pg.evaluate("() => { const e = window.__session.player.entrances[0]; return [e.sx, e.sy]; }")
        pg.evaluate(SURF_CAM, [x + 12, z + 8, 230, 0.9, 0.0])
        shoot(pg, n, errs)

    # ---- each species: the ant lab line-up
    for sp, ants in SPECIES.items():
        n = f"species_{sp}"
        if not want(n):
            continue
        load(pg, f"?scene=antlab&ants={ants}&spacing=1.25", errs)
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, f"{n}.png"))
        note(f"{'PASS' if not errs else 'FAIL'}  {n} {errs[:2]}")

    # ---- a big fight (the stress scene)
    if want("fight"):
        load(pg, "?stress=1&shot=1&ants=200&creatures=60&bosses=2&q=high&ticks=400", errs)
        pg.evaluate("() => { const s = window.__session; const r = s.view.surfaceRig; r.jumpTo(s.world.terrain.width / 2, s.world.terrain.depth / 2, 160); r.yaw = r.goalYaw = 0.6; }")
        shoot(pg, "fight", errs)

    # ---- water and a flood (Riverbank: the first flood brought forward)
    if want("flood"):
        load(pg, GAME.format(q="high", seed=5) + "&map=riverbank&species=lasius&rival=formica&floods=1", errs)
        pg.evaluate("() => { const w = window.__session.world; for (const f of w.s.flood || []) f.next = w.s.time + 1; window.__session.loop.advance(20 * 32); }")
        x, z = pg.evaluate("() => { const w = window.__session.world; const m = w.terrain.map; const z = (m && m.zones || []).find((q) => q.kind === 'flood') || null;" +
                           " return z ? [z.x ?? (z.rect ? z.rect[0] + z.rect[2] / 2 : w.terrain.width / 2), z.y ?? (z.rect ? z.rect[1] + z.rect[3] / 2 : w.terrain.depth / 2)] : [w.terrain.width / 2, w.terrain.depth / 2]; }")
        pg.evaluate(SURF_CAM, [x, z, 300, 0.9, 0.0])
        shoot(pg, "flood", errs)

    # ---- a titan in a nest (a tarantula digs straight into the player's nest)
    if want("titan"):
        load(pg, GAME.format(q="high", seed=5) + "&map=meadowPond&species=lasius&rival=formica&titanRaid=tarantula", errs)
        pg.evaluate("window.__session.loop.advance(20 * 75)")
        sp = pg.evaluate("""() => { const s = window.__session; const w = s.world; const cr = w.s.creatures.find((c) => c.kind === 'tarantula');
          const sp = cr && cr.space > 0 ? cr.space : s.player.id + 1; const g = w.nestOf(sp);
          const p = cr && cr.space === sp ? { x: cr.x, y: cr.y } : g.hexCenter(g.entrances[0]); return [sp, p.x, p.y]; }""")
        pg.evaluate(NEST_CAM, [sp[0], sp[1], sp[2], 14, 0.45])
        shoot(pg, "titan_nest", errs)

    # ---- day and night (The Long Nights: the morning, and the third night)
    for when, extra in (("day", "&stage=1"), ("night", "&night=3")):
        n = f"story_{when}"
        if not want(n):
            continue
        load(pg, f"?story=longNights&diff=normal&shot=1&noui=1&nocine=1&q=high&seed=7&ticks=40{extra}", errs)
        pg.evaluate(f"window.__session.loop.advance({20 * 25 if when == 'night' else 200})")
        x, z = pg.evaluate("() => { const e = window.__session.player.entrances[0]; return [e.sx, e.sy]; }")
        pg.evaluate(SURF_CAM, [x + 10, z + 6, 200, 0.9, 0.0])
        shoot(pg, n, errs, steps=40)
    b.close()

bad = [r for r in res if r.startswith("FAIL")]
print(f"{len([r for r in res if r.startswith('PASS')])} shots, {len(bad)} failed")
raise SystemExit(1 if bad else 0)
