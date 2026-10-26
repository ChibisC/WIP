"""The simulation in a Web Worker (performance brief, Part A): the game runs in real time with
the worker owning the World and the main thread rendering a replica.

  tests/browser/with_server.sh python3 tests/browser/worker.py
"""
import sys, time
from playwright.sync_api import sync_playwright

fails = 0
def check(name, ok, info=''):
    global fails
    print(('PASS' if ok else 'FAIL') + '  ' + name + (('  ' + str(info)) if info != '' else ''))
    if not ok: fails += 1

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    pg.set_default_timeout(120000)
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    # (web fonts are blocked in the build container; that one is not a game error)
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text else None)
    pg.goto("http://127.0.0.1:5173/?play=1&q=low&seed=5&species=lasius")
    t0 = time.time()
    while time.time() - t0 < 120 and not pg.evaluate("window.__ready===true"): time.sleep(0.3)
    ev = pg.evaluate
    S = "window.__session"
    check('the simulation runs in a worker', ev(f"{S}.sim.kind") == 'worker')
    tick0 = ev(f"{S}.world.s.tick")
    pos0 = ev(f"{S}.world.s.ants.map(a=>[a.id,a.x,a.y])")
    time.sleep(4)
    tick1 = ev(f"{S}.world.s.tick")
    check('the replica advances in real time', tick1 - tick0 >= 10, f'{tick0} -> {tick1} in 4 s')
    pos1 = {a[0]: a for a in ev(f"{S}.world.s.ants.map(a=>[a.id,a.x,a.y])")}
    moved = sum(1 for a in pos0 if a[0] in pos1 and abs(pos1[a[0]][1] - a[1]) + abs(pos1[a[0]][2] - a[2]) > 0.5)
    check('ants move on the main thread replica', moved >= 2, f'{moved}/{len(pos0)} moved')
    check('the worker reports its tick time', ev(f"{S}.sim.tickMs") > 0, f'{ev(f"{S}.sim.tickMs"):.2f} ms')
    # a command goes to the worker and comes back applied
    ok = ev(f"""(()=>{{const s={S};const e=s.player.entrances[0];s.issue({{type:'placeMarker',i:0,space:0,x:e.sx+40,y:e.sy}});return s.commands.pending().length}})()""")
    check('a command is pending until the worker applies it', ok == 1, ok)
    t1 = time.time()
    while time.time() - t1 < 10 and not (ev(f"{S}.player.markers[0].placed") and ev(f"{S}.commands.pending().length") == 0): time.sleep(0.05)
    check('the worker applied the marker command', ev(f"{S}.player.markers[0].placed") and ev(f"{S}.commands.pending().length") == 0, f'{time.time() - t1:.2f} s')
    # paused: commands still apply (at the tick boundary), ticks stop
    ev(f"{S}.loop.paused = true"); time.sleep(0.5)
    tp = ev(f"{S}.world.s.tick")
    ev(f"{S}.issue({{type:'removeMarker',i:0}})")
    t2 = time.time()
    while time.time() - t2 < 5 and ev(f"{S}.player.markers[0].placed"): time.sleep(0.1)
    time.sleep(0.5)
    check('while paused, commands still apply and no ticks run', not ev(f"{S}.player.markers[0].placed") and ev(f"{S}.world.s.tick") == tp, f'tick {tp} -> {ev(f"{S}.world.s.tick")}')
    ev(f"{S}.loop.paused = false")
    # pheromone overlay comes from the worker
    ev(f"{S}.setPhero(true)"); time.sleep(1.5)
    check('the pheromone overlay arrives from the worker', ev(f"{S}.pheroOn") and ev(f"{S}.sim.kind") == 'worker')
    snap = ev(f"{S}.sim.snapshot().then(b=>b.length)")
    check('the worker returns a binary snapshot on request', snap > 100000, snap)
    check('no errors in the console', not errors, errors[:3])
    pg.screenshot(path="shots/mp_worker_running.jpg", quality=75)
    b.close()
sys.exit(1 if fails else 0)
