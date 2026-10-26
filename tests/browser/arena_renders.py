"""Battle-arena renders (DESIGN 3.13): four teams at the start and at the clash, creatures of three teams, two bosses,
ants climbing a passive stag beetle, termites against hell ants and Saiy-Ants close up, and the arena UI. Fails on page
errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/arena_renders.py docs/arena-renders   (ONLY=<name part>;
BASE=<server> for another dev server)
"""
import os, sys, time
from playwright.sync_api import sync_playwright
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "docs", "arena-renders")
ONLY = os.environ.get("ONLY", "")
os.makedirs(OUT, exist_ok=True)
res = []
def scene(ctx, name, teams, cmds, secs, cam, ui=False, size=(1400, 820)):
    if ONLY and ONLY not in name: return
    pg = ctx.new_page(); pg.set_viewport_size({"width": size[0], "height": size[1]}); pg.set_default_timeout(900000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    pg.goto(BASE + f"?play=1&mode=arena&teams={teams}&shot=1&q=low&seed=4" + ("" if ui else "&noui=1"), wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"): time.sleep(0.5)
    pg.evaluate("(cmds) => { const s = window.__session; for (const c of cmds) s.issue(c); }", cmds)
    for k in range(secs): pg.evaluate("window.__session.loop.advance(20)")
    pg.evaluate("(c) => { const s = window.__session; const A = s.world.s.mode.arena; const r = s.view.surfaceRig; const x = c.x ?? A.cx, y = c.y ?? A.cy; r.jumpTo(x, y, c.d); if (c.p !== undefined) r.pitchBias = c.p; if (c.yaw !== undefined) { r.yaw = r.goalYaw = c.yaw; } }", cam)
    pg.evaluate("window.__step(5, 0.05)"); time.sleep(0.5 if ui else 0.1)
    pg.screenshot(path=os.path.join(OUT, name + ".png"))
    st = pg.evaluate("() => { const A = window.__session.world.s.mode.arena; return [A.teams.map(t => t.alive), window.__session.world.s.ants.filter(a => (a.ridePh || 0) >= 1).length]; }")
    res.append(f"{'PASS' if not errs else 'FAIL'}  {name} alive {st[0]} riding {st[1]} {errs[:2]}"); print(res[-1], flush=True)
    pg.close()
S = lambda team, unit, n, lv=1, at=None: {"type": "arenaSpawn", "team": team, "unit": unit, "n": n, "level": lv, "at": at is not None, "x": at[0] if at else 0, "y": at[1] if at else 0}
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context()
    four = [S(0, "ant:formica_soldier", 25), S(1, "ant:fire_major", 10), S(1, "ant:fire_minor", 30), S(2, "cr:wolfSpider", 3), S(2, "ant:atta_media", 25), S(3, "ant:eciton_major", 8), S(3, "ant:eciton_minor", 30)]
    scene(ctx, "four_teams_start", 4, four, 1, {"d": 360, "p": 0.75})
    scene(ctx, "four_teams_clash", 4, four, 9, {"d": 170, "p": 0.55})
    scene(ctx, "creatures_three_teams", 3, [S(0, "cr:groundBeetle", 3), S(1, "cr:wolfSpider", 3), S(2, "cr:rove", 2), S(2, "cr:lithobius", 1)], 8, {"d": 120, "p": 0.5})
    scene(ctx, "boss_v_boss", 2, [S(0, "cr:stagBeetle", 1), S(1, "cr:tarantula", 1)], 9, {"d": 280, "p": 0.5})
    scene(ctx, "climb_passive_stag", 2, [{"type": "arenaStance", "team": 1, "stance": 2}, S(1, "cr:stagBeetle", 1, 1, (280, 280)), S(0, "ant:lasius_soldier", 40)], 14, {"x": 280, "y": 280, "d": 95, "p": 0.4})
    scene(ctx, "termites_v_ants_close", 2, [S(0, "ant:nasute_soldier", 15), S(0, "ant:rhy_soldier", 8), S(1, "ant:hell_soldier", 10), S(1, "ant:aurimyrmex_soldier", 10)], 8, {"d": 60, "p": 0.45})
    scene(ctx, "ui_four_teams", 4, four, 6, {"d": 240, "p": 0.6}, ui=True)
    b.close()
print("FAILED" if any(r.startswith("FAIL") for r in res) else "arena renders OK")
