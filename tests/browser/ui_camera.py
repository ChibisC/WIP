"""Browser checks for the camera, minimaps and tab alerts (Revision 2 test plan).

Run with:  tests/browser/with_server.sh python3 tests/browser/ui_camera.py
"""
import time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1600, "height": 900})
    pg.set_default_timeout(240000)
    logs = []
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    pg.goto("http://127.0.0.1:5173/?play=1&shot=1&ticks=60&q=low&seed=5&species=formica&areas=1", wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 200 and not pg.evaluate("window.__ready===true"): time.sleep(0.3)
    ev = lambda js: pg.evaluate(js)
    step = lambda n=2: ev(f"window.__step({n},0.05)")
    res = []
    def check(name, ok, info=''):
        res.append(f"{'PASS' if ok else 'FAIL'}  {name} {info}")
    S = "window.__session"
    R = f"{S}.view.surfaceRig"
    W, H = 1600, 900
    pg.mouse.move(W / 2, H / 2 - 100); step(3)
    goal = lambda: ev(f"[{R}.goal.x, {R}.goal.z]")
    def hold(key, n=10):
        pg.keyboard.down(key); step(n); pg.keyboard.up(key); step(2)
    g0 = goal(); hold('d'); g1 = goal()
    check('D pans the camera', g1[0] - g0[0] > 2 or abs(g1[1] - g0[1]) > 2, f'{g0} -> {g1}')
    g0 = goal(); hold('ArrowUp'); g1 = goal()
    check('arrow keys pan the camera', abs(g1[0] - g0[0]) + abs(g1[1] - g0[1]) > 2, f'{g0} -> {g1}')
    y0 = ev(f"{R}.goalYaw"); hold('q'); y1 = ev(f"{R}.goalYaw")
    check('Q rotates', abs(y1 - y0) > 0.2, f'{y0:.2f} -> {y1:.2f}')
    d0 = ev(f"{R}.goalDistance")
    for i in range(12): pg.mouse.wheel(0, -500); step(1)
    d1 = ev(f"{R}.goalDistance")
    for i in range(40): pg.mouse.wheel(0, 900); step(1)
    d2 = ev(f"{R}.goalDistance")
    check('wheel zooms in and out, clamped', d1 < d0 and d2 > d1 and d1 >= ev(f"{R}.minDist") - 1e-3 and d2 <= ev(f"{R}.maxDist") + 1e-3, f'{d0:.0f} -> {d1:.0f} -> {d2:.0f}')
    # bounds: hold pan for a long time
    pg.keyboard.down('a'); step(200); pg.keyboard.up('a'); step(2)
    gx = goal()[0]
    check('bounds keep the view on the map', gx >= ev(f"{R}.bounds.min.x") - 1e-3, f'x={gx:.0f}')
    pg.keyboard.press('c'); step(10)
    check('C resets the camera', abs(ev(f"{R}.goalYaw") - 0.6) < 1e-3 and abs(ev(f"{R}.goalDistance") - ev(f"{R}.homeDistance")) < 1)
    # edge scrolling
    g0 = goal(); pg.mouse.move(W - 2, H / 2); step(12); pg.mouse.move(W / 2, H / 2 - 100); step(2); g1 = goal()
    check('edge scrolling pans', abs(g1[0] - g0[0]) + abs(g1[1] - g0[1]) > 2, f'{g0} -> {g1}')
    # surface minimap click-to-jump
    box = pg.locator('.mm-box').nth(1).locator('canvas').bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.2, box['y'] + box['height'] * 0.8); step(2)
    tw = ev(f"{S}.world.terrain.width"); g = goal()
    check('surface minimap click moves the camera there', abs(g[0] - tw * 0.2) < tw * 0.05 and abs(g[1] - tw * 0.8) < tw * 0.05, f'{g}')
    # area minimap click: dives into the area
    box = pg.locator('.mm-box').nth(0).locator('canvas').bounding_box()
    pg.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5); step(40)
    check('area minimap click switches to that area', ev(f"{S}.view.space") == 'nest')
    pg.keyboard.press('Tab'); step(40)
    # tab alerts while viewing the surface
    ev(f"{S}.events.emit({{t:'invasion', colony:{S}.player.id}})"); step(3)
    check('an attack on the nest badges tab 1 while you watch the surface', ev("document.querySelectorAll('.at-tab')[0].classList.contains('alert')") and ev(f"{S}.view.space") == 'surface')
    # photo mode
    pg.keyboard.press('F9'); step(2)
    on = ev(f"{S}.photoMode && {S}.loop.paused")
    hidden = ev("document.querySelector('.gui').style.display === 'none'")
    pg.keyboard.press('Shift+F9'); step(2)
    free = ev(f"{S}.view.freeCam.on")
    pg.keyboard.press('Escape'); step(2)
    check('F9 photo mode pauses and hides the UI; Shift+F9 frees the camera; Esc leaves', on and hidden and free and not ev(f"{S}.photoMode"), f'on={on} hidden={hidden} free={free}')
    print("\n".join(res)); print("\n".join(logs[-5:]))
    b.close()
