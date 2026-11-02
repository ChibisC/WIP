/**
 * Unit heights and the under-pass (combat v2.2, CHANGE_PLAN §20; `BALANCE.underpass`): which unit fits under which,
 * where along its body, in its current pose; its feet; how many may stand under it. The numbers come from the models
 * (src/sim/heightData.ts, made by tools/height-data.ts).
 */
import { BALANCE } from './balance';
import { HEIGHTS, HeightDef } from './heightData';
import { Ant, AS, Carry, Creature } from './types';
import { casteOf } from './species';
import { dcos, dsin } from './dmath';

const U = BALANCE.underpass;

/** For a caste or kind with no model data: as tall as combat v2 assumed (0.3 of its length), nothing fits under it. */
const NONE: HeightDef = { h: 0.3, zx: [-0.17, 0.17], c: [0, 0, 0], hw: 0.14, feet: [] };

const antDef = new Map<string, HeightDef>(); // det-ok: constant lookups (caste id → its model's heights)
export function antHeights(caste: string): HeightDef {
  let d = antDef.get(caste);
  if (!d) {
    const m = casteOf(caste).morph;
    d = (m && HEIGHTS.ant[m]) || NONE;
    antDef.set(caste, d);
  }
  return d;
}

/** A creature kind's heights; one without model data keeps combat v2's flat clearance (`combat2.clearance`). */
const crDef = new Map<string, HeightDef>(); // det-ok: constant lookups
export function creatureHeights(kind: string): HeightDef {
  let d = crDef.get(kind);
  if (!d) {
    const m = HEIGHTS.creature[kind];
    if (m) d = m;
    else {
      const k = BALANCE.combat2.clearance[kind] ?? 0;
      d = { h: Math.max(0.3, k * 2), zx: [-0.17, 0.17], c: [k, k, k], hw: 0.2, feet: [] };
    }
    crDef.set(kind, d);
  }
  return d;
}

/**
 * Per caste: its heights, length (mm), the height it needs crouched with the margin (mm), standing (mm, no margin),
 * how far it can lower its body (mm) and the most clearance any pose gives (mm).
 */
interface CasteRec {
  d: HeightDef;
  L: number;
  need: number;
  stand: number;
  drop: number;
  most: number;
}
const casteRec = new Map<string, CasteRec>(); // det-ok: constant lookups
function recOf(caste: string): CasteRec {
  let r = casteRec.get(caste);
  if (!r) {
    const d = antHeights(caste);
    const L = casteOf(caste).length;
    const k = Math.max(1, U.pose.braced, U.pose.porterLoaded, U.pose.rearing);
    // (user 2026-11-01: workers and other ants walk and fight under majors) crouched: the body lowered by up to
    // `crouch` × its own belly clearance
    const drop = U.crouch * d.c[1] * L;
    r = { d, L, need: (d.h * L - drop) * (1 + U.margin), stand: d.h * L, drop, most: Math.max(d.c[0], d.c[1], d.c[2]) * L * k };
    casteRec.set(caste, r);
  }
  return r;
}

/** An ant's height crouched, with the margin (mm): what must fit under another. */
export function antNeed(a: Ant): number {
  return recOf(a.caste).need;
}

/**
 * How far an ant under a unit with `clear` mm of room over it lowers its body (mm, render): enough that its height
 * with the margin fits, at most as far as it can crouch.
 */
export function antCrouch(a: Ant, clear: number): number {
  const r = recOf(a.caste);
  return Math.max(0, Math.min(r.drop, r.stand - clear / (1 + U.margin)));
}

/** The most clearance an ant of this caste has in any pose (mm): a quick "nothing fits under it" check. */
export function antMostClear(caste: string): number {
  return recOf(caste).most;
}

const braced = new Set(U.braced); // det-ok: constant
const porters = new Set(U.porters); // det-ok: constant

/**
 * The clearance under ant `b` in each zone (mm), in its pose, into `out` [rear, middle, front]. `holdFront`: something
 * under its front is mid-attack, so its front waits to lower (a braced bite).
 */
export function antClear(b: Ant, out: number[], holdFront = false): number[] {
  const rc = recOf(b.caste);
  const d = rc.d;
  const L = rc.L;
  if (rc.most === 0 || b.state === AS.Dead || b.state === AS.Flung) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  let r = 1;
  let m = 1;
  let f = 1;
  if (b.state === AS.Grapple && braced.has(b.caste) && !holdFront) f = U.pose.braced;
  if (porters.has(b.caste) && b.carry !== Carry.None) m = U.pose.porterLoaded;
  if (b.state === AS.Spray) f = U.pose.rearing;
  out[0] = d.c[0] * L * r;
  out[1] = d.c[1] * L * m;
  out[2] = d.c[2] * L * f;
  return out;
}

/** Same for a creature (dead: nothing under it). */
export function creatureClear(cr: Creature, out: number[]): number[] {
  const d = creatureHeights(cr.kind);
  const L = cr.scale;
  const k = cr.dead ? 0 : 1;
  out[0] = d.c[0] * L * k;
  out[1] = d.c[1] * L * k;
  out[2] = d.c[2] * L * k;
  return out;
}

/** Which zone of a body (centre x, y, heading h, length L, its data) a point is over: 0 rear, 1 middle, 2 front. */
export function zoneAt(d: HeightDef, L: number, cx: number, cy: number, h: number, x: number, y: number): number {
  const lx = ((x - cx) * dcos(h) + (y - cy) * dsin(h)) / L;
  return lx < d.zx[0] ? 0 : lx < d.zx[1] ? 1 : 2;
}

/** How many units of length `La` may stand under one of length `Lb` at once. */
export function stackCap(La: number, Lb: number): number {
  return Math.max(1, Math.min(U.maxStack, Math.floor(Lb / (La * U.stackLen) + 1e-9)));
}

/** A foot's radius on a body of length L (mm). */
export function footR(L: number): number {
  return Math.max(U.footMinMm, U.footR * L);
}

const CL = [0, 0, 0]; // det-ok: scratch

/** Does ant `a` fit under ant `b` where it stands now (the zone of `b` over it, in `b`'s pose)? */
export function antFitsUnderAnt(a: Ant, b: Ant): boolean {
  const need = antNeed(a);
  antClear(b, CL, frontHeld(b));
  if (need > Math.max(CL[0], CL[1], CL[2])) return false;
  const d = antHeights(b.caste);
  return need <= CL[zoneAt(d, casteOf(b.caste).length, b.x, b.y, b.h, a.x, a.y)];
}

/** Could ant `a` fit under some part of creature `cr` (its clearest zone)? (The under ring of attack slots.) */
export function antFitsUnderCreature(a: Ant, cr: Creature): boolean {
  creatureClear(cr, CL);
  return antNeed(a) <= Math.max(CL[0], CL[1], CL[2]);
}

/** Does ant `a` fit under creature `cr` at point (x, y)? */
export function antFitsUnderCreatureAt(a: Ant, cr: Creature, x: number, y: number): boolean {
  creatureClear(cr, CL);
  const d = creatureHeights(cr.kind);
  return antNeed(a) <= CL[zoneAt(d, cr.scale, cr.x, cr.y, cr.h, x, y)];
}

/** A foot of a body (centre, heading, length, data), index `k`, into `out` (world). */
export function footAt(d: HeightDef, L: number, cx: number, cy: number, h: number, k: number, out: { x: number; y: number }): void {
  const fx = d.feet[k * 2] * L;
  const fz = d.feet[k * 2 + 1] * L;
  const c = dcos(h);
  const s = dsin(h);
  // (model z is to the right of the heading: world = forward × x + right × z, right = (sin h, −cos h) in the sim's y-up
  // plane: the models' +z is the sim's −y side; the feet are symmetric, so the sign only orders them)
  out.x = cx + fx * c + fz * s;
  out.y = cy + fx * s - fz * c;
}

/** Something under ant `b`'s front is mid-attack (separation's last pass): its braced front waits to lower. */
export function frontHeld(b: Ant): boolean {
  return (b.fhd ?? 0) > 0;
}

/** The foot data count of a unit. */
export function feetN(d: HeightDef): number {
  return d.feet.length / 2;
}
