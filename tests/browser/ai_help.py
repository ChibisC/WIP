"""Allies helping (CHANGE_PLAN §22): a clip of an AI ally's soldiers coming to the player's rescue, for the user.

Meadow Pond, you a Black garden colony with an AI Black garden ally next door (the team placement puts them close) and
a Red wood rival across the pond, all well grown (?developed=70). The rival's own brains are switched off; a band of
its soldiers is dropped in your nest by your queen. The ally brain sees the danger and sends fighter groups to marker V:
first on your nearest hole (so they go down into your nest), then on the fight. The clip follows them on the surface
from the ally's anthill to your holes, then in your nest until the invaders are gone and the helpers go home.

Writes docs/ai/allies_help.mp4 and stills docs/ai/allies_help_{march,fight,clear}.jpg. Fails on page errors, if no help
is sent, or if the helpers never reach your nest.

Run: tests/browser/with_server.sh python3 tests/browser/ai_help.py     (BAND=12 SEED=5)
"""
import os, time, subprocess, shutil
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
BAND = int(os.environ.get("BAND", "12"))
SEED = int(os.environ.get("SEED", "5"))
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "ai")
FR = os.path.join("/tmp", "ai_help_frames")
os.makedirs(OUT, exist_ok=True)
shutil.rmtree(FR, ignore_errors=True)
os.makedirs(FR, exist_ok=True)

STAT = """() => { const w = window.__session.world; const [B, A, R] = [w.s.colonies[0], w.s.colonies.find((c) => c.ai && c.team === w.s.colonies[0].team), w.s.colonies.find((c) => c.team !== w.s.colonies[0].team)];
  const grp = new Set(A.groups.filter((g) => g.marker === 4).map((g) => g.id)); const gof = new Map(A.tiles.map((t) => [t.q, t.group]));
  let helpers = 0, inB = 0, invaders = 0;
  for (const a of w.s.ants) { if (a.state === window.__DEAD || a.hp <= 0) continue;
    if (a.colony === A.id && grp.has(gof.get(a.tile))) { helpers++; if (a.space === B.id + 1) inB++; }
    if (a.colony === R.id && a.space === B.id + 1) invaders++; }
  return { t: w.s.time, ally: A.aiAlly ? A.aiAlly.ally : -1, why: A.aiAlly ? (A.aiAlly.why || '') : '', helpers, inB, invaders, queen: (w.antById.get(B.queen) || {}).hp }; }"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": 1280, "height": 760})
    pg = ctx.new_page()
    pg.set_default_timeout(1800000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    t0 = time.time()
    pg.goto(BASE + f"?play=1&shot=1&q=medium&seed={SEED}&creatures=0&map=meadowPond&species=lasius&allies=lasius&rival=formica&developed=70&ticks=40", wait_until="load")
    while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    print(f"loaded in {time.time() - t0:.0f} s", flush=True)
    # the rival does nothing but send this band; settle 20 s; then drop the band by your queen
    info = pg.evaluate("""async (band) => {
      const s = window.__session; const w = s.world; s.replayable = false;
      const B = w.s.colonies[0]; const A = w.s.colonies.find((c) => c.ai && c.team === B.team); const R = w.s.colonies.find((c) => c.team !== B.team);
      R.ai = false;
      s.loop.advance(400);
      const f = await import('/src/sim/factory.ts');
      window.__DEAD = (await import('/src/sim/types.ts')).AS.Dead;
      const q = w.antById.get(B.queen);
      for (let i = 0; i < band; i++) { const a = f.makeAnt(w, R.id, 'formica_soldier', B.id + 1, q.x + ((i % 4) - 1.5) * 3, q.y + 14 + Math.floor(i / 4) * 3, -Math.PI / 2); a.task = 'guard'; a.alarm = 1; a.age = 1; }
      w.reindex();
      const hb = B.entrances, ha = A.entrances;
      const bx = hb.reduce((t, e) => t + e.sx, 0) / hb.length, by = hb.reduce((t, e) => t + e.sy, 0) / hb.length;
      const ax = ha.reduce((t, e) => t + e.sx, 0) / ha.length, ay = ha.reduce((t, e) => t + e.sy, 0) / ha.length;
      return { bx, by, ax, ay, d: Math.hypot(ax - bx, ay - by), A: A.name, B: B.name };
    }""", BAND)
    print("scene:", info, flush=True)
    msgs = []

    def grab_msgs():
        # the message log on screen (the HUD keeps the last few)
        for t in pg.evaluate("() => [...document.querySelectorAll('.msg, .message, .toast')].map((e) => e.textContent)"):
            if t and t not in msgs:
                msgs.append(t)

    frame = [0]

    def shot(path=None):
        pg.evaluate("window.__step(1, 1/30)")
        f = os.path.join(FR, f"f{frame[0]:04d}.png")
        pg.screenshot(path=f)
        frame[0] += 1
        if path:
            shutil.copy(f, path)

    # 1. the surface: the ally's anthill and yours, the helpers marching over
    mx, my = (info["ax"] + info["bx"]) / 2, (info["ay"] + info["by"]) / 2
    pg.evaluate(f"() => {{ const s = window.__session; s.view.space = 'surface'; const r = s.view.surfaceRig; r.jumpTo({mx}, {my}, {max(140, info['d'] * 1.15)}); r.pitchBias = 0.55; }}")
    st = pg.evaluate(STAT)
    first = None
    marchShot = None
    while frame[0] <= 200:
        pg.evaluate("window.__session.loop.advance(10)")
        st = pg.evaluate(STAT)
        if first is None and st["ally"] >= 0:
            first = frame[0]
            marchShot = first + 24
            print(f"help sent {st['t']:.0f} s: {st}", flush=True)
        shot(os.path.join(OUT, "allies_help_march.jpg") if frame[0] == marchShot else None)
        grab_msgs()
        if first is not None and st["helpers"] and st["inB"] >= max(1, st["helpers"] // 2):
            break
    print(f"surface part: {frame[0]} frames, {st}", flush=True)
    # 2. your nest: the helpers come down the entrance and fight round the queen
    pg.evaluate("""() => { const s = window.__session; const w = s.world; const B = w.s.colonies[0]; const space = B.id + 1;
      s.viewedArea = space; s.view.setActiveNest(space); s.view.space = 'nest';
      const g = w.nest(B.id); const e = g.hexCenter(B.entrances[0].q); const q = w.antById.get(B.queen);
      const r = s.view.nestRig; r.jumpTo((e.x + q.x) / 2, (e.y + q.y) / 2, Math.max(g.R * 16, Math.hypot(e.x - q.x, e.y - q.y) * 1.6)); r.pitchBias = 0.6; }""")
    fought = False
    cleared = None
    n2 = 0
    while n2 < 260:
        pg.evaluate("window.__session.loop.advance(10)")
        st = pg.evaluate(STAT)
        still = None
        if not fought and st["inB"] >= 2 and st["invaders"] > 0 and n2 >= 20:
            still = os.path.join(OUT, "allies_help_fight.jpg")
            fought = True
        if cleared is None and st["invaders"] == 0:
            cleared = n2
        if cleared is not None and n2 == cleared + 30:
            still = os.path.join(OUT, "allies_help_clear.jpg")
        shot(still)
        grab_msgs()
        n2 += 1
        if cleared is not None and n2 > cleared + 40:
            break
    print(f"nest part: {n2} frames, {st}", flush=True)
    print("messages:", msgs, flush=True)
    ctx.close()
    b.close()

if shutil.which("ffmpeg"):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "12", "-i", os.path.join(FR, "f%04d.png"), "-vf", "scale=1280:-2,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", os.path.join(OUT, "allies_help.mp4")], check=False)
    print("saved allies_help.mp4", flush=True)
bad = errs or first is None or not fought
print(("FAIL" if bad else "PASS") + f"  help sent: {first is not None}, helpers in your nest: {fought}, cleared: {cleared is not None} {errs[:3]}")
raise SystemExit(1 if bad else 0)
