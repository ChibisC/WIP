"""Multiplayer in browser tabs (multiplayer brief, Step 2): a host and two guests on one machine
through BroadcastChannel (?local=1), plus an AI colony. Creates the game from the menus, joins
by invite link, readies up, starts, plays, checks the state hashes match, sends commands and
chat, checks the match cannot be paused, and drops a guest who closes their tab.

  tests/browser/with_server.sh python3 tests/browser/mp_local.py
"""
import sys, time, re
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173/"
fails = 0
def check(name, ok, info=''):
    global fails
    print(('PASS' if ok else 'FAIL') + '  ' + name + (('  ' + str(info)) if info != '' else ''))
    if not ok: fails += 1

def wait(pred, secs=60, step=0.25):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            if pred(): return True
        except Exception:
            pass
        time.sleep(step)
    return False

# In-game buttons are pressed with dispatch_event: with several tabs software-rendering on this
# machine a frame can take seconds, and Playwright's click waits for the page to render stable frames
# (IN_GAME_CLICK_NOTE). The lobby, which is plain DOM, is clicked normally.
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"])
    ctx = b.new_context(viewport={"width": 960, "height": 540})
    errors = []
    def watch(pg, who):
        pg.on('pageerror', lambda e: errors.append(f'{who}: {e}'))
        pg.on('console', lambda m: errors.append(f'{who}: {m.text}') if m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text else None)
    host = ctx.new_page(); watch(host, 'host')
    host.set_default_timeout(120000)
    host.goto(BASE + "?q=low")
    host.click("text=Multiplayer")
    host.fill('[data-f="name"]', 'Host')
    host.click('[data-mode="local"]')
    host.click('[data-a="create"]')
    check('the host creates a game and sees the lobby', wait(lambda: host.locator('.lb-code').count() > 0, 20))
    room = host.locator('.lb-code').inner_text().strip()
    link = host.locator('.lb-invite input').input_value()
    check('the lobby shows a six-letter room code and an invite link', re.fullmatch(r'[A-Z]{6}', room) is not None and f'room={room}' in link and 'local=1' in link, link)
    # the fourth slot becomes an AI colony
    host.select_option('select[data-slot="3"][data-f="kind"]', 'ai')
    host.screenshot(path='shots/mp_lobby_host.jpg', quality=80)

    guests = []
    for name in ['Ana', 'Bo']:
        g = ctx.new_page(); watch(g, name)
        g.set_default_timeout(120000)
        g.goto(BASE + f"?room={room}&local=1&name={name}&q=low")
        guests.append(g)
    check('both guests are seated in the lobby', wait(lambda: host.locator('text=Ana').count() > 0 and host.locator('text=Bo').count() > 0, 30))
    check('the start button waits until everyone is ready', host.locator('[data-a="start"]').is_disabled())
    # chat in the lobby
    guests[0].fill('[data-f="chat"]', 'hello from Ana')
    guests[0].press('[data-f="chat"]', 'Enter')
    check('lobby chat reaches the host', wait(lambda: 'hello from Ana' in host.locator('.lb-chat').inner_text(), 10))
    guests[0].select_option('select[data-f="species"]', 'formica')
    for g in guests: g.click('[data-a="ready"]')
    check('when everyone is ready the host can start', wait(lambda: not host.locator('[data-a="start"]').is_disabled(), 15))
    guests[0].screenshot(path='shots/mp_lobby_guest.jpg', quality=80)
    host.click('[data-a="start"]')
    pages = [host] + guests
    check('the match starts on every tab', wait(lambda: all(pg.evaluate('window.__ready===true') for pg in pages), 300))
    ev = lambda pg, js: pg.evaluate(js)
    check('every tab runs the simulation in a worker, driven by lockstep', all(ev(pg, '__session.sim.kind') == 'worker' and ev(pg, '!!__net') for pg in pages))
    # Real clicks must reach the in-game buttons: the multiplayer HUD layer once covered the whole screen
    # and swallowed them (the clicks elsewhere in this test use dispatch_event, which skips hit-testing).
    REACH = """() => [...document.querySelectorAll('#ui button, #ui .tbtn, #ui .at-tab')].filter((b) => {
        const r = b.getBoundingClientRect(), st = getComputedStyle(b);
        if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none' || st.pointerEvents === 'none') return false;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
        const top = document.elementFromPoint(x, y);
        return !(top && (top === b || b.contains(top)));
      }).map((b) => (b.className + ' ' + (b.textContent || '').trim()).slice(0, 40))"""
    blocked = [ev(pg, REACH) for pg in pages]
    check('real clicks reach every in-game button on every tab (nothing covers them)', all(not x for x in blocked), [x[:4] for x in blocked])
    dig = guests[0].locator('.tbtn', has_text='Dig').first.bounding_box()
    if dig:
        guests[0].mouse.click(dig['x'] + dig['width'] / 2, dig['y'] + dig['height'] / 2)
    check('a real mouse click on Dig picks the Dig tool (guest)', wait(lambda: ev(guests[0], '__session.tool') != 'none', 15), ev(guests[0], '__session.tool'))
    guests[0].keyboard.press('Escape')
    check('players are colonies 0, 1, 2 (+ AI 3)', [ev(pg, '__net.self') for pg in pages] == [0, 1, 2] and ev(host, '__session.world.s.colonies.length') == 4)
    check('guest 1 plays the species they picked', ev(guests[0], '__session.player.species') == 'formica')
    wait(lambda: min(ev(pg, '__session.world.s.tick') for pg in pages) >= 10, 120)
    wait(lambda: min(ev(pg, '__session.world.s.tick') for pg in pages) >= 10, 120)
    t0 = [ev(pg, '__session.world.s.tick') for pg in pages]
    time.sleep(12)
    t1 = [ev(pg, '__session.world.s.tick') for pg in pages]
    # (three tabs share one CPU with software rendering here, so the pace is slow; it must move, in step)
    check('the match advances on every tab, in step', min(t1) - max(t0) >= 5 and max(t1) - min(t1) <= 15, f'{t0} -> {t1}')
    # hashes every 100 ticks: wait until all report the same checkpoint
    def same_hash():
        hs = [ev(pg, '__net.status().lastHash') for pg in pages]
        if not all(hs): return False
        tick = min(h['tick'] for h in hs)
        return tick >= 100
    wait(same_hash, 90)
    hs = [ev(pg, '__net.status().lastHash') for pg in pages]
    ok = all(hs) and len(set((h['tick'], h['hash']) for h in hs)) == 1
    if not ok and all(hs):
        # tabs may be on different checkpoints: wait for the next common one
        target = max(h['tick'] for h in hs)
        wait(lambda: all(ev(pg, '__net.status().lastHash.tick') >= target for pg in pages), 60)
        hs = [ev(pg, '__net.status().lastHash') for pg in pages]
        ok = len(set(h['hash'] for h in hs if h['tick'] == target)) == 1 and all(h['tick'] == target for h in hs)
    check('state hashes match across the tabs', ok, hs)
    check('no desync', not any(ev(pg, '!!__net.status().desync') for pg in pages))
    # a guest's command reaches everyone
    ev(guests[1], "(()=>{const s=__session;const e=s.player.entrances[0];s.issue({type:'placeMarker',i:2,space:0,x:e.sx+30,y:e.sy+10})})()")
    ok = wait(lambda: all(ev(pg, '__session.world.colony(2).markers[2].placed') for pg in pages), 90)
    check("a guest's marker appears in every tab", ok, [ev(pg, 'JSON.stringify([__session.world.s.tick, __session.world.colony(2).markers[2], __session.commands.pending().length])') for pg in pages])
    # in-game chat
    ev(guests[1], "__net.chat('gg so far')")
    check('in-match chat reaches the other players', wait(lambda: 'gg so far' in host.locator('.net-chat').inner_text(), 10))
    # a multiplayer match cannot be paused (user rule): P only explains that
    tp = [ev(pg, '__session.world.s.tick') for pg in pages]
    host.keyboard.press('KeyP')
    advanced = wait(lambda: all(ev(pg, '__session.world.s.tick') > t + 2 for pg, t in zip(pages, tp)), 30)
    check('P does not pause a multiplayer match', not any(ev(pg, '__session.loop.paused') for pg in pages) and advanced, [ev(pg, '[__session.world.s.tick, __session.loop.paused, JSON.stringify(__net.status().waitingFor)]') for pg in pages])
    host.keyboard.press('F3')
    check('F3 shows the debug overlay with network details', wait(lambda: 'input delay' in host.locator('.debug-overlay').inner_text(), 20))
    host.screenshot(path='shots/mp_match_f3.jpg', quality=80)
    # a guest closes the tab: the others wait, then the host drops them (button) and the AI takes over
    guests[1].close()
    ok = wait(lambda: 'Waiting for' in host.locator('.net-banner').inner_text(), 40)
    check('the others show who they are waiting for', ok, ev(host, 'JSON.stringify({tick: __session.world.s.tick, st: __net.status(), active: __net.lockstep.activePlayers(), miss: __net.lockstep.missing(), peers: __net.transport.peers()})'))
    host.screenshot(path='shots/mp_waiting.jpg', quality=80)
    host.locator('[data-drop]').dispatch_event('click')
    rest = [host, guests[0]]
    check('after the drop the match goes on and the AI runs the colony', wait(lambda: all(ev(pg, '__session.world.colony(2).ai') for pg in rest), 30))
    t2 = [ev(pg, '__session.world.s.tick') for pg in rest]
    time.sleep(12)
    t3 = [ev(pg, '__session.world.s.tick') for pg in rest]
    check('the two remaining players keep playing', min(t3) - max(t2) >= 5, f'{t2} -> {t3} in 12 s')
    check('no errors in any tab', not errors, errors[:5])
    b.close()
sys.exit(1 if fails else 0)
