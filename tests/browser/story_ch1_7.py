"""Chapter 1 as seven levels in the browser (claude/story/06-spec-levels-5-7-and-lengths.md): the island hub with the
seven nodes (the Forest Floor and the Rainforest out of the mist), and the three new levels at their set pieces — The
Antlered King (the woods, two males wrestling at the sap, the titan coming down from his stump, digging in), High Water
(the summit above three nests, the plain under water, the river over the hill's foot and the west nest flooding below
ground), Carton Kingdom (the termites' shelf and carton nests, the shower over the hollow and the alates after it) —
and two surprise events in the old levels (a red wood ant column in the garden, an army ant swarm on the river bank).
Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/story_ch1_7.py   (ONLY=hub,stag,water,termites,events)
Screenshots: docs/story/shots/ch1_7/*.jpg
"""
import math
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "hub,stag,water,termites,events").split(",")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "story", "shots", "ch1_7")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
errs = []

SAVE = """{ version: 1, levels: { garden: { won: true, plays: 1, time: 'gold', losses: 'silver', bonus: 'none', bestSeconds: 1500, bestLost: 30, hardest: 'normal' }, longNights: { won: true, plays: 1, time: 'gold', losses: 'gold', bonus: 'gold', bestSeconds: 2310, bestLost: 60, hardest: 'normal' }, fireBanks: { won: true, plays: 1, time: 'silver', losses: 'gold', bonus: 'gold', bestSeconds: 2300, bestLost: 40, hardest: 'normal' }, spiderMother: { won: true, plays: 1, time: 'gold', losses: 'gold', bonus: 'none', bestSeconds: 1900, bestLost: 45, hardest: 'normal' } }, castes: ['lasius_soldier', 'fire_major'], traits: ['spiderlingVenom'], bosses: 1, difficulty: {}, loadout: {}, journal: [{ level: 'garden', date: '2026-11-02', caste: 'lasius_soldier' }, { level: 'fireBanks', date: '2026-11-02', caste: 'fire_major' }], revealed: ['fireBanks', 'longNights', 'spiderMother'] }"""


def note(r):
    print(r, flush=True)


def wait_ready(pg, t0, limit=900):
    while time.time() - t0 < limit and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


def shot(pg, name):
    pg.screenshot(path=os.path.join(OUT, name + ".jpg"), type="jpeg", quality=86)
    note(f"  shot {name}")


def load(pg, q):
    t0 = time.time()
    pg.goto(BASE + q, wait_until="load")
    wait_ready(pg, t0)
    note(f"loaded {q.split('&')[0]} in {time.time() - t0:.0f} s")


def cam(pg, cx, cz, dist, yaw, pitch, space="surface"):
    pg.evaluate(f"""() => {{ const s = window.__session, v = s.view;
      const r = '{space}' === 'nest' ? v.nestRig : v.surfaceRig; r.jumpTo({cx}, {cz}, {dist}); r.yaw = r.goalYaw = {yaw}; r.pitchBias = {pitch}; }}""")


JUMP = """([stage, time]) => { const w = window.__session.world, m = w.s.mode.mission; m.stage = stage; m.entered = false; w.s.time = time; }"""
SIM = """(secs) => { const w = window.__session.world; for (let i = 0; i < secs * 20; i++) { w.step(0.05); w.events.drain(); } }"""
FLAG = """(f) => window.__session.world.s.mode.mission.story.flags.includes(f)"""
ACTOR = """(name) => { const w = window.__session.world, st = w.s.mode.mission.story; const a = st.actors.find((x) => x.name === name); if (!a) return null; for (const id of a.ids) { const c = w.creatureById.get(id) ?? w.antById.get(id); if (c && !c.dead && c.state !== 9) return { x: c.x, y: c.y, h: c.h, space: c.space }; } return null; }"""
# let every surprise event but one go (so the shot's own event is not held back by another)
ONLY_EVENT = """(id) => { const st = window.__session.world.s.mode.mission.story; for (const s of st.surp ?? []) if (s.id !== id) s.done = 1; const e = (st.surp ?? []).find((s) => s.id === id); return e ? e.at : -1; }"""


def front(a, dist, pitch=0.0, space="surface"):
    return (a["x"], a["y"], dist, math.pi / 2 - a["h"], pitch, space)


def sim_until(pg, flag, limit):
    for _ in range(int(limit / 5)):
        if pg.evaluate(FLAG, flag):
            return True
        pg.evaluate(SIM, 5)
    return pg.evaluate(FLAG, flag)


def render(pg, frames=40):
    pg.evaluate(f"window.__step({frames}, 0.05)")


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1280, "height": 760})
    pg = ctx.new_page()
    pg.set_default_timeout(1800000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
    if "hub" in ONLY:
        pg.goto(BASE + "?story=1", wait_until="load")
        pg.evaluate(f"() => localStorage.setItem('ud-campaign-v1', JSON.stringify({SAVE}))")
        pg.goto(BASE + "?story=1", wait_until="load")
        pg.wait_for_selector(".story-hub", timeout=60000)
        time.sleep(4)
        shot(pg, "hub_seven_levels")
        pg.locator(".sh-lv[data-lv=antleredKing]").click()
        time.sleep(1.5)
        shot(pg, "hub_antlered_king")
        pg.evaluate("() => localStorage.removeItem('ud-campaign-v1')")
    if "stag" in ONLY:
        load(pg, "?story=antleredKing&shot=1&nocine=1&q=high&seed=3&ticks=40&cx=640&cz=560&dist=520&yaw=0.6&pitch=0.25")
        render(pg)
        shot(pg, "king_woods")
        # the sap run: two males meet at the oak and wrestle
        pg.evaluate(JUMP, [1, 600])
        sim_until(pg, "sapMeet", 120)
        pg.evaluate(SIM, 4)
        cam(pg, 675, 515, 130, 0.4, -0.05)
        render(pg)
        shot(pg, "king_sap_wrestle")
        pg.evaluate(SIM, 8)
        render(pg)
        shot(pg, "king_sap_wrestle2")
        # the Antlered King comes down from his stump
        pg.evaluate(JUMP, [3, 1800])
        sim_until(pg, "kingOut", 30)
        pg.evaluate(SIM, 10)
        a = pg.evaluate(ACTOR, "king")
        if a:
            cam(pg, *front(a, 230, 0.05))
        render(pg)
        shot(pg, "king_out")
        # a quarter of his health left: he digs into the nest
        pg.evaluate("() => { const w = window.__session.world, st = w.s.mode.mission.story; const a = st.actors.find((x) => x.name === 'king'); const c = w.creatureById.get(a.ids[0]); c.hp = c.maxHp * 0.24; }")
        sim_until(pg, "kingIn", 120)
        a = pg.evaluate(ACTOR, "king")
        if a and a["space"] != 0:
            pg.evaluate("() => window.__session.setSpace?.('nest')")
            cam(pg, a["x"], a["y"], 140, 0.6, 0.1, "nest")
        elif a:
            cam(pg, *front(a, 160, 0.05))
        render(pg)
        shot(pg, "king_dig_in")
    if "water" in ONLY:
        load(pg, "?story=highWater&shot=1&nocine=1&q=high&seed=3&ticks=40&cx=600&cz=560&dist=620&yaw=0.2&pitch=0.3")
        render(pg)
        shot(pg, "water_hill")
        # the plain goes under
        pg.evaluate(JUMP, [1, 600])
        pg.evaluate(SIM, 40)
        cam(pg, 600, 820, 420, 0.3, 0.2)
        render(pg)
        shot(pg, "water_plain_flooded")
        # the hill's foot floods, and the west nest with it (below ground)
        pg.evaluate(JUMP, [2, 1200])
        pg.evaluate(SIM, 70)
        cam(pg, 300, 520, 420, 0.9, 0.2)
        render(pg)
        shot(pg, "water_foot_flooded")
    if "termites" in ONLY:
        load(pg, "?story=cartonKingdom&shot=1&nocine=1&q=high&seed=3&ticks=40&cx=1020&cz=330&dist=420&yaw=1.2&pitch=0.2")
        render(pg)
        shot(pg, "carton_shelf")
        # the shower over the hollow, then the alates
        at = pg.evaluate(ONLY_EVENT, "shower")
        pg.evaluate(JUMP, [1, 900])
        sim_until(pg, "ev:shower", 400)
        pg.evaluate(SIM, 20)
        cam(pg, 600, 600, 360, 0.5, 0.15)
        render(pg, 80)
        shot(pg, "carton_shower")
        sim_until(pg, "ev:alatesN", 90)
        pg.evaluate(SIM, 3)
        cam(pg, 780, 400, 180, 0.8, 0.05)
        render(pg)
        shot(pg, "carton_alates")
    if "events" in ONLY:
        load(pg, "?story=garden&shot=1&nocine=1&q=high&seed=5&ticks=40")
        at = pg.evaluate(ONLY_EVENT, "woodAnts")
        if at > 0:
            pg.evaluate(JUMP, [0, at - 1])
            sim_until(pg, "ev:woodAnts", 10)
            pg.evaluate(SIM, 18)
            a = pg.evaluate(ACTOR, "woodAnts")
            if a:
                cam(pg, a["x"], a["y"], 140, 2.6, 0.05)
            render(pg)
            shot(pg, "event_wood_ant_column")
        load(pg, "?story=fireBanks&diff=brutal&shot=1&nocine=1&q=high&seed=1&ticks=40")
        at = pg.evaluate(ONLY_EVENT, "armySwarm")
        if at > 0:
            pg.evaluate(JUMP, [0, at - 1])
            sim_until(pg, "ev:armySwarm", 10)
            pg.evaluate(SIM, 12)
            a = pg.evaluate(ACTOR, "armySwarm")
            if a:
                cam(pg, a["x"], a["y"], 170, 0.3, 0.05)
            render(pg)
            shot(pg, "event_army_ant_swarm")
    b.close()
print("FAIL: " + " | ".join(errs[:6]) if errs else "chapter 1 (seven levels) shots done")
