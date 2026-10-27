import * as THREE from 'three';
import { PostPipeline } from '../render/post';
import { setBakeRenderer } from '../render/bake/detailBake';
import { createSurfaceEnvironment } from '../render/environment';
import { applyLabLight, renderLabMask } from './labLight';
import { textures } from '../render/textures';
import { globalUniforms } from '../render/shaderPatch';
import { CreatureRenderer } from '../render/creatures/creatureRenderer';
import { EXTENT } from '../render/creatures/builders';
import { CREATURES } from '../sim/creatures/kinds';
import type { Creature } from '../sim/types';

/**
 * Creature model review scene (Phase 11):
 *   ?scene=crlab&kinds=groundBeetle,wolfSpider&state=0&st=1&phase=0.2&amp=1&cam=34
 * Options: rot (heading), curve (chains walk in on an arc), dead=1&deadT=2&eaten=0.5,
 * riders=14, exposed=1, scale=k (per-kind lengths times k), spacing, dist, fov, dof.
 * Each creature walks in to its place first so chains have a trail and legs a phase.
 */
export function runCreatureLab(canvas: HTMLCanvasElement, q: URLSearchParams): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  setBakeRenderer(renderer);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const env = createSurfaceEnvironment(renderer, scene);
  scene.fog = null;
  const tex = textures();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex.soil.map, normalMap: tex.soil.normal, roughness: 0.95 }),
  );
  (ground.material as THREE.MeshStandardMaterial).map!.repeat.set(30, 30);
  (ground.material as THREE.MeshStandardMaterial).normalMap!.repeat.set(30, 30);
  ground.receiveShadow = true;
  scene.add(ground);
  const kinds = (q.get('kinds') || q.get('kind') || 'groundBeetle').split(',');
  const k = Number(q.get('scale') || 1);
  const rot = Number(q.get('rot') || 0);
  const curve = Number(q.get('curve') || 0);
  const num = (n: string, d: number) => (q.get(n) !== null ? Number(q.get(n)) : d);
  const cr = new CreatureRenderer('labCreatures');
  scene.add(cr.group);
  const Ls = kinds.map((kd) => (CREATURES[kd]?.length ?? 10) * k);
  const Es = kinds.map((kd, i) => Ls[i] * (EXTENT[kd] ?? 1.15));
  const maxL = Math.max(...Es);
  const spacing = num('spacing', maxL * 0.15);
  const totalW = Es.reduce((a, b) => a + b, 0) + (kinds.length - 1) * spacing;
  let x = -totalW / 2;
  const list: Creature[] = kinds.map((kind, i) => {
    const L = Ls[i];
    const cx = x + Es[i] / 2;
    x += Es[i] + spacing;
    return {
      id: i + 1,
      kind,
      space: -1,
      x: cx,
      y: 0,
      px: cx,
      py: 0,
      h: rot,
      ph: rot,
      v: 0,
      hp: 1,
      maxHp: 1,
      state: num('state', 0),
      st: num('st', 2),
      tgt: 0,
      tk: 0,
      tx: 0,
      ty: 0,
      homeX: 0,
      homeY: 0,
      cd: 0,
      cd2: 0,
      latched: 0,
      latchGrip: 0,
      phase: 0,
      wind: 0,
      anim: 0,
      v2: (i * 0.37) % 1,
      dead: q.get('dead') === '1',
      deadT: num('deadT', 2),
      scale: L,
      venom: 0,
      venomT: 0,
      venomDps: 0,
      slowT: 0,
      stun: 0,
      faction: -1,
      data: { riders: num('riders', kind === 'hogna' ? 14 : 0), exposed: num('exposed', 0), eaten: num('eaten', 0), pit: L * 1.3 },
    };
  });
  // walk each creature in to its place (backward along its path from the end pose)
  const flat = () => 0;
  const finals = list.map((c) => ({ x: c.x, y: c.y }));
  // ?walk=<seconds> at ?speed=<body lengths per second>: consecutive values give consecutive frames of the gait
  const walkS = num('walk', 2.5);
  const speedL = num('speed', 1);
  const steps = Math.max(1, Math.round(walkS * 60));
  for (let s = steps; s >= 0; s--) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const L = Ls[i];
      // arc length back from the end, and the heading there
      const back = (s / 60) * speedL * L;
      const hh = rot - (curve * back) / L;
      // integrate the arc position (closed form for a circle, straight when curve = 0)
      let dx: number;
      let dz: number;
      if (Math.abs(curve) < 1e-4) {
        dx = -Math.cos(rot) * back;
        dz = -Math.sin(rot) * back;
      } else {
        const R = L / curve;
        dx = R * (Math.sin(rot) - Math.sin(hh));
        dz = -R * (Math.cos(rot) - Math.cos(hh));
        dx = -dx;
        dz = -dz;
      }
      c.px = c.x = finals[i].x + dx;
      c.py = c.y = finals[i].y + dz;
      c.ph = c.h = hh;
    }
    cr.update(list, -1, 1, 1 / 60, flat, null, 1);
  }
  if (q.get('phase') !== null) list.forEach((c, i) => cr.setAnim(c.id, num('phase', 0.15), num('amp', 1) * Ls[i] * 0.6));
  cr.update(list, -1, 1, 0, flat, null, 1);

  const camKind = q.get('cam') || '34';
  const span = Math.max(totalW, maxL);
  const dist = num('dist', span * (kinds.length > 1 ? 1.25 : 1.9));
  const cam = new THREE.PerspectiveCamera(num('fov', 30), window.innerWidth / window.innerHeight, dist * 0.02, dist * 50);
  const target = new THREE.Vector3(num('tx', 0), num('ty', Math.max(...Ls) * 0.1), num('tz', 0));
  const dirs: Record<string, THREE.Vector3> = {
    side: new THREE.Vector3(0, 0.12, 1),
    // realism v2: a side view from a little above (field macro photos: ground behind, no horizon)
    fside: new THREE.Vector3(0.08, 0.42, 1),
    top: new THREE.Vector3(0.0001, 1, 0.0001),
    front: new THREE.Vector3(1, 0.25, 0.0001),
    back: new THREE.Vector3(-1, 0.35, 0.0001),
    '34': new THREE.Vector3(0.7, 0.55, 0.85),
    low: new THREE.Vector3(0.9, 0.18, 0.6),
    game: new THREE.Vector3(0.25, 1, 0.55),
  };
  cam.position.copy(target).addScaledVector(dirs[camKind].normalize(), dist);
  if (camKind === 'top') cam.up.set(1, 0, 0);
  cam.lookAt(target);
  // realism v2: lighting preset, backlit test, tone mapping, macro ground (dev/labLight.ts)
  applyLabLight(renderer, scene, env, cam, target, span, q, ground);
  const sun = env.sun;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -span;
  sc.right = span;
  sc.top = span;
  sc.bottom = -span;
  sc.updateProjectionMatrix();
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(env.sunDir, 400);
  if (renderLabMask(renderer, scene, cam, q, [], cr.group)) {
    (window as unknown as { __ready: boolean }).__ready = true;
    return;
  }
  const post = new PostPipeline(renderer);
  post.setSize(window.innerWidth, window.innerHeight, 1);
  post.focusDistance = dist;
  post.tilt = 0;
  post.settings.dofStrength = num('dof', 0.4);
  post.settings.ao = q.get('ao') !== '0';
  // realism v2: a little film grain and stronger contact occlusion for the macro renders
  post.settings.grade.grain = Number(q.get('grain') || 0);
  if (q.get('aostr')) post.settings.aoStrength = Number(q.get('aostr'));
  // no bloom on a specimen photo (white paper would glow over everything) or when asked
  if (q.get('bloom') === '0' || q.get('light') === 'studio') post.settings.bloom = false;
  // soft shadow edges (a lamp or the sun through haze, not a point)
  env.sun.shadow.radius = Number(q.get('shadowr') || 2.5);
  globalUniforms.uTime.value = 0;
  post.render(scene, cam);
  post.render(scene, cam);
  const w = window as unknown as { __ready: boolean; __shotInfo: unknown; __lab: unknown };
  w.__shotInfo = { kinds, instances: cr.stats.instances };
  w.__ready = true;
  w.__lab = { renderer, scene, cam, post, cr, list };
}
