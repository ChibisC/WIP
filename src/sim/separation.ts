import { World } from './world';
import { Ant, AS } from './types';
import { casteOf } from './species';
import { BALANCE, GUARD } from './balance';
import { dcos, dhypot, dsin } from './dmath';
import { bodyHook } from './slots';
import { creatureHooks } from './combat';
import { queenBody, royalOf } from './termites';

/**
 * Soft separation (fix brief: no stacking). Runs after creatures move.
 *
 *  - **Ant–ant:** two ants closer than the sum of their radii (`radiusOfWidth`
 *    × body width) are pushed apart, each pair once (by the lower id), split
 *    by mass, capped at `maxPush` mm a tick so it never looks like a shove.
 *    Ants that hold still on purpose (grappling, holding prey, pinned,
 *    queens, a termite king at his place) do not move but still push the others; the dead, the flung,
 *    climbers and riders, and prey in a hell ant's jaws take no part.
 *  - **Creature body:** an ant inside a creature's capsule is pushed out of
 *    it, unless it is holding on to that creature or riding it.
 *  - **Termite queen:** her 22 mm abdomen (behind her position, the thorax)
 *    is a capsule too (termites.ts queenBody); her own circle covers only her
 *    head and thorax.
 *  - A push that would land on rock is dropped (or kept along one axis).
 *
 * Deterministic: ants in id order, the spatial hash built at the tick start.
 */
export function separationSystem(w: World, dt: number): void {
  const S = BALANCE.separation;
  const ants = w.s.ants;
  const n = ants.length;
  const cap = S.maxPush * dt * BALANCE.tickHz;
  queens.clear();
  for (const c of w.s.colonies) {
    if (c.queen) queens.add(c.queen);
    // a termite king standing at his queen's side holds his place too (workers step round him)
    const k = c.king ? w.antById.get(c.king) : undefined;
    if (k && k.v === 0) queens.add(k.id);
  }
  if (pushX.length < n) {
    pushX = new Float64Array(n * 2);
    pushY = new Float64Array(n * 2);
    flag = new Uint8Array(n * 2);
    rad = new Float64Array(n * 2);
    mass = new Float64Array(n * 2);
  }
  // per-ant flags (bit 1 takes part, bit 2 movable) and the largest small radius
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const a = ants[i];
    pushX[i] = 0;
    pushY[i] = 0;
    flag[i] = (takesPart(a) ? 1 : 0) | (movable(a) ? 2 : 0) | (fightStance(a) ? 16 : 0) | (a.state === AS.Grapple && a.gKind === 3 && a.pinned <= 0 ? 32 : 0);
    const r = antRadius(a);
    rad[i] = r;
    mass[i] = antMass(a);
    if (r <= BIG && r > maxR) maxR = r;
  }
  // Small ants find their neighbours with a short query (their radius + the
  // largest small radius); the few big ones (queens, majors, …) search wider
  // themselves, so the common query stays cheap. Pushes are summed per ant
  // and applied once at the end (one walkability test per ant moved).
  P.ants = ants;
  ants0 = ants;
  P.strength = S.strength;
  for (let i = 0; i < n; i++) {
    const fa = flag[i];
    if (!(fa & 1)) continue;
    const a = ants[i];
    const ra = rad[i];
    P.i = i;
    P.a = a;
    P.fa = fa;
    P.ra = ra;
    P.big = ra > BIG;
    w.antIdxNear(a.space, a.x, a.y, ra + (P.big ? Math.max(maxR, ra) : maxR), pairCb);
  }
  // a termite queen's abdomen pushes ants out like a creature's body
  for (let i = 0; i < n; i++) {
    const q = ants[i];
    if (!(flag[i] & 1) || casteOf(q.caste).termite !== 'queen') continue;
    queenBody(q, qb);
    const dx = qb.bx - qb.ax;
    const dy = qb.by - qb.ay;
    const l2 = dx * dx + dy * dy;
    const mx = (qb.ax + qb.bx) / 2;
    const my = (qb.ay + qb.by) / 2;
    QB.q = q;
    QB.dx = dx;
    QB.dy = dy;
    QB.l2 = l2;
    w.antIdxNear(q.space, mx, my, dhypot(dx, dy) / 2 + qb.r + maxR, queenCb);
  }
  // creature bodies push ants out (harder: a body is solid)
  for (const cr of w.s.creatures) {
    if (cr.dead) continue;
    const b = bodyHook.body(cr);
    const c = dcos(cr.h);
    const s = dsin(cr.h);
    w.antIdxNear(cr.space, cr.x, cr.y, b.hl + b.r + maxR, (i) => {
      if ((flag[i] & 3) !== 3) return false;
      const a = ants[i];
      if (a.gKind === 4 && a.gId === cr.id) return false; // holding on to it
      if (a.rideId === cr.id) return false;
      const dx = a.x - cr.x;
      const dy = a.y - cr.y;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const cx = Math.max(-b.hl, Math.min(b.hl, lx));
      const ex = lx - cx;
      const min = b.r + rad[i];
      if (ex * ex + ly * ly >= min * min) return false;
      const d = dhypot(ex, ly);
      let nx = 0;
      let ny = 1;
      if (d > 1e-6) {
        nx = ex / d;
        ny = ly / d;
      } else if (a.id & 1) ny = -1;
      const push = (min - d) * S.creatureStrength;
      // back to world space
      pushX[i] += (nx * c - ny * s) * push;
      pushY[i] += (nx * s + ny * c) * push;
      flag[i] |= 4;
      return false;
    });
  }
  for (let i = 0; i < n; i++) {
    let dx = pushX[i];
    let dy = pushY[i];
    if (dx * dx + dy * dy < 1e-6) continue; // under a thousandth of a millimetre: not worth a terrain test
    // capped so it is a gentle drift, never a shove (out of a body: twice that; out of a termite queen: all of it)
    const m = dhypot(dx, dy);
    const lim = flag[i] & 8 ? m : flag[i] & 4 ? cap * 2 : cap;
    if (m > lim) {
      dx *= lim / m;
      dy *= lim / m;
    }
    nudge(w, ants[i], dx, dy);
  }
  creatureSpacing(w, dt);
  // a termite queen is solid: after the shared pushes (crowd pressure can cancel hers), anyone still inside her
  // abdomen is put back on its surface
  for (let i = 0; i < n; i++) {
    const q = ants[i];
    if (!(flag[i] & 1) || casteOf(q.caste).termite !== 'queen') continue;
    queenBody(q, qb);
    QB.q = q;
    QB.w = w;
    QB.dx = qb.bx - qb.ax;
    QB.dy = qb.by - qb.ay;
    QB.l2 = QB.dx * QB.dx + QB.dy * QB.dy;
    w.antIdxNear(q.space, (qb.ax + qb.bx) / 2, (qb.ay + qb.by) / 2, dhypot(QB.dx, QB.dy) / 2 + qb.r + maxR, queenOutCb);
  }
}

/**
 * Creatures keep apart too (user note 2026-10-25: "creatures fight too compact"): two living creatures in one space
 * closer than the sum of their radii (creatureHooks.radius, the one their bites reach from) are pushed apart, split
 * by size and capped at `creatureMaxPush` mm a tick; teammates (battle arena) keep `creatureAllyRoom` × that.
 * Foes can still bite at that distance (creatureAI meleeReach is the radii + 2 mm).
 */
function creatureSpacing(w: World, dt: number): void {
  const crs = w.s.creatures;
  const S = BALANCE.separation;
  const cap = S.creatureMaxPush * dt * BALANCE.tickHz;
  for (let i = 0; i < crs.length; i++) {
    const a = crs[i];
    if (a.dead) continue;
    const ra = creatureHooks.radius(a);
    let px = 0;
    let py = 0;
    for (let j = 0; j < crs.length; j++) {
      const o = crs[j];
      if (j === i || o.dead || o.space !== a.space) continue;
      const ally = a.faction >= 0 && o.faction >= 0 && w.teamOf(a.faction) === w.teamOf(o.faction);
      const min = (ra + creatureHooks.radius(o)) * (ally ? S.creatureAllyRoom : 1);
      const dx = a.x - o.x;
      const dy = a.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = dhypot(dx, dy);
      let nx = 1;
      let ny = 0;
      if (d > 1e-6) {
        nx = dx / d;
        ny = dy / d;
      } else {
        const ang = ((a.id * 7 + o.id * 13) % 360) * (Math.PI / 180);
        nx = i < j ? dcos(ang) : -dcos(ang);
        ny = i < j ? dsin(ang) : -dsin(ang);
      }
      // the smaller one gives way more
      const share = o.scale / (a.scale + o.scale);
      px += nx * (min - d) * 0.5 * share;
      py += ny * (min - d) * 0.5 * share;
    }
    const m = dhypot(px, py);
    if (m < 1e-4) continue;
    if (m > cap) {
      px *= cap / m;
      py *= cap / m;
    }
    if (w.walkable(a.space, a.x + px, a.y + py)) {
      a.x += px;
      a.y += py;
    }
  }
}

/** Put an ant that is still inside the current queen's abdomen back on its surface. */
function queenOutCb(i: number): boolean {
  pushX[i] = 0;
  pushY[i] = 0;
  queenCb(i);
  if (pushX[i] !== 0 || pushY[i] !== 0) nudge(QB.w, ants0[i], pushX[i], pushY[i]);
  return false;
}

/** The termite queen whose abdomen is pushing (one shared callback). */
const QB = { q: null as unknown as Ant, dx: 0, dy: 0, l2: 0, w: null as unknown as World }; // det-ok: scratch
const qb = { ax: 0, ay: 0, bx: 0, by: 0, r: 0 }; // det-ok: scratch

function queenCb(i: number): boolean {
  if ((flag[i] & 3) !== 3) return false;
  const a = ants0[i];
  if (a === QB.q) return false;
  const t = QB.l2 > 0 ? Math.max(0, Math.min(1, ((a.x - qb.ax) * QB.dx + (a.y - qb.ay) * QB.dy) / QB.l2)) : 0;
  const ex = a.x - (qb.ax + QB.dx * t);
  const ey = a.y - (qb.ay + QB.dy * t);
  const min = qb.r + rad[i];
  const d2 = ex * ex + ey * ey;
  if (d2 >= min * min) return false;
  const d = dhypot(ex, ey);
  let nx = 0;
  let ny = 0;
  if (d > 1e-6) {
    nx = ex / d;
    ny = ey / d;
  } else {
    // on her axis: out to the side fixed by the id
    const l = dhypot(QB.dx, QB.dy) || 1;
    const sd = a.id & 1 ? 1 : -1;
    nx = (-QB.dy / l) * sd;
    ny = (QB.dx / l) * sd;
  }
  // fully out at once: she is a solid body and nobody may walk through her
  const push = min - d;
  pushX[i] += nx * push;
  pushY[i] += ny * push;
  flag[i] |= 8;
  return false;
}

/** The ant whose neighbours are being visited (one shared callback: no closure per ant). */
const P = { ants: [] as Ant[], i: 0, a: null as unknown as Ant, fa: 0, ra: 0, big: false, strength: 0 }; // det-ok: scratch

function pairCb(j: number): boolean {
  const i = P.i;
  if (j === i) return false;
  const fa = P.fa;
  const fo = flag[j];
  if (!(fo & 1)) return false;
  // Fighters keep a body's room from each other (user note 2026-10-25: fights were heaps). Two ants in a fight
  // stance (16) that are not holding each other stand `fightRoom` × the usual radius apart, and an ant holding a
  // foe (32), which does not give way to the crowd, is eased apart from the other fighters around it.
  const pa = P.a;
  const po = P.ants[j];
  // (two holding the same foe stand at its limbs: the slots set their spacing; an ant and the foe it is going for or
  // holding close in as before)
  const fight = (fa & fo & 16) !== 0 && pa.gId !== po.id && po.gId !== pa.id && !(pa.tk === 3 && pa.tgt === po.id) && !(po.tk === 3 && po.tgt === pa.id) && !(pa.gId !== 0 && pa.gId === po.gId && pa.gKind === po.gKind);
  const ma = (fa & 2) !== 0 || (fight && (fa & 32) !== 0);
  const mo = (fo & 2) !== 0 || (fight && (fo & 32) !== 0);
  if (!ma && !mo) return false;
  const a = P.a;
  const o = P.ants[j];
  const ro = rad[j];
  // each pair once: by the lower id within a size class, else by the big one
  const oBig = ro > BIG;
  if (P.big === oBig ? o.id <= a.id : !P.big) return false;
  const dx = o.x - a.x;
  const dy = o.y - a.y;
  const min = (P.ra + ro) * (fight ? GUARD.fightRoom : 1);
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  const d = dhypot(dx, dy);
  // exactly on top of each other: split along a direction fixed by the ids
  let nx = 1;
  let ny = 0;
  if (d > 1e-6) {
    nx = dx / d;
    ny = dy / d;
  } else {
    const ang = ((a.id * 7 + o.id * 13) % 360) * (Math.PI / 180);
    nx = dcos(ang);
    ny = dsin(ang);
  }
  const push = (min - d) * P.strength;
  const wa = mass[i];
  const wo = mass[j];
  // share by mass: the lighter ant gives way more
  const ka = !ma ? 0 : !mo ? 1 : wo / (wa + wo);
  const ko = !mo ? 0 : !ma ? 1 : wa / (wa + wo);
  pushX[i] -= nx * push * ka;
  pushY[i] -= ny * push * ka;
  pushX[j] += nx * push * ko;
  pushY[j] += ny * push * ko;
  return false;
}

let ants0: Ant[] = []; // det-ok: this tick's ant list (for the queen callback)
let pushX = new Float64Array(0); // det-ok: scratch, cleared every tick
let pushY = new Float64Array(0); // det-ok: scratch, cleared every tick
let flag = new Uint8Array(0); // det-ok: scratch, rebuilt every tick
let rad = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let mass = new Float64Array(0); // det-ok: scratch, rebuilt every tick

/** Radius (mm) above which an ant counts as big for the neighbour search. */
const BIG = 2;
/** Queens (and termite kings standing by them) this tick: they never give way. */
const queens = new Set<number>(); // det-ok: rebuilt every tick from the colonies
/** Per-caste radius and mass (static data). */
const radiusOf = new Map<string, number>(); // det-ok: cache of static caste data
const massOf = new Map<string, number>(); // det-ok: cache of static caste data

function antRadius(a: Ant): number {
  let r = radiusOf.get(a.caste);
  if (r === undefined) {
    const S = BALANCE.separation;
    const cd = casteOf(a.caste);
    // a termite queen's circle is her head and thorax (her abdomen is a capsule: queenBody)
    r = cd.termite === 'queen' ? royalOf(a.caste).abdHalfWidth * (cd.length / royalOf(a.caste).length) * 0.6 : cd.length * S.widthOfLength * S.radiusOfWidth;
    radiusOf.set(a.caste, r);
  }
  return r;
}

function antMass(a: Ant): number {
  let m = massOf.get(a.caste);
  if (m === undefined) {
    m = casteOf(a.caste).mass;
    massOf.set(a.caste, m);
  }
  return m;
}

/** In the separation at all (as a body that pushes or is pushed)? */
/** In a fight (closing in, spraying, holding a foe) or standing in a guard line / squad place: wants more room. */
function fightStance(a: Ant): boolean {
  return a.state === AS.Attack || a.state === AS.Spray || (a.state === AS.Grapple && a.gKind === 3) || (a.state === AS.Rally && a.task === 'marker');
}

function takesPart(a: Ant): boolean {
  // (army ants: bridge links, pothole plugs and ants walking over them are walked on, not crowded)
  return a.state !== AS.Dead && a.state !== AS.Flung && !a.heldBy && !(a.rideId ?? 0) && a.state !== AS.Bridge && a.state !== AS.Plug && (a.xing ?? 0) === 0;
}

/**
 * Free to be pushed? Ants holding still on purpose are not — except ants planted beside a creature
 * (user note 2026-10-25), who stand on the ground and are gently eased apart so they never stack.
 */
function movable(a: Ant): boolean {
  if (a.state === AS.Grapple) return a.gKind === 4 && a.pinned <= 0;
  return a.state !== AS.Hold && a.pinned <= 0 && !queens.has(a.id);
}

function nudge(w: World, a: Ant, dx: number, dy: number): void {
  if (w.walkable(a.space, a.x + dx, a.y + dy)) {
    a.x += dx;
    a.y += dy;
  } else if (w.walkable(a.space, a.x + dx, a.y)) a.x += dx;
  else if (w.walkable(a.space, a.x, a.y + dy)) a.y += dy;
}
