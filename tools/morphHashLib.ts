/** Geometry fingerprint of ant morphs (tools/morph-hash.ts, tests/eciton.ts). */
import { MORPHS } from '../src/render/ants/morphs';
import { buildAnt } from '../src/render/ants/antGeometry';

function fnv(h: number, arr: ArrayLike<number>): number {
  for (let i = 0; i < arr.length; i++) {
    // round to 1e-5 so the hash ignores nothing but float noise
    const v = Math.round(arr[i] * 1e5) | 0;
    h ^= v & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= v >>> 16;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function hashMorph(key: string): string {
  const out: string[] = [];
  for (const lod of [0, 1] as const) {
    const { geometry: g, rig } = buildAnt(MORPHS[key], lod, 1);
    let h = 2166136261;
    for (const name of ['position', 'normal', 'color', 'aSurf', 'aPart']) h = fnv(h, g.getAttribute(name).array as ArrayLike<number>);
    h = fnv(h, g.getIndex()!.array as ArrayLike<number>);
    const r: number[] = [rig.length, rig.stride, rig.stance, rig.q0];
    for (const v of [...rig.coxa, ...rig.knee, ...rig.ankle, ...rig.axis, rig.neck, rig.mandL, rig.mandR, rig.antL, rig.antR, rig.elbL, rig.elbR, rig.gasterPivot, rig.waistPivot, rig.headTip, rig.gasterTip, rig.mouth]) r.push(v.x, v.y, v.z);
    h = fnv(h, r);
    out.push(`${h.toString(16)}:${g.getIndex()!.count / 3}`);
  }
  return out.join(' ');
}

