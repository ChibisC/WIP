"""Replays (multiplayer brief, Part F): play a single-player game for a while with orders, save the
replay from the session, watch it from the title screen, and check it ends identical to the recording.

  tests/browser/with_server.sh python3 tests/browser/replay.py
"""
import sys, time
from playwright.sync_api import sync_playwright

fails = 0
def check(name, ok, info=''):
    global fails
    print(('PASS' if ok else 'FAIL') + '  ' + name + (('  ' + str(info)) if info != '' else ''))
    if not ok: fails += 1

def wait(pg, js, secs):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            if pg.evaluate(js): return True
        except Exception:
            pass
        time.sleep(0.3)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 960, "height": 540})
    pg.set_default_timeout(240000)
    pg.goto("http://127.0.0.1:5173/?play=1&q=low&seed=11")
    check('the game starts (simulation in the worker)', wait(pg, "window.__ready===true && __session.sim.kind==='worker'", 240))
    S = "__session"
    pg.evaluate(f"{S}.setSpeed(4)")
    wait(pg, f"{S}.world.s.tick > 60", 120)
    pg.evaluate(f"""(()=>{{const s={S};const c=s.player;const e=c.entrances[0];
      s.issue({{type:'placeMarker',i:0,space:0,x:e.sx+40,y:e.sy+15}});
      const g=c.groups.find(x=>x.type==='queen'); if(g) s.issue({{type:'assignGroup',group:g.id,marker:0}});
      s.issue({{type:'setAggression',on:false}});}})()""")
    wait(pg, f"{S}.world.s.tick > 400", 240)
    pg.evaluate(f"{S}.issue({{type:'removeMarker',i:0}})")
    wait(pg, f"{S}.world.s.tick > 600", 240)
    data = pg.evaluate(f"{S}.saveReplay('test').then(b => Array.from(b))")
    check('a replay is saved (setup + command log + final hash)', bool(data) and len(data) > 200, f'{len(data) if data else 0} bytes')
    recorded = pg.evaluate(f"{S}.world.s.tick")
    pg.goto("http://127.0.0.1:5173/?q=low")
    pg.wait_for_selector('[data-m="replay"]')
    with pg.expect_file_chooser() as fc:
        pg.click('[data-m="replay"]')
    fc.value.set_files(files=[{"name": "test.udreplay", "mimeType": "application/octet-stream", "buffer": bytes(data)}])
    check('the replay loads from the title screen', wait(pg, "window.__ready===true && !!__session && __session.watchingReplay", 240))
    pg.evaluate(f"{S}.onReplayEnd = (same) => window.__same = same; {S}.setSpeed(8)")
    check('orders are off while watching', pg.evaluate(f"(()=>{{const before=JSON.stringify({S}.player.markers);{S}.issue({{type:'placeMarker',i:3,space:0,x:100,y:100}});return {S}.commands.pending().length===0}})()"))
    ok = wait(pg, "window.__same !== undefined", 400)
    check('the replay plays to the end and is identical to the recorded game', ok and pg.evaluate("window.__same") is True, pg.evaluate(f"[window.__same, {S}.world.s.tick]"))
    b.close()
sys.exit(1 if fails else 0)
