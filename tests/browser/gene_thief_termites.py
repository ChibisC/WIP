"""Gene Thief lobby chips include the termite soldiers (user note 2026-11-02): main menu Colony → Gene Thief Ant → the
borrowed-caste chips list Nasute, Nasute Major and Sickle-jaw; clicking one toggles it. Shot: docs/multiplayer/gene-thief-termites.png
Run: tests/browser/with_server.sh python3 tests/browser/gene_thief_termites.py"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:5173/')
OUT = os.environ.get('OUT', 'docs/multiplayer')
failed = 0


def check(name, ok, info=''):
    global failed
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  — ' + str(info) if info else ''}")
    if not ok:
        failed += 1


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_context(viewport={"width": 1100, "height": 900}).new_page()
    pg.set_default_timeout(120000)
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(BASE + "?q=low")
    pg.wait_for_selector('[data-m="single"]', state='attached')
    pg.click('[data-m="single"]')
    pg.wait_for_selector('.sp-card', state='attached')
    if pg.locator('[data-mode="skirmish"]').count():
        pg.click('[data-mode="skirmish"]')
    pg.click('.sp-card[data-sp="plagiaria"]')
    pg.wait_for_selector('[data-borrow]', state='attached')
    chips = pg.evaluate("() => [...document.querySelectorAll('[data-borrow]')].map((b) => [b.dataset.borrow, b.textContent.trim()])")
    ids = [c[0] for c in chips]
    names = dict(chips)
    check('the Gene Thief borrow chips include the three termite soldiers', all(i in ids for i in ['nasute_soldier', 'nasute_major', 'rhy_soldier']), ','.join(ids))
    check('no termite worker or royal chips', not any(i in ids for i in ['nasute_worker', 'rhy_worker', 'nasute_queen', 'nasute_king', 'rhy_queen', 'rhy_king']))
    check('chips are named species + caste', names.get('nasute_soldier') == 'Conehead Termite Sprayer' and names.get('nasute_major') == 'Conehead Termite Soldier' and names.get('rhy_soldier') == 'Sickle-Jaw Termite Soldier' and names.get('formica_mortar') == 'Red Wood Mortar', f"{names.get('nasute_soldier')} / {names.get('rhy_soldier')}")
    pg.click('[data-borrow="nasute_soldier"]')
    pg.click('[data-borrow="rhy_soldier"]')
    on = pg.evaluate("() => [...document.querySelectorAll('[data-borrow].on')].map((b) => b.dataset.borrow)")
    check('clicking a termite chip toggles it on', 'nasute_soldier' in on and 'rhy_soldier' in on, ','.join(on))
    os.makedirs(OUT, exist_ok=True)
    pg.locator('[data-borrow="nasute_soldier"]').scroll_into_view_if_needed()
    pg.screenshot(path=os.path.join(OUT, 'gene-thief-termites.png'))
    check('no page errors', not errors, '; '.join(errors)[:300])
    b.close()

print('all passed' if not failed else f'{failed} FAILED')
sys.exit(1 if failed else 0)
