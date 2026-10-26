"""Phase 14 in the browser: mission briefing, the audio graph, pause-menu tabs,
key rebinding that persists, save to a slot and load it back, and Continue on
the title screen.

Run: tests/browser/with_server.sh python3 tests/browser/ui_save.py
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
SHOTS = os.environ.get("SHOTS", "/tmp")
res = []


def check(name, ok, info=""):
    res.append(f"{'PASS' if ok else 'FAIL'}  {name} {info}")


def wait_ready(pg, t=300):
    t0 = time.time()
    while time.time() - t0 < t and not pg.evaluate("window.__ready===true"):
        time.sleep(0.5)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1440, "height": 810})
    pg = ctx.new_page()
    pg.set_default_timeout(240000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "?play=1&mode=mission&mission=meadow&q=low&seed=5", wait_until="load")
    wait_ready(pg)
    time.sleep(2)
    brief = pg.locator(".modal.briefing")
    check("a new mission opens on its briefing", brief.count() == 1 and "The stages" in brief.inner_text() and "Medals" in brief.inner_text())
    pg.screenshot(path=f"{SHOTS}/p14_briefing.png")
    # a real key press unlocks the audio (a click outside the card would close it)
    pg.keyboard.press("Shift")
    pg.locator(".modal.briefing .go-btn").dispatch_event("click")
    time.sleep(3)
    st = pg.evaluate("window.__ui.audio.state")
    check("the audio graph starts on the first click", st["ctx"] == "running", str(st))
    time.sleep(4)
    au = pg.evaluate("({started: __audio.stats.started, meter: __audio.meter(), mem: __audio.bank.bytes()/1048576})")
    check("sounds play (ambience, the Begin tap) and the output never clips", au["started"] > 0 and au["meter"]["peak"] < 1.0, str(au))
    check("the briefing closes on Begin", pg.locator(".modal.briefing").count() == 0)
    # pause menu tabs
    pg.keyboard.press("Escape")
    time.sleep(1)
    tabs = pg.locator(".mtabs .bbtn").all_inner_texts()
    check("the pause menu has Game, Graphics, Sound and Controls tabs", tabs == ["Game", "Graphics", "Sound", "Controls"], str(tabs))
    rows = pg.locator(".save-row").count()
    check("the Game tab lists the save slots", rows == 5, str(rows))
    pg.screenshot(path=f"{SHOTS}/p14_game_tab.png")
    pg.locator('.mtabs .bbtn[data-tab="sound"]').dispatch_event("click")
    time.sleep(0.5)
    check("Sound: seven sliders (master and six buses)", pg.locator("input.vol").count() == 7, str(pg.locator("input.vol").count()))
    sl = pg.locator('input.vol[data-vol="music"]')
    sl.fill("25")
    sl.dispatch_event("input")
    time.sleep(0.3)
    pg.screenshot(path=f"{SHOTS}/p14_sound_tab.png")
    pg.locator('.mtabs .bbtn[data-tab="controls"]').dispatch_event("click")
    time.sleep(0.5)
    pg.locator('.keycap[data-action="dig"]').dispatch_event("click")
    time.sleep(0.3)
    waiting = pg.locator(".keycap.wait").count()
    pg.keyboard.press("k")
    time.sleep(0.5)
    dig = pg.evaluate("__session.input.bindings.dig")
    label = pg.locator('.keycap[data-action="dig"]').inner_text()
    stored = pg.evaluate("localStorage.getItem('ud-settings')") or ""
    check("Controls: click a key, press a new one; it is stored", waiting == 1 and dig == "KeyK" and label == "K" and '"dig":"KeyK"' in stored and '"music":0.25' in stored, f"{dig} {label} {stored[:120]}")
    sliders = pg.evaluate("[...document.querySelectorAll('input.vol')].length")
    still = pg.locator(".modal").count()
    check("Esc while rebinding does not close the menu", still == 1)
    pg.screenshot(path=f"{SHOTS}/p14_controls_tab.png")
    pg.locator('.mtabs .bbtn[data-tab="game"]').dispatch_event("click")
    time.sleep(0.5)
    # save into slot 1
    pg.locator('.save-row[data-slot="1"] .bbtn', has_text="Save").dispatch_event("click")
    t0 = time.time()
    while time.time() - t0 < 60 and "Empty" in pg.locator('.save-row[data-slot="1"]').inner_text():
        time.sleep(0.5)
    saved = pg.evaluate("[__session.world.s.tick, __session.player.name, __session.player.living, __session.world.s.mode.mission.stage]")
    row = pg.locator('.save-row[data-slot="1"]').inner_text()
    check("Save puts the game in slot 1", "A Meadow Kingdom" in row, row.replace("\n", " | "))
    # load it back: the page restarts into the save
    pg.locator('.save-row[data-slot="1"] .bbtn', has_text="Load").dispatch_event("click")
    pg.wait_for_url("**/", timeout=60000)
    time.sleep(1)
    wait_ready(pg)
    time.sleep(2)
    got = pg.evaluate("[__session.world.s.tick, __session.player.name, __session.player.living, __session.world.s.mode.mission.stage, __session.input.bindings.dig, location.search]")
    check("Load brings back the same game (tick, colony, mission stage)", got[0] >= saved[0] and got[0] < saved[0] + 400 and got[1] == saved[1] and got[3] == saved[3] and got[5] == "", f"saved {saved} → loaded {got}")
    check("settings persist across the reload (the rebound key)", got[4] == "KeyK")
    check("a loaded mission does not show its briefing again", pg.locator(".modal.briefing").count() == 0)
    # F7 quick save works
    pg.mouse.click(720, 400)
    pg.keyboard.press("F7")
    time.sleep(3)
    quick = pg.evaluate("new Promise(r=>{const q=indexedDB.open('underground-dominion');q.onsuccess=()=>{const t=q.result.transaction('saves').objectStore('saves').get('quick');t.onsuccess=()=>r(!!t.result)}})")
    check("F7 quick-saves", quick)
    # the title screen offers Continue
    pg.goto(BASE, wait_until="load")
    time.sleep(3)
    cont = pg.locator('.mode-card.continue')
    check("the title screen offers Continue with the newest save", cont.count() == 1 and "Continue" in cont.inner_text(), cont.inner_text().replace("\n", " | ") if cont.count() else "")
    pg.locator('button[data-m="load"]').click()
    time.sleep(0.5)
    cards = pg.locator(".load-card").count()
    check("Load a game lists the saves", cards >= 2, str(cards))
    pg.screenshot(path=f"{SHOTS}/p14_title.png")
    check("no page errors", not errs, str(errs[:3]))
    print("\n".join(res))
