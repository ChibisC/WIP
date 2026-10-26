import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl","--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1600, "height": 900})
    pg.set_default_timeout(240000)
    logs=[]
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    pg.goto("http://127.0.0.1:5173/?play=1&shot=1&layout=1&ticks=200&q=low&seed=4&species=formica&rival=solenopsis&view=nest", wait_until="load", timeout=200000)
    t0=time.time()
    while time.time()-t0<400 and not pg.evaluate("window.__ready===true"): time.sleep(0.3)
    ev=lambda js: pg.evaluate(js)
    step=lambda n=2: ev(f"window.__step({n},0.05)")
    res=[]
    def check(name, ok, info=''):
        res.append(f"{'PASS' if ok else 'FAIL'}  {name} {info}")
    gid = ev("window.__session.player.groups.find(g=>g.marker===-1 && g.caste).id")
    card = pg.locator(f'.gcard[data-gid="{gid}"]')
    cb = card.bounding_box(); tb = pg.locator('.mp-col[data-col="0"] .mp-cards').bounding_box()
    sx, sy = cb['x']+cb['width']/2, cb['y']+cb['height']/2
    tx, ty = tb['x']+tb['width']/2, tb['y']+40
    pg.mouse.move(sx, sy); pg.mouse.down()
    for i in range(1,11): pg.mouse.move(sx+(tx-sx)*i/10, sy+(ty-sy)*i/10)
    ghost = ev("!!document.querySelector('.drag-ghost')"); hov = ev("document.querySelector('.mp-col.drop-hover')?.dataset.col")
    pg.mouse.up(); step()
    check('drag shows a ghost', ghost); check('target column highlighted', hov=='0', f'hover={hov}')
    check('drop assigns group to marker I', ev(f"window.__session.player.groups.find(g=>g.id==={gid}).marker")==0)
    check('card moved into column I', ev(f"!!document.querySelector('.mp-col[data-col=\"0\"] .gcard[data-gid=\"{gid}\"]')"))
    # drag back home
    card = pg.locator(f'.gcard[data-gid="{gid}"]'); cb = card.bounding_box(); hb = pg.locator('.mp-col[data-col="-1"] .mp-cards').bounding_box()
    sx, sy = cb['x']+cb['width']/2, cb['y']+cb['height']/2; tx, ty = hb['x']+hb['width']/2, hb['y']+60
    pg.mouse.move(sx, sy); pg.mouse.down()
    for i in range(1,11): pg.mouse.move(sx+(tx-sx)*i/10, sy+(ty-sy)*i/10)
    pg.mouse.up(); step()
    check('drag back to home column', ev(f"window.__session.player.groups.find(g=>g.id==={gid}).marker")==-1)
    # header click + place in nest
    pg.locator('.mp-col[data-col="0"] .mp-head').click(); step()
    check('header click selects marker I', ev("window.__session.tool==='marker' && window.__session.markerSel===0"))
    pos = ev("""(()=>{const s=window.__session;const g=s.world.nest(s.player.id);for(let q=0;q<g.cols*g.rows;q++){if(g.isHexDug(q)){const p=g.hexCenter(q);const v=new (s.view.nestCam.position.constructor)(p.x,0,p.y).project(s.view.nestCam);const x=(v.x+1)/2*innerWidth,y=(1-v.y)/2*innerHeight;if(x>500&&x<1100&&y>200&&y<600)return [x,y]}}return null})()""")
    pg.mouse.click(pos[0], pos[1]); step()
    check('click places marker I in the nest', ev("window.__session.player.markers[0].placed && window.__session.player.markers[0].space===1"))
    check('marker count label visible', ev("[...document.querySelectorAll('.mlabel')].some(l=>l.style.display==='block')"))
    pg.keyboard.press('3'); step(); t3 = ev("window.__session.tool+' '+window.__session.markerSel")
    pg.keyboard.press('Escape'); step()
    check('key 3 selects marker III, Esc cancels', t3=='marker 2' and ev("window.__session.tool")=='none', t3)
    # tile placement via build panel
    pg.locator('.tbtn', has_text='Food Storage').click(); step()
    n0 = ev("window.__session.player.tiles.length")
    pos = ev("""(()=>{const s=window.__session;const g=s.world.nest(s.player.id);const c=s.player;for(let q=0;q<g.cols*g.rows;q++){if(g.isHexDug(q)&&!g.isEntrance(q)&&!c.tiles.find(t=>t.q===q)){const p=g.hexCenter(q);const v=new (s.view.nestCam.position.constructor)(p.x,0,p.y).project(s.view.nestCam);const x=(v.x+1)/2*innerWidth,y=(1-v.y)/2*innerHeight;if(x>420&&x<1250&&y>120&&y<620)return [x,y]}}return null})()""")
    if pos:
        pg.mouse.move(pos[0], pos[1]); step()
        ghost = ev("window.__session.ghostInfo")
        pg.mouse.click(pos[0], pos[1]); step()
        check('tile ghost shows cost and group', 'food' in ghost, ghost)
        check('click places a food store', ev("window.__session.player.tiles.length")==n0+1)
    else: check('found free hex on screen', False)
    pg.keyboard.press('Escape'); step()
    # area tabs (on the minimaps): the rival nest's tab stays shut while none of our ants are inside
    pg.locator('.at-tab').nth(1).click(); step(3)
    check('tab 2 (rival nest) is closed without ants inside', ev("window.__session.view.activeNest===1 && document.querySelectorAll('.at-tab')[1].classList.contains('shut')"))
    ev("window.__session.revealAreas=true"); step(2)
    pg.locator('.at-tab').nth(1).click(); step(16)
    check('with "reveal all areas", tab 2 shows the rival nest', ev("window.__session.viewedArea===2 && window.__session.view.activeNest===2"))
    pg.locator('.at-tab').nth(0).click(); step(16)
    check('tab 1 returns to your nest', ev("window.__session.viewedArea===1 && window.__session.view.activeNest===1"))
    ev("window.__session.revealAreas=false")
    # recall & aggression & ability
    pg.locator('.mp-actions .bbtn').nth(1).click(); step()
    check('aggression toggles to defend', ev("window.__session.player.aggressive===false"))
    pg.locator('.mp-actions .bbtn').nth(2).click(); step()
    check('ability starts its cooldown', ev("window.__session.player.abilityCd>0"))
    # menu
    pg.locator('.tb-right .bbtn').click(); step()
    check('menu opens and pauses', ev("!!document.querySelector('.modal') && window.__session.loop.paused"))
    pg.keyboard.press('Escape'); step()
    check('Esc closes the menu', ev("!document.querySelector('.modal')"))
    print("\n".join(res)); print("\n".join(logs[-5:]))
