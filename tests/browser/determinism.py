"""Cross-engine determinism: run ?scene=determinism in the browser and compare every
checkpoint hash with a Node run of the same length (tools/determinism.ts --out).

  tests/browser/with_server.sh python3 tests/browser/determinism.py [minutes=2]
"""
import json, subprocess, sys, tempfile, os, time
from playwright.sync_api import sync_playwright

minutes = sys.argv[1] if len(sys.argv) > 1 else '2'
root = os.path.join(os.path.dirname(__file__), '..', '..')
out = os.path.join(tempfile.mkdtemp(), 'node.json')
subprocess.run(['npx', 'vite-node', 'tools/determinism.ts', '--', minutes, '--out', out], cwd=root, check=False, stdout=subprocess.DEVNULL)
node = json.load(open(out))
fails = 0
def check(name, ok, info=''):
    global fails
    print(('PASS' if ok else 'FAIL') + '  ' + name + (('  ' + info) if info else ''))
    if not ok: fails += 1
with sync_playwright() as p:
    engines = [('chromium', p.chromium)]
    for name, bt in engines:
        try:
            b = bt.launch()
        except Exception as e:
            print(f'SKIP  {name}: {e}'.splitlines()[0]); continue
        pg = b.new_page()
        pg.set_default_timeout(900000)
        pg.goto(f'http://127.0.0.1:5173/?scene=determinism&min={minutes}')
        t0 = time.time()
        while time.time() - t0 < 900 and not pg.evaluate('!!window.__det'): time.sleep(0.5)
        r = pg.evaluate('window.__det')
        check(f'{name}: two runs and a restored run agree', r['ok'], f"final {r['a'][-1]}")
        diff = next((i for i, (x, y) in enumerate(zip(r['a'], node['hashes'])) if x != y), -1)
        check(f'{name} matches Node ({node["engine"]}) at all {len(node["hashes"])} checkpoints', diff < 0 and len(r['a']) == len(node['hashes']), '' if diff < 0 else f'first difference at tick {(diff + 1) * 100}')
        b.close()
sys.exit(1 if fails else 0)
