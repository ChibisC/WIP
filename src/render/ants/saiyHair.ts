// @ts-nocheck
/**
 * Saiy-Ants: six swept-back hair locks grown from the head mesh (part id 30).
 * Ported from the user's verified prototype (claude/saiy-ants/04-prototype-code.md):
 * placement = brief 07's table (head-local, head lengths; middle pair moved to
 * X = −0.26 so nothing covers the eyes), construction = brief 08 (core + twisted
 * strands splitting into sub-tips, one scalp cap, stray hairs). aSurf.w 4.8
 * (queen 6.8) marks hair for the shader. Original design: not based on any
 * anime or cartoon character's hairstyle.
 */
import * as THREE from 'three';
import { ellipsoid, transformPts, tube, tmpC } from './antGeometry';

export function buildHair6(acc, hair6, look, headM, hL, headCY, hi, rng) {
if (hair6) {
    const hs = hair6, wflag = (hs.queen ? 6 : 4) + 0.8, hsurf = { rough: hs.rough ?? 0.46, coat: 0.05, sheen: 0.1 };
    const hcol = () => { tmpC.setHex(look.head.color); if (look.head.color2 !== undefined) tmpC.lerp(new THREE.Color(look.head.color2), 0.2); return tmpC; };
    const put = (pp, pi) => acc.piece(transformPts(pp, headM), pi, 30, hcol, hsurf, wflag);
    // scalp cap: one continuous mass of hair over the top and back of the head, behind the antenna bases
    if (hs.cap) { const cp = hs.cap, [kp, ki] = ellipsoid(new THREE.Vector3((cp.at[0] + 0.5) * hL, headCY + cp.at[1] * hL, 0), new THREE.Vector3(cp.r[0] * hL, cp.r[1] * hL, cp.r[2] * hL), hi ? 14 : 8); put(kp, ki); }
    const strandsN = hi ? (hs.strands ?? 6) : !hi ? 3 : 0, segs = hi ? 7 : 5;
    for (const sp of hs.spikes) {
      const [X, Y, Z] = sp.at, yaw = sp.yaw * Math.PI / 180 * Math.sign(Z || 0), pitch = sp.pitch * Math.PI / 180;
      const len = sp.len * hL * (hs.lenMul ?? 1) * (sp.lenMul ?? 1), wdt = sp.w * hL * (hs.wMul ?? 1);
      const dir = new THREE.Vector3(-Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).normalize();
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(), upv = new THREE.Vector3().crossVectors(side, dir).normalize();
      const attach = new THREE.Vector3((X + 0.5) * hL, headCY + Y * hL, Z * hL), inset = 0.3 * wdt, base = attach.clone().addScaledVector(dir, -inset), Lt = len + inset;
      // S-curved centre line: sags slightly in the middle, tip curls up a little (gelled look)
      const at = (t2) => base.clone().addScaledVector(dir, Lt * t2).addScaledVector(upv, Lt * (-(hs.sag ?? 0.06) * Math.sin(Math.PI * t2) + (hs.curl ?? 0.05) * Math.pow(t2, 3)));
      const prof = (t2) => wdt * 0.5 * (Math.pow(1 - t2, 0.8) * (1 - 0.08 * t2) + 0.012);
      { const M2 = hi ? 8 : 5, pts = [], rad = []; for (let k = 0; k <= M2; k++) { const t2 = k / M2; pts.push(at(t2)); rad.push(prof(t2) * 0.88); }
        const [pp, pi] = tube(pts, rad, hi ? 10 : 7, true, true, hs.flat ?? 0.75); put(pp, pi); }
      // strands: narrower tubes riding on the core, twisted slightly, splitting apart over the last 15%
      for (let q = 0; q < strandsN; q++) {
        const a0 = (q / strandsN) * Math.PI * 2 + 0.4, M2 = hi ? 8 : 5, pts = [], rad = [], split = 0.85, fan = ((q % 3) - 1) * 0.35;
        for (let k = 0; k <= M2; k++) {
          const t2 = k / M2, ang = a0 + (hs.twist ?? 0.6) * t2, r2 = prof(t2) * 0.78, out = Math.cos(ang) * r2, upo = Math.sin(ang) * r2 * (hs.flat ?? 0.75);
          const spread = t2 > split ? (t2 - split) / (1 - split) : 0;
          pts.push(at(t2).addScaledVector(side, out + spread * fan * wdt * 0.25).addScaledVector(upv, upo + spread * Math.abs(fan) * wdt * 0.12));
          rad.push(prof(t2) * (0.3 - 0.1 * t2) + 0.006 * hL);
        }
        const [pp, pi] = tube(pts, rad, segs, false, true); put(pp, pi);
      }
      // root blend: low swelling where the lock meets the cap
      { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir), [fp, fi] = ellipsoid(attach.clone().addScaledVector(dir, -wdt * 0.1), new THREE.Vector3(wdt * 0.4, wdt * 0.2, wdt * 0.56), hi ? 10 : 6, q); put(fp, fi); }
    }
    // stray hairs between the locks near the roots
    if (hi && hs.strays) for (let k = 0; k < hs.strays; k++) {
      const sp = hs.spikes[k % hs.spikes.length], [X, Y, Z] = sp.at, root = new THREE.Vector3((X + 0.5) * hL + rng.range(-0.04, 0.04) * hL, headCY + Y * hL + 0.02 * hL, Z * hL + rng.range(-0.08, 0.08) * hL);
      const d = new THREE.Vector3(-1, rng.range(0.1, 0.45), rng.range(-0.4, 0.4)).normalize(), tip = root.clone().addScaledVector(d, rng.range(0.12, 0.22) * hL), mid = root.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.01 * hL, 0));
      const [hp2, hi2] = tube([root, mid, tip], [0.012 * hL, 0.008 * hL, 0.001 * hL], 3, false, true); put(hp2, hi2);
    }
  }

}
