"""Stag beetle males of four sizes (claude/story/06-spec-levels-5-7-and-lengths.md §2): a sheet of the four males next to
the titan from above and from the side (the creature lab), workers fighting a medium male in the battle arena, and a
strip of two males wrestling (face-off, locked, the lift, thrown on its back). Writes docs/creatures/shots/stag_sizes_*.jpg.

  tests/browser/with_server.sh python3 tests/browser/stag_sizes.py [sheet,arena,wrestle]
  (BASE=http://127.0.0.1:<port>/ for another server)
"""
import os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = "docs/creatures/shots"
WHAT = (sys.argv[1] if len(sys.argv) > 1 else "sheet,arena,wrestle").split(",")
os.makedirs(OUT, exist_ok=True)
KINDS = ["stagMinor", "stagSmall", "stagMedium", "stagLarge", "stagBeetle"]
LABELS = ["minor male", "small male", "medium male", "large male", "the titan (boss)"]
errs = []
try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 17)
except Exception:
    FONT = ImageFont.load_default()


def page(p, url, w=1400, h=620):
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": w, "height": h})
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text) else None)
    pg.goto(BASE + url, wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 600 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    return b, pg


def save(pg, name, labels=None):
    png = os.path.join(OUT, f"_{name}.png")
    pg.screenshot(path=png)
    im = Image.open(png).convert("RGB")
    if labels:
        d = ImageDraw.Draw(im)
        for x, y, text in labels:
            lines = text.split("\n")
            tw = max(d.textlength(t, font=FONT) for t in lines)
            d.rectangle([x - tw / 2 - 6, y - 2, x + tw / 2 + 6, y + 22 * len(lines)], fill=(20, 16, 12))
            for i, t in enumerate(lines):
                d.text((x - d.textlength(t, font=FONT) / 2, y + 22 * i), t, fill=(240, 228, 205), font=FONT)
    out = os.path.join(OUT, f"stag_sizes_{name}.jpg")
    im.save(out, quality=88)
    os.remove(png)
    print("saved", out, flush=True)


# where each lab creature is on screen, and how long it is (labels under them)
LABEL_JS = """([lift, back]) => { const L = window.__lab; const V = L.cam.position.constructor; const r = [];
  for (const c of L.list) { const v = new V(c.x - Math.cos(c.h) * back * c.scale, 0, c.y - Math.sin(c.h) * back * c.scale).project(L.cam);
    r.push([(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight + lift, c.kind, c.scale]); } return r; }"""


def labelled(pg, lift, back=0):
    return [(x, y, f"{LABELS[KINDS.index(k)]}\n{L:g} mm") for x, y, k, L in pg.evaluate(LABEL_JS, [lift, back])]


with sync_playwright() as p:
    if "sheet" in WHAT:
        # side view: facing right, standing, in a row from the minor male to the titan
        q = "?scene=crlab&kinds=" + ",".join(KINDS) + "&cam=fside&rot=0&speed=0.0001&dof=0&q=high&spacing=14&ty=8&dist=470"
        b, pg = page(p, q)
        save(pg, "side", labelled(pg, 60))
        b.close()
        # from above: facing up the picture (heading −z, the camera's up −z)
        b, pg = page(p, q.replace("rot=0", "rot=-1.5708").replace("cam=fside", "cam=top"))
        pg.evaluate("""() => { const L = window.__lab; const d = 430; L.cam.position.set(0, d, 0.0001); L.cam.up.set(0, 0, -1); L.cam.lookAt(0, 0, 0);
          L.cam.updateMatrixWorld(); L.post.render(L.scene, L.cam); L.post.render(L.scene, L.cam); }""")
        time.sleep(0.5)
        save(pg, "top", labelled(pg, 14, 0.55))
        b.close()

    S = lambda team, unit, n, at: {"type": "arenaSpawn", "team": team, "unit": unit, "n": n, "level": 1, "at": True, "x": at[0], "y": at[1]}
    CAM = "(c) => { const r = window.__session.view.surfaceRig; r.jumpTo(c.x, c.y, c.d); r.pitchBias = c.p; if (c.yaw !== null) { r.yaw = r.goalYaw = c.yaw; } }"

    if "arena" in WHAT:
        b, pg = page(p, "?play=1&mode=arena&teams=2&shot=1&q=high&seed=4&noui=1", 1280, 760)
        cx, cy = pg.evaluate("(() => { const A = window.__session.world.s.mode.arena; return [A.cx, A.cy]; })()")
        pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", [S(0, "cr:stagMedium", 1, (cx - 25, cy)), S(1, "ant:lasius_worker", 24, (cx + 45, cy))])
        pg.evaluate("window.__session.loop.advance(20 * 9)")
        st = pg.evaluate("(() => { const c = window.__session.world.s.creatures.find(c => c.kind === 'stagMedium'); return [c.x, c.y, c.h, c.state, c.hp / c.maxHp]; })()")
        pg.evaluate(CAM, {"x": st[0], "y": st[1], "d": 125, "p": 0.15, "yaw": -st[2] + 0.9})
        pg.evaluate("window.__step(3, 1/30)")
        time.sleep(0.3)
        print("medium male", st, flush=True)
        save(pg, "arena_workers_v_medium")
        b.close()

    if "wrestle" in WHAT:
        b, pg = page(p, "?play=1&mode=arena&teams=2&shot=1&q=high&seed=5&noui=1", 1280, 760)
        cx, cy = pg.evaluate("(() => { const A = window.__session.world.s.mode.arena; return [A.cx, A.cy]; })()")
        pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", [S(0, "cr:stagLarge", 1, (cx - 40, cy)), S(0, "cr:stagSmall", 1, (cx + 40, cy + 6))])
        # passive: the team's creatures stand (the bout runs before the arena's own orders)
        pg.evaluate("(c) => window.__session.issue(c)", {"type": "arenaStance", "team": 0, "stance": 2})
        pg.evaluate("window.__session.loop.advance(2)")
        pg.evaluate("""async () => { const m = await import('/src/sim/creatures/stagWrestle.ts'); const w = window.__session.world;
          const a = w.s.creatures.find(c => c.kind === 'stagLarge'); const b = w.s.creatures.find(c => c.kind === 'stagSmall');
          window.__wr = m.startStagWrestle(w, a, b); }""")
        print("started", pg.evaluate("window.__wr"), flush=True)
        st = lambda: pg.evaluate("(() => { const w = window.__session.world; return ['stagLarge', 'stagSmall'].map(k => { const c = w.s.creatures.find(c => c.kind === k); return [c.state, c.st, c.x, c.y, c.h]; }); })()")
        CS = {"Spar": 21, "Lock": 22, "Heave": 23, "Thrown": 24}
        want = [
            ("1_faceoff", lambda s: s[0][0] == CS["Spar"] and s[0][1] > 0.9),
            ("2_locked", lambda s: s[0][0] == CS["Lock"] and s[0][1] > 1.2),
            ("3_lift", lambda s: CS["Heave"] in (s[0][0], s[1][0]) and max(s[0][1], s[1][1]) > 0.75 and CS["Thrown"] in (s[0][0], s[1][0])),
            ("4_thrown", lambda s: CS["Thrown"] in (s[0][0], s[1][0]) and [x for x in s if x[0] == CS["Thrown"]][0][1] > 2.4),
        ]
        for name, cond in want:
            ok = False
            for _ in range(20 * 40):
                s = st()
                if cond(s):
                    ok = True
                    break
                pg.evaluate("window.__session.loop.advance(1)")
            if not ok:
                print("no", name, st(), flush=True)
                continue
            mx, my = (s[0][2] + s[1][2]) / 2, (s[0][3] + s[1][3]) / 2
            # from the large male's left (the camera sits at (sin yaw, cos yaw) from the pair), a little in front, above
            pg.evaluate(CAM, {"x": mx, "y": my, "d": 170, "p": -0.9, "yaw": -s[0][4] + 0.3})
            pg.evaluate("window.__step(3, 1/30)")
            time.sleep(0.3)
            print(name, s, flush=True)
            save(pg, "wrestle_" + name)
        b.close()
print("errors:", errs[:5])
