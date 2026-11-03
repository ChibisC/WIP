"""Allies helping (CHANGE_PLAN §23): a clip of an AI ally's soldiers coming to the player's rescue, for the user.

Meadow Pond, you a Black garden colony with an AI Black garden ally next door (the team placement puts them close) and
a Red wood rival across the pond, everyone well grown (?developed=70). The rival's own brains are switched off; a band
of its soldiers is dropped in your nest by your queen. The ally brain sees the danger and sends fighter groups to
marker V: first on your nearest hole (so they go down into your nest), then on the fight.

The clip: your nest as the band breaks in; the surface, following the helpers from the ally's anthill to your holes;
your nest again until the invaders are gone and the helpers leave. Captions say what is happening (the game's own
messages to you included). Writes docs/ai/allies_help.mp4 and stills docs/ai/allies_help_{invaded,march,fight,clear}.jpg.
Fails on page errors, if no help is sent, or if the helpers never reach your nest.

Run: tests/browser/with_server.sh python3 tests/browser/ai_help.py     (BAND=24 SEED=5)
"""
import os, time, subprocess, shutil
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
BAND = int(os.environ.get("BAND", "24"))
SEED = int(os.environ.get("SEED", "5"))
W, H = 1120, 680
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "ai")
FR = os.path.join("/tmp", "ai_help_frames")
os.makedirs(OUT, exist_ok=True)
shutil.rmtree(FR, ignore_errors=True)
os.makedirs(FR, exist_ok=True)
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
FONT_B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)

STAT = """() => { const w = window.__session.world; const B = w.s.colonies[0];
  const A = w.s.colonies.find((c) => c.ai && c.team === B.team); const R = w.s.colonies.find((c) => c.team !== B.team);
  const grp = new Set(A.groups.filter((g) => g.marker === 4).map((g) => g.id)); const gof = new Map(A.tiles.map((t) => [t.q, t.group]));
  let helpers = 0, inB = 0, invaders = 0, sx = 0, sy = 0, ns = 0;
  for (const a of w.s.ants) { if (a.state === window.__DEAD || a.hp <= 0) continue;
    if (a.colony === A.id && grp.has(gof.get(a.tile))) { helpers++; if (a.space === B.id + 1) inB++; else if (a.space === 0) { sx += a.x; sy += a.y; ns++; } }
    if (a.colony === R.id && a.space === B.id + 1) invaders++; }
  const msgs = window.__msgs.splice(0);
  return { t: w.s.time, ally: A.aiAlly ? A.aiAlly.ally : -1, why: A.aiAlly ? (A.aiAlly.why || '') : '', helpers, inB, invaders,
           sx: ns ? sx / ns : null, sy: ns ? sy / ns : null, mine: B.living, msgs }; }"""

NEST_CAM = """() => { const s = window.__session; const w = s.world; const B = w.s.colonies[0]; const space = B.id + 1;
  s.viewedArea = space; s.view.setActiveNest(space); s.view.space = 'nest';
  const g = w.nest(B.id); const e = g.hexCenter(B.entrances[0].q); const q = w.antById.get(B.queen);
  const r = s.view.nestRig; r.jumpTo(e.x * 0.25 + q.x * 0.75, e.y * 0.25 + q.y * 0.75, Math.max(g.R * 18, Math.hypot(e.x - q.x, e.y - q.y) * 1.9)); r.pitchBias = 0.85; }"""


def caption(path, lines, msg=None):
    im = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(im, "RGBA")
    h = 18 + 28 * len(lines) + (28 if msg else 0)
    d.rectangle([0, H - h, W, H], fill=(16, 12, 8, 190))
    y = H - h + 10
    for k, t in enumerate(lines):
        d.text((18, y), t, fill=(240, 228, 205), font=FONT_B if k == 0 else FONT)
        y += 28
    if msg:
        d.text((18, y), f"Message to you: “{msg}”", fill=(150, 220, 140), font=FONT)
    im.save(path)


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={"width": W, "height": H})
    pg = ctx.new_page()
    pg.set_default_timeout(1800000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    t0 = time.time()
    pg.goto(BASE + f"?play=1&shot=1&noui=1&q=medium&seed={SEED}&creatures=0&map=meadowPond&species=lasius&allies=lasius&rival=formica&developed=70&ticks=40", wait_until="load")
    while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    print(f"loaded in {time.time() - t0:.0f} s", flush=True)
    # the rival does nothing but send this band; settle 20 s; then drop the band by your queen
    info = pg.evaluate("""async (band) => {
      const s = window.__session; const w = s.world; s.replayable = false;
      window.__DEAD = (await import('/src/sim/types.ts')).AS.Dead;
      window.__msgs = [];
      const B = w.s.colonies[0]; const A = w.s.colonies.find((c) => c.ai && c.team === B.team); const R = w.s.colonies.find((c) => c.team !== B.team);
      w.events.onAny((e) => { if (e.t === 'message' && e.colony === B.id && /ally/.test(e.text)) window.__msgs.push(e.text); });
      R.ai = false;
      s.loop.advance(400);
      const f = await import('/src/sim/factory.ts');
      const q = w.antById.get(B.queen);
      for (let i = 0; i < band; i++) { const a = f.makeAnt(w, R.id, 'formica_soldier', B.id + 1, q.x + ((i % 4) - 1.5) * 3, q.y + 14 + Math.floor(i / 4) * 3, -Math.PI / 2); a.task = 'guard'; a.alarm = 1; a.age = 1; }
      w.reindex();
      const hb = B.entrances, ha = A.entrances;
      const bx = hb.reduce((t, e) => t + e.sx, 0) / hb.length, by = hb.reduce((t, e) => t + e.sy, 0) / hb.length;
      const ax = ha.reduce((t, e) => t + e.sx, 0) / ha.length, ay = ha.reduce((t, e) => t + e.sy, 0) / ha.length;
      return { bx, by, ax, ay, d: Math.hypot(ax - bx, ay - by), A: A.name, B: B.name };
    }""", BAND)
    print("scene:", info, flush=True)

    frame = [0]
    shown = {"msg": None, "until": -1}

    def shot(lines, st, still=None):
        for m in st["msgs"]:
            shown["msg"], shown["until"] = m, frame[0] + 24
        pg.evaluate("window.__step(1, 1/30)")
        f = os.path.join(FR, f"f{frame[0]:04d}.png")
        pg.screenshot(path=f)
        caption(f, lines, shown["msg"] if frame[0] <= shown["until"] else None)
        if still:
            Image.open(f).convert("RGB").save(os.path.join(OUT, still), quality=88)
        frame[0] += 1

    def step():
        pg.evaluate("window.__session.loop.advance(10)")
        return pg.evaluate(STAT)

    # 1. your nest: the band breaks in by the queen
    pg.evaluate(NEST_CAM)
    pg.evaluate("window.__step(12, 1/30)")
    pg.evaluate(NEST_CAM)
    first = None
    st = None
    for k in range(60):
        st = step()
        shot(["Your nest: a band of Red wood soldiers breaks in by your queen", f"{BAND} invaders; your AI ally next door weighs the danger"], st, "allies_help_invaded.jpg" if k == 2 else None)
        if st["ally"] >= 0 and first is None:
            first = st["t"]
            print(f"help sent at {st['t']:.0f} s: {st}", flush=True)
        if first is not None and k >= 9:
            break
    # 2. the surface: follow the helpers from the ally's anthill to your holes
    if first is not None:
        pg.evaluate("() => { window.__session.view.space = 'surface'; }")
        cx, cy = info["ax"], info["ay"]
        n1 = 0
        while n1 < 140:
            st = step()
            if st["sx"] is not None:
                cx += (st["sx"] - cx) * 0.35
                cy += (st["sy"] - cy) * 0.35
            pg.evaluate(f"() => {{ const r = window.__session.view.surfaceRig; r.jumpTo({cx}, {cy}, 75); r.pitchBias = 0.7; }}")
            shot(["The ally sends fighter groups to marker V (help), keeping a home guard", f"{st['helpers']} soldiers on the way to your anthill"], st, "allies_help_march.jpg" if n1 == 30 else None)
            n1 += 1
            if st["helpers"] and st["inB"] >= max(1, st["helpers"] // 2):
                break
        print(f"surface part done at {st['t']:.0f} s: {st}", flush=True)
    # 3. your nest: down the entrance and onto the fight, until it is clear and they go home
    pg.evaluate(NEST_CAM)
    pg.evaluate("window.__step(12, 1/30)")
    pg.evaluate(NEST_CAM)
    fought = False
    cleared = None
    n2 = 0
    while n2 < 240:
        st = step()
        still = None
        if not fought and st["inB"] >= 3 and st["invaders"] > 0:
            fought, still = True, "allies_help_fight.jpg"
        if cleared is None and st["invaders"] == 0:
            cleared = n2
        if cleared is not None and n2 == cleared + 14:
            still = "allies_help_clear.jpg"
        if cleared is None:
            lines = ["Down your entrance: marker V moves from your hole onto the fight", f"{st['inB']} ally soldiers in your nest, {st['invaders']} invaders left"]
        else:
            lines = ["The invaders are gone: the ally lifts marker V and its soldiers go home", f"Your queen is safe ({st['mine']} of your ants left)"]
        shot(lines, st, still)
        n2 += 1
        if cleared is not None and n2 > cleared + 30:
            break
    print(f"nest part: {n2} frames, {st}", flush=True)
    ctx.close()
    b.close()

subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "12", "-i", os.path.join(FR, "f%04d.png"), "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", os.path.join(OUT, "allies_help.mp4")], check=False)
print(f"saved allies_help.mp4 ({frame[0]} frames)", flush=True)
bad = errs or first is None or not fought
print(("FAIL" if bad else "PASS") + f"  help sent: {first is not None}, helpers fought in your nest: {fought}, cleared: {cleared is not None} {errs[:3]}")
raise SystemExit(1 if bad else 0)
