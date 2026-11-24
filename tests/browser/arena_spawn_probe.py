"""Performance v6 (claude/performance/06-spec-performance-v6-no-hitches-ever.md §2.1): the battle arena's spawn freeze.
Opens an empty arena, records every frame's main-thread time and its parts (the profiler's own numbers), then spawns
armies from the panel's command and keeps recording through the fight. Prints the frames over the limit with what was
in them (shader links, texture and buffer uploads, the profiler's notes and parts).

  tests/browser/with_server.sh python3 tests/browser/arena_spawn_probe.py
      UNITS="ant:fire_minor:25,ant:fire_major:10"  (each team gets these, team 0 then team 1)
      SECS=30 (recorded after the spawn)  VW=640 VH=400  Q=high  LIMIT=33  OUT=report.json  ZOOM=1 (zoom in at 15 s)
      TEAMS=2  GAP=0 (seconds between the two teams' spawns)  RAF=1 (also log rAF-to-rAF gaps)
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
UNITS = [u.rsplit(":", 1) for u in os.environ.get("UNITS", "ant:fire_minor:25,ant:fire_major:10").split(",")]
SECS = float(os.environ.get("SECS", "30"))
VW = int(os.environ.get("VW", "640"))
VH = int(os.environ.get("VH", "400"))
QUAL = os.environ.get("Q", "high")
LIMIT = float(os.environ.get("LIMIT", "33"))
OUT = os.environ.get("OUT", "")
ZOOM = os.environ.get("ZOOM", "") == "1"
TEAMS = int(os.environ.get("TEAMS", "2"))
GAP = float(os.environ.get("GAP", "0"))
EXTRA = os.environ.get("EXTRA", "")
PASSIVE = os.environ.get("PASSIVE", "") == "1"
PROFILE = os.environ.get("PROFILE", "") == "1"
TOP = int(os.environ.get("TOP", "25"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

HOOK = """() => {
  const p = window.__prof;
  if (p.__rec) return;
  p.__rec = [];
  const end = p.end.bind(p);
  let heap = 0;
  let last = performance.now();
  p.end = function () {
    const cur = {};
    for (const k in this.cur) if (this.cur[k] > 0.5) cur[k] = +this.cur[k].toFixed(1);
    const g = this.gl;
    const now = performance.now();
    const cpu = now - this.cpuStart;
    const mem = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const gc = heap && mem < heap - 2 * 1048576 ? +((heap - mem) / 1048576).toFixed(1) : 0;
    heap = mem;
    const notes = this.notes.slice(0, 6);
    end();
    const s = window.__session;
    const w = s && s.world;
    if (p.__on) p.__rec.push({ t: +(now / 1000).toFixed(2), gap: +(now - last).toFixed(1), cpu: +cpu.toFixed(1), parts: cur, links: g.links, compiles: g.compiles, compileMs: +(g.compileMs || 0).toFixed(1), tex: g.texUploads, texMB: +((g.texBytes || 0) / 1048576).toFixed(2), buf: +(g.bufBytes / 1048576).toFixed(2), gc, notes, ants: w ? w.s.ants.length : 0, tick: w ? w.s.tick : 0 });
    last = now;
  };
}"""


def print_profile(prof):
    from collections import defaultdict
    nodes = {n["id"]: n for n in prof["nodes"]}
    parent = {}
    for n in prof["nodes"]:
        for c in n.get("children", []):
            parent[c] = n["id"]
    dt = defaultdict(float)
    for sid, d in zip(prof["samples"], prof["timeDeltas"]):
        dt[sid] += d / 1000.0

    def name(n):
        cf = n["callFrame"]
        return f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1].split('?')[0]}:{cf['lineNumber'] + 1}"

    selft = defaultdict(float)
    tot = defaultdict(float)
    for sid, t in dt.items():
        selft[name(nodes[sid])] += t
        seen = set()
        cur = sid
        while cur is not None and cur in nodes:
            nm = name(nodes[cur])
            if nm not in seen:
                tot[nm] += t
                seen.add(nm)
            cur = parent.get(cur)
    print("self time (ms):")
    for k, v in sorted(selft.items(), key=lambda kv: -kv[1])[:TOP]:
        print(f"  {v:8.0f}  {k}")
    print("total time (ms):")
    for k, v in sorted(tot.items(), key=lambda kv: -kv[1])[:TOP]:
        print(f"  {v:8.0f}  {k}")


HILLS = """() => { const out = []; window.__session.mounds.group.traverse((o) => { if (!o.isMesh) return; const m = o.material; const g = o.geometry; out.push(`${o.type} ${o.name || ''} v ${g.attributes.position ? g.attributes.position.count : ''} attrs ${Object.keys(g.attributes).join('/')} cast ${o.castShadow} recv ${o.receiveShadow} cdm ${!!o.customDepthMaterial} mat ${Array.isArray(m) ? 'multi' : m.type + ' side ' + m.side + ' ss ' + m.shadowSide + ' map ' + !!m.map + ' at ' + m.alphaTest + ' vc ' + m.vertexColors + ' tr ' + m.transparent + ' disp ' + !!m.displacementMap + ' clip ' + (m.clippingPlanes ? m.clippingPlanes.length : 0) + ' a2c ' + m.alphaToCoverage + ' am ' + !!m.alphaMap}`); }); return out; }"""
# each anthill/dome mesh's shadow program, as the shadow pass used it (onAfterShadow: the shared depth material's program)
SHPROG = """() => { window.__shp = window.__shp || {}; const props = window.__session.view.renderer.properties; window.__session.mounds.group.traverse((o) => { if (!o.isMesh || o.__shp) return; o.__shp = true; const f = o.onAfterShadow; o.onAfterShadow = function (r, obj, cam, scam, geo, dm, grp) { const pr = props.get(dm).currentProgram; window.__shp[o.geometry.attributes.position.count + ' ' + o.uuid.slice(0, 4)] = pr ? pr.id : -1; return f.call(this, r, obj, cam, scam, geo, dm, grp); }; }); return window.__shp; }"""
COLS = "() => window.__session.world.s.colonies.map((c) => `${c.id}:${c.species} ent ${c.entrances.length} living ${c.living} alive ${c.alive}`).join(' | ')"

TRACE = """() => {
  const s = window.__session, m = s.mounds, e = m.entrances;
  window.__trace = [];
  const t = (what) => window.__trace.push(`${(performance.now() / 1000).toFixed(2)} f${window.__prof.frame} ${what}`);
  const wrap = (o, k, f) => { const g = o[k].bind(o); o[k] = (...a) => { const r = g(...a); t(f(a, r)); return r; }; };
  wrap(m, 'build', (a) => `dome built colony ${a[0].colony} r ${a[0].r.toFixed(1)}`);
  wrap(e, 'rebuild', (a) => `anthill rebuild at once colony ${a[0]}`);
  wrap(e, 'swap', (a, r) => `anthill swap ${a[0]} objs ${a[1].objs.length}`);
  if (e.compile) wrap(e, 'compile', (a) => `anthill compiled ahead objs ${a[0].length}`);
}"""


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        pg = b.new_page(viewport={"width": VW, "height": VH})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        t0 = time.time()
        pg.goto(BASE + f"?play=1&mode=arena&seed=3&nocine=1&q={QUAL}{EXTRA}", wait_until="load")
        while time.time() - t0 < 900 and not pg.evaluate("window.__ready===true"):
            time.sleep(0.5)
        print(f"ready in {time.time() - t0:.0f} s", flush=True)
        # (SwiftShader: the GPU's queue after loading can take minutes here — wait until frames flow: 6 frames in a row
        # each under 3 s)
        tq = time.time()
        f0 = pg.evaluate("() => window.__prof.frame")
        while time.time() - tq < 900:
            time.sleep(3)
            f1 = pg.evaluate("() => window.__prof.frame")
            if f1 - f0 >= 6:
                break
            if f1 == f0:
                continue
            f0 = f1 if f1 - f0 < 1 else f0
        print(f"frames flowing {time.time() - tq:.0f} s after ready", flush=True)
        time.sleep(4)
        pg.evaluate(HOOK)
        pg.evaluate("() => { window.__prof.__on = true; }")
        time.sleep(4)
        PROGS = "() => window.__session.view.renderer.info.programs.map((p) => ({ id: p.id, name: p.name, key: p.cacheKey }))"
        progs0 = {x["id"]: x for x in pg.evaluate(PROGS)}
        cdp = None
        if PROFILE:
            cdp = pg.context.new_cdp_session(pg)
            cdp.send("Profiler.enable")
            cdp.send("Profiler.setSamplingInterval", {"interval": 500})
            cdp.send("Profiler.start")
        # the anthills' and domes' builds in play traced (which path built what, and whether its programs were compiled first)
        pg.evaluate(TRACE)
        hills0 = pg.evaluate(HILLS)
        pg.evaluate(SHPROG)
        time.sleep(6)
        print("shadow programs before the spawn:", pg.evaluate(SHPROG))
        tspawn = pg.evaluate("() => performance.now() / 1000")
        for team in range(TEAMS):
            if PASSIVE:
                pg.evaluate(f"() => window.__session.issue({{ type: 'arenaStance', team: {team}, stance: 2 }})")
            for unit, n in UNITS:
                pg.evaluate(f"() => window.__session.issue({{ type: 'arenaSpawn', team: {team}, unit: '{unit}', n: {int(n)}, level: 1, at: false, x: 0, y: 0 }})")
            if GAP:
                time.sleep(GAP)
        # every object's shadow draw recorded with its depth material (which object a new depth program is for)
        SHADOWHOOK = """() => {
          window.__dm = window.__dm || new Map();
          const scenes = [window.__session.view.surfaceScene];
          const gl = window.__session.view.renderer.getContext();
          if (!gl.__lk) {
            gl.__lk = true;
            window.__links = [];
            const lp = gl.linkProgram.bind(gl);
            gl.linkProgram = (prog) => { const st = (new Error().stack || '').split('\\n').slice(2, 12).map((l) => l.trim().replace(/\\(.*\\/(.*?)(\\?[^:]*)?:(\\d+):\\d+\\)/, '($1:$3)')).join(' | '); window.__links.push((window.__cur || '?') + ' @' + (performance.now() / 1000).toFixed(2) + ' frame ' + window.__prof.frame + '\\n        ' + st); return lp(prog); };
          }
          const desc = (obj, pass, mat) => { const chain = []; for (let q = obj.parent; q && chain.length < 4; q = q.parent) chain.push(q.name || q.type); const om = obj.material; return `${pass}: ${obj.type} '${obj.name}' < ${chain.join(' < ')} mat ${mat ? mat.type + ' ' + (mat.name || '') : '?'} cast ${obj.castShadow} customDepth ${!!obj.customDepthMaterial} own ${om && !Array.isArray(om) ? om.type + ' side ' + om.side + ' shadowSide ' + om.shadowSide + ' map ' + !!om.map + ' alphaTest ' + om.alphaTest : '-'} attrs ${obj.geometry ? Object.keys(obj.geometry.attributes).join('/') + ' morph ' + Object.keys(obj.geometry.morphAttributes).length : '-'} v ${obj.geometry && obj.geometry.attributes.position ? obj.geometry.attributes.position.count : ''}`; };
          for (const sc of scenes) sc.traverse((o) => {
            if (o.__hooked) return;
            o.__hooked = true;
            const ob = o.onBeforeRender, os = o.onBeforeShadow;
            o.onBeforeShadow = function (r, obj, cam, scam, geo, dm, grp) { window.__cur = desc(obj, 'shadow', dm); return os.call(this, r, obj, cam, scam, geo, dm, grp); };
            o.onBeforeRender = function (r, scene, cam, geo, mat, grp) { window.__cur = desc(o, 'draw', mat); return ob.call(this, r, scene, cam, geo, mat, grp); };
          });
        }"""
        tz = None
        t1 = time.time()
        while time.time() - t1 < SECS:
            pg.evaluate(SHADOWHOOK)
            pg.evaluate(SHPROG)
            if ZOOM and tz is None and time.time() - t1 > SECS / 2:
                pg.evaluate("() => { window.__objs0 = new Set(); window.__session.view.surfaceScene.traverse((o) => window.__objs0.add(o.uuid)); }")
                tz = pg.evaluate("() => performance.now() / 1000")
                pg.evaluate("() => { const r = window.__session.view.surfaceRig; r.jumpTo(r.target.x, r.target.z, 60); }")
            time.sleep(0.5)
        rec = pg.evaluate("() => window.__prof.__rec")
        progs1 = pg.evaluate(PROGS)
        newobj = pg.evaluate("""() => { if (!window.__objs0) return []; const out = []; window.__session.view.surfaceScene.traverse((o) => { if (!window.__objs0.has(o.uuid)) { const m = o.material; const chain = []; for (let q = o.parent; q; q = q.parent) chain.push(q.name || q.type); out.push(`${o.type} '${o.name}' geo ${o.geometry ? o.geometry.type + ' ' + (o.geometry.attributes.position ? o.geometry.attributes.position.count : '') + 'v' : '-'} col ${m && m.color ? m.color.getHexString() : ''} map ${!!(m && m.map)} at ${o.position.x.toFixed(0)},${o.position.y.toFixed(1)},${o.position.z.toFixed(0)} < ${chain.join(' < ')} cast ${o.castShadow} vis ${o.visible} mat ${m ? (Array.isArray(m) ? 'multi' : m.type + ' ' + m.name) : '-'} customDepth ${!!o.customDepthMaterial} count ${o.count ?? ''}`); } }); return out; }""")
        print(f"objects added to the surface scene after the zoom: {len(newobj)}")
        for x in newobj[:30]:
            print("   ", x)
        new = [x for x in progs1 if x["id"] not in progs0]
        print(f"programs: {len(progs0)} before the spawn, {len(progs1)} after; new:")
        links = pg.evaluate("() => window.__links || []")
        print("colonies after:", pg.evaluate(COLS))
        hills1 = pg.evaluate(HILLS)
        print("shadow programs after:", pg.evaluate(SHPROG))
        print(f"anthill and dome meshes before the spawn ({len(hills0)}):")
        for x in sorted(set(hills0)):
            print("    ", hills0.count(x), x)
        print(f"after ({len(hills1)}):")
        for x in sorted(set(hills1)):
            print("    ", hills1.count(x), x, "" if x in hills0 else "   <- new")
        for x in pg.evaluate("() => window.__trace || []")[:40]:
            print("   trace", x)
        print(f"programs linked while recording: {len(links)}")
        for x in links[:20]:
            print("   ", x)
        owners = pg.evaluate("""() => { const out = {}; const props = window.__session.view.renderer.properties; for (const [id, v] of (window.__dm || new Map())) { const pr = props.get(v.dm).currentProgram; if (pr) (out[pr.id] = out[pr.id] || []).push(v.obj); } return out; }""")
        olds = list(progs0.values())
        for x in new:
            k = x["key"]
            print(f"  #{x['id']} {x['name']}  key {len(k)} chars: {k[:200]}")
            # the nearest program built before: which of the key's fields differ
            fk = k.split(",")
            best = None
            for o in olds:
                fo = o["key"].split(",")
                if len(fo) != len(fk) or fo[0] != fk[0]:
                    continue
                d = [i for i in range(len(fk)) if fk[i] != fo[i]]
                if best is None or len(d) < len(best[1]):
                    best = (o, d)
            for o in olds:
                fo = o["key"].split(",")
                if fo[0] == fk[0]:
                    d = [i for i in range(min(len(fk), len(fo))) if fk[i] != fo[i]]
                    print(f"      same kind #{o['id']} ({len(fo)} fields): differs at " + "; ".join(f"[{i}] {fo[i][:30]!r} -> {fk[i][:30]!r}" for i in d[:10]))
            if best:
                fo = best[0]["key"].split(",")
                print(f"      nearest #{best[0]['id']}: fields differ at " + "; ".join(f"[{i}] {fo[i][:40]!r} -> {fk[i][:40]!r}" for i in best[1][:8]))
            for o in (owners.get(str(x['id'])) or owners.get(x['id']) or [])[:6]:
                print(f"      shadow of: {o}")
        gone = [x for x in progs0.values() if x["id"] not in {y['id'] for y in progs1}]
        if gone:
            print(f"  ({len(gone)} programs released meanwhile: {', '.join(x['name'] for x in gone[:8])})")
        prof = cdp.send("Profiler.stop")["profile"] if cdp else None
        b.close()
    if prof:
        print_profile(prof)
    if errs:
        print("page errors:", errs[:3])
    print(f"{len(rec)} frames recorded; spawn at {tspawn:.2f}" + (f", zoom at {tz:.2f}" if tz else ""))
    long = [r for r in rec if r["cpu"] > LIMIT or r["gap"] > LIMIT * 3]
    print(f"frames with main-thread time over {LIMIT} ms: {sum(1 for r in rec if r['cpu'] > LIMIT)}; worst cpu {max((r['cpu'] for r in rec), default=0)} ms")
    for r in sorted(long, key=lambda r: -r["cpu"])[:25]:
        parts = ", ".join(f"{k} {v}" for k, v in sorted(r["parts"].items(), key=lambda kv: -kv[1])[:8])
        print(f"  t={r['t'] - tspawn:+6.2f}s cpu {r['cpu']:6.1f} gap {r['gap']:6.1f} links {r['links']} compiles {r['compiles']} ({r['compileMs']} ms) tex {r['tex']} ({r['texMB']} MB) buf {r['buf']} MB gc {r['gc']} ants {r['ants']} | {parts} | {'; '.join(r['notes'])}")
    if OUT:
        json.dump({"spawn": tspawn, "zoom": tz, "rec": rec}, open(OUT, "w"))


main()
