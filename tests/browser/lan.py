"""LAN play with connection codes (docs/multiplayer.md, "LAN play"), in real Chromium pages joined by
WebRTC with no ICE servers. Everything goes through the menus as a player would: the host adds each
player with a host code, the player pastes it and gets a reply code, the host pastes the reply.

  1. two players by copy and paste, a match, matching state hashes
  2. wrong and damaged codes give the right messages
  3. a dropped player comes back with a new code (host: Players → Reconnect) and catches up
  4. four players (host + 3) on Meadow Pond (chosen in the lobby), matching hashes
  every page: no request to PeerJS, STUN/TURN hosts or any other server once loaded, and every
  RTCPeerConnection made with an empty iceServers list

Chromium hides local IPs behind mDNS `.local` names unless told not to; this container has no mDNS
resolver, so the pages run with plain IP candidates (MDNS=1 tries the mDNS default instead).

  tests/browser/with_server.sh python3 tests/browser/lan.py      (ONLY=two,codes,reconnect,four)
Screenshots: docs/multiplayer/lan-*.png
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "")
MDNS = os.environ.get("MDNS", "") == "1"
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


def want(part):
    return not ONLY or part in ONLY.split(',')


# record every RTCPeerConnection configuration a page makes
RTC_SPY = """
(() => {
  const O = window.RTCPeerConnection; if (!O) return;
  window.__rtcConfigs = [];
  const W = function (cfg) { window.__rtcConfigs.push(JSON.parse(JSON.stringify(cfg || {}))); return new O(cfg); };
  W.prototype = O.prototype; Object.setPrototypeOf(W, O);
  window.RTCPeerConnection = W;
})();
"""

FORBIDDEN = re.compile(r'peerjs|stun|turn|twilio|0\.peerjs\.com', re.I)

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]
if not MDNS:
    ARGS.append("--disable-features=WebRtcHideLocalIpsWithMdns")

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    requests = []

    def player(name, w=900, h=560):
        ctx = b.new_context(viewport={"width": w, "height": h})
        ctx.add_init_script(RTC_SPY)
        pg = ctx.new_page()
        pg.set_default_timeout(120000)
        pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
        pg.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text else None)
        pg.on('request', lambda r: requests.append((name, r.url)))
        pg.on('websocket', lambda ws: requests.append((name, 'ws ' + ws.url)))
        pg.goto(BASE + "?q=low")
        return pg

    def to_lan(pg, name):
        pg.click("text=Multiplayer")
        pg.fill('[data-f="name"]', name)
        pg.click('[data-mode="lan"]')

    def host_game(name='Host'):
        h = player(name)
        to_lan(h, name)
        h.click('[data-a="lan-host"]')
        return h

    def code_out(pg, prefix):
        """the code a page shows (waits for it)"""
        ok = wait(lambda: pg.locator('[data-f="code-out"]').count() > 0 and pg.locator('[data-f="code-out"]').last.input_value().startswith(prefix), 30)
        return pg.locator('[data-f="code-out"]').last.input_value() if ok else ''

    def add_player(h, g, slot, gname):
        """host adds a player to a slot through the code dialog; returns (host code, reply code)"""
        h.click(f'[data-a="add-player"][data-slot="{slot}"]')
        hc = code_out(h, 'UD1H-')
        to_lan(g, gname)
        g.click('[data-a="lan-join"]')
        g.fill('[data-f="code-in"]', hc)
        g.click('[data-a="code-submit"]')
        rc = code_out(g, 'UD1R-')
        h.fill('.lan-dialog [data-f="code-in"]', rc)
        h.click('.lan-dialog [data-a="code-submit"]')
        return hc, rc

    def seated(h, gname):
        return wait(lambda: h.locator('.lb-slots').count() > 0 and gname in h.locator('.lb-slots').inner_text(), 30)

    ev = lambda pg, js: pg.evaluate(js)

    def shot(pg, name):
        # an in-game page renders slowly in software: do not let a screenshot hold the test up
        try:
            pg.screenshot(path=os.path.join(SHOTS, name), timeout=90000)
        except Exception as e:
            print('  (no screenshot', name, str(e)[:60], ')', flush=True)

    def same_hashes(pages, secs=150):
        def ready():
            hs = [ev(pg, '__net.status().lastHash') for pg in pages]
            return all(hs) and min(h['tick'] for h in hs) >= 100
        wait(ready, secs)
        hs = [ev(pg, '__net.status().lastHash') for pg in pages]
        if not all(hs):
            return False, hs
        target = max(h['tick'] for h in hs)
        wait(lambda: all(ev(pg, '__net.status().lastHash.tick') >= target for pg in pages), 90)
        # read each page's hash at the common checkpoint
        hs = [ev(pg, '__net.status().lastHash') for pg in pages]
        ok = all(h['tick'] == target for h in hs) and len(set(h['hash'] for h in hs)) == 1
        return ok, hs

    def start_match(h, guests):
        for g in guests:
            wait(lambda: g.locator('[data-a="ready"]').count() > 0, 30)
            g.click('[data-a="ready"]')
        wait(lambda: not h.locator('[data-a="start"]').is_disabled(), 30)
        h.click('[data-a="start"]')
        pages = [h] + guests
        return wait(lambda: all(pg.evaluate('window.__ready===true') for pg in pages), 300)

    def rtc_clean(pages):
        cfgs = [c for pg in pages for c in (ev(pg, 'window.__rtcConfigs || []') or [])]
        return cfgs and all(isinstance(c.get('iceServers'), list) and len(c['iceServers']) == 0 for c in cfgs), cfgs

    # ------------------------------------------------------------------ 1. two players
    if want('two') or want('reconnect') or want('codes'):
        h = host_game()
        check('the host opens a LAN lobby (no room code, no invite link)', wait(lambda: h.locator('text=LAN game').count() > 0, 20) and h.locator('.lb-invite').count() == 0)
        g = player('Ana')
        glog = []
        g.on('console', lambda m: glog.append(m.text[:160]))
        hlog = []
        h.on('console', lambda m: hlog.append(m.text[:160]))
        h.click('[data-a="add-player"][data-slot="1"]')
        hc = code_out(h, 'UD1H-')
        check('Add player shows host code #2 as a QR code and text', hc.startswith('UD1H-') and h.locator('.lan-dialog canvas.lan-qr').count() == 1 and 'host code #2' in h.locator('.lan-dialog').inner_text(), f'{len(hc)} characters')
        check('the host code is short', 0 < len(hc) < 400, len(hc))
        h.screenshot(path=os.path.join(SHOTS, 'lan-host-code.png'))
        to_lan(g, 'Ana')
        g.click('[data-a="lan-join"]')
        check('the joiner sees step 1 of 3', wait(lambda: 'Step 1 of 3' in g.locator('.lan-card').inner_text(), 10))
        if want('codes'):
            g.fill('[data-f="code-in"]', 'hello')
            g.click('[data-a="code-submit"]')
            check('random text: "not a connection code"', wait(lambda: 'not a connection code' in g.locator('.lan-err').inner_text(), 10))
            g.fill('[data-f="code-in"]', hc[:-6])
            g.click('[data-a="code-submit"]')
            check('a cut-off host code: "damaged or incomplete"', wait(lambda: 'damaged or incomplete' in g.locator('.lan-err').inner_text(), 10))
            g.fill('[data-f="code-in"]', 'UD1R-' + hc[5:])
            g.click('[data-a="code-submit"]')
            check('a reply-tagged code on the joiner is caught (it fails its check)', wait(lambda: 'damaged' in g.locator('.lan-err').inner_text() or 'reply code' in g.locator('.lan-err').inner_text(), 10))
        g.fill('[data-f="code-in"]', '  ' + hc[:80] + '\n' + hc[80:] + '\n')
        g.click('[data-a="code-submit"]')
        rc = code_out(g, 'UD1R-')
        check('pasting the host code (wrapped over two lines) gives a reply code', rc.startswith('UD1R-') and 'Step 2 of 3' in g.locator('.lan-card').inner_text(), f'{len(rc)} characters')
        g.screenshot(path=os.path.join(SHOTS, 'lan-reply-code.png'))
        if want('codes'):
            h.fill('.lan-dialog [data-f="code-in"]', hc)
            h.click('.lan-dialog [data-a="code-submit"]')
            check('the host pasting its own host code is told which code goes where', wait(lambda: 'host code: it goes to the joining player' in h.locator('.lan-dialog .lan-err').inner_text(), 10))
        t0 = time.time()
        h.fill('.lan-dialog [data-f="code-in"]', rc)
        h.click('.lan-dialog [data-a="code-submit"]')
        ok = seated(h, 'Ana')
        check('the host enters the reply: the player is seated in slot 2', ok and h.locator('.lan-dialog').count() == 0, f'{time.time() - t0:.1f} s')
        check('the joiner reaches the lobby', wait(lambda: g.locator('text=LAN game').count() > 0 and g.locator('[data-a="ready"]').count() > 0, 20))
        check('the host sees the player’s ping', wait(lambda: re.search(r'\d+ ms', h.locator('.lb-slots').inner_text()) is not None, 15))
        h.screenshot(path=os.path.join(SHOTS, 'lan-lobby.png'))
        if want('codes'):
            # the same host code again: used
            g2 = player('Late')
            to_lan(g2, 'Late')
            g2.click('[data-a="lan-join"]')
            g2.fill('[data-f="code-in"]', hc)
            g2.click('[data-a="code-submit"]')
            rc2 = code_out(g2, 'UD1R-')
            h.click('[data-a="add-player"][data-slot="2"]')
            code_out(h, 'UD1H-')
            h.fill('.lan-dialog [data-f="code-in"]', rc2)
            h.click('.lan-dialog [data-a="code-submit"]')
            check('a reply to a host code that was already used is refused', wait(lambda: 'already used' in h.locator('.lan-dialog .lan-err').inner_text(), 10))
            h.click('.lan-dialog [data-a="cancel"]')
            g2.context.close()
        lobby_ok = start_match(h, [g])
        check('the LAN match starts on both devices', lobby_ok)
        if lobby_ok:
            ok, hs = same_hashes([h, g])
            check('state hashes match (2 players)', ok, hs)
            check('no desync', not any(ev(pg, '!!__net.status().desync') for pg in [h, g]))
            shot(g, 'lan-match.png')

        # ------------------------------------------------------------------ 3. reconnect
        if lobby_ok and want('reconnect'):
            ev(g, '__net.transport.sever()')
            check('the joiner who lost the host is offered a rejoin', wait(lambda: g.locator('[data-a="rejoin"]').count() > 0, 30))
            check('the host waits for the player and offers a new code', wait(lambda: h.locator('[data-a="reconnect-waiting"]').is_visible(), 40))
            shot(g, 'lan-lost-host.png')
            g.locator('[data-a="rejoin"]').dispatch_event('click')
            check('the rejoin screen opens (the tab keeps its token)', wait(lambda: 'Rejoin the LAN match' in g.locator('.lan-card').inner_text(), 30))
            # software rendering here needs minutes to rebuild a match: give the rejoining page more time than a real device needs
            ev(h, '__net.rejoinLoadS = 1500')
            h.locator('[data-a="players"]').dispatch_event('click')
            check('the host’s Players list shows the player as disconnected', wait(lambda: 'Disconnected' in h.locator('.modal').inner_text() or 'Dropped' in h.locator('.modal').inner_text(), 10))
            h.locator('[data-a="reconnect"][data-slot="1"]').dispatch_event('click')
            hc = code_out(h, 'UD1H-')
            g.fill('[data-f="code-in"]', hc)
            g.click('[data-a="code-submit"]')
            rc = code_out(g, 'UD1R-')
            print(f'    reconnect codes: host {len(hc)} characters, reply {len(rc)}', flush=True)
            h.fill('.lan-dialog [data-f="code-in"]', rc)
            h.locator('.lan-dialog [data-a="code-submit"]').dispatch_event('click')

            def state():
                gs = g.evaluate("""() => ({ url: location.search, card: (document.querySelector('.lan-card')||{}).innerText?.slice(0, 160) || '', err: [...document.querySelectorAll('.mp-error')].map(e => e.innerText).join(' | '),
                    lobby: !!document.querySelector('.lobby'), session: !!window.__session, ready: window.__ready === true, net: !!window.__net, loading: (document.querySelector('.loading')||{}).innerText || '' })""")
                hs = h.evaluate("""() => ({ dialog: !!document.querySelector('.lan-dialog'), err: (document.querySelector('.lan-dialog .lan-err')||{}).innerText || '', status: (document.querySelector('.lan-dialog .lan-status')||{}).innerText || '',
                    peers: __net.transport.peers(), dropped: __net.status().dropped, waiting: __net.status().waitingFor, tick: __net.status().tick })""")
                return gs, hs
            back = False
            t0 = time.time()
            next_print = t0
            while time.time() - t0 < 1100:
                try:
                    if g.evaluate('window.__ready===true') and g.evaluate('!!window.__net'):
                        back = True
                        break
                except Exception:
                    pass
                if time.time() >= next_print:
                    next_print += 20
                    try:
                        print('   ', round(time.time() - t0), state(), flush=True)
                    except Exception as e:
                        print('    (state:', str(e)[:80], ')', flush=True)
                time.sleep(1)
            if not back:
                print('    console (joiner):', glog[-15:], flush=True)
                print('    console (host):', hlog[-15:], flush=True)
            check('after the new code exchange the player is back in the match', back, f'{time.time() - t0:.0f} s')
            if back:
                check('the rejoined player controls their own colony again', wait(lambda: ev(g, '__net.self') == 1 and 1 not in ev(h, '__net.status().dropped'), 60))
                ok, hs = same_hashes([h, g], 240)
                check('state hashes match after the catch-up', ok, hs)
        clean, cfgs = rtc_clean([h, g])
        check('every RTCPeerConnection had an empty iceServers list', clean, cfgs[:3])
        h.context.close()
        g.context.close()

    # ------------------------------------------------------------------ 4. four players
    if want('four'):
        h = host_game()
        guests = []
        for slot, name in [(1, 'Ana'), (2, 'Bo'), (3, 'Cy')]:
            g = player(name, 640, 400)
            add_player(h, g, slot, name)
            check(f'{name} is seated in slot {slot + 1}', seated(h, name))
            guests.append(g)
        # the authored map, chosen in the lobby
        h.select_option('select[data-f="style"]', 'map:meadowPond')
        check('every player sees Meadow Pond chosen', all(wait(lambda: 'Meadow Pond' in g.locator('.lobby').inner_text(), 15) for g in guests))
        h.screenshot(path=os.path.join(SHOTS, 'lan-lobby-four.png'))
        ok = start_match(h, guests)
        check('the four-player LAN match starts everywhere', ok)
        if ok:
            check('the match is on Meadow Pond, four colonies on its sites', all(ev(pg, '__session.world.terrain.map && __session.world.terrain.map.id') == 'meadowPond' and ev(pg, '__session.world.s.colonies.length') == 4 for pg in [h] + guests))
            ok, hs = same_hashes([h] + guests, 300)
            check('state hashes match (4 players)', ok, hs)
            check('no desync', not any(ev(pg, '!!__net.status().desync') for pg in [h] + guests))
        clean, cfgs = rtc_clean([h] + guests)
        check('every RTCPeerConnection had an empty iceServers list (4 players)', clean, len(cfgs))

    bad = [(who, u) for who, u in requests if FORBIDDEN.search(u) and not u.startswith(BASE)]
    off = sorted(set(u.split('/')[2] if '://' in u else u for who, u in requests if not u.startswith(BASE) and not u.startswith('data:') and not u.startswith('blob:')))
    check('no request to PeerJS, STUN or TURN hosts', not bad, bad[:5])
    print('  hosts contacted besides the game server:', off or 'none')
    check('no page errors', not errors, errors[:6])
    b.close()

print('\n' + ('ALL PASS' if not fails else f'{fails} FAILED'))
sys.exit(1 if fails else 0)
