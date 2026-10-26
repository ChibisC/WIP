"""Phones and tablets (core/device.ts, core/input.ts touch gestures, GameUI compact layout). In Chromium's mobile
emulation (touch events, coarse pointer) at iPhone and iPad sizes:

  - the touch mode and the compact layout switch on where they should (not on an iPad in landscape), and the
    "turn your phone sideways" hint shows only on a phone in portrait;
  - one finger drags the ground (and a drag is not a tap), a tap is a click (a marker is placed), a long press is a
    right-click (the marker is lifted), two fingers pinch-zoom and twist-rotate with the ground following the fingers,
    three fingers tilt;
  - with the dig tool a tap and a drag mark soil, and a two-finger gesture marks nothing;
  - the Build drawer, the Map button, the cancel button for tools and long-press tooltips (whose press is not a tap);
  - screenshots of the menu, the start screen, the surface, the nest with the build drawer and maps open, and the
    battle arena on each device.
Fails on page errors, shader warnings or any check.

Run: tests/browser/with_server.sh python3 tests/browser/mobile.py docs/mobile-renders   (ONLY=<device name parts, comma-separated>)
"""
import math, os, sys, time
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "docs", "mobile-renders")
ONLY = os.environ.get("ONLY", "")
os.makedirs(OUT, exist_ok=True)
UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
UA_PAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
# name, width, height, user agent, compact layout expected
DEVICES = [
    ("iphone15_landscape", 852, 393, UA_PHONE, True),
    ("iphoneSE_landscape", 667, 375, UA_PHONE, True),
    ("ipad_portrait", 820, 1180, UA_PAD, True),
    ("ipad_landscape", 1180, 820, UA_PAD, False),
]
res = []


def check(name, ok, detail=""):
    res.append(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))
    print(res[-1], flush=True)


def touch(cdp, kind, pts):
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i, "radiusX": 4, "radiusY": 4, "force": 1} for i, (x, y) in enumerate(pts)]})


def gesture(cdp, pg, start, end, steps=8, hold=0.0):
    """Fingers from `start` to `end` (lists of points), then lifted; frames are stepped so the camera takes it in."""
    touch(cdp, "touchStart", start)
    if hold:
        time.sleep(hold)
    for k in range(1, steps + 1):
        f = k / steps
        touch(cdp, "touchMove", [(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) for a, b in zip(start, end)])
        pg.evaluate("window.__step(1, 0.016)")
    touch(cdp, "touchEnd", [])
    pg.evaluate("window.__step(1, 0.016)")


def settle(pg, n=60):
    pg.evaluate(f"window.__step({n}, 0.016)")


def rig(pg):
    return pg.evaluate("() => { const s = window.__session; const r = s.view.space === 'nest' ? s.view.nestRig : s.view.surfaceRig; return { x: r.goal.x, z: r.goal.z, d: r.goalDistance, yaw: r.goalYaw, pitch: r.pitchBias }; }")


def ground(pg, x, y):
    return pg.evaluate("([x, y]) => { const p = window.__session.view.pickSurface(x, y); return p ? [p.x, p.z] : null; }", [x, y])


def open_game(ctx, url, errs):
    pg = ctx.new_page()
    pg.set_default_timeout(600000)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if ("THREE.WebGLProgram" in m.text or (m.type == "error" and "fonts" not in m.text and "ERR_" not in m.text)) else None)
    pg.goto(BASE + url, wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 300 and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)
    settle(pg, 6)
    return pg


def shot(pg, name):
    time.sleep(0.3)
    pg.screenshot(path=os.path.join(OUT, name + ".png"))


with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    # ---- phone in portrait: the rotate hint, nothing else
    if not ONLY or "portrait_phone" in ONLY:
        ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=1, is_mobile=True, has_touch=True, user_agent=UA_PHONE)
        pg = ctx.new_page()
        pg.goto(BASE, wait_until="load")
        time.sleep(2)
        hint = pg.evaluate("() => { const h = document.querySelector('.rotate-hint'); return !!h && getComputedStyle(h).display !== 'none'; }")
        check("iPhone portrait: touch mode, and the 'turn your phone sideways' hint covers the screen", pg.evaluate("document.documentElement.classList.contains('touch') && document.documentElement.classList.contains('phone')") and hint)
        shot(pg, "iphone_portrait_rotate_hint")
        pg.set_viewport_size({"width": 852, "height": 393})
        time.sleep(0.5)
        hint2 = pg.evaluate("() => getComputedStyle(document.querySelector('.rotate-hint')).display !== 'none'")
        check("iPhone turned to landscape: the hint goes away", not hint2)
        ctx.close()

    for name, W, H, ua, compact in DEVICES:
        if ONLY and not any(o and o in name for o in ONLY.split(",")):
            continue
        errs = []
        ctx = b.new_context(viewport={"width": W, "height": H}, device_scale_factor=1, is_mobile=True, has_touch=True, user_agent=ua)
        # ---- title menu and start screen
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE, wait_until="load")
        time.sleep(2)
        check(f"{name}: touch mode on", pg.evaluate("document.documentElement.classList.contains('touch')"))
        shot(pg, f"{name}_title")
        pg.locator(".mode-card").first.tap()
        time.sleep(1)
        shot(pg, f"{name}_start_screen")
        # the start screen scrolls to its Start button on a short screen
        go = pg.locator(".go").first
        go.scroll_into_view_if_needed()
        box = go.bounding_box()
        check(f"{name}: the start screen's Start button can be reached", box is not None and box["y"] >= 0 and box["y"] + box["height"] <= H + 1, str(box))
        pg.close()

        # ---- in the game (screenshot harness: frames stepped by hand)
        pg = open_game(ctx, "?play=1&mode=skirmish&shot=1&q=low&seed=4", errs)
        cdp = ctx.new_cdp_session(pg)
        is_compact = pg.evaluate("document.querySelector('.gui').classList.contains('compact')")
        check(f"{name}: compact layout {'on' if compact else 'off'}", is_compact == compact, f"--ui {pg.evaluate('getComputedStyle(document.documentElement).getPropertyValue(\"--ui\")')}")
        # nothing in the bottom bar overlaps: marker panel and build panel side by side, both on screen
        boxes = pg.evaluate("() => ['.mp', '.bp', '.mm'].map(q => { const r = document.querySelector(q).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })")
        mp, bp, mm = boxes
        check(f"{name}: marker panel and build panel on screen, not overlapping", mp[2] <= bp[0] + 1 and bp[2] <= W + 1 and mp[0] >= 0 and bp[3] <= H + 1, f"mp {mp}, bp {bp}")
        # the smallest tappable control in the bottom bar and top bar
        small = pg.evaluate("() => Math.min(...[...document.querySelectorAll('.gui .bbtn, .gui .mp-head, .gui .at-tab')].filter(e => e.offsetParent).map(e => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)))")
        check(f"{name}: controls are big enough for a finger (smallest {small:.0f} px ≥ 24)", small >= 24)
        shot(pg, f"{name}_surface")
        cx, cy = W / 2, H * 0.42

        # the marker panel opened: its controls too; in the compact layout each column's orders sit behind one button
        folded = pg.evaluate("document.querySelector('.mp').classList.contains('collapsed')")
        if folded:
            pg.locator(".mp-side .bbtn").first.tap()
            settle(pg, 2)
        small = pg.evaluate("() => Math.min(...[...document.querySelectorAll('.gui .bbtn, .gui .mp-head, .gui .at-tab')].filter(e => e.offsetParent).map(e => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)))")
        mp, bp = pg.evaluate("() => ['.mp', '.bp'].map(q => { const r = document.querySelector(q).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })")
        check(f"{name}: marker panel open: controls big enough (smallest {small:.0f} px ≥ 24), beside the build panel", small >= 24 and mp[2] <= bp[0] + 1 and mp[1] >= 0, f"mp {mp}, bp {bp}")
        if compact:
            pg.locator(".mp-col[data-col='0'] .mp-ordbtn").tap()
            settle(pg, 2)
            sw = pg.evaluate("() => [...document.querySelectorAll('.mp-col.ord-open .mp-ord')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })")
            ok = len(sw) == 3 and all(min(r[2] - r[0], r[3] - r[1]) >= 24 and r[0] >= 0 and r[2] <= W and r[1] >= 0 and r[3] <= H for r in sw)
            check(f"{name}: a column's Orders button opens its three switches, finger-sized and on screen", ok, str([[round(v) for v in r] for r in sw]))
            was = bool(pg.evaluate("window.__session.player.markers[0].noAttack"))  # unset (undefined) counts as off
            pg.locator(".mp-col.ord-open .mp-ord[data-order='noAttack']").tap()
            settle(pg, 4)
            now = bool(pg.evaluate("window.__session.player.markers[0].noAttack"))
            still = pg.evaluate("!!document.querySelector('.mp-col.ord-open')")
            summary = pg.evaluate("document.querySelector(\".mp-col[data-col='0'] .mp-ordbtn .os\").classList.contains('on')")
            check(f"{name}: tapping a switch sets the order, the switches stay open and the button shows it", now != was and still and summary == now, f"noAttack {was} → {now}, open {still}, summary {summary}")
            shot(pg, f"{name}_marker_orders")
            pg.locator(".mp-col.ord-open .mp-ord[data-order='noAttack']").tap()
            settle(pg, 4)
            # a tap elsewhere closes them: open ground near the top (not next to a button: Chromium's touch
            # adjustment moves a tap onto a nearby button, e.g. another column's Orders button below its count)
            pg.touchscreen.tap(cx, H * 0.25)
            settle(pg, 2)
            check(f"{name}: a tap outside closes the switches", not pg.evaluate("!!document.querySelector('.mp-col.ord-open')") and bool(pg.evaluate("window.__session.player.markers[0].noAttack")) == was)
        if folded:
            pg.locator(".mp-side .bbtn").first.tap()
            settle(pg, 2)

        # one finger: a drag pans and is not a tap (no inspect, no click)
        r0 = rig(pg)
        g0 = ground(pg, cx - 80, cy)
        gesture(cdp, pg, [(cx - 80, cy)], [(cx + 80, cy + 20)])
        settle(pg)
        r1 = rig(pg)
        g1 = ground(pg, cx + 80, cy + 20)
        moved = math.hypot(r1["x"] - r0["x"], r1["z"] - r0["z"])
        follow = math.hypot(g1[0] - g0[0], g1[1] - g0[1]) if g0 and g1 else 999
        span = math.hypot(*(a - b for a, b in zip(ground(pg, cx - 80, cy), ground(pg, cx + 80, cy + 20))))
        check(f"{name}: one-finger drag pans the camera, the ground following the finger", moved > 5 and follow < span * 0.5, f"camera moved {moved:.1f} mm; ground under the finger off by {follow:.1f} of {span:.1f} mm")

        # pinch apart: zoom in
        d0 = rig(pg)["d"]
        gesture(cdp, pg, [(cx - 40, cy), (cx + 40, cy)], [(cx - 120, cy), (cx + 120, cy)])
        settle(pg)
        d1 = rig(pg)["d"]
        check(f"{name}: pinching apart zooms in", d1 < d0 * 0.6, f"{d0:.0f} → {d1:.0f}")
        gesture(cdp, pg, [(cx - 120, cy), (cx + 120, cy)], [(cx - 40, cy), (cx + 40, cy)])
        settle(pg)
        check(f"{name}: pinching together zooms out again", rig(pg)["d"] > d1 * 1.6)

        # twist: the ground turns with the fingers (centre of the view; finger 1 starts left of it)
        R = 90
        a0, a1 = 0.0, 0.6  # radians, clockwise on screen
        p1s = (cx - R * math.cos(a0), cy - R * math.sin(a0))
        p2s = (cx + R * math.cos(a0), cy + R * math.sin(a0))
        p1e = (cx - R * math.cos(a1), cy - R * math.sin(a1))
        p2e = (cx + R * math.cos(a1), cy + R * math.sin(a1))
        w1 = ground(pg, *p1s)
        y0 = rig(pg)["yaw"]
        gesture(cdp, pg, [p1s, p2s], [p1e, p2e], steps=12)
        settle(pg, 90)
        y1 = rig(pg)["yaw"]
        w1e = ground(pg, *p1e)
        w1s = ground(pg, *p1s)
        off_end = math.hypot(w1e[0] - w1[0], w1e[1] - w1[1])
        off_start = math.hypot(w1s[0] - w1[0], w1s[1] - w1[1])
        check(f"{name}: twisting rotates the view, the ground turning with the fingers", abs(y1 - y0) > 0.3 and off_end < off_start, f"yaw {y0:.2f} → {y1:.2f}; the point first under finger 1 is {off_end:.1f} mm from it at the end (it would be {off_start:.1f} where it started)")

        # three fingers up: tilt
        t0 = rig(pg)["pitch"]
        gesture(cdp, pg, [(cx - 60, cy + 40), (cx, cy + 40), (cx + 60, cy + 40)], [(cx - 60, cy - 20), (cx, cy - 20), (cx + 60, cy - 20)])
        settle(pg)
        check(f"{name}: three fingers dragged up or down tilt the camera", abs(rig(pg)["pitch"] - t0) > 0.05, f"{t0:.2f} → {rig(pg)['pitch']:.2f}")

        # a tap is a click: marker I, then a tap on the ground places it
        pg.locator(".mp-col[data-col='0'] .mp-head").tap()
        settle(pg, 2)
        tool = pg.evaluate("window.__session.tool")
        chip = pg.evaluate("() => { const c = document.querySelector('.touch-cancel'); return c && c.classList.contains('show') ? c.textContent : ''; }")
        check(f"{name}: tapping a marker head picks the marker; the cancel button appears", tool == "marker" and "Cancel" in chip, f"tool {tool}, chip '{chip}'")
        touch(cdp, "touchStart", [(cx + 30, cy + 10)])
        touch(cdp, "touchEnd", [])
        settle(pg, 4)
        placed = pg.evaluate("window.__session.player.markers[0].placed")
        check(f"{name}: a tap on the ground places the marker", placed)
        # long press on it: lifted (a right-click)
        touch(cdp, "touchStart", [(cx + 30, cy + 10)])
        time.sleep(0.8)
        touch(cdp, "touchEnd", [])
        settle(pg, 4)
        check(f"{name}: a long press on a placed marker lifts it (right-click)", not pg.evaluate("window.__session.player.markers[0].placed"))
        # the cancel button cancels a tool
        pg.locator(".mp-col[data-col='1'] .mp-head").tap()
        settle(pg, 1)
        pg.locator(".touch-cancel").tap()
        settle(pg, 1)
        check(f"{name}: the cancel button drops the tool", pg.evaluate("window.__session.tool") == "none")

        # long-press tooltip on a build-panel button: shown, and the press is not a tap
        if compact:
            pg.locator(".bp-open").tap()
            settle(pg, 1)
            check(f"{name}: the Build button opens the drawer", pg.evaluate("document.querySelector('.bp').classList.contains('open')"))
        btn = pg.locator(".bp-grid .tbtn").first
        bb = btn.bounding_box()
        touch(cdp, "touchStart", [(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)])
        time.sleep(0.8)
        tip = pg.evaluate("() => { const t = document.querySelector('.tip'); return t.classList.contains('show') ? t.textContent.slice(0, 40) : ''; }")
        touch(cdp, "touchEnd", [])
        settle(pg, 2)
        check(f"{name}: a long press on a button shows its tooltip and does not press it", bool(tip) and pg.evaluate("window.__session.tool") == "none", f"tip '{tip}', tool {pg.evaluate('window.__session.tool')}")

        # the nest: dig by tap and by drag; a two-finger gesture digs nothing
        pg.evaluate("() => { const s = window.__session; s.view.space = 'nest'; s.viewedArea = s.areaTabs()[0].space; s.view.setActiveNest(s.viewedArea); }")
        settle(pg, 30)
        pg.evaluate("window.__session.setTool('dig')")
        desig = "() => window.__session.world.nest(window.__session.player.id).designatedCount"
        n0 = pg.evaluate(desig)
        # two fingers in dig mode: a camera gesture, no digging
        gesture(cdp, pg, [(cx - 60, cy + 30), (cx + 60, cy + 30)], [(cx - 90, cy + 30), (cx + 90, cy + 30)])
        settle(pg, 3)
        n1 = pg.evaluate(desig)
        check(f"{name}: a two-finger gesture with the dig tool marks no soil", n1 == n0, f"{n0} → {n1}")
        # find soil that can be dug near the middle of the screen
        spot = pg.evaluate("""([W, H]) => { const s = window.__session; const g = s.world.nest(s.player.id);
            for (let r = 0; r < 260; r += 12) for (let a = 0; a < 6.28; a += 0.5) { const x = W / 2 + Math.cos(a) * r, y = H * 0.42 + Math.sin(a) * r * 0.6;
              const np = s.view.pickNest(x, y); if (!np) continue; const q = g.hexAt(np.x, np.y); if (q >= 0 && !g.isHexDug(q) && g.isHexDiggable(q) && !g.hexDesig[q]) return [x, y]; } return null; }""", [W, H])
        if spot:
            touch(cdp, "touchStart", [spot])
            touch(cdp, "touchEnd", [])
            settle(pg, 4)
            n2 = pg.evaluate(desig)
            check(f"{name}: a tap with the dig tool marks one hex of soil", n2 == n1 + 1, f"{n1} → {n2}")
            gesture(cdp, pg, [(spot[0], spot[1])], [(spot[0] + 70, spot[1] + 10)], steps=10, hold=0.2)
            settle(pg, 4)
            n3 = pg.evaluate(desig)
            check(f"{name}: dragging with the dig tool paints soil instead of panning", n3 > n2 or n3 < n2, f"{n2} → {n3}")
        else:
            check(f"{name}: soil to dig on screen", False)
        pg.evaluate("window.__session.setTool('none')")
        if compact:
            pg.locator(".mm-toggle").tap()
            settle(pg, 2)
            check(f"{name}: the Map button shows the maps", pg.evaluate("document.querySelector('.mm').classList.contains('open')"))
        settle(pg, 10)
        shot(pg, f"{name}_nest_build_maps")
        if compact:
            pg.locator(".mm-toggle").tap()
            pg.locator(".bp-open").tap()
        pg.locator(".mp-side .bbtn").first.tap()  # unfold the group cards
        settle(pg, 4)
        shot(pg, f"{name}_nest_cards")
        cdp.detach()
        pg.close()

        # ---- battle arena
        pg = open_game(ctx, "?play=1&mode=arena&teams=3&shot=1&q=low&seed=4", errs)
        pg.evaluate("() => { const s = window.__session; for (const c of [{type:'arenaSpawn',team:0,unit:'ant:lasius_soldier',n:20,level:1,at:false,x:0,y:0},{type:'arenaSpawn',team:1,unit:'cr:wolfSpider',n:2,level:1,at:false,x:0,y:0},{type:'arenaSpawn',team:2,unit:'ant:fire_major',n:10,level:1,at:false,x:0,y:0}]) s.issue(c); }")
        settle(pg, 120)
        ab = pg.evaluate("() => { const r = document.querySelector('.arena-panel').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
        check(f"{name}: the arena panel fits on screen", ab[1] >= 0 and ab[3] <= H + 1 and ab[2] <= W + 1, str(ab))
        shot(pg, f"{name}_arena")
        pg.close()
        check(f"{name}: no page errors or shader warnings", not errs, "; ".join(errs[:3]))
        ctx.close()
    b.close()
print("FAILED" if any(r.startswith("FAIL") for r in res) else "mobile checks OK")
