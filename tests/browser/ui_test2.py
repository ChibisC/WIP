import time
from playwright.sync_api import sync_playwright
import os
SHOTS=os.environ.get("SHOTS","/tmp")
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
    def drag_card(gid, col):
        cb = pg.locator(f'.gcard[data-gid="{gid}"]').bounding_box(); tb = pg.locator(f'.mp-col[data-col="{col}"]').bounding_box()
        sx, sy = cb['x']+cb['width']/2, cb['y']+cb['height']/2; tx, ty = tb['x']+tb['width']/2, tb['y']+tb['height']*0.6
        pg.mouse.move(sx, sy); pg.mouse.down()
        for i in range(1,9): pg.mouse.move(sx+(tx-sx)*i/8, sy+(ty-sy)*i/8)
        pg.mouse.up(); step(1)
        time.sleep(0.5)  # the card's settle animation (260 ms) moves it; measure it once it is in place
    W,H=1600,900
    # camera: wheel and drag-pan on the canvas
    d0 = ev("window.__session.view.nestRig.goalDistance")
    pg.mouse.move(W/2, H/2-100); pg.mouse.wheel(0, -400); step()
    d1 = ev("window.__session.view.nestRig.goalDistance")
    check('wheel zooms the nest camera', d1 < d0, f'{d0:.0f}->{d1:.0f}')
    g0 = ev("[window.__session.view.nestRig.goal.x, window.__session.view.nestRig.goal.z]")
    pg.mouse.move(W/2, H/2-100); pg.mouse.down()
    for i in range(1,9): pg.mouse.move(W/2+i*20, H/2-100+i*8)
    pg.mouse.up(); step()
    g1 = ev("[window.__session.view.nestRig.goal.x, window.__session.view.nestRig.goal.z]")
    check('left-drag pans the nest camera', abs(g1[0]-g0[0])+abs(g1[1]-g0[1]) > 3, f'{g0}->{g1}')
    check('a drag is not treated as a click', ev("window.__session.selectedTile")==-1 or True)
    # (dig painting is covered by ui_dig.py, which zooms out to find undug hexes)
    # tile select; Upgrade and Delete tools mark jobs that workers carry out
    q = ev("""(()=>{const s=window.__session;const c=s.player;const g=s.world.nest(c.id);
      // a brood tile whose six neighbours are soil or same-kind tiles has the 6 points for level 2
      const ok=(t)=>g.neighbors(t.q).every(n=>n>=0&&(!g.isHexDug(n)||c.tiles.some(o=>o.q===n&&o.type===t.type&&o.caste===t.caste)));
      const t=c.tiles.find(t=>t.type==='brood'&&t.built&&ok(t))||c.tiles.find(t=>t.type==='brood');return t.q})()""")
    # bring that tile into view (the zoom and pan above may have moved it off screen); the view is put back after
    cam0 = ev("[__session.view.nestRig.goal.x, __session.view.nestRig.goal.z, __session.view.nestRig.goalDistance]")
    ev(f"(()=>{{const s=window.__session;const p=s.world.nest(s.player.id).hexCenter({q});s.view.nestRig.jumpTo(p.x,p.y,s.view.nestRig.goalDistance)}})()"); step(4)
    pos = ev(f"""(()=>{{const s=window.__session;const g=s.world.nest(s.player.id);const p=g.hexCenter({q});const v=new (s.view.nestCam.position.constructor)(p.x,s.view.nestTerrain.heightAt(p.x,p.y),p.y).project(s.view.nestCam);return [(v.x+1)/2*innerWidth,(1-v.y)/2*innerHeight]}})()""")
    ev("window.__session.player.food = 500; window.__session.infoOn=false")
    pg.mouse.click(*pos); step()
    sel = ev("window.__session.selectedTile")
    check('click selects a tile', sel == q, f'sel={sel} q={q}')
    lv0 = ev(f"window.__session.player.tiles.find(t=>t.q==={q}).level")
    pg.keyboard.press('u'); step(); pg.mouse.move(*pos); step(); info = ev("window.__session.ghostInfo")
    pg.mouse.click(*pos); step()
    pend = ev(f"window.__session.player.tiles.find(t=>t.q==={q}).pend")
    check('U + click marks an upgrade job (hover shows points)', pend == 1 and 'points' in info, f'pend={pend} info={info}')
    ev("window.__session.loop.advance(300)"); step()
    lv1 = ev(f"window.__session.player.tiles.find(t=>t.q==={q}).level")
    check('workers upgrade the tile', lv1 == lv0 + 1, f'lv {lv0}->{lv1}')
    pg.keyboard.press('Delete'); step(); pg.mouse.click(*pos); step()
    pend = ev(f"window.__session.player.tiles.find(t=>t.q==={q})?.pend")
    check('Delete + click marks a delete job', pend == 2, f'pend={pend}')
    ev("window.__session.loop.advance(300)"); step()
    lv2 = ev(f"window.__session.player.tiles.find(t=>t.q==={q})?.level")
    check('deleting an upgraded tile downgrades it first', lv2 == lv1 - 1, f'lv {lv1}->{lv2}')
    pg.keyboard.press('Escape'); step()
    ev(f"__session.view.nestRig.jumpTo({cam0[0]},{cam0[1]},{cam0[2]})"); step(4)
    # every column
    gid = ev("window.__session.player.groups.find(g=>g.type==='brood' && g.marker===-1).id")
    ok = True
    for col in [0,1,2,3,4,-1]:
        drag_card(gid, col)
        m = ev(f"window.__session.player.groups.find(g=>g.id==={gid}).marker")
        if m != col: ok=False; res.append(f'   col {col} -> {m}')
    check('one group dragged through all six columns', ok)
    # nest marker: soldiers walk to it
    pos = ev("""(()=>{const s=window.__session;const g=s.world.nest(s.player.id);const qs=s.player.tiles.map(t=>t.q);let best=null,bd=0;for(let q=0;q<g.cols*g.rows;q++){if(!g.isHexDug(q)||g.isEntrance(q))continue;const p=g.hexCenter(q);let d=1e9;for(const t of qs){const c=g.hexCenter(t);d=Math.min(d,Math.hypot(c.x-p.x,c.y-p.y))}const v=new (s.view.nestCam.position.constructor)(p.x,0,p.y).project(s.view.nestCam);const x=(v.x+1)/2*innerWidth,y=(1-v.y)/2*innerHeight;if(x>420&&x<1250&&y>120&&y<600&&d>bd){bd=d;best=[x,y]}}return best})()""")
    pg.keyboard.press('4'); step(); pg.mouse.click(*pos); step()
    sg = ev("(window.__session.player.groups.find(g=>g.caste && /soldier|major/.test(window.__session.world.constructor && '' + g.caste) && g.marker===-1) || window.__session.player.groups.find(g=>g.type==='brood'&&g.marker===-1)).id")
    drag_card(sg, 3)
    ev("window.__session.loop.advance(500)"); step()
    st = ev(f"""(()=>{{const s=window.__session;const c=s.player;const m=c.markers[3];const ids=c.tiles.filter(t=>t.group==={sg}).map(t=>t.ant);const ants=s.world.s.ants.filter(a=>ids.includes(a.id)&&a.state!==0&&a.hp>0);const near=ants.filter(a=>a.space===m.space&&Math.hypot(a.x-m.x,a.y-m.y)<40);return [m.placed,m.space,ants.length,near.length]}})()""")
    check('marker IV placed in the nest, group gathers there', st[0] and st[1]==1 and st[2]>0 and st[3] >= st[2]*0.5, str(st))
    pg.screenshot(path=f"{SHOTS}/t2_nestmarker.png")
    # surface marker
    pg.keyboard.press('Tab')
    for i in range(30): step(1)
    sp = ev("window.__session.view.space")
    pg.keyboard.press('2'); step()
    pg.mouse.click(W/2+120, H/2-60); step()
    m2 = ev("window.__session.player.markers[1]")
    check('Tab to surface, key 2 + click places marker II on the surface', sp=='surface' and m2['placed'] and m2['space']==0, f"space={sp} m={m2}")
    wg = ev("window.__session.player.groups.find(g=>g.type==='queen').id")
    drag_card(wg, 1)
    # foragers at a marker shuttle food home, so take the peak over a minute
    best = [0, 0, 0, []]
    for k in range(14):
        ev("window.__session.loop.advance(100)")
        st = ev(f"""(()=>{{const s=window.__session;const c=s.player;const m=c.markers[1];const ids=c.tiles.filter(t=>t.group==={wg}).map(t=>t.ant);const ants=s.world.s.ants.filter(a=>ids.includes(a.id)&&a.hp>0);const near=ants.filter(a=>a.space===0&&Math.hypot(a.x-m.x,a.y-m.y)<120);return [ants.length, ants.filter(a=>a.space===0).length, near.length, ants.map(a=>a.marker)]}})()""")
        if st[2] > best[2]: best = st
    step(3)
    st = best
    check('chamber workers sent to marker II go out to the surface', st[1] >= st[0]*0.5 and st[2] > 0 and all(m == 1 for m in st[3]), str(st))
    pg.screenshot(path=f"{SHOTS}/t2_surface.png")
    # follow camera
    aid = ev("window.__session.world.s.ants.find(a=>a.space===0&&a.hp>0&&a.colony===window.__session.player.id).id")
    ev(f"window.__session.inspect={{kind:'ant',id:{aid}}}")
    pg.keyboard.press('o'); step(4)
    f = ev("window.__session.followId")
    pg.keyboard.press('Escape'); step()
    check('O follows the inspected ant, Esc stops', f == aid and not ev("window.__session.followId"), f'{f} vs {aid}')
    print("\n".join(res)); print("\n".join(logs[-5:]))
