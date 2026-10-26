import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl","--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1600, "height": 900})
    pg.goto("http://127.0.0.1:5173/?play=1&shot=1&layout=1&ticks=100&q=low&seed=4&species=formica&rival=solenopsis&view=nest", wait_until="load", timeout=200000)
    t0=time.time()
    while time.time()-t0<200 and not pg.evaluate("window.__ready===true"): time.sleep(0.3)
    ev=lambda js: pg.evaluate(js); step=lambda n=2: ev(f"window.__step({n},0.05)")
    pg.mouse.move(800,350); pg.mouse.wheel(0,900); step(30)
    pg.keyboard.press('g'); step()
    cnt="window.__session.world.nest(window.__session.player.id).hexDesig.reduce((a,b)=>a+(b?1:0),0)"
    n0 = ev(cnt)
    pts = ev("""(()=>{const s=window.__session;const g=s.world.nest(s.player.id);const out=[];for(let q=0;q<g.cols*g.rows&&out.length<6;q++){if(!g.isHexDug(q)&&!g.hexDesig[q]&&g.isHexDiggable(q)){const p=g.hexCenter(q);const v=new (s.view.nestCam.position.constructor)(p.x,0,p.y).project(s.view.nestCam);const x=(v.x+1)/2*innerWidth,y=(1-v.y)/2*innerHeight;if(x>420&&x<1250&&y>90&&y<640&&(!out.length||Math.hypot(x-out[out.length-1][0],y-out[out.length-1][1])<90))out.push([x,y])}}return out})()""")
    pg.mouse.move(*pts[0]); pg.mouse.down()
    for pt in pts[1:]: pg.mouse.move(*pt, steps=4)
    pg.mouse.up(); step()
    n1 = ev(cnt)
    print('PASS' if n1>n0 else 'FAIL', 'dig paint', n0, '->', n1, len(pts))
    # second drag over the same hexes clears them
    pg.mouse.move(*pts[0]); pg.mouse.down()
    for pt in pts[1:]: pg.mouse.move(*pt, steps=4)
    pg.mouse.up(); step()
    print('PASS' if ev(cnt)==n0 else 'FAIL', 'repaint clears', ev(cnt))
