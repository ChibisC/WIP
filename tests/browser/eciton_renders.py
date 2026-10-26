"""Renders for the army-ant upgrade (claude/army-ants package, plan Step 7): the five models (side, top, front,
three-quarter; LOD1), the four new poses, and a raid in the game at close and far zoom (front, lanes, porters with
prey under the body, Soldiers at their trail posts). Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/eciton_renders.py   (ONLY=<name part> for one scene)
Screenshots: docs/creatures/eciton-renders/
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "creatures", "eciton-renders")
ONLY = os.environ.get("ONLY", "")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
res = []
FIVE = "eciton_minor,eciton_submajor,eciton_media,eciton_major,eciton_queen"


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


RAID_JS = """async (o) => {
  const { makeAnt, makeFood } = await import('/src/sim/factory.ts');
  const { placeMarker, assignGroup } = await import('/src/sim/markers.ts');
  const s = window.__session; const w = s.world; const c = s.player; const e = c.entrances[0];
  let mx = e.sx + 150, my = e.sy;
  // o.bridge: aim the raid across the nearest puddle, so the trail runs past (or through) its edge
  const pud = o.bridge ? w.terrain.params.water.map((p) => ({ p, d: Math.hypot(p.x - e.sx, p.y - e.sy) })).filter((q) => q.d > 50 && q.d < 220).sort((a, b) => a.d - b.d)[0] : null;
  if (pud) { const a = Math.atan2(pud.p.y - e.sy, pud.p.x - e.sx) + 0.25; mx = e.sx + Math.cos(a) * (pud.d + pud.p.r + 45); my = e.sy + Math.sin(a) * (pud.d + pud.p.r + 45); }
  for (let k = 0; !pud && k < 24; k++) { const a = k / 24 * Math.PI * 2; const x = e.sx + Math.cos(a) * 150, y = e.sy + Math.sin(a) * 150;
    let ok = x > 90 && y > 90 && x < w.terrain.width - 90 && y < w.terrain.depth - 90;
    for (let r = 0; ok && r <= 60; r += 10) for (let q = 0; ok && q < 8; q++) ok = w.walkable(0, x + Math.cos(q) * r, y + Math.sin(q) * r);
    if (ok) { mx = x; my = y; break; } }
  for (let i = 0; i < 14; i++) { const a = i * 2.399, rr = 60 * Math.sqrt((i + 0.5) / 14); const x = mx + Math.cos(a) * rr, y = my + Math.sin(a) * rr;
    if (w.walkable(0, x, y)) makeFood(w, 'insect', 0, x, y, i % 4 === 0 ? 1.8 : 1.0, ['fly', 'cricket', 'moth', 'beetle'][i % 4]); }
  const chamber = c.tiles.find((t) => t.type === 'queen');
  const spawn = (caste, n) => { for (let i = 0; i < n; i++) { const a = makeAnt(w, c.id, caste, 0, e.sx + Math.cos(i * 2.4) * (6 + i * 0.4), e.sy + Math.sin(i * 2.4) * (6 + i * 0.4), 0);
    a.tile = chamber.q; a.task = 'marker'; a.marker = 0; } };
  spawn('eciton_minor', o.minors); spawn('eciton_submajor', o.porters); spawn('eciton_media', o.medias); spawn('eciton_major', o.majors);
  placeMarker(w, c, 0, 0, mx, my);
  assignGroup(w, c, chamber.group, 0);
  w.reindex();
  return { mx, my, ex: e.sx, ey: e.sy };
}"""


def raid(ctx, name, minors, porters, medias, majors, secs, cam, bridge=False):
    if ONLY and ONLY not in name:
        return
    errs = []
    pg = page(ctx, errs)
    pg.set_viewport_size({"width": 1200, "height": 700})
    pg.goto(BASE + "?play=1&shot=1&noui=1&q=low&seed=5&creatures=0&species=eciton&rival=lasius", wait_until="load")
    wait_ready(pg)
    info = pg.evaluate(RAID_JS, {"minors": minors, "porters": porters, "medias": medias, "majors": majors, "bridge": bridge})
    for k in range(secs):
        pg.evaluate("window.__session.loop.advance(20)")
    st = pg.evaluate("""() => { const w = window.__session.world; const A = w.s.ants.filter(a => a.colony === window.__session.player.id && a.space === 0);
        const links = (window.__session.player.ecLinks || []).filter(L => L.done !== -1);
        return { raid: A.filter(a => a.state === 32).length, guard: A.filter(a => a.pose === 11).length, porterLaden: A.filter(a => a.caste === 'eciton_submajor' && a.carry === 1).length,
                 front: window.__session.player.ecRaid[0], links, team: A.filter(a => (a.helpOf || 0) !== 0).length }; }""")
    cam(pg, info, st)
    pg.evaluate("window.__step(3, 0.05)")
    pg.screenshot(path=os.path.join(OUT, name + ".png"))
    note(f"{'PASS' if not errs else 'FAIL'}  {name} raiding {st['raid']}, guards {st['guard']}, laden porters {st['porterLaden']}, team helpers {st['team']}, links {[(L['kind'], L['n'], L['done']) for L in st['links']]} {errs[:2]}")
    pg.close()


def cam_front(pg, info, st):
    f = st["front"]
    pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig; r.jumpTo({f['x']}, {f['y']}, 95); r.pitchBias = 0.35;
        if (s.view.grass) s.view.grass.mesh.visible = false; }}""")


def cam_far(pg, info, st):
    pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig;
        r.jumpTo(({info['mx']} + {info['ex']}) / 2, ({info['my']} + {info['ey']}) / 2, 240); r.pitchBias = 0.6;
        if (s.view.grass) s.view.grass.mesh.visible = false; }}""")


def cam_bridge(pg, info, st):
    b = [L for L in st["links"] if L["kind"] == 1]
    x, y = ((b[0]["ax"] + b[0]["bx"]) / 2, (b[0]["ay"] + b[0]["by"]) / 2) if b else (info["mx"], info["my"])
    pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig; r.jumpTo({x}, {y}, 45); r.pitchBias = 0.45;
        if (s.view.grass) s.view.grass.mesh.visible = false; }}""")


def cam_plug(pg, info, st):
    b = [L for L in st["links"] if L["kind"] == 2 and L["done"] == 1]
    x, y = (b[0]["ax"], b[0]["ay"]) if b else (info["mx"], info["my"])
    pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig; r.jumpTo({x}, {y}, 30); r.pitchBias = 0.5;
        if (s.view.grass) s.view.grass.mesh.visible = false; }}""")


def cam_trail(pg, info, st):
    # the middle of the trail, close: lanes, porters with prey under the body, a Soldier post
    mx = info["ex"] * 0.45 + info["mx"] * 0.55
    my = info["ey"] * 0.45 + info["my"] * 0.55
    pg.evaluate(f"""() => {{ const s = window.__session; const r = s.view.surfaceRig; r.jumpTo({mx}, {my}, 80); r.pitchBias = 0.45;
        if (s.view.grass) s.view.grass.mesh.visible = false; }}""")


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1400, "height": 600})
    # ---- the five models, LOD0, swell 0.5 (the queen's fixed physogastry)
    for cam in ["side", "top", "front", "34"]:
        extra = "&dist=58" if cam == "top" else ""
        lab(ctx, f"models_{cam}", f"ants={FIVE}&cam={cam}&lod=0&swell=0.5{extra}")
    lab(ctx, "models_lod1", f"ants={FIVE}&cam=34&lod=1&swell=0.5")
    # close-ups: the Soldier's ice-tong hooks with barbed points; porter and media heads
    lab(ctx, "major_head_34", "ant=eciton_major&cam=34&lod=0&tx=7&dist=14", (1000, 700))
    lab(ctx, "major_head_top", "ant=eciton_major&cam=top&lod=0&tx=6&dist=16", (1000, 700))
    lab(ctx, "workers_34", "ants=eciton_minor,eciton_submajor,eciton_media&cam=34&lod=0", (1200, 600))
    # queen: swell 0 / 0.5 / 1 (the game uses 0.5)
    for sw in ["0", "0.5", "1"]:
        lab(ctx, f"queen_swell_{sw}", f"ant=eciton_queen&cam=side&lod=0&swell={sw}&dist=40", (1000, 500))
    # ---- the poses: porter with prey under the body, Soldier on guard, bridge link, pothole plug
    lab(ctx, "poses_side", "ants=eciton_submajor,eciton_major,eciton_minor,eciton_minor&poses=10,11,12,13&hpitches=0,0.4,0,0&mopens=0.3,0.9,0,0&prey=1&cam=side&lod=0&amp=0.3&dist=40")
    lab(ctx, "poses_34", "ants=eciton_submajor,eciton_major,eciton_minor,eciton_minor&poses=10,11,12,13&hpitches=0,0.4,0,0&mopens=0.3,0.9,0,0&prey=1&cam=34&lod=0&amp=0.3&dist=42", (1400, 700))
    # ---- a raid in the game
    raid(ctx, "raid_front", 60, 10, 6, 8, 40, cam_front)
    raid(ctx, "raid_trail", 60, 10, 6, 8, 45, cam_trail)
    raid(ctx, "raid_far", 60, 10, 6, 8, 45, cam_far)
    raid(ctx, "raid_few_soldiers", 60, 10, 6, 2, 45, cam_trail)
    raid(ctx, "raid_plug", 60, 10, 6, 8, 45, cam_plug)
    b.close()

print("FAILED" if any(r.startswith("FAIL") for r in res) else "eciton renders OK")
