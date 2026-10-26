"""Multiplayer connection fixes (docs/multiplayer.md, "When players cannot connect"), in real Chromium pages:

  1. LAN "Check connection" on a normal browser: this device's address is found
  2. Online "Check connection": the check runs with STUN and the relay, and in this sandbox (no internet)
     says plainly that the matchmaking server and the relay cannot be reached
  3. Safari / iPhone behaviour (simulated: an iPhone user agent and a page that hides its own addresses
     until the microphone is allowed, as WebKit does): the LAN check offers Allow; hosting a LAN game asks
     for it before making the host code; with it allowed, a normal browser joins and both are seated
  every LAN page: no request to PeerJS, STUN/TURN hosts or any other server, and no RTCPeerConnection
  with ICE servers

  tests/browser/with_server.sh python3 tests/browser/net_check.py      (ONLY=lan,online,webkit)
Screenshots: docs/multiplayer/check-*.png
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "")
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


RTC_SPY = """
(() => {
  const O = window.RTCPeerConnection; if (!O) return;
  window.__rtcConfigs = [];
  const W = function (cfg) { window.__rtcConfigs.push(JSON.parse(JSON.stringify(cfg || {}))); return new O(cfg); };
  W.prototype = O.prototype; Object.setPrototypeOf(W, O);
  window.RTCPeerConnection = W;
})();
"""

# WebKit hides a page's own (host) candidates until getUserMedia has been allowed in the document.
WEBKIT_HIDE = """
(() => {
  window.__unlocked = false; window.__gum = 0;
  const P = RTCPeerConnection.prototype;
  const ld = Object.getOwnPropertyDescriptor(P, 'localDescription');
  Object.defineProperty(P, 'localDescription', { configurable: true, get() {
    const d = ld.get.call(this);
    if (!d || window.__unlocked) return d;
    const sdp = d.sdp.split('\\r\\n').filter((l) => !l.startsWith('a=candidate:')).join('\\r\\n');
    return { type: d.type, sdp, toJSON() { return { type: d.type, sdp }; } };
  } });
  const ael = P.addEventListener;
  P.addEventListener = function (t, fn, o) {
    if (t !== 'icecandidate') return ael.call(this, t, fn, o);
    return ael.call(this, t, function (e) { if (!window.__unlocked && e.candidate && e.candidate.candidate) return; return fn.call(this, e); }, o);
  };
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => { const s = await gum(c); window.__unlocked = true; window.__gum++; return s; };
})();
"""

IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
FORBIDDEN = re.compile(r'peerjs|stun|turn|twilio|metered', re.I)

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
        "--disable-features=WebRtcHideLocalIpsWithMdns", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    requests = []

    def page(name, ua=None, webkit=False, w=900, h=640):
        ctx = b.new_context(viewport={"width": w, "height": h}, user_agent=ua) if ua else b.new_context(viewport={"width": w, "height": h})
        ctx.grant_permissions(['microphone', 'camera'])
        ctx.add_init_script(RTC_SPY)
        if webkit:
            ctx.add_init_script(WEBKIT_HIDE)
        pg = ctx.new_page()
        pg.set_default_timeout(60000)
        pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
        pg.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and 'peerjs' not in m.text.lower() else None)
        pg.on('request', lambda r: requests.append((name, r.url)))
        pg.goto(BASE + "?q=low")
        return pg

    def to_mode(pg, name, mode):
        pg.click("text=Multiplayer")
        pg.fill('[data-f="name"]', name)
        pg.click(f'[data-mode="{mode}"]')

    def check_text(pg):
        return pg.locator('.mp-netcheck').inner_text() if pg.locator('.mp-netcheck').count() else ''

    def code_out(pg, prefix):
        ok = wait(lambda: pg.locator('[data-f="code-out"]').count() > 0 and pg.locator('[data-f="code-out"]').last.input_value().startswith(prefix), 30)
        return pg.locator('[data-f="code-out"]').last.input_value() if ok else ''

    lan_pages = []

    if want('lan'):
        pg = page('lan')
        lan_pages.append('lan')
        to_mode(pg, 'Ada', 'lan')
        pg.click('[data-a="check"]')
        ok = wait(lambda: 'should connect' in check_text(pg), 20)
        check('LAN check on a normal browser finds this device\'s address', ok, check_text(pg)[:160])
        pg.screenshot(path=os.path.join(SHOTS, 'check-lan.png'))
        cfgs = pg.evaluate('window.__rtcConfigs')
        check('LAN check uses no ICE servers', all(not c.get('iceServers') for c in cfgs), cfgs)
        pg.context.close()

    if want('online'):
        pg = page('online')
        to_mode(pg, 'Bo', 'online')
        pg.click('[data-a="check"]')
        ok = wait(lambda: pg.locator('.mp-netcheck .nc-list li').count() >= 3, 30)
        txt = check_text(pg)
        check('online check reports the server, direct route and relay', ok and 'matchmaking server' in txt and 'relay' in txt.lower(), txt[:400])
        check('…and, with no internet here, says online games will not connect', 'will not connect' in txt, txt.split('\n')[0])
        cfgs = pg.evaluate('window.__rtcConfigs')
        urls = [u for c in cfgs for s in (c.get('iceServers') or []) for u in (s['urls'] if isinstance(s['urls'], list) else [s['urls']])]
        check('online check gathers with STUN and the Open Relay TURN server (UDP, TCP, TLS)',
              any(u.startswith('stun:') for u in urls) and sum(1 for u in urls if 'openrelay.metered.ca' in u) == 3 and any(u.startswith('turns:') for u in urls), urls)
        pg.screenshot(path=os.path.join(SHOTS, 'check-online.png'))
        pg.context.close()

    if want('webkit'):
        ph = page('iphone', ua=IPHONE, webkit=True, w=430, h=900)
        lan_pages.append('iphone')
        to_mode(ph, 'Phone', 'lan')
        ph.click('[data-a="check"]')
        ok = wait(lambda: 'cannot connect' in check_text(ph) and ph.locator('[data-a="nc-allow"]').count() == 1, 20)
        check('iPhone LAN check: address hidden, offers Allow', ok, check_text(ph)[:200])
        ph.screenshot(path=os.path.join(SHOTS, 'check-iphone-hidden.png'))
        ph.click('[data-a="nc-allow"]')
        ok = wait(lambda: 'should connect' in check_text(ph), 20)
        check('…after Allow (microphone asked once) the address is visible', ok and ph.evaluate('window.__gum') == 1, check_text(ph)[:160])
        ph.context.close()

        # a fresh iPhone page hosts: the host-code dialog asks first, then makes a code a normal browser can join
        h = page('iphone-host', ua=IPHONE, webkit=True, w=430, h=900)
        lan_pages.append('iphone-host')
        to_mode(h, 'PhoneHost', 'lan')
        h.click('[data-a="lan-host"]')
        h.click('[data-a="add-player"][data-slot="1"]')
        ok = wait(lambda: h.locator('[data-a="allow-mic"]').count() == 1, 20)
        check('iPhone host: Add player asks to allow before making a code', ok and h.locator('[data-f="code-out"]').count() == 0)
        h.screenshot(path=os.path.join(SHOTS, 'check-iphone-host-gate.png'))
        h.click('[data-a="allow-mic"]')
        hc = code_out(h, 'UD1H-')
        check('…after Allow the host code is made', bool(hc), hc[:24])
        g = page('guest')
        lan_pages.append('guest')
        to_mode(g, 'Desk', 'lan')
        g.click('[data-a="lan-join"]')
        g.fill('[data-f="code-in"]', hc)
        g.click('[data-a="code-submit"]')
        rc = code_out(g, 'UD1R-')
        h.fill('.lan-dialog [data-f="code-in"]', rc)
        h.click('.lan-dialog [data-a="code-submit"]')
        ok = wait(lambda: h.locator('.lb-slots').count() > 0 and 'Desk' in h.locator('.lb-slots').inner_text(), 30)
        check('…and a normal browser joins the iPhone host (both seated)', ok)
        h.screenshot(path=os.path.join(SHOTS, 'check-iphone-host-seated.png'))

        # an iPhone joining: the join screen asks first too
        j = page('iphone-join', ua=IPHONE, webkit=True, w=430, h=900)
        lan_pages.append('iphone-join')
        to_mode(j, 'PhoneJoin', 'lan')
        j.click('[data-a="lan-join"]')
        ok = wait(lambda: j.locator('[data-a="allow-mic"]').count() == 1, 20)
        check('iPhone join: asks to allow before the code step', ok and j.locator('[data-f="code-in"]').count() == 0)
        j.click('[data-a="allow-mic"]')
        check('…then shows the code step', wait(lambda: j.locator('[data-f="code-in"]').count() == 1, 20))

    bad = [(n, u) for n, u in requests if n in lan_pages and FORBIDDEN.search(u) and not u.startswith(BASE)]
    check('LAN pages made no request to PeerJS, STUN/TURN or relay hosts', not bad, bad[:5])
    check('no page errors', not errors, errors[:5])
    b.close()

print('net check: ' + ('all passed' if not fails else f'{fails} FAILED'))
sys.exit(1 if fails else 0)
