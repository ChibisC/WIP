import * as THREE from 'three';
import { createSurfaceEnvironment } from '../render/environment';
import { globalUniforms } from '../render/shaderPatch';
import { installShadowOnly } from '../render/shadowOnly';
import { bakeTreeMaps, BARK_LAYER } from '../render/trees/barkBake';
import { buildWood, woodMaterial } from '../render/trees/woodMesh';
import { addLeafPrepass, buildFoliage, leafMaterials } from '../render/trees/foliage';
import { crownSkeleton, linkHeadings, paintCanopy } from '../sim/treeCrowns';
import type { CanopyData } from '../sim/trees';
import type { CrownStyle, TreeDef } from '../maps/types';
import { TREES } from '../sim/balance';

/**
 * Trees v2 look lab (render only):
 *   ?scene=treelab&mode=bark|leaves|crown&species=oak,beech,willow,tropical,acacia&dist=140&pitch=0.5&yaw=0.6&sun=0.6
 * bark: a limb of each species side by side (flat-topped, as walked); leaves: each species' four blades, upper and
 * lower side, lit from behind and in front; crown: one tree of the first species, grown as in a match.
 */
export function runTreeLab(canvas: HTMLCanvasElement, q: URLSearchParams): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  installShadowOnly(renderer);
  const scene = new THREE.Scene();
  createSurfaceEnvironment(renderer, scene);
  scene.background = new THREE.Color(0x8ea79a);
  const num = (n: string, d: number) => (q.get(n) !== null ? Number(q.get(n)) : d);
  const mode = q.get('mode') || 'bark';
  const species = (q.get('species') || 'oak,beech,willow,tropical,acacia').split(',') as CrownStyle[];
  const maps = bakeTreeMaps(renderer, 512);
  const sun = new THREE.DirectionalLight(0xfff1dc, num('sunI', 2.6));
  const sunA = num('sun', 0.6);
  sun.position.set(Math.cos(sunA) * 300, num('sunH', 260), Math.sin(sunA) * 300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -260;
  sc.right = sc.top = 260;
  sc.near = 10;
  sc.far = 1200;
  sun.shadow.bias = -0.0006;
  scene.add(sun, new THREE.HemisphereLight(0xcfe0f0, 0x3a4a2a, 0.55));
  const cam = new THREE.PerspectiveCamera(num('fov', 40), window.innerWidth / window.innerHeight, 0.5, 5000);
  let target = new THREE.Vector3();
  if (mode === 'bark') {
    // a limb of each species: flat-topped (as walked), 18 mm radius, 110 mm long, side by side
    const pieces = species.map((sp, i) => {
      const x = (i - (species.length - 1) / 2) * 50;
      return { sp, x };
    });
    const mat = woodMaterial(maps);
    for (const p of pieces) {
      const nodes = [];
      for (let k = 0; k <= 8; k++) nodes.push({ x: p.x, y: -55 + k * 14, z: 20, r: 18 - k * 0.4 });
      const data = {
        skels: [{ tree: 0, style: p.sp, tiers: 2, topLv: 0, topZ: 0, topR: 0, x: 0, y: 0, pieces: [], leaves: [], flowers: [], sites: [], lowTips: [] }],
        links: [],
      } as unknown as CanopyData;
      const g = buildWood(data, mat, [{ piece: { kind: 'twig', parent: -1, tree: 0, walk: num('flat', 1) > 0, nodes }, tree: 0 }]);
      scene.add(g);
    }
    void BARK_LAYER;
    target.set(0, 20, 0);
  } else if (mode === 'leaves') {
    const mats = leafMaterials(maps);
    // each species' four blades, upper side up (left) and turned over (right)
    species.forEach((sp, i) => {
      const data = {
        skels: [{ tree: 0, style: sp, tiers: 2, topLv: 0, topZ: 0, topR: 0, x: 0, y: 0, pieces: [{ kind: 'twig', parent: -1, tree: 0, walk: true, nodes: [{ x: 0, y: 0, z: 0, r: 3 }, { x: 0, y: 1, z: 0, r: 3 }] }], leaves: [], flowers: [], sites: [], lowTips: [] }],
        links: [],
      } as unknown as CanopyData;
      void data;
      const L = { oak: [30, 19], beech: [26, 16], willow: [34, 6], tropical: [48, 23], acacia: [26, 18], sapling: [22, 14] }[sp];
      for (let v = 0; v < 4; v++)
        for (const flip of [0, 1]) {
          const geo = new THREE.PlaneGeometry(1, 1, 2, 4).translate(0, 0.5, 0);
          const A = new Float32Array(4).fill(0);
          const B = new Float32Array(4).fill(0);
          A[0] = ({ oak: 0, beech: 1, willow: 2, tropical: 3, acacia: 4, sapling: 1 }[sp] ?? 0) * 4 + v;
          B[1] = 0.05;
          const im = new THREE.InstancedMesh(geo, mats.color, 1);
          geo.setAttribute('aLeafA', new THREE.InstancedBufferAttribute(A, 4));
          geo.setAttribute('aLeafB', new THREE.InstancedBufferAttribute(B, 4));
          const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(L[1], 0, 0), new THREE.Vector3(0, 0, -L[0]), new THREE.Vector3(0, flip ? -L[0] : L[0], 0));
          m.setPosition((v * 2 + flip - 3.5) * 30, 0, (i - (species.length - 1) / 2) * 56 + 24);
          im.setMatrixAt(0, m);
          im.customDepthMaterial = mats.depth;
          addLeafPrepass(im, mats.pre);
          im.castShadow = im.receiveShadow = true;
          scene.add(im);
        }
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 1 }));
    floor.position.y = -20;
    floor.receiveShadow = true;
    scene.add(floor);
    target.set(0, 0, 24);
  } else {
    const sp = species[0];
    const reach = num('reach', sp === 'tropical' ? 400 : sp === 'acacia' ? 300 : 260);
    const def: TreeDef = { trunk: [600, 600], r: num('r', sp === 'tropical' ? 60 : 32), style: sp, reach, seed: num('seed', 11) };
    const defs = [def];
    const sk = crownSkeleton(def, 0, linkHeadings(defs)[0]);
    const cell = TREES.hexR / 3.5;
    const W = Math.ceil(1200 / cell);
    const floor = paintCanopy({ w: W, h: W, cell }, [sk], () => []);
    const data: CanopyData = { ...floor, skels: [sk], links: [] };
    const f = buildFoliage(data, maps, (x, y) => {
      const i = Math.floor(x / cell);
      const j = Math.floor(y / cell);
      return i < 0 || j < 0 || i >= W || j >= W ? -1 : floor.h[j * W + i];
    });
    scene.add(buildWood(data, woodMaterial(maps), f.fineTwigs), f.group);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 1 }));
    ground.position.set(600, -TREES.height, 600);
    ground.receiveShadow = true;
    scene.add(ground);
    target = new THREE.Vector3(600 + num('tx', 0), num('ty', sk.topZ), 600 + num('tz', 0));
    sun.target.position.copy(target);
    sun.position.add(target);
    scene.add(sun.target);
    scene.fog = new THREE.FogExp2(0x9fb0a8, 0.0006);
  }
  const dist = num('dist', mode === 'crown' ? 520 : mode === 'leaves' ? 300 : 170);
  const pitch = num('pitch', 0.75);
  const yaw = num('yaw', 0.6);
  cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  cam.lookAt(target);
  let t = 0;
  const frame = () => {
    t += 1 / 60;
    globalUniforms.uTime.value = t;
    renderer.render(scene, cam);
  };
  (window as unknown as { __labFrame: () => void }).__labFrame = frame;
  frame();
  frame();
  (window as unknown as { __ready: boolean }).__ready = true;
}
