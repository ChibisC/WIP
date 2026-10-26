"""Multiplayer lobby: teams, the Gene Thief's stolen castes and map cards (docs/multiplayer.md §6), in two tabs
through BroadcastChannel (?local=1, the same lobby code as online). Everything is clicked for real.

  1. the lobby has eight slots and five map cards with sketches; the host picks Forest Floor and the guest sees it
  2. the guest plays a Gene Thief and picks its castes; the host sees them
  3. teams: the guest and the host pick teams, the host adds an AI and puts it on a team; everyone on one team
     cannot start
  4. the match starts on Forest Floor with those teams and castes on both tabs; teammates are allies; the Gene
     Thief's Castes tab lists the stolen castes; real clicks reach the in-game buttons

  tests/browser/with_server.sh python3 tests/browser/mp_teams.py
Screenshots: docs/multiplayer/teams-*.png
"""
import os, sys, time, re
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
SHOTS = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "multiplayer")
os.makedirs(SHOTS, exist_ok=True)
fails = 0


def check(name, ok, info=''):
    global fails
    print(('PASS' if ok else 'FAIL') + '  ' + name + (('  ' + str(info)) if info != '' else ''), flush=True)
    if not ok:
        fails += 1


def wait(pred, secs=60, step=0.25):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            if pred():
                return True
        except Exception:
            pass
        time.sleep(step)
    return False


REACH = """() => [...document.querySelectorAll('#ui button, #ui .tbtn, #ui .at-tab')].filter((b) => {
    const r = b.getBoundingClientRect(), st = getComputedStyle(b);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none' || st.pointerEvents === 'none') return false;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const top = document.elementFromPoint(x, y);
    return !(top && (top === b || b.contains(top)));
  }).length"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
                                "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"])
    ctx = b.new_context(viewport={"width": 1100, "height": 900})
    errors = []

    def page(who):
        pg = ctx.new_page()
        pg.set_default_timeout(120000)
        pg.on('pageerror', lambda e: errors.append(f'{who}: {e}'))
        pg.on('console', lambda m: errors.append(f'{who}: {m.text}') if m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text else None)
        return pg

    host = page('host')
    host.goto(BASE + "?q=low")
    host.click("text=Multiplayer")
    host.fill('[data-f="name"]', 'Host')
    host.click('[data-mode="local"]')
    host.click('[data-a="create"]')
    wait(lambda: host.locator('.lb-code').count() > 0, 20)
    room = host.locator('.lb-code').inner_text().strip()
    rows = host.locator('.lb-slots > tbody > tr:not(.lb-sub)').count()
    check('the lobby has eight slots', rows == 8, rows)
    cards = host.locator('.lb-maps .map-card')
    check('five map cards, each with a sketch of the map', cards.count() == 5 and host.locator('.lb-maps .map-thumb canvas').count() == 5, f'{cards.count()} cards')

    guest = page('guest')
    guest.goto(BASE + f"?room={room}&local=1&name=Ana&q=low")
    check('the guest is seated', wait(lambda: 'Ana' in host.locator('.lb-slots').inner_text(), 30))

    # 1. map: the host clicks a card, the guest sees the choice (and cannot click the cards)
    host.click('.lb-maps .map-card[data-map="forestFloor"]')
    ok = wait(lambda: guest.locator('.lb-maps .map-card.on[data-map="forestFloor"]').count() == 1, 15)
    check('the host picks Forest Floor on a map card; the guest sees it chosen', ok and guest.locator('.lb-maps .map-card[data-map="meadowPond"]').is_disabled())

    # 2. Gene Thief: the guest switches to it and picks castes
    guest.select_option('select[data-slot="1"][data-f="species"]', 'plagiaria')
    ok = wait(lambda: guest.locator('button[data-a="borrow"]').count() >= 20, 15)
    check('a Gene Thief player gets the caste picker (every borrowable caste)', ok, guest.locator('button[data-a="borrow"]').count())
    guest.click('button[data-a="borrow"][data-caste="atta_major"]')
    wait(lambda: 'Leafcutter Major' in host.locator('.lb-sub').inner_text(), 15)
    guest.click('button[data-a="borrow"][data-caste="formica_mortar"]')  # the default pick: off again
    ok = wait(lambda: 'Leafcutter Major' in host.locator('.lb-sub').inner_text() and 'Mortar' not in host.locator('.lb-sub').inner_text(), 15)
    check("the host sees the Gene Thief's picks", ok, host.locator('.lb-sub').inner_text()[:160])
    guest.screenshot(path=os.path.join(SHOTS, 'teams-guest-gene-thief.png'))

    # 3. teams
    guest.select_option('select[data-slot="1"][data-f="team"]', '2')
    host.select_option('select[data-slot="0"][data-f="team"]', '2')
    host.select_option('select[data-slot="2"][data-f="kind"]', 'ai')
    wait(lambda: host.locator('select[data-slot="2"][data-f="team"]').count() == 1, 10)
    host.select_option('select[data-slot="2"][data-f="team"]', '2')
    guest.click('[data-a="ready"]')
    ok = wait(lambda: 'Everyone is on Team' in host.locator('.lobby').inner_text(), 15)
    check('everyone on one team: the host cannot start (and is told why)', ok and host.locator('[data-a="start"]').is_disabled())
    host.select_option('select[data-slot="2"][data-f="team"]', '3')
    ok = wait(lambda: not host.locator('[data-a="start"]').is_disabled(), 15)
    check('with the AI on another team the match can start', ok)
    check('the guest sees the teams', wait(lambda: guest.locator('.lb-team').count() >= 2, 10), guest.locator('.lb-team').all_inner_texts())
    host.screenshot(path=os.path.join(SHOTS, 'teams-lobby-host.png'))

    # 4. the match
    host.click('[data-a="start"]')
    pages = [host, guest]
    check('the match starts on both tabs', wait(lambda: all(pg.evaluate('window.__ready===true') for pg in pages), 300))
    ev = lambda pg, js: pg.evaluate(js)
    st = [ev(pg, "JSON.stringify({map: __session.setup && __session.setup.map, teams: __session.world.s.colonies.map(c => c.team), castes: __session.world.colony(1).castes})") for pg in pages]
    check('both tabs play Forest Floor with the same teams and Gene Thief castes', st[0] == st[1] and '"forestFloor"' in st[0] and '[102,102,103]' in st[0] and 'atta_major' in st[0] and 'formica_mortar' not in st[0], st[0])
    check('the host and the guest are allies; the AI is an enemy', ev(host, '__session.world.teamOf(0) === __session.world.teamOf(1) && __session.world.teamOf(2) !== __session.world.teamOf(0)'))
    check('real clicks reach every in-game button on both tabs', all(ev(pg, REACH) == 0 for pg in pages), [ev(pg, REACH) for pg in pages])
    # the Gene Thief's Castes tab lists its stolen caste
    tab = guest.locator('.bp-tab').nth(1)
    bb = tab.bounding_box() if tab.count() else None
    if bb:
        guest.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
    ok = wait(lambda: 'Leafcutter Major' in ' '.join(guest.locator('.caste-card .cc-t').all_inner_texts()), 30)
    check("the Gene Thief's Castes tab (opened with a real click) lists the stolen Leafcutter Major", ok, guest.locator('.caste-card .cc-t').all_inner_texts())
    try:
        guest.screenshot(path=os.path.join(SHOTS, 'teams-match-gene-thief.png'), timeout=90000)
    except Exception as e:
        print('  (no screenshot', str(e)[:60], ')')
    check('no errors in either tab', not errors, errors[:5])
    b.close()

print('mp teams: ' + ('all passed' if not fails else f'{fails} FAILED'))
sys.exit(1 if fails else 0)
