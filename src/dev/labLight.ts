import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SurfaceLights } from '../render/environment';
import { LightPreset, presetEnvironment, setCreatureLighting } from '../render/lightPresets';
import { textures } from '../render/textures';

/**
 * Lab lighting and presentation (realism pass v2): the creature lighting presets, a backlit test, tone
 * mapping and exposure, and a macro ground of sand grains and litter around the subject, so a close-up has
 * real ground under it rather than a stretched terrain texture.
 *
 *   ?light=sunny|overcast|forest|backlit  (backlit: the sun low behind the subject, facing the camera)
 *   ?tm=aces|agx|neutral  ?exp=1  ?grains=<count>  ?grainmm=<typical grain size, mm>  ?litter=<count>
 *   ?bg=sky (default) | env (the environment, blurred) | studio (plain backdrop, no ground: specimen photos)
 */
export function applyLabLight(renderer: THREE.WebGLRenderer, scene: THREE.Scene, env: SurfaceLights, cam: THREE.Camera, target: THREE.Vector3, span: number, q: URLSearchParams, ground?: THREE.Mesh): void {
  const light = q.get('light') || 'sunny';
  const preset: LightPreset = light === 'overcast' ? 'overcast' : light === 'forest' ? 'forest' : 'sunny';
  const sunDir = env.sunDir.clone();
  if (light === 'backlit') {
    // the sun low behind the subject, a little to the side, shining toward the camera
    const back = target.clone().sub(cam.position).setY(0).normalize();
    sunDir.set(back.x * 0.9 + back.z * 0.25, 0.42, back.z * 0.9 - back.x * 0.25).normalize();
  }
  env.sunDir.copy(sunDir);
  const p = setCreatureLighting(renderer, preset, sunDir);
  env.sun.intensity = p.sun * (light === 'backlit' ? 1.15 : 1);
  env.sun.color.setHex(p.sunColor);
  env.sun.target.position.copy(target);
  env.sun.position.copy(target).addScaledVector(sunDir, span * 6 + 200);
  scene.environment = presetEnvironment(renderer, preset, sunDir);
  // a macro background: the same little world, out of focus (as behind a real close-up)
  if (q.get('bg') === 'env') {
    env.sky.visible = false;
    scene.background = scene.environment;
    scene.backgroundBlurriness = Number(q.get('bgblur') || 0.45);
    scene.backgroundIntensity = 1;
  }
  // the ground's ambient: a weaker hemisphere when the environment lights it
  env.hemi.intensity = preset === 'overcast' ? 0.75 : preset === 'forest' ? 0.55 : 0.7;
  const sky = env.sky.material as THREE.ShaderMaterial;
  if (sky.uniforms?.sunDir) (sky.uniforms.sunDir.value as THREE.Vector3).copy(sunDir);
  const tm = q.get('tm');
  if (tm === 'agx') renderer.toneMapping = THREE.AgXToneMapping;
  else if (tm === 'neutral') renderer.toneMapping = THREE.NeutralToneMapping;
  else if (tm === 'aces') renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if (q.get('exp')) renderer.toneMappingExposure = Number(q.get('exp'));
  if (q.get('bg') === 'studio') {
    // a museum specimen photo: plain pale backdrop, no ground, soft even light
    env.sky.visible = false;
    if (ground) ground.visible = false;
    scene.background = new THREE.Color(q.get('bgcol') ? Number('0x' + q.get('bgcol')) : 0xd8d6d0);
  }
  const grains = q.get('mask') === '1' || q.get('bg') === 'studio' ? 0 : Number(q.get('grains') || 0);
  if (grains > 0) {
    scene.add(macroGround(target, span, grains, Number(q.get('grainmm') || span * 0.03), Number(q.get('litter') || 0)));
    // the ground at the subject's scale, three textures blended by low-frequency noise so nothing repeats
    if (ground) mixGround(ground, span);
  }
}

/** Seeded random (the lab renders are reproducible). */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Sand grains and a few litter flakes scattered around the subject: rounded, irregular grains of quartz,
 * feldspar and dark minerals in soil, bedded into the ground (instanced, one draw each).
 */
function macroGround(target: THREE.Vector3, span: number, count: number, size: number, litter: number): THREE.Group {
  const rnd = rand(7);
  const g = new THREE.Group();
  // an irregular grain: an icosphere pushed in and out by smooth noise
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 3));
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + 0.18 * Math.sin(v.x * 3.1 + 1.3) * Math.cos(v.y * 2.7 + 0.4) + 0.12 * Math.sin(v.z * 4.3 + v.x * 1.7);
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y * 0.75, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, envMapIntensity: 0.8 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  const R = span * 2.2;
  const palette = [0x8c7e66, 0x766a56, 0x9e9078, 0x5a4c3c, 0x6e5a44, 0x3a322a, 0x86745c, 0xa8a090];
  for (let i = 0; i < count; i++) {
    const r = R * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const s = size * (0.35 + 1.3 * Math.pow(rnd(), 2));
    e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
    qq.setFromEuler(e);
    // bedded into the soil: only the top of each grain shows
    m.compose(new THREE.Vector3(target.x + Math.cos(a) * r, s * (-0.15 + 0.2 * rnd()), target.z + Math.sin(a) * r), qq, new THREE.Vector3(s * (0.8 + 0.4 * rnd()), s * (0.55 + 0.25 * rnd()), s * (0.8 + 0.4 * rnd())));
    mesh.setMatrixAt(i, m);
    c.setHex(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.6 + 0.35 * rnd());
    mesh.setColorAt(i, c);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  if (litter > 0) {
    // flakes of dead leaf: thin, curled, brown
    const lg = new THREE.PlaneGeometry(1, 1, 6, 6);
    const lp = lg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setZ(i, 0.12 * (lp.getX(i) * lp.getX(i) + 0.6 * lp.getY(i) * lp.getY(i)));
    lg.computeVertexNormals();
    lg.rotateX(-Math.PI / 2);
    const lm = new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide });
    const lmesh = new THREE.InstancedMesh(lg, lm, litter);
    for (let i = 0; i < litter; i++) {
      const r = R * (0.25 + 0.75 * Math.sqrt(rnd()));
      const a = rnd() * Math.PI * 2;
      const s = span * (0.12 + 0.25 * rnd());
      e.set((rnd() - 0.5) * 0.3, rnd() * 6.28, (rnd() - 0.5) * 0.3);
      qq.setFromEuler(e);
      m.compose(new THREE.Vector3(target.x + Math.cos(a) * r, size * 0.3, target.z + Math.sin(a) * r), qq, new THREE.Vector3(s, s, s * 0.6));
      lmesh.setMatrixAt(i, m);
      c.setHex([0x6b4a2a, 0x8a6236, 0x5a3e24, 0x9a7444][Math.floor(rnd() * 4)]).multiplyScalar(0.8 + 0.3 * rnd());
      lmesh.setColorAt(i, c);
    }
    lmesh.castShadow = true;
    lmesh.receiveShadow = true;
    g.add(lmesh);
  }
  return g;
}

/** Creature part colours for the lab part masks (realism metrics). */
const CR_MASK: Record<string, number> = {
  stag_head: 0xff0000,
  stag_pronotum: 0x00ff00,
  stag_elytra: 0x0000ff,
  stag_mandL: 0xff8000,
  stag_mandR: 0xff8000,
  stag_under: 0x00ffff,
  stag_coxa: 0xffff00,
  stag_femur: 0xffff00,
  stag_tibia1: 0xffff00,
  stag_tibia: 0xffff00,
  stag_tarsus: 0xffff00,
  stag_scape: 0xff00ff,
  stag_funicle: 0xff00ff,
  stag_club: 0xff00ff,
};

/**
 * ?mask=1: render flat part colours on black instead of the picture (no ground, sky, post or tone mapping),
 * for the per-part colour statistics in tools/realism-metrics.py. Returns whether it rendered.
 */
export function renderLabMask(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, q: URLSearchParams, keep: THREE.Object3D[], creatureGroup?: THREE.Object3D): boolean {
  if (q.get('mask') !== '1') return false;
  const keepSet = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => keepSet.add(o));
  if (creatureGroup) {
    creatureGroup.traverse((o) => {
      keepSet.add(o);
      const m = o as THREE.InstancedMesh;
      if (!m.isInstancedMesh) return;
      m.material = new THREE.MeshBasicMaterial({ color: CR_MASK[m.name] ?? 0x000000 });
      m.instanceColor = null;
    });
  }
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !keepSet.has(o)) o.visible = false;
  });
  scene.background = new THREE.Color(0x000000);
  scene.fog = null;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.render(scene, cam);
  return true;
}

/**
 * A lab ground that holds up at macro scale: soil, sand and litter blended by low-frequency noise at the
 * subject's scale, each sampled at its own scale and offset, so no texture repeat or ring pattern shows.
 */
function mixGround(ground: THREE.Mesh, span: number): void {
  const tex = textures();
  const size = (ground.geometry as THREE.PlaneGeometry).parameters?.width ?? 400;
  const mat = new THREE.MeshStandardMaterial({ map: tex.sand.map, normalMap: tex.soil.normal, roughness: 0.95, envMapIntensity: 0.6 });
  for (const t of [tex.sand.map, tex.soil.map, tex.litter.map, tex.noise, tex.soil.normal]) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  const rep = size / (span * 2.2);
  mat.map!.repeat.set(rep, rep);
  mat.normalMap!.repeat.set(rep * 0.7, rep * 0.7);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSoil = { value: tex.soil.map };
    sh.uniforms.uLitter = { value: tex.litter.map };
    sh.uniforms.uNoise = { value: tex.noise };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform sampler2D uSoil; uniform sampler2D uLitter; uniform sampler2D uNoise;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 uv = vMapUv;
          float n1 = texture2D(uNoise, uv * 0.031 + 0.17).r;
          float n2 = texture2D(uNoise, uv * 0.083 + 0.61).g;
          vec3 soil = texture2D(uSoil, uv * 0.53 + vec2(0.31, 0.77)).rgb;
          vec3 lit = texture2D(uLitter, mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.37).rgb;
          vec3 c = mix(diffuseColor.rgb, soil, smoothstep(0.35, 0.65, n1));
          c = mix(c, lit, smoothstep(0.55, 0.75, n2) * 0.8);
          diffuseColor.rgb = c * (0.85 + 0.3 * n2);
        }`,
      );
  };
  ground.material = mat;
}
