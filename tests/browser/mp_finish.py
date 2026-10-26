"""A two-player match in browser tabs played to the end (multiplayer brief, Step 2): the guest
surrenders from the menu (two clicks), the host gets the Victory screen and the guest Defeat.
Also checks the multiplayer menu has no sandbox options (they would show other players' nests).

  tests/browser/with_server.sh python3 tests/browser/mp_finish.py
"""
import sys, time
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
    host.check('[data-f="local"]')
    host.click('[data-a="create"]')
    wait(lambda: host.locator('.lb-code').count() > 0, 20)
    room = host.locator('.lb-code').inner_text().strip()
    host.select_option('select[data-slot="2"][data-f="kind"]', 'closed')
    g = ctx.new_page(); watch(g, 'Ana')
    g.set_default_timeout(120000)
    g.goto(BASE + f"?room={room}&local=1&name=Ana&q=low")
    wait(lambda: host.locator('text=Ana').count() > 0, 30)
    g.click('[data-a="ready"]')
    wait(lambda: not host.locator('[data-a="start"]').is_disabled(), 15)
    host.click('[data-a="start"]')
    pages = [host, g]
    check('a two-player match starts', wait(lambda: all(pg.evaluate('window.__ready===true') for pg in pages), 300) and host.evaluate('__session.world.s.colonies.length') == 2)
    wait(lambda: min(pg.evaluate('__session.world.s.tick') for pg in pages) >= 20, 120)
    # the guest opens the menu: no sandbox section, and Surrender needs a second click
    g.keyboard.press('Escape')
    check('the multiplayer menu has a Surrender button and no sandbox options', wait(lambda: g.locator('[data-surrender]').count() == 1, 20) and g.locator('text=Reveal all underground areas').count() == 0)
    g.locator('[data-surrender]').dispatch_event('click')
    time.sleep(1)
    check('one click only arms it', g.evaluate('__session.player.alive') and 'again' in g.locator('[data-surrender]').inner_text())
    g.locator('[data-surrender]').dispatch_event('click')
    check('the guest surrenders: their colony is out on both tabs', wait(lambda: all(not pg.evaluate('__session.world.colony(1).alive') for pg in pages), 60))
    check('the host gets the Victory screen', wait(lambda: 'Victory' in host.locator('.modal').inner_text(), 60))
    check('the guest gets the Defeat screen', wait(lambda: 'Defeat' in g.locator('.modal').last.inner_text(), 60))
    host.screenshot(path='shots/mp_results.jpg', quality=80)
    check('no errors in either tab', not errors, errors[:5])
    b.close()
sys.exit(1 if fails else 0)
