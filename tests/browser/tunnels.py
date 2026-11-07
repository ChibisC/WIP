"""The shared underground (claude/underground/01-spec-shared-underground-tunnels.md §7): stills of the tunnel routes —
the gate's loosened soil and the rock margin, digging toward the rival with hints, the defender's warning sign, the
breakthrough and the fog in the rival's nest, allies linked. Fails on page errors.

Run: BASE=http://127.0.0.1:5173/ python3 tests/browser/tunnels.py   (STAGES=gate,dig,warn,enemy,open,in,ally)
Stills: docs/underground/tunnels/<stage>.jpg
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
STAGES = os.environ.get("STAGES", "gate,dig,warn,enemy,open,in,ally").split(",")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "underground", "tunnels")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
os.makedirs(OUT, exist_ok=True)
errs = []


def wait_ready(pg, t0, limit=900):
    while time.time() - t0 < limit and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


# where to look: a gate of the player's (1) or the rival's (2) nest, at the route's rim, or the rival's queen
LOOK = {
    "gate": ("gate", 1, 45),
    "dig": ("gate", 1, 70),
    "warn": ("gate", 2, 70),
    "enemy": ("gate", 1, 70),
    "open": ("rim", 2, 80),
    "in": ("gate", 2, 90),
    "ally": ("gate", 2, 90),
}

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_context(viewport={"width": 1280, "height": 760}).new_page()
    pg.set_default_timeout(900000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    for stage in STAGES:
        what, nest, dist = LOOK[stage]
        demo = "dig" if stage == "gate" else stage
        t0 = time.time()
        pg.goto(BASE + f"?play=1&mode=skirmish&species=formica&rival=lasius&seed=3&creatures=0&titans=0&min=2&tunnel={demo}&shot=1&nocine=1&q=high&ticks=1&view=nest&nest={nest}", wait_until="load")
        wait_ready(pg, t0)
        pg.evaluate("window.__step(2, 0.05)")
        # aim the camera from the sim's data
        info = pg.evaluate(
            """(args) => {
              const s = window.__session; const w = s.world; const r = w.s.routes[0]; const [what, nest] = args;
              const space = s.areaTabs()[nest - 1].space; const g = w.nestOf(space);
              const h = r.halves[0].space === space ? r.halves[0] : r.halves[1];
              const q = what === 'gate' ? h.gate : h.steps[h.steps.length - 1][0];
              const c = g.hexCenter(q); s.view.nestRig.jumpTo(c.x, c.y, args[2]); s.view.nestRig.yaw = s.view.nestRig.goalYaw = Math.atan2(c.y - g.depthMm / 2, c.x - g.widthMm / 2) + Math.PI / 2;
              return { open: r.open, warned: r.halves.map((x) => x.warned), joined: r.halves.map((x) => !!x.joined), dig: s.player.routeDig };
            }""",
            [what, nest, dist],
        )
        pg.evaluate("window.__step(24, 0.05)")
        pg.screenshot(path=os.path.join(OUT, f"{stage}.jpg"), type="jpeg", quality=88)
        print(f"  {stage}: {info} [{time.time() - t0:.0f} s]", flush=True)
    b.close()
bad = [e for e in errs if "favicon" not in e]
print("FAIL: page errors: " + " | ".join(bad[:5]) if bad else "tunnel stills done")
