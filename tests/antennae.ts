/**
 * Leafcutter antennae never go into the head (user 2026-11-01: "in the animations all of them are clipping inside
 * their respective leafcutter ants head"). The shader (antMaterial.ts, `uAntHug`) moves each antenna in its own frame
 * — the scape swung and raised at the socket, the funiculus carried on the elbow — and limits the move by test points
 * along it against the head's cross-sections. This replays that move on the CPU over every antenna vertex of each
 * Atta caste, for the whole range of inputs the renderer sends, and checks none goes inside the head.
 * (The scape's base, its first quarter, sits in its socket under the frontal lobe; it is checked to stay at its rest
 * depth.)
 */
import * as THREE from 'three';
import { buildAnt, ANT_TEST, ANT_FUN_FOLLOW, antHeadIn } from '../src/render/ants/antGeometry';
import { MORPHS } from '../src/render/ants/morphs';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();
const UP = new THREE.Vector3(0, 1, 0);
const rotA = (v: THREE.Vector3, a: THREE.Vector3, ang: number) => v.clone().applyAxisAngle(a, ang);
/** depth inside the head as a share of its radius there (the head's measure is r^2.1) */
const depth = (e: number) => (e >= 1 ? 0 : 1 - Math.pow(e, 1 / 2.1));

for (const key of ['atta_minim', 'atta_media', 'atta_soldier', 'atta_major', 'atta_queen']) {
  for (const det of [0, 1] as const) {
    const b = buildAnt(MORPHS[key], det, 3);
    const r = b.rig;
    const H = r.antHug;
    if (!H) {
      check(`${key} lod${det}: has the head shape for the antenna limit`, false);
      continue;
    }
    const pos = b.geometry.getAttribute('position');
    const part = b.geometry.getAttribute('aPart');
    let worst = 0;
    let worstBase = 0;
    let restBase = 0;
    let typK = 0;
    let typN = 0;
    for (const left of [true, false]) {
      const sock = left ? r.antL : r.antR;
      const elb = left ? r.elbL : r.elbR;
      const fm = left ? H.fun[0] : H.fun[2];
      const ft = left ? H.fun[1] : H.fun[3];
      const sd = elb.clone().sub(sock).normalize();
      const fAx = ft.clone().sub(elb).normalize().cross(UP).normalize();
      const o = left ? 0 : ANT_TEST.length + 2;
      // (as antMove in the shader)
      const move = (p: THREE.Vector3, fun: boolean, eA: number, pA: number, sA: number) => {
        const ax = rotA(sd, UP, sA).cross(UP).normalize();
        const e2 = sock.clone().add(rotA(rotA(elb.clone().sub(sock), UP, sA), ax, pA));
        if (fun) return e2.add(rotA(rotA(p.clone().sub(elb), fAx, eA), UP, ANT_FUN_FOLLOW * sA));
        return sock.clone().add(rotA(rotA(p.clone().sub(sock), UP, sA), ax, pA));
      };
      const hits = (k: number, eA: number, pA: number, sA: number) => {
        for (let j = 0; j < ANT_TEST.length; j++) if (antHeadIn(H, move(sock.clone().lerp(elb, ANT_TEST[j]), false, k * eA, k * pA, k * sA)) < H.thr[o + j]) return true;
        if (antHeadIn(H, move(fm, true, k * eA, k * pA, k * sA)) < H.thr[o + ANT_TEST.length]) return true;
        return antHeadIn(H, move(ft, true, k * eA, k * pA, k * sA)) < H.thr[o + ANT_TEST.length + 1];
      };
      const scL = sock.distanceTo(elb);
      const vs: { p: THREE.Vector3; fun: boolean; base: boolean }[] = [];
      for (let i = 0; i < pos.count; i++) {
        const pp = Math.round(part.getX(i));
        const sc = pp === (left ? 4 : 6);
        const fu = pp === (left ? 5 : 7);
        if (!sc && !fu) continue;
        const p = new THREE.Vector3().fromBufferAttribute(pos, i);
        const along = p.distanceTo(sock) / scL;
        if (sc && along < 0.12) continue; // the socket bulb
        vs.push({ p, fun: fu, base: sc && along < 0.25 });
      }
      for (const v of vs) if (v.base) restBase = Math.max(restBase, depth(antHeadIn(H, v.p)));
      // spread (activity · 0.3 + 0.6 alert + the motion springs), pitch, sweep and tap phases, dying, exhausted
      for (const aSpread of [-0.6, 0, 0.3, 0.9, 1.3]) for (const aPitch of [-1.3, -0.7, 0, 0.4, 0.8, 1.2]) for (let w = 0; w < 8; w++) for (const death of [0, 0.5, 1]) for (const exh of [0, 1]) {
        const wv = (w / 8) * Math.PI * 2 + (left ? 0 : 2.1);
        const sweep = Math.sin(wv) * 0.22;
        const tap = Math.max(0, Math.sin(wv * 1.7)) * 0.35;
        const eA = -tap + aPitch * 0.35 - death * 1.2 - exh * 0.55;
        const pA = Math.max(aPitch * 0.45 - death * 0.5, -0.4);
        const sA = (0.2 + aSpread * 0.4 + Math.max(aPitch, 0) * 0.55 + sweep) * (1 - death) * (left ? -1 : 1);
        let k = 1;
        if (hits(1, eA, pA, sA)) {
          let lo = 0;
          let hi = 1;
          for (let it = 0; it < 6; it++) {
            const mid = (lo + hi) / 2;
            if (hits(mid, eA, pA, sA)) hi = mid;
            else lo = mid;
          }
          k = lo;
        }
        if (death === 0 && exh === 0 && aSpread >= 0 && aSpread <= 0.9 && Math.abs(aPitch) <= 0.8) {
          typK += k;
          typN++;
        }
        for (const v of vs) {
          const d = depth(antHeadIn(H, move(v.p, v.fun, k * eA, k * pA, k * sA)));
          if (v.base) worstBase = Math.max(worstBase, d);
          else worst = Math.max(worst, d);
        }
      }
    }
    check(`${key} lod${det}: no part of the antennae past the scape's base enters the head, in any move`, worst < 0.01, `deepest ${(worst * 100).toFixed(1)} % of the head's radius`);
    // (within 1.5 % of the head's radius: the scape's surface beside the socket turns with it — a few hundredths of a mm)
    check(`${key} lod${det}: the scape's base stays at its rest depth in its socket`, worstBase <= restBase + 0.015, `rest ${(restBase * 100).toFixed(1)} %, moving ${(worstBase * 100).toFixed(1)} %`);
    check(`${key} lod${det}: the antennae still move freely in ordinary poses (the limit trims, not freezes)`, typK / typN > 0.85, `mean share of the move kept ${(typK / typN).toFixed(2)}`);
  }
}

console.log(failed ? `\n${failed} antenna test(s) failed` : `\nall antenna tests passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
