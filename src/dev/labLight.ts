import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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
  const preset: LightPreset = light === 'overcast' ? 'overcast' : light === 'forest' ? 'forest' : light === 'studio' ? 'studio' : 'sunny';
  const sunDir = env.sunDir.clone();
  if (light === 'studio') {
    // the key from above, a little in front of the subject (toward the camera) and to the left
    const toCam = cam.position.clone().sub(target).setY(0).normalize();
    sunDir.set(toCam.x * 0.35 - toCam.z * 0.25, 0.9, toCam.z * 0.35 + toCam.x * 0.25).normalize();
  }
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
  if (q.get('bg') === 'studio' || light === 'studio') {
    // a specimen photo: the animal on white paper, a plain pale backdrop, soft light
    env.sky.visible = false;
    const paper = q.get('bgcol') ? Number('0x' + q.get('bgcol')) : 0xe2dfd9;
    if (ground) ground.material = new THREE.MeshStandardMaterial({ color: paper, roughness: 0.92, envMapIntensity: 0.5 });
    scene.background = new THREE.Color(paper).multiplyScalar(1.15);
    env.hemi.intensity = 0.55;
    // the paper fades into the backdrop well before its edge (no horizon band)
    const camDist = cam.position.distanceTo(target);
    scene.fog = new THREE.Fog(scene.background.getHex(), camDist * 1.6 + span, camDist * 5 + span * 3);
    if (ground) ground.scale.setScalar(20);
  }
  const grains = q.get('mask') === '1' || q.get('bg') === 'studio' || light === 'studio' || q.get('amber') === '1' ? 0 : Number(q.get('grains') || 0);
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
  // irregular grains: icospheres pushed in and out by smooth noise, three shapes so no two neighbours match
  const shapes = [0, 1, 2].map((k) => {
    const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 3));
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const p1 = 1.3 + k * 0.9;
    const p2 = 2.1 + k * 1.3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const kk = 1 + 0.2 * Math.sin(v.x * 3.1 * p1 / 2 + 1.3 + k) * Math.cos(v.y * 2.7 + 0.4 * k) + 0.14 * Math.sin(v.z * 4.3 * p2 / 2 + v.x * 1.7) + (k === 2 ? 0.25 * Math.max(0, v.x) : 0);
      v.multiplyScalar(kk);
      pos.setXYZ(i, v.x, v.y * (0.6 + 0.15 * k), v.z * (k === 1 ? 0.75 : 1));
    }
    geo.computeVertexNormals();
    return geo;
  });
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, envMapIntensity: 0.8 });
  const meshes = shapes.map((geo) => new THREE.InstancedMesh(geo, mat, Math.ceil(count / 3)));
  const mesh = meshes[0];
  const m = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  const R = span * 2.2;
  const palette = [0x7c6e56, 0x665a46, 0x8a7c64, 0x5a4c3c, 0x6e5a44, 0x3a322a, 0x76644c, 0x8a8270, 0x8c806a, 0x4e3e30];
  for (let i = 0; i < count; i++) {
    const tgt = meshes[i % 3];
    const j = Math.floor(i / 3);
    const r = R * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    // sizes spread widely: fine sand to small pebbles
    const s = size * (0.25 + 1.6 * Math.pow(rnd(), 2.4));
    e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
    qq.setFromEuler(e);
    // bedded into the soil: only the top of each grain shows
    m.compose(new THREE.Vector3(target.x + Math.cos(a) * r, s * (-0.32 + 0.18 * rnd()), target.z + Math.sin(a) * r), qq, new THREE.Vector3(s * (0.7 + 0.6 * rnd()), s * (0.5 + 0.3 * rnd()), s * (0.7 + 0.6 * rnd())));
    tgt.setMatrixAt(j, m);
    c.setHex(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.55 + 0.45 * rnd());
    tgt.setColorAt(j, c);
  }
  meshes.forEach((mm, k) => (mm.count = Math.floor((count - k + 2) / 3)));
  for (const mm of meshes.slice(1)) {
    mm.castShadow = true;
    mm.receiveShadow = true;
    g.add(mm);
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
  const mat = new THREE.MeshStandardMaterial({ map: tex.sand.map, normalMap: tex.sand.normal, roughness: 0.95, envMapIntensity: 0.6 });
  for (const t of [tex.sand.map, tex.soil.map, tex.litter.map, tex.noise, tex.sand.normal]) {
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

/**
 * Amber specimen mode (realism rework, CHANGE_PLAN §22.2; render only): `?amber=1` sets the subject inside a polished
 * block of amber on a light table — a rounded slab of warm, transmissive resin (ior 1.54, absorbing toward orange),
 * a scatter of small air bubbles and dark plant debris, lit from below and behind as amber pieces are photographed.
 * Nothing here reaches the game.
 */
export function addAmber(scene: THREE.Scene, env: SurfaceLights, target: THREE.Vector3, span: number, q: URLSearchParams, ground?: THREE.Mesh): void {
  if (q.get('amber') !== '1') return;
  env.sky.visible = false;
  if (ground) ground.visible = false;
  scene.fog = null;
  scene.background = new THREE.Color(q.get('bgcol') ? Number('0x' + q.get('bgcol')) : 0xf1eadc);
  // the light table under the piece
  const table = new THREE.Mesh(new THREE.PlaneGeometry(span * 40, span * 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.9, emissive: 0xfff6e8, emissiveIntensity: 0.35 }));
  const bh = span * 1.3;
  const cy = span * 0.28;
  table.position.set(target.x, cy - bh / 2 - 0.01, target.z);
  table.receiveShadow = true;
  scene.add(table);
  const w = span * 1.5;
  const block = new THREE.Mesh(
    new RoundedBoxGeometry(w, bh, span * 0.95, 6, span * 0.14),
    new THREE.MeshPhysicalMaterial({
      color: 0xffd48a,
      roughness: 0.04,
      metalness: 0,
      transmission: 1,
      ior: 1.54,
      // (a small thickness: the subject sits inside the piece, so it is seen through one flat face, barely bent)
      thickness: span * 0.12,
      attenuationColor: new THREE.Color(0xc4680e),
      attenuationDistance: span * Number(q.get('amberd') || 0.8),
      specularIntensity: 1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
    }),
  );
  block.position.set(target.x, cy, target.z);
  block.rotation.y = 0.04;
  block.renderOrder = 3;
  scene.add(block);
  const rnd = rand(77);
  const bubbleMat = new THREE.MeshPhysicalMaterial({ color: 0xfff4dc, roughness: 0.02, transmission: 0.85, ior: 1.15, thickness: 0.05, specularIntensity: 1, envMapIntensity: 1.4 });
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x2e1c0e, roughness: 0.85 });
  const inside = (m: number) => new THREE.Vector3(target.x + (rnd() - 0.5) * w * m, cy + (rnd() - 0.5) * bh * m, target.z + (rnd() - 0.5) * span * 0.85 * m);
  for (let k = 0; k < 40; k++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(span * (0.004 + 0.016 * rnd() * rnd()), 10, 8), bubbleMat);
    b.position.copy(inside(0.9));
    b.renderOrder = 2;
    scene.add(b);
  }
  for (let k = 0; k < 26; k++) {
    const d = new THREE.Mesh(new THREE.TetrahedronGeometry(span * (0.003 + 0.007 * rnd()), 0), debrisMat);
    d.position.copy(inside(0.92));
    // (the sheets: specks over the animal read as glitches — the debris keeps clear of the subject)
    if (Math.abs(d.position.x - target.x) < span * 0.6 && d.position.y < span * 0.75 && Math.abs(d.position.z - target.z) < span * 0.35) continue;
    d.scale.set(1, 0.3 + rnd() * 0.5, 0.6 + rnd());
    d.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
    scene.add(d);
  }
}

let contactTex: THREE.DataTexture | null = null;
/**
 * Contact shadows for the review renders (realism rework, spec §2: "a ground plane, contact shadows"; render only,
 * `?contact=1`): a soft occlusion pool under each body — the overcast sky blocked by the animal — and a small dark
 * spot under each foot, laid on the ground as multiplied decals. Positions in world mm, `rot` the body's yaw.
 */
export function addContactShadows(scene: THREE.Scene, q: URLSearchParams, items: Array<{ x: number; z: number; len: number; wid: number; rot: number; feet?: THREE.Vector3[]; footR?: number }>): void {
  if (q.get('contact') !== '1') return;
  if (!contactTex) {
    const N = 64;
    const d = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5) / N * 2 - 1;
        const y = (j + 0.5) / N * 2 - 1;
        const a = Math.exp(-3.2 * (x * x + y * y)) * Math.max(0, 1 - Math.sqrt(x * x + y * y));
        d.set([0, 0, 0, Math.round(255 * a)], (j * N + i) * 4);
      }
    contactTex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
    contactTex.needsUpdate = true;
    contactTex.magFilter = THREE.LinearFilter;
  }
  const k = Number(q.get('contactk') || 1);
  const mat = (o: number) => new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: o * k, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const body = mat(0.85);
  // (review round 4: the foot spots read as black dots at close range — fainter, wider)
  const foot = mat(0.32);
  for (const it of items) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(it.len * 1.25, it.wid * 2.4).rotateX(-Math.PI / 2), body);
    m.position.set(it.x, 0.004, it.z);
    m.rotation.y = it.rot;
    m.renderOrder = 1;
    scene.add(m);
    for (const f of it.feet ?? []) {
      const r = (it.footR ?? it.len * 0.035) * 1.6;
      const s = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2), foot);
      s.position.set(f.x, 0.005, f.z);
      s.renderOrder = 1;
      scene.add(s);
    }
  }
}
