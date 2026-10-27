import * as THREE from 'three';
import { buildAnt } from '../render/ants/antGeometry';
import { setBakeRenderer } from '../render/bake/detailBake';
import { createAntGlueShell, createAntMaterials, labMask } from '../render/ants/antMaterial';
import { ATTACK_CONTACT, AttackPose, applyAttackBody, attackPose, neutralPose } from '../render/ants/attackPoses';
import { MORPHS } from '../render/ants/morphs';
import { PostPipeline } from '../render/post';
import { createSurfaceEnvironment } from '../render/environment';
import { applyLabLight, renderLabMask } from './labLight';
import { textures } from '../render/textures';
import { globalUniforms, patchDapple } from '../render/shaderPatch';
import { buildTermiteGeometry } from '../render/termite/build';
import { CasteId } from '../render/termite/castes';
import { getTermiteMaterial, TermiteInstances, termiteTime, nasusTipLocal } from '../render/termite/material';
import { AnimState } from '../render/termite/rig';
import { GlueStreams } from '../render/termite/glue';

/**
 * Model review scene: ?scene=antlab&ant=lasius_worker&lod=0&cam=34&phase=0.2&pose=0
 * Also ?ants=lasius_worker,formica_worker,... renders a line-up.
 * Per-ant lists (comma-separated, one value per ant in the line-up): poses=, mopens=, hpitches=, tints= (Termant tint
 * code: 1 stolen caste), scales=; swell=0..1 (crop,
 * or an army-ant queen's physogastry); prey=1 draws a pale prey item slung under porter-pose (10) ants.
 */
export function runAntLab(canvas: HTMLCanvasElement, q: URLSearchParams): void {
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
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex.soil.map, normalMap: tex.soil.normal, roughness: 0.95 }),
  );
  (ground.material as THREE.MeshStandardMaterial).map!.repeat.set(6, 6);
  (ground.material as THREE.MeshStandardMaterial).normalMap!.repeat.set(6, 6);
  ground.receiveShadow = true;
  scene.add(ground);
  const keys = (q.get('ants') || q.get('ant') || 'lasius_worker').split(',');
  const lod = Number(q.get('lod') || 0) as 0 | 1;
  const phase = Number(q.get('phase') || 0.15);
  const pose = Number(q.get('pose') || 0);
  const amp = Number(q.get('amp') || 1);
  const meshes: THREE.InstancedMesh[] = [];
  let x = 0;
  let maxL = 0;
  const spacing = Number(q.get('spacing') || 0);
  // optional per-model scale (a caste built from another's model, e.g. the fire ant soldier)
  const scales = (q.get('scales') || '').split(',').map((v) => Number(v) || 1);
  const placements: number[] = [];
  // melee attack preview: ?atk=0..1 (jaws close at 0.7) &atkvar=0|1|2 (lunge, rear-up, side clamp) &atkside=±1
  const atkQ = q.get('atk');
  const atk = atkQ !== null ? attackPose(Number(q.get('atkvar') || 0), Number(atkQ), Number(q.get('atkside') || 1), neutralPose({} as AttackPose)) : null;
  /** the instance matrix at x with yaw rotY, posed by the attack (body length L) */
  const posed = (x: number, rotY: number, L: number, sc: number) => {
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const vF = new THREE.Vector3(1, 0, 0).applyQuaternion(qy);
    const vU = new THREE.Vector3(0, 1, 0);
    const vR = new THREE.Vector3().crossVectors(vF, vU).normalize();
    const vP = new THREE.Vector3(x, 0, 0);
    if (atk) applyAttackBody(atk, 1, L, vF, vU, vR, vP);
    const m = new THREE.Matrix4().makeBasis(vF, vU, vR);
    m.scale(new THREE.Vector3(sc, sc, sc));
    m.setPosition(vP);
    return m;
  };
  // termites (model kit): ?ants=termite_nasute,termite_worker&tstate=5&ramp=1&fire=1&tan=1
  const termiteKeys = keys.filter((k) => k.startsWith('termite_'));
  if (termiteKeys.length) {
    patchDapple(getTermiteMaterial());
    termiteTime.value = Number(q.get('time') || 1.3);
    const tl = Number(q.get('lod') || 0);
    let tx = 0;
    const geos = termiteKeys.map((k) => buildTermiteGeometry(k.slice(8) as CasteId, tl));
    const widths = geos.map((g) => (g.userData.rig.bounds.max[0] - g.userData.rig.bounds.min[0]) * 1.25);
    const totalT = widths.reduce((s, x2) => s + x2, 0);
    tx = -totalT / 2;
    const glue = new GlueStreams(8, { diameter: 0.22 });
    let gn = 0;
    geos.forEach((g, i) => {
      const herd = new TermiteInstances(g, 1, { glueShell: true });
      herd.count = 1;
      const mx = posed(tx + widths[i] / 2, Number(q.get('rot') || 0), g.userData.rig.bodyLength, 1);
      herd.setMatrix(0, mx);
      const st = Number(q.get('tstate') || (g.userData.rig.isQueen ? AnimState.QUEEN : AnimState.IDLE));
      // with ?atk the kit's bite / ram is posed on the attack's contact like in the game
      const ph = atk ? Number(atkQ) - ATTACK_CONTACT + 0.25 : Number(q.get('phase') || 0.15);
      herd.setAnim(0, st as never, ph, atk ? 0 : Number(q.get('rate') || 0), Number(q.get('statet') || 0));
      const fire = q.get('fire') === '1' && !!g.userData.rig.nasusTip;
      herd.setFire(0, Number(q.get('ramp') || 0), 0, 0, fire);
      herd.setLook(0, { tan: Number(q.get('tan') ?? 1), carry: Number(q.get('carry') || 0), glue: Number(q.get('glue') || 0), seed: 0.37 });
      herd.commit();
      scene.add(herd.group);
      if (fire) {
        const tip = nasusTipLocal(g.userData.rig, 0, 0).applyMatrix4(mx);
        glue.set(gn++, tip, tip.clone().add(new THREE.Vector3(12, -0.5, 0)), Number(q.get('ramp') || 0), true);
      }
      tx += widths[i];
    });
    glue.count = gn;
    glue.commit();
    scene.add(glue.mesh);
    maxL = Math.max(...widths) / 1.25;
    keys.splice(0, keys.length, ...keys.filter((k) => !k.startsWith('termite_')));
    if (!keys.length) {
      const cam = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 5000);
      const camKind = q.get('cam') || '34';
      const dirs2: Record<string, THREE.Vector3> = { side: new THREE.Vector3(0, 0.12, 1), top: new THREE.Vector3(0.0001, 1, 0.0001), front: new THREE.Vector3(1, 0.25, 0.0001), '34': new THREE.Vector3(0.7, 0.55, 0.85) };
      const span = Math.max(totalT, maxL);
      const dist = Number(q.get("dist") || span * 2.6);
      const target = new THREE.Vector3(0, Number(q.get('ty') || maxL * 0.12), 0);
      cam.position.copy(target).addScaledVector(dirs2[camKind].normalize(), dist);
      if (camKind === 'top') cam.up.set(1, 0, 0);
      cam.lookAt(target);
      const sun = env.sun;
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(env.sunDir, 200);
      const post = new PostPipeline(renderer);
      post.setSize(window.innerWidth, window.innerHeight, 1);
      post.focusDistance = dist;
      post.tilt = 0;
      post.settings.dofStrength = Number(q.get('dof') || 0);
      post.settings.ao = q.get('ao') !== '0';
      post.render(scene, cam);
      post.render(scene, cam);
      (window as unknown as { __shotInfo: unknown }).__shotInfo = geos.map((g, i) => ({ key: termiteKeys[i], tris: g.userData.rig.triangles }));
      (window as unknown as { __ready: boolean }).__ready = true;
      return;
    }
  }
  const builtList = keys.map((k, i) => {
    const m = MORPHS[k];
    const b = buildAnt(m, lod, 3);
    maxL = Math.max(maxL, b.rig.length * (scales[i] ?? 1));
    return b;
  });
  const lenOf = (i: number) => builtList[i].rig.length * (scales[i] ?? 1);
  const totalW = builtList.reduce((s, _b, i) => s + lenOf(i), 0) + (builtList.length - 1) * (spacing || maxL * 0.25);
  x = -totalW / 2;
  /** per-ant value from a comma list (?poses=0,10,11), else the default */
  const per = (key: string, i: number, dflt: number) => {
    const v = (q.get(key) || '').split(',')[i];
    return v === undefined || v === '' ? dflt : Number(v);
  };
  builtList.forEach((b, bi) => {
    const sc = scales[bi] ?? 1;
    const pz = per('poses', bi, pose);
    const { material, depth } = createAntMaterials(b.rig, false, q.get('nodetail') === '1' ? undefined : keys[bi]);
    const im = new THREE.InstancedMesh(b.geometry, material, 1);
    const set = (name: string, v: number[]) => im.geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(v), 4));
    set('aA', [phase, amp, Number(q.get('hyaw') || 0) + (atk?.headYaw ?? 0), per('hpitches', bi, Number(q.get('hpitch') || 0)) + (atk?.headPitch ?? 0)]);
    set('aB', [atk ? atk.mand : per('mopens', bi, Number(q.get('mopen') || 0)), Number(q.get('aspread') || 0), Number(q.get('apitch') || 0), Number(q.get('awave') || 0.1)]);
    set('aC', [Number(q.get('gpitch') || 0), Number(q.get('swell') || 0), pz, pz ? 1 : 0]);
    set('aD', [Number(q.get('death') || 0), 0, 4 * per('tints', bi, 0), Number(q.get('pph') || 0.1)]);
    set('aE', [Number(q.get('gold') || 0), Number(q.get('golddir') || 1), Number(q.get('exh') || 0), 0]);
    const mx = new THREE.Matrix4();
    const cx = x + (b.rig.length * sc) / 2;
    placements.push(cx);
    const rotY = Number(q.get('rot') || 0);
    mx.copy(posed(cx, rotY, b.rig.length * sc, sc));
    im.setMatrixAt(0, mx);
    im.castShadow = true;
    im.receiveShadow = true;
    im.customDepthMaterial = depth;
    im.frustumCulled = false;
    scene.add(im);
    meshes.push(im);
    if (pz === 10 && q.get('prey') && b.rig.carryUnder) {
      // a pale prey item (a larva) slung under the porter at its carry point
      const cu = b.rig.carryUnder;
      const pm = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0xb59a78, roughness: 0.8 }));
      pm.scale.set(b.rig.length * 0.3 * sc, b.rig.length * 0.075 * sc, b.rig.length * 0.09 * sc);
      pm.position.set(cu.x, cu.y, 0).applyMatrix4(mx);
      pm.castShadow = true;
      scene.add(pm);
    }
    // ?glue=0..1: termite glue clinging to the ant (the shell pass)
    const gq = Number(q.get('glue') || 0);
    if (gq > 0) {
      const sh = new THREE.InstancedMesh(b.geometry.clone(), createAntGlueShell(b.rig), 1);
      for (const nm of ['aA', 'aB', 'aC', 'aD', 'aE']) sh.geometry.setAttribute(nm, im.geometry.getAttribute(nm));
      sh.geometry.setAttribute('aGlue', new THREE.InstancedBufferAttribute(new Float32Array([gq]), 1));
      sh.setMatrixAt(0, mx);
      sh.frustumCulled = false;
      sh.renderOrder = 2;
      scene.add(sh);
    }
    x += b.rig.length * sc + (spacing || maxL * 0.25);
  });
  const camKind = q.get('cam') || '34';
  const span = Math.max(totalW, maxL);
  const dist = Number(q.get('dist') || span * (keys.length > 1 ? 1.25 : 1.9));
  const cam = new THREE.PerspectiveCamera(Number(q.get('fov') || 30), window.innerWidth / window.innerHeight, dist * 0.02, dist * 50);
  const target = new THREE.Vector3(Number(q.get('tx') || 0), Number(q.get('ty') || maxL * 0.1), Number(q.get('tz') || 0));
  const dirs: Record<string, THREE.Vector3> = {
    side: new THREE.Vector3(0, 0.12, 1),
    // realism v2: a side view from a little above (field macro photos: ground behind, no horizon)
    fside: new THREE.Vector3(0.08, 0.42, 1),
    top: new THREE.Vector3(0.0001, 1, 0.0001),
    front: new THREE.Vector3(1, 0.25, 0.0001),
    back: new THREE.Vector3(-1, 0.35, 0.0001),
    '34': new THREE.Vector3(0.7, 0.55, 0.85),
    low: new THREE.Vector3(0.9, 0.18, 0.6),
    under: new THREE.Vector3(0.3, -0.25, 1),
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
  sun.position.copy(target).addScaledVector(env.sunDir, 200);
  if (q.get('mask') === '1') {
    labMask.value = 1;
    renderLabMask(renderer, scene, cam, q, meshes);
    (window as unknown as { __ready: boolean }).__ready = true;
    return;
  }
  const post = new PostPipeline(renderer);
  post.setSize(window.innerWidth, window.innerHeight, 1);
  post.focusDistance = dist;
  post.tilt = 0;
  post.settings.dofStrength = Number(q.get('dof') || 0.5);
  post.settings.ao = q.get('ao') !== '0';
  // realism v2: a little film grain and stronger contact occlusion for the macro renders
  post.settings.grade.grain = Number(q.get('grain') || 0);
  if (q.get('aostr')) post.settings.aoStrength = Number(q.get('aostr'));
  globalUniforms.uTime.value = 0;
  post.render(scene, cam);
  post.render(scene, cam);
  (window as unknown as { __shotInfo: unknown }).__shotInfo = builtList.map((b, i) => ({ key: keys[i], tris: (b.geometry.index!.count / 3) | 0, verts: b.geometry.attributes.position.count, len: +b.rig.length.toFixed(2), stride: +b.rig.stride.toFixed(2) }));
  (window as unknown as { __ready: boolean }).__ready = true;
  (window as unknown as { __lab: unknown }).__lab = { renderer, scene, cam, post, meshes };
}
