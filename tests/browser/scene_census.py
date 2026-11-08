"""What the renderer goes through each frame (performance v3): a scene's objects, meshes, shadow casters, visible meshes
and instanced meshes with their counts, and the draw calls and triangles of one frame — per space shown.

Run: tests/browser/with_server.sh python3 tests/browser/scene_census.py   (QUERY='stress=1&ants=200&creatures=40&view=nest' Q=high)
"""
import json
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://127.0.0.1:5173/")
QUERY = os.environ.get("QUERY", "stress=1&ants=200&creatures=100&bosses=2")
Q = os.environ.get("Q", "high")
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

JS = """() => {
  const s = window.__session; const v = s.view;
  const scene = v.space === 'surface' ? v.surfaceScene : v.activeScene();
  const out = { space: v.space, objects: 0, meshes: 0, visibleMeshes: 0, casters: 0, visibleCasters: 0, instanced: 0, instances: 0, materials: new Set(), byName: {} };
  scene.traverseVisible((o) => {
    out.objects++;
    if (o.isMesh || o.isPoints || o.isLine) {
      out.visibleMeshes++;
      if (o.castShadow) out.visibleCasters++;
      if (o.isInstancedMesh) { out.instanced++; out.instances += o.count; }
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) out.materials.add(m.uuid);
      const key = (o.name || o.type).split(':').slice(0, 2).join(':');
      out.byName[key] = (out.byName[key] || 0) + 1;
    }
  });
  scene.traverse((o) => { if (o.isMesh) { out.meshes++; if (o.castShadow) out.casters++; } });
  // the biggest meshes by triangles (instances included), and whether they cast shadows
  const big = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry; const per = (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    big.push([o.name || o.type, Math.round(per * n), o.castShadow ? 1 : 0, o.frustumCulled ? 1 : 0, n, o.visible ? 1 : 0]);
  });
  big.sort((a, b) => b[1] - a[1]);
  out.big = big.slice(0, 25);
  out.materials = out.materials.size;
  return out;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    pg = b.new_page(viewport={"width": 480, "height": 300})
    pg.set_default_timeout(1800000)
    pg.goto(BASE + f"?{QUERY}&q={Q}&nocine=1", wait_until="load")
    pg.wait_for_function("window.__ready === true", timeout=1800000)
    time.sleep(8)
    res = pg.evaluate(JS)
    calls = pg.evaluate("() => { const i = window.__session.view.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length, geometries: i.memory.geometries, textures: i.memory.textures }; }")
    top = sorted(res.pop("byName").items(), key=lambda kv: -kv[1])[:25]
    big = res.pop("big")
    print(json.dumps(res), json.dumps(calls))
    print("visible meshes by name:", ", ".join(f"{k} {n}" for k, n in top))
    print("biggest meshes (name, triangles, casts shadow, culled, instances, visible):")
    for b in big: print("  ", b)
    b.close()
