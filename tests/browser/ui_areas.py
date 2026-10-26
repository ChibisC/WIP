"""Browser checks for underground areas (Revision 2, System 8) on the five-area test level.

Run with the dev server on 127.0.0.1:5173:  python3 tests/browser/ui_areas.py [screenshot-dir]
"""
import sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else None
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1600, "height": 900})
    pg.set_default_timeout(240000)
    logs = []
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    pg.goto("http://127.0.0.1:5173/?play=1&shot=1&ticks=100&q=low&seed=5&species=formica&areas=1", wait_until="load")
    t0 = time.time()
    while time.time() - t0 < 200 and not pg.evaluate("window.__ready===true"): time.sleep(0.3)
    ev = lambda js: pg.evaluate(js)
    step = lambda n=2: ev(f"window.__step({n},0.05)")
    res = []
    def check(name, ok, info=''):
        res.append(f"{'PASS' if ok else 'FAIL'}  {name} {info}")
    def shot(name):
        if OUT: pg.screenshot(path=f"{OUT}/{name}.png")
    S = "window.__session"
    step(3)
    tabs = ev(f"{S}.areaTabs().map(t=>[t.number,t.kind,t.open])")
    check('five area tabs: home, enemy, allied, two neutral', [t[1] for t in tabs] == ['home', 'enemy', 'allied', 'neutral', 'neutral'], str(tabs))
    check('tab column shows five tabs', ev("[...document.querySelectorAll('.at-tab')].filter(b=>b.style.display!=='none').length") == 5)
    check('closed tabs are greyed', ev("[...document.querySelectorAll('.at-tab')].slice(0,5).map(b=>b.classList.contains('shut'))") == [False, True, False, True, True])
    check('closed tab tooltip says no ants', 'No ants in this area' in ev("document.querySelectorAll('.at-tab')[3].dataset.tip"))
    # clicking a closed tab does nothing but explain
    pg.locator('.at-tab').nth(3).click(); step(3)
    check('a closed tab cannot be opened', ev(f"{S}.view.space") == 'surface')
    # Shift+1 dives into the home nest; tab 3 (allies inside) opens the allied nest with a fade cut
    pg.keyboard.press('Shift+Digit1'); step(30)
    check('Shift+1 shows area 1 (home)', ev(f"{S}.view.space==='nest' && {S}.viewedArea===1 && {S}.view.activeNest===1"))
    pg.locator('.at-tab').nth(2).click(); step(16)
    check('allied nest tab opens (allies inside)', ev(f"{S}.viewedArea===3 && {S}.view.activeNest===3"), str(ev(f"[{S}.viewedArea,{S}.view.activeNest]")))
    shot('areas_1_allied_nest')
    pg.keyboard.press('Shift+Digit1'); step(16)
    check('per-area camera: back home', ev(f"{S}.view.activeNest===1"))
    # Tab → surface; place marker I on the cave entrance
    pg.keyboard.press('Tab'); step(30)
    check('Tab returns to the surface', ev(f"{S}.view.space") == 'surface')
    cave = ev(f"(()=>{{const t={S}.areaTabs()[3];const e={S}.world.entrancesOf(t.space)[0];return [t.space,e.sx,e.sy]}})()")
    ev(f"{S}.jumpTo('surface',{cave[1]},{cave[2]})"); step(40)
    pos = ev(f"""(()=>{{const s={S};const h=s.world.terrain.walkHeight({cave[1]},{cave[2]});const v=new (s.view.surfaceCam.position.constructor)({cave[1]},h,{cave[2]}).project(s.view.surfaceCam);return [(v.x+1)/2*innerWidth,(1-v.y)/2*innerHeight]}})()""")
    pg.keyboard.press('1'); step()
    pg.mouse.click(pos[0], pos[1]); step(2)
    check('a marker clicked on the cave entrance goes into the cave', ev(f"{S}.player.markers[0].placed && {S}.player.markers[0].space") == cave[0], str(ev(f"{S}.player.markers[0].space")))
    check('the marker column shows the area number', '⬇4' in ev("document.querySelector('.mp-col[data-col=\"0\"] .mp-count').textContent"))
    shot('areas_2_marker_on_cave_entrance')
    # drag the worker chamber's card to marker I
    gid = ev(f"{S}.player.groups.find(g=>g.marker===-1 && g.caste).id")
    card = pg.locator(f'.gcard[data-gid="{gid}"]'); cb = card.bounding_box(); tb = pg.locator('.mp-col[data-col="0"] .mp-cards').bounding_box()
    sx, sy = cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] / 2; tx, ty = tb['x'] + tb['width'] / 2, tb['y'] + 40
    pg.mouse.move(sx, sy); pg.mouse.down()
    for i in range(1, 11): pg.mouse.move(sx + (tx - sx) * i / 10, sy + (ty - sy) * i / 10)
    pg.mouse.up(); step()
    check('the queen’s group sent to marker I', ev(f"{S}.player.groups.find(g=>g.id==={gid}).marker") == 0)
    # let them walk there (sim only)
    opened = False
    for k in range(40):
        ev(f"{S}.loop.advance(40)"); step(1)
        if ev(f"{S}.areaTab({cave[0]}).open"): opened = True; break
    check('the cave tab opens once ants are inside', opened, f"after ~{(k + 1) * 2} s")
    step(2)
    check('the newly opened tab pulses', ev("document.querySelectorAll('.at-tab')[3].classList.contains('pulse')"))
    shot('areas_3_cave_tab_open')
    pg.keyboard.press('Shift+Digit4'); step(16)
    check('F4 shows the cave', ev(f"{S}.view.space==='nest' && {S}.view.activeNest==={cave[0]}"))
    check('area map is labelled with the cave', 'Root hollow' in ev("document.querySelector('.mm-box .mm-lbl').textContent"))
    ev(f"{S}.loop.advance(60)"); step(4)
    shot('areas_4_inside_cave')
    # Space jumps to the selected marker (here: in the cave) from home
    pg.keyboard.press('Shift+Digit1'); step(16)
    pg.keyboard.press('1'); step(); pg.keyboard.press('Space'); step(16)
    check('Space jumps to the marker in its area', ev(f"{S}.view.activeNest==={cave[0]}"))
    pg.keyboard.press('Escape'); step()
    # N cycles open areas
    a0 = ev(f"{S}.viewedArea"); pg.keyboard.press('KeyN'); step(16)
    check('N moves to the next open area', ev(f"{S}.viewedArea") != a0, f"{a0} → {ev(f'{S}.viewedArea')}")
    # sandbox reveal
    ev(f"{S}.revealAreas=true"); step(2)
    check('reveal setting opens every tab', not ev("[...document.querySelectorAll('.at-tab')].some(b=>b.classList.contains('shut'))"))
    pg.locator('.at-tab').nth(1).click(); step(16)
    check('the enemy nest can be viewed when revealed', ev(f"{S}.view.activeNest===2"))
    shot('areas_5_enemy_nest_revealed')
    ev(f"{S}.revealAreas=false"); ev(f"{S}.loop.advance(20)"); step(20)
    check('closing the reveal sends the view home', ev(f"{S}.view.activeNest===1 || {S}.viewedArea===1"), str(ev(f"[{S}.viewedArea,{S}.view.activeNest]")))
    print("\n".join(res)); print("\n".join(logs[-5:]))
    b.close()
