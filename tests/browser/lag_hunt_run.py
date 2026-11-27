"""Performance v7: run the in-game Lag Hunt (dev/lagHunt.ts) in the build machine's browser and print its report.
Chromium (SwiftShader) by default, or WebKit (the engine of the user's Safari: `ENGINE=webkit`). Absolute times here
are slow (the GPU is the CPU); read the causes and counters — compiles, uploads, long main-thread work.

  tests/browser/with_server.sh python3 tests/browser/lag_hunt_run.py   ONLY=arena-saiy,match-saiy  Q=high  OUT=report.txt
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
ONLY = os.environ.get("ONLY", "")
QUAL = os.environ.get("Q", "high")
OUT = os.environ.get("OUT", "")
ENGINE = os.environ.get("ENGINE", "chromium")
VW = int(os.environ.get("VW", "800"))
VH = int(os.environ.get("VH", "500"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]


def main():
    with sync_playwright() as p:
        b = p.webkit.launch() if ENGINE == "webkit" else p.chromium.launch(args=ARGS)
        pg = b.new_page(viewport={"width": VW, "height": VH})
        pg.set_default_timeout(3600000)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: print("   ", m.text[:160], flush=True) if m.text.startswith("[lag hunt] step") else None)
        url = BASE + f"?lagHunt=1&q={QUAL}" + (f"&lhonly={ONLY}" if ONLY else "")
        pg.goto(url, wait_until="load")
        t0 = time.time()
        last = ""
        while time.time() - t0 < 4 * 3600:
            time.sleep(5)
            try:
                u = pg.url
                if u != last:
                    print(f"{time.time() - t0:6.0f} s  {u.split('?')[-1][:120]}", flush=True)
                    last = u
                rep = pg.evaluate("() => window.__lagHunt ? window.__lagHunt.text : null")
            except Exception:
                continue  # (between page loads)
            if rep:
                print(rep)
                if OUT:
                    open(OUT, "w").write(rep)
                break
        print("page errors:", errs[:5])
        b.close()


main()
