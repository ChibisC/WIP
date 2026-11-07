import type { World } from '../world';
import { AS, Creature } from '../types';
import { BALANCE, STAG_MALE } from '../balance';
import { riding } from '../climbing';
import { CreatureKind, creatureKind, isStagMale, stagMaleGeom } from './kinds';
import { CS, creatureAttacking, setState, walkTo } from './creatureAI';
import { datan2, dcos, dhypot, dsin } from '../dmath';

/**
 * Stag beetle males wrestle (claude/story/06-spec-levels-5-7-and-lengths.md §2; docs/creatures/lucanus-cervus.md): two
 * males (any of the four sizes, never the titan) that meet with no ants about square up and fight as rival males do on
 * a branch —
 *  1. **approach**: each walks to its place either side of the point where their antlers will meet (`wrMx`, `wrMy`) and
 *     turns to face the other;
 *  2. **face-off** (`CS.Spar`, `faceSec`): reared a little, antlers spread;
 *  3. **locked** (`CS.Lock`, `lockMin`..`lockMax` s): they step in, antlers interlocked, and shove back and forth, the
 *     locked heads twisting; the winner slowly gains ground;
 *  4. **the lift and throw**: the winner (`CS.Heave`) rears and lifts the loser (`CS.Thrown`) up in its antlers for
 *     `liftSec`, then flicks its head to one side and throws it `throwDist` × its length; the loser lands on its back;
 *  5. **parting**: the winner stands with its antlers raised (`CS.Display`) while the loser rights itself, then the loser
 *     walks off. Neither is hurt; both leave other males alone for `cdMin`..`cdMax` s.
 * The bigger male wins most bouts (`winK`; a hurt male less often). Ants coming within `clear` × its length of either,
 * or a hit on either, break the bout off at once (both turn on the ants). Everything is drawn from `w.rng` when the bout
 * starts and is then a function of the sim time, so each of the pair works out its own place in its own tick (no
 * order effects) and saves and lockstep carry it (`cr.data.wr…`).
 *
 * The story director can stage a bout with `startStagWrestle`; wild males start their own when idle (`stagRivalScan`,
 * from the males' program in creatureAI.ts). A creature in a bout is run here before the director and its program.
 */

const W = STAG_MALE.wrestle;
const TAU = Math.PI * 2;

/** the bout's data on each of the pair (cleared when it ends) */
const KEYS = ['wr', 'wrMx', 'wrMy', 'wrU', 'wrS', 'wrWin', 'wrLock', 'wrSide', 'wrPh', 'wrHp', 'wrDl', 'wrF', 'wrZ', 'wrCdN', 'wrLand'] as const;

const ease = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

function angleTo(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Is this creature in a bout? */
export function wrestling(cr: Creature): boolean {
  return (cr.data.wr ?? 0) > 0;
}

/** Its rival, while both are still in the same bout. */
function partnerOf(w: World, cr: Creature): Creature | null {
  const id = cr.data.wr ?? 0;
  if (!id) return null;
  const o = w.creatureById.get(id);
  return o && !o.dead && o.space === cr.space && o.data.wr === cr.id ? o : null;
}

/** Live ants (of another team, for a team's creature) within `clear` × its length. */
function antsAbout(w: World, cr: Creature, k: CreatureKind): boolean {
  const team = cr.faction >= 0 ? w.teamOf(cr.faction) : -1;
  let found = false;
  w.antsNear(cr.space, cr.x, cr.y, W.clear * k.length, (a) => {
    if (a.state === AS.Dead || riding(a) || (team >= 0 && (a.team ?? a.colony) === team)) return false;
    found = true;
    return true;
  });
  return found;
}

/** Can this male start a bout now (alive, idle, healthy, nothing on it or about it, not the director's or a raider)? */
function free(w: World, cr: Creature, k: CreatureKind): boolean {
  return (
    !cr.dead &&
    !wrestling(cr) &&
    cr.data.dirA === undefined &&
    !(cr.data.raid ?? 0) &&
    cr.stun <= 0 &&
    cr.hp >= cr.maxHp * W.minHp &&
    !creatureAttacking(cr) &&
    (cr.climbers ?? 0) === 0 &&
    cr.latched === 0 &&
    w.s.time >= (cr.data.wrCd ?? 0) &&
    !antsAbout(w, cr, k)
  );
}

/**
 * Set two stag beetle males up to wrestle now (story levels: the director stages a bout; wild males: `stagRivalScan`).
 * Any bout either is in ends first; whatever each was doing is dropped (ants in its antlers fall). They walk to their
 * places and the bout runs as above; it breaks off if ants come or either is hurt. Returns false (and does nothing)
 * unless both are live stag beetle males (not the titan) in the same space. Deterministic: its draws come from `w.rng`.
 */
export function startStagWrestle(w: World, a: Creature, b: Creature): boolean {
  if (a === b || a.dead || b.dead || a.space !== b.space || !isStagMale(a.kind) || !isStagMale(b.kind)) return false;
  for (const c of [a, b]) {
    const o = partnerOf(w, c);
    if (o && o !== a && o !== b) finish(w, o, W.cdAbort);
    finish(w, c, 0);
  }
  const lo = a.id < b.id ? a : b;
  const hi = lo === a ? b : a;
  const kl = creatureKind(lo.kind)!;
  const kh = creatureKind(hi.kind)!;
  const d = dhypot(hi.x - lo.x, hi.y - lo.y);
  // the axis from the lower id to the higher; the antlers meet half way along the gap between their locked places
  const U = d > 1e-6 ? datan2(hi.y - lo.y, hi.x - lo.x) : lo.h;
  const ll = stagMaleGeom(lo.kind)!.lock * kl.length;
  const lh = stagMaleGeom(hi.kind)!.lock * kh.length;
  const m = ll + (d - ll - lh) / 2;
  const mx = lo.x + dcos(U) * m;
  const my = lo.y + dsin(U) * m;
  // the bigger (and the healthier) male wins most bouts
  const sl = kl.length * (0.6 + 0.4 * (lo.hp / Math.max(1, lo.maxHp)));
  const sh = kh.length * (0.6 + 0.4 * (hi.hp / Math.max(1, hi.maxHp)));
  const pLo = Math.max(W.winMin, Math.min(W.winMax, 0.5 + (W.winK * (sl - sh)) / (sl + sh)));
  const loWins = w.rng.next() < pLo;
  const lock = w.rng.range(W.lockMin, W.lockMax);
  const side = w.rng.next() < 0.5 ? -1 : 1;
  const ph = w.rng.range(0, TAU);
  const cdN = w.rng.range(W.cdMin, W.cdMax);
  // the face-off must start by then: `approachSec` more than the longer of their two walks takes
  const walk = Math.max(Math.abs(m - ll) / Math.max(1, kl.speed * W.speed), Math.abs(d - m - lh) / Math.max(1, kh.speed * W.speed));
  const deadline = w.s.time + W.approachSec + walk;
  const pair: Array<[Creature, number, boolean, Creature, CreatureKind]> = [
    [lo, 1, loWins, hi, kh],
    [hi, -1, !loWins, lo, kl],
  ];
  for (const [c, s, win, o, ko] of pair) {
    // drop what it was doing: ants held in its antlers fall, a bite or a shake is called off
    c.data.held1 = 0;
    c.data.held2 = 0;
    c.data.bw = 0;
    c.data.shake = 0;
    c.data.backT = 0;
    c.tgt = 0;
    c.tk = 0;
    c.v = 0;
    c.data.wr = o.id;
    c.data.wrMx = mx;
    c.data.wrMy = my;
    c.data.wrU = U;
    c.data.wrS = s;
    c.data.wrWin = win ? 1 : 0;
    c.data.wrLock = lock;
    c.data.wrSide = side;
    c.data.wrPh = ph;
    c.data.wrHp = c.hp;
    c.data.wrDl = deadline;
    c.data.wrF = -1;
    // (the loser is held up this high: render)
    c.data.wrZ = W.liftZ * ko.length;
    c.data.wrCdN = cdN;
    setState(c, CS.Chase);
  }
  return true;
}

/** End this creature's part in its bout (no new bout for `cd` s); one thrown and still in the air drops where it is. */
function finish(w: World, cr: Creature, cd: number): void {
  if (!wrestling(cr)) return;
  const midAir = cr.state === CS.Thrown && !cr.data.wrLand;
  for (const key of KEYS) delete cr.data[key];
  if (cd > 0) cr.data.wrCd = w.s.time + cd;
  cr.v = 0;
  if (midAir) cr.stun = Math.max(cr.stun, 0.4);
  setState(cr, CS.Chase);
}

/** Break a bout off (ants came, or one was hurt): both go back to their programs. */
function breakOff(w: World, cr: Creature, o: Creature | null): void {
  finish(w, cr, W.cdAbort);
  if (o) finish(w, o, W.cdAbort);
}

/** The shoving while locked, `tl` s into the lock: along the axis toward the higher id (mm). */
function pushAt(cr: Creature, tl: number, mean: number): number {
  const lock = cr.data.wrLock ?? W.lockMin;
  // (the lower id's win drives the pair toward the higher id: +; its loss, the other way)
  const loWins = (cr.data.wrS ?? 1) > 0 ? cr.data.wrWin === 1 : cr.data.wrWin !== 1;
  const env = Math.min(1, tl / 0.5);
  return W.pushAmp * mean * dsin(TAU * W.pushHz * tl + (cr.data.wrPh ?? 0)) * env + W.pushDrift * mean * Math.min(1, tl / lock) * (loWins ? 1 : -1);
}

/** Move straight to (x, y) facing h (small, smooth steps: the gait reads the speed). */
function place(w: World, cr: Creature, x: number, y: number, h: number, dt: number): void {
  const d = dhypot(x - cr.x, y - cr.y);
  if (d > 1e-9 && w.walkable(cr.space, x, y)) {
    cr.x = x;
    cr.y = y;
    cr.v = d / Math.max(dt, 1e-3);
  } else cr.v = 0;
  cr.h = h;
}

function turnTo(cr: Creature, want: number, rate: number, dt: number): void {
  const diff = angleTo(cr.h, want);
  cr.h += Math.max(-rate * dt, Math.min(rate * dt, diff));
}

/** Its place at the face-off (mm), and the way it faces there. */
function spotOf(cr: Creature, k: CreatureKind, mean: number): { x: number; y: number; h: number } {
  const U = cr.data.wrU ?? 0;
  const s = cr.data.wrS ?? 1;
  const r = stagMaleGeom(cr.kind)!.lock * k.length + (W.gap * mean) / 2;
  return { x: (cr.data.wrMx ?? cr.x) - s * dcos(U) * r, y: (cr.data.wrMy ?? cr.y) - s * dsin(U) * r, h: s > 0 ? U : U + Math.PI };
}

function atSpot(cr: Creature, k: CreatureKind, mean: number): boolean {
  const p = spotOf(cr, k, mean);
  return dhypot(p.x - cr.x, p.y - cr.y) <= 1.5 && Math.abs(angleTo(cr.h, p.h)) <= 0.2;
}

/**
 * One tick of a creature in a bout (creatureSystem, before the director and its program). Returns true while the bout
 * moves it; false when the bout is over or broken off this tick (its program runs on).
 */
export function stagWrestleTick(w: World, cr: Creature, k: CreatureKind, dt: number): boolean {
  const o = partnerOf(w, cr);
  const t = w.s.time;
  const F = cr.data.wrF ?? -1;
  const lock = cr.data.wrLock ?? W.lockMin;
  const T1 = W.faceSec;
  const T2 = T1 + lock;
  const T3 = T2 + W.liftSec;
  const T4 = T3 + W.throwSec;
  const T5 = T4 + W.downSec;
  const T6 = T5 + W.partSec;
  if (!o) {
    // its rival is gone: the bout is over (a full one, or its rival was killed or broken off)
    finish(w, cr, F >= 0 && t - F >= T5 ? (cr.data.wrCdN ?? W.cdMin) : W.cdAbort);
    return false;
  }
  if (cr.hp < (cr.data.wrHp ?? cr.hp) - 1e-6 || antsAbout(w, cr, k)) {
    breakOff(w, cr, o);
    return false;
  }
  const ko = creatureKind(o.kind)!;
  const L = k.length;
  const mean = (L + ko.length) / 2;
  const U = cr.data.wrU ?? 0;
  const ux = dcos(U);
  const uy = dsin(U);
  const s = cr.data.wrS ?? 1;
  const mx = cr.data.wrMx ?? cr.x;
  const my = cr.data.wrMy ?? cr.y;
  const myLock = stagMaleGeom(cr.kind)!.lock * L;
  const face = s > 0 ? U : U + Math.PI;
  // ---- approach: to its place, then face the rival; when both are there the face-off starts (for both at once)
  if (F < 0) {
    if (t > (cr.data.wrDl ?? t + 1)) {
      breakOff(w, cr, o);
      return false;
    }
    const p = spotOf(cr, k, mean);
    if (dhypot(p.x - cr.x, p.y - cr.y) > 1.5) {
      setState(cr, CS.Chase);
      walkTo(w, cr, k, p.x, p.y, W.speed, dt, 2.5);
    } else {
      cr.v = 0;
      turnTo(cr, p.h, 2.5, dt);
    }
    if (atSpot(cr, k, mean) && atSpot(o, ko, mean)) {
      cr.data.wrF = t;
      o.data.wrF = t;
      setState(cr, CS.Spar);
    }
    return true;
  }
  const e = t - F;
  if (e >= T6) {
    finish(w, cr, cr.data.wrCdN ?? W.cdMin);
    return false;
  }
  // ---- face-off and lock: the pair's places along the axis, the gap closing as they lock, the shoving
  if (e < T2) {
    const tl = Math.max(0, e - T1);
    const gap = e < T1 ? W.gap * mean : W.gap * mean * (1 - ease(tl / W.lockIn));
    const sp = e < T1 ? 0 : pushAt(cr, tl, mean);
    const tw = e < T1 ? 0 : W.twist * dsin(TAU * 0.6 * tl + (cr.data.wrPh ?? 0) * 1.3) * Math.min(1, tl / 0.5);
    if (e >= T1 && cr.state !== CS.Lock && s > 0) w.events.emit({ t: 'bite', x: mx, y: my, space: cr.space, strength: 0.9, by: cr.kind, on: 'creature' });
    setState(cr, e < T1 ? CS.Spar : CS.Lock);
    place(w, cr, mx + ux * (sp - s * (myLock + gap / 2)), my + uy * (sp - s * (myLock + gap / 2)), face + tw, dt);
    return true;
  }
  // ---- after the lock: both start from where the shoving left them
  const sEnd = pushAt(cr, lock, mean);
  const endX = mx + ux * (sEnd - s * myLock);
  const endY = my + uy * (sEnd - s * myLock);
  if (cr.data.wrWin === 1) {
    // the winner: lifts and throws (the render: rearing, then the flick of the head), then stands, antlers raised
    place(w, cr, endX, endY, face, dt);
    if (e < T4) setState(cr, CS.Heave);
    else if (e < T5) setState(cr, CS.Display);
    else {
      setState(cr, CS.Wander);
      cr.v = 0;
    }
    return true;
  }
  // the loser: from the winner (its rival) toward it
  const wx = -s * ux;
  const wy = -s * uy;
  const oLock = stagMaleGeom(o.kind)!.lock * ko.length;
  const oEndX = mx + ux * (sEnd + s * oLock);
  const oEndY = my + uy * (sEnd + s * oLock);
  // held by its pronotum where the winner's antler tips close (raised, they reach `heldK` as far forward)
  const reach = stagMaleGeom(o.kind)!.jaw * ko.length * W.heldK + (stagMaleGeom(cr.kind)!.off - 0.02) * L;
  const heldX = oEndX + wx * reach;
  const heldY = oEndY + wy * reach;
  if (e < T3) {
    const r = ease((e - T2) / 0.3);
    setState(cr, CS.Thrown);
    place(w, cr, endX + (heldX - endX) * r, endY + (heldY - endY) * r, face, dt);
    return true;
  }
  // thrown to the winner's right (side +1) or left: where its head flicks
  const side = cr.data.wrSide ?? 1;
  const landX = heldX + wy * side * W.throwDist * L + wx * 0.15 * L;
  const landY = heldY - wx * side * W.throwDist * L + wy * 0.15 * L;
  const spun = face + side * W.throwSpin;
  if (e < T4) {
    const f = (e - T3) / W.throwSec;
    setState(cr, CS.Thrown);
    place(w, cr, heldX + (landX - heldX) * f, heldY + (landY - heldY) * f, face + side * W.throwSpin * ease(f), dt);
    return true;
  }
  if (!cr.data.wrLand) {
    cr.data.wrLand = 1;
    w.events.emit({ t: 'slam', x: cr.x, y: cr.y, space: cr.space, radius: L * 0.35, power: 0.25 });
  }
  if (e < T5) {
    // on its back, legs waving, then righting itself (the render)
    setState(cr, CS.Thrown);
    cr.v = 0;
    cr.h = spun;
    return true;
  }
  // it walks off, away from the winner
  setState(cr, CS.Wander);
  walkTo(w, cr, k, landX + wx * W.partDist * L, landY + wy * W.partDist * L, 1, dt, 3);
  return true;
}

/**
 * An idle male looks for a rival (every `scanSec`, from the males' program when no ant is about): the nearest free
 * male of its faction (wild ones: wild) within `meet` × their mean length; with `chance` they wrestle.
 */
export function stagRivalScan(w: World, cr: Creature, k: CreatureKind): void {
  const every = Math.max(1, Math.round(W.scanSec * BALANCE.tickHz));
  if (w.s.tick % every !== cr.id % every || !free(w, cr, k)) return;
  let best: Creature | null = null;
  let bd = Infinity;
  for (const o of w.s.creatures) {
    if (o === cr || o.dead || o.space !== cr.space || o.faction !== cr.faction || !isStagMale(o.kind)) continue;
    const ko = creatureKind(o.kind)!;
    const d = dhypot(o.x - cr.x, o.y - cr.y);
    if (d > (W.meet * (k.length + ko.length)) / 2 || d >= bd || !free(w, o, ko)) continue;
    best = o;
    bd = d;
  }
  if (best && w.rng.chance(W.chance)) startStagWrestle(w, cr, best);
}
