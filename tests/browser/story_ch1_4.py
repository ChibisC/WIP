"""Chapter 1 as four levels in the browser (claude/story/04-spec): the island hub with the four nodes (an old two-level
save: progress kept by level id), the new levels' cards and the Genome's traits; The Long Nights by day, at dusk, in the
night (moonlight, the hunters at the ramps, wolf spiders' eyeshine at the lair mouths), the tarantula digging into the
nest and walking through it; The Spider Mother at her burrow, hunting at the nest in the dusk light, her spiderlings,
and digging in. Fails on page errors or shader warnings.

Run: tests/browser/with_server.sh python3 tests/browser/story_ch1_4.py   (ONLY=hub,nights,spider)
Screenshots: docs/story/shots/ch1_4/*.jpg
"""
import math
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "hub,nights,spider").split(",")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "story", "shots", "ch1_4")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
errs = []
fails = []

OLD_SAVE = """{ version: 1, levels: { garden: { won: true, plays: 1, time: 'gold', losses: 'silver', bonus: 'none', bestSeconds: 1100, bestLost: 30, hardest: 'normal' }, fireBanks: { won: true, plays: 1, time: 'silver', losses: 'gold', bonus: 'gold', bestSeconds: 2300, bestLost: 40, hardest: 'normal' } }, castes: ['lasius_soldier', 'fire_major'], bosses: 0, difficulty: {}, loadout: {}, journal: [{ level: 'garden', date: '2026-11-02', caste: 'lasius_soldier' }, { level: 'fireBanks', date: '2026-11-02', caste: 'fire_major' }], revealed: ['fireBanks'] }"""


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


# jump a story level to a stage and a game time (the clock runs on game time), then simulate `secs` without rendering
JUMP = """([stage, time]) => { const w = window.__session.world, m = w.s.mode.mission; m.stage = stage; m.entered = false; w.s.time = time; }"""
SIM = """(secs) => { const w = window.__session.world; for (let i = 0; i < secs * 20; i++) { w.step(0.05); w.events.drain(); } }"""
FLAG = """(f) => window.__session.world.s.mode.mission.story.flags.includes(f)"""
ACTOR = """(name) => { const w = window.__session.world, st = w.s.mode.mission.story; const a = st.actors.find((x) => x.name === name); if (!a) return null; for (const id of a.ids) { const c = w.creatureById.get(id); if (c && !c.dead) return { x: c.x, y: c.y, h: c.h, space: c.space, hp: c.hp / c.maxHp }; } return null; }"""


def front(a, dist, pitch=0.0, space="surface"):
    """the camera in front of a creature (its head toward the camera: the rig's offset is (sin yaw, cos yaw))"""
    return (a["x"], a["y"], dist, math.pi / 2 - a["h"], pitch, space)


def sim_until(pg, flag, limit):
    for _ in range(int(limit / 5)):
        if pg.evaluate(FLAG, flag):
            return True
        pg.evaluate(SIM, 5)
    return pg.evaluate(FLAG, flag)


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1280, "height": 760})
    pg = ctx.new_page()
    pg.set_default_timeout(1800000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
    if "hub" in ONLY:
        pg.goto(BASE + "?story=1", wait_until="load")
        pg.evaluate(f"() => localStorage.setItem('ud-campaign-v1', JSON.stringify({OLD_SAVE}))")
        pg.goto(BASE + "?story=1", wait_until="load")
        pg.wait_for_selector(".story-hub", timeout=60000)
        time.sleep(4)
        shot(pg, "hub_four_levels")
        pg.locator(".sh-lv[data-lv=longNights]").click()
        time.sleep(1.5)
        shot(pg, "hub_long_nights")
        pg.locator(".sh-lv[data-lv=spiderMother]").click()
        time.sleep(1.5)
        shot(pg, "hub_spider_mother")
        pg.evaluate("() => { const c = JSON.parse(localStorage.getItem('ud-campaign-v1')); c.traits = ['spiderlingVenom']; c.levels.spiderMother = { won: true, plays: 1, time: 'gold', losses: 'gold', bonus: 'gold', bestSeconds: 700, bestLost: 30, hardest: 'normal' }; localStorage.setItem('ud-campaign-v1', JSON.stringify(c)); }")
        pg.goto(BASE + "?story=1", wait_until="load")
        pg.wait_for_selector(".story-hub", timeout=60000)
        time.sleep(1)
        pg.locator(".sh-tab[data-tab=genome]").click()
        time.sleep(0.5)
        shot(pg, "hub_genome_trait")
        pg.evaluate("() => localStorage.removeItem('ud-campaign-v1')")
    if "nights" in ONLY:
        # by day: the terrace and the hollow below (UI on: the clock under the stage name)
        load(pg, "?story=longNights&shot=1&nocine=1&q=high&seed=3&ticks=40&cx=330&cz=620&dist=330&yaw=0.55&pitch=0.1")
        pg.evaluate("window.__step(3, 0.05)")
        shot(pg, "nights_day")
        # dusk: the beetle crossing the hollow
        pg.evaluate(JUMP, [0, 420 - 30 - 1])
        sim_until(pg, "beetleSeen", 20)
        pg.evaluate(SIM, 12)
        a = pg.evaluate(ACTOR, "duskBeetle")
        if a:
            cam(pg, a["x"], a["y"], 120, 2.5, 0.0)
        pg.evaluate("window.__step(40, 0.05)")
        shot(pg, "nights_dusk")
        # night 1: the hunters at the ramp tops, moonlight
        sim_until(pg, "night:1", 60)
        pg.evaluate(SIM, 50)
        a = pg.evaluate(ACTOR, "night1e")
        cam(pg, a["x"] if a else 400, a["y"] if a else 700, 160, 2.2, 0.05)
        pg.evaluate("window.__step(60, 0.05)")
        shot(pg, "nights_night1")
        # dusk of night 2: wolf spiders' eyes at the lair mouths (the camera looks at them from the terrace side)
        pg.evaluate(JUMP, [1, 420 + 210 + 330 - 30 - 1])
        sim_until(pg, "eyesSeen", 20)
        # (the light fades through the dusk: 20 s on it is mostly night)
        pg.evaluate(SIM, 20)
        a = pg.evaluate(ACTOR, "eyes")
        if a:
            cam(pg, *front(a, 110, -0.12))
        pg.evaluate("window.__step(60, 0.05)")
        shot(pg, "nights_eyes")
        # night 4 (the last): the tarantula digs into the nest, then walks through it
        pg.evaluate(JUMP, [3, 420 + 3 * (210 + 330) - 2])
        sim_until(pg, "tarantulaOut", 20)
        a = pg.evaluate(ACTOR, "tarantula")
        if a:
            cam(pg, *front(a, 280, 0.05))
        pg.evaluate("window.__step(40, 0.05)")
        shot(pg, "nights_tarantula_out")
        sim_until(pg, "tarantulaDigs", 150)
        pg.evaluate(SIM, 8)
        a = pg.evaluate(ACTOR, "tarantula")
        if a:
            cam(pg, a["x"], a["y"], 200, 2.6, 0.05)
        pg.evaluate("window.__step(40, 0.05)")
        shot(pg, "nights_tarantula_digs")
        sim_until(pg, "tarantulaIn", 120)
        pg.evaluate(SIM, 12)
        a = pg.evaluate(ACTOR, "tarantula")
        pg.evaluate("() => { const s = window.__session; s.showArea(s.world.s.colonies[0].id + 1); }")
        pg.evaluate("window.__step(80, 0.05)")
        if a:
            cam(pg, a["x"], a["y"], 430, 0.0, 0.4, "nest")
        pg.evaluate("window.__step(40, 0.05)")
        shot(pg, "nights_tarantula_nest")
    if "spider" in ONLY:
        load(pg, "?story=spiderMother&shot=1&nocine=1&q=high&seed=3&ticks=40&cx=600&cz=330&dist=150&yaw=2.9&pitch=0.0")
        pg.evaluate("window.__step(3, 0.05)")
        shot(pg, "spider_burrow")
        # the hunt at dusk: she comes to the nest
        pg.evaluate(JUMP, [2, 1500])
        pg.evaluate(SIM, 45)
        a = pg.evaluate(ACTOR, "mother")
        if a:
            cam(pg, *front(a, 170, 0.0))
        pg.evaluate("window.__step(60, 0.05)")
        shot(pg, "spider_hunt")
        # the brood phase: her spiderlings spill
        pg.evaluate("() => { const w = window.__session.world; const c = w.s.creatures.find((x) => x.kind === 'hogna' && !x.dead); c.hp = c.maxHp * 0.57; }")
        pg.evaluate(SIM, 3)
        a = pg.evaluate(ACTOR, "mother")
        if a:
            cam(pg, a["x"], a["y"], 130, 2.0, 0.05)
        pg.evaluate("window.__step(40, 0.05)")
        shot(pg, "spider_brood")
        # fury: she digs into the nest
        pg.evaluate("() => { const w = window.__session.world; const c = w.s.creatures.find((x) => x.kind === 'hogna' && !x.dead); c.hp = c.maxHp * 0.28; }")
        sim_until(pg, "hp:mother:30", 10)
        for _ in range(30):
            a = pg.evaluate(ACTOR, "mother")
            st = pg.evaluate("() => { const c = window.__session.world.s.creatures.find((x) => x.kind === 'hogna' && !x.dead); return c ? (c.data.rph || 0) : -1; }")
            if st >= 2:
                break
            pg.evaluate(SIM, 4)
        pg.evaluate(SIM, 6)
        a = pg.evaluate(ACTOR, "mother")
        if a:
            cam(pg, a["x"], a["y"], 150, 2.4, 0.05)
        pg.evaluate("window.__step(40, 0.05)")
        shot(pg, "spider_digs")
    bad = [e for e in errs if "favicon" not in e]
    if bad:
        fails.append("page errors: " + " | ".join(bad[:5]))
    b.close()
print("FAIL: " + "; ".join(fails) if fails else "chapter 1 browser check passed")
