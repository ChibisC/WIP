"""Story titans get inside the nest (claude/story/05-spec-story-titans-get-inside.md §4): clips of The Long Nights'
red-knee tarantula and The Spider Mother digging into the player's nest while the army fights them at the hole (marker V
on the hole it digs: the dig ring, the hole opening in stages, the breakthrough banner), then walking through the nest
with the army after them. Frames from the screenshot harness (a virtual clock), MP4 clips with ffmpeg. Fails on page
errors, or if a titan is not inside at the end.

Run: tests/browser/with_server.sh python3 tests/browser/story_titans_in.py   (ONLY=nights,spider)
Clips: docs/story/shots/titans_in/<level>_surface.mp4, <level>_nest.mp4 (+ a few stills, frames in <level>_*_frames/)
"""
import os
import shutil
import subprocess
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "nights,spider").split(",")
Q = os.environ.get("Q", "medium")
# the army's size (ANTS) and which parts to film (PARTS: surface,nest — without the surface, the dig runs unrendered)
ANTS = os.environ.get("ANTS", "60")
PARTS = os.environ.get("PARTS", "surface,nest").split(",")
TAG = os.environ.get("TAG", "")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "story", "shots", "titans_in")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
errs = []
fails = []


def note(r):
    print(r, flush=True)


def wait_ready(pg, t0, limit=900):
    while time.time() - t0 < limit and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


# the titan of the level (its raid state), the player's army on marker V: on the hole it digs, then after it inside
TITAN = """(name) => { const w = window.__session.world, st = w.s.mode.mission.story; const a = st.actors.find((x) => x.name === name);
  if (!a) return null; const c = w.creatureById.get(a.ids[0]); if (!c) return null;
  return { x: c.x, y: c.y, h: c.h, space: c.space, hp: c.hp / c.maxHp, dead: c.dead, raid: c.data.raid || 0, rph: c.data.rph || 0, prog: c.data.rprog || 0, hole: c.data.rhole || 0, inside: c.data.rinside || 0 }; }"""
ARMY = """() => { const s = window.__session, w = s.world, c = s.player; const t = c.tiles.find((x) => x.type === 'brood');
  for (const a of w.s.ants) if (a.colony === c.id && a.tile < 0 && a.id !== c.queen) a.tile = t.q;
  s.issue({ type: 'assignGroup', group: t.group, marker: 4 }); }"""
ORDER = """([name]) => { const s = window.__session, w = s.world, c = s.player, st = w.s.mode.mission.story; const a = st.actors.find((x) => x.name === name);
  const cr = a && w.creatureById.get(a.ids[0]); if (!cr || cr.dead) return; const e = c.entrances[cr.data.raid ? (cr.data.rhole || 0) : 0];
  if (cr.space !== 0) s.issue({ type: 'placeMarker', i: 4, space: cr.space, x: cr.x, y: cr.y });
  else s.issue({ type: 'placeMarker', i: 4, space: 0, x: e.sx + (cr.x - e.sx) * 0.15, y: e.sy + (cr.y - e.sy) * 0.15 }); }"""
SIM = """(secs) => { const w = window.__session.world; for (let i = 0; i < secs * 20; i++) { w.step(0.05); w.events.drain(); } }"""


def cam(pg, cx, cz, dist, yaw, pitch, space="surface"):
    pg.evaluate(f"""() => {{ const s = window.__session, v = s.view;
      const r = '{space}' === 'nest' ? v.nestRig : v.surfaceRig; r.jumpTo({cx}, {cz}, {dist}); r.yaw = r.goalYaw = {yaw}; r.pitchBias = {pitch}; }}""")


def frames(pg, name, part, n, every, view, actor, dist, yaw, pitch, still_at=()):
    d = os.path.join(OUT, f"{name}_{part}_frames")
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    last = None
    for i in range(n):
        pg.evaluate(ORDER, [actor])
        pg.evaluate(f"window.__step({every}, 0.05)")
        t = pg.evaluate(TITAN, actor)
        if t and not t["dead"]:
            last = t
            if view == "nest" and t["space"] != 0:
                cam(pg, t["x"], t["y"], dist, yaw, pitch, "nest")
            elif view == "surface" and t["space"] == 0:
                c = pg.evaluate("() => { const e = window.__session.player.entrances; return e.map((x) => [x.sx, x.sy]); }")[t["hole"]]
                # between the titan and its hole, closing in on the hole as it digs
                k = 0.75 if t["rph"] >= 2 else 0.4
                cam(pg, c[0] + (t["x"] - c[0]) * (1 - k), c[1] + (t["y"] - c[1]) * (1 - k), dist, yaw, pitch)
        pg.screenshot(path=os.path.join(d, f"f{i:03d}.jpg"), type="jpeg", quality=85)
        if i in still_at:
            shutil.copy(os.path.join(d, f"f{i:03d}.jpg"), os.path.join(OUT, f"{name}_{part}_{i:03d}.jpg"))
    mp4 = os.path.join(OUT, f"{name}_{part}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "8", "-i", os.path.join(d, "f%03d.jpg"), "-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", mp4], check=True)
    note(f"  {mp4}")
    return last


def level(pg, name, actor, url, yaw, dist):
    t0 = time.time()
    pg.goto(BASE + url, wait_until="load")
    wait_ready(pg, t0)
    note(f"{name}: loaded in {time.time() - t0:.0f} s")
    pg.evaluate(ARMY)
    # (unrendered) until it is close to the hole it will dig
    for _ in range(400):
        pg.evaluate(ORDER, [actor])
        t = pg.evaluate(TITAN, actor)
        if t and t["raid"] and t["rph"] == 1:
            c = pg.evaluate("() => window.__session.player.entrances.map((x) => [x.sx, x.sy])")[t["hole"]]
            if ((t["x"] - c[0]) ** 2 + (t["y"] - c[1]) ** 2) ** 0.5 < 110:
                break
        pg.evaluate(SIM, 1)
    t = pg.evaluate(TITAN, actor)
    note(f"  close to the hole: {t}")
    # on the surface: the approach through the army, the dig (the ring, the hole's stages), the breakthrough (0.5 s a frame)
    if "surface" in PARTS:
        last = frames(pg, name, "surface", 40, 10, "surface", actor, dist, yaw, 0.12, still_at=(8, 20, 32))
        note(f"  after the surface clip: {last}")
    for _ in range(30):
        t = pg.evaluate(TITAN, actor)
        if not t or t["inside"] or t["dead"]:
            break
        pg.evaluate(ORDER, [actor])
        pg.evaluate("window.__step(20, 0.05)")
    t = pg.evaluate(TITAN, actor)
    if not t or not t["inside"]:
        fails.append(f"{name}: the titan is not inside ({t})")
    # underground: walking through the nest, breaking soil, the army after it (0.5 s a frame)
    pg.evaluate("() => { const s = window.__session; s.showArea(s.player.id + 1); }")
    pg.evaluate("window.__step(20, 0.05)")
    if "nest" in PARTS:
        last = frames(pg, name + TAG, "nest", 28, 10, "nest", actor, dist * 1.6, 0.0, 0.45, still_at=(6, 18))
        note(f"  after the nest clip: {last}")


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_context(viewport={"width": 1120, "height": 660}).new_page()
    pg.set_default_timeout(1800000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or "Error" in m.text) else None)
    if "nights" in ONLY:
        level(pg, "long_nights", "tarantula", "?story=longNights&stage=2&titan=1&ants=" + ANTS + "&shot=1&nocine=1&q=" + Q + "&seed=3&ticks=4", 2.6, 420)
    if "spider" in ONLY:
        level(pg, "spider_mother", "mother", "?story=spiderMother&stage=1&titan=1&ants=" + ANTS + "&shot=1&nocine=1&q=" + Q + "&seed=3&ticks=4", 2.4, 190)
    bad = [e for e in errs if "favicon" not in e]
    if bad:
        fails.append("page errors: " + " | ".join(bad[:5]))
    b.close()
print("FAIL: " + "; ".join(fails) if fails else "story titans-in clips done")
