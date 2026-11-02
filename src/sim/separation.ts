import { World } from './world';
import { Ant, AS, Creature } from './types';
import { casteOf } from './species';
import { BALANCE, GUARD } from './balance';
import { dcos, dhypot, dsin } from './dmath';
import { anchored, bodyHook } from './slots';
import { antClear, antFitsUnderCreatureAt, antHeights, antNeed, feetN, footAt, footR, stackCap, zoneAt } from './underpass';
import { HEIGHTS } from './heightData';
import { climbDef } from './creatures/climb';
import { cancelAttack, creatureHooks } from './combat';
import { queenBody, royalOf } from './termites';

/**
 * Soft separation (fix brief: no stacking). Runs after creatures move.
 *
 *  - **In a fight (combat v2, CHANGE_PLAN §16 step 1):** two allies who are both
 *    fighting keep a personal space (`combat2.personalSpace` × the larger one's
 *    length) centre to centre, pushed harder than walking ants; allies at the
 *    slots of the same foe are spaced by the slots instead. Enemies keep only
 *    their body radii, so two lines can meet (an attacker holds its own foe at
 *    its hold point, combat.ts) — except two enemies each holding someone else:
 *    separate duels drift a personal space apart, leaving ground between them.
 *  - **Ant–ant:** two ants closer than the sum of their radii (`radiusOfWidth`
 *    × body width) are pushed apart, each pair once (by the lower id), split
 *    by mass, capped at `maxPush` mm a tick so it never looks like a shove.
 *    Ants that hold still on purpose (grappling, holding prey, pinned,
 *    queens, a termite king at his place) do not move but still push the others; the dead, the flung,
 *    climbers and riders, and prey in a hell ant's jaws take no part.
 *  - **Creature body:** an ant inside a creature's capsule is pushed out of
 *    it, unless it is holding on to that creature or riding it, or small
 *    enough to walk under it (combat v2: `combat2.clearance`); its feet (the
 *    climb rails' feet) push every ant on the ground aside.
 *  - **Termite queen:** her 22 mm abdomen (behind her position, the thorax)
 *    is a capsule too (termites.ts queenBody); her own circle covers only her
 *    head and thorax.
 *  - A push that would land on rock is dropped (or kept along one axis).
 *  - **Combat v2.1 (CHANGE_PLAN §17):** an anchored ant (holding a foe, firing,
 *    recovering: slots.ts `anchored`) is a fixed obstacle — the other ant takes
 *    the whole push. Between teammates the right of way decides who gives way:
 *    anchored (3) > holding or closing in on a reserved slot (2) > looking for a
 *    slot, waiting or going round (1) > the rest (0); the lower one moves alone,
 *    equals share by mass. A teammate's push never moves a fighting ant toward its
 *    target (that component is dropped). A creature's body or feet move an
 *    anchored ant only while the creature walks (not in its own attack), and that
 *    cancels the ant's attack (combat.ts `cancelAttack`). A creature in an attack
 *    is not moved by other creatures.
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
    len = new Float64Array(n * 2);
    prio = new Uint8Array(n * 2);
    tdx = new Float64Array(n * 2);
    tdy = new Float64Array(n * 2);
    cancel = new Uint8Array(n * 2);
    under = new Uint8Array(n * 2);
    wt = new Uint8Array(n * 2);
    need = new Float64Array(n * 2);
    clr = new Float64Array(n * 6);
    cmax = new Float64Array(n * 2);
    udrN = new Float64Array(n * 2);
    ucnt = new Uint8Array(n * 2);
    fhdN = new Uint8Array(n * 2);
  }
  // per-ant flags (bit 1 takes part, bit 2 movable, 16 fighting, 32 anchored (combat v2.1), 128 standing in a guard line; 64
  // set below: pushed by a fighting ally, a stronger cap) and the largest small radius and fighting length
  let maxR = 0;
  let maxFightL = 0;
  let maxFightLBig = 0;
  for (let i = 0; i < n; i++) {
    const a = ants[i];
    pushX[i] = 0;
    pushY[i] = 0;
    const anch = anchored(a);
    flag[i] = (takesPart(a) ? 1 : 0) | (!anch && movable(a) ? 2 : 0) | (fighting(a) ? 16 : 0) | (anch ? 32 : 0) | (inLine(a) ? 128 : 0);
    cancel[i] = 0;
    // squeezing in under a creature to a slot under its body (small enough to go under): it passes between its
    // teammates' legs, no push between them (combat v2.1)
    under[i] = a.state === AS.Attack && a.tk === 4 && (a.rsv ?? 0) === a.tgt && a.gSlot >= 1 ? 1 : 0;
    wt[i] = waiting(a) ? 1 : 0;
    // right of way (combat v2.1), and the way to its target (a teammate never pushes it that way)
    prio[i] = anch ? 3 : a.state === AS.Attack && (a.rsv ?? 0) !== 0 && a.rsv === a.tgt ? 2 : fighting(a) ? 1 : 0;
    tdx[i] = 0;
    tdy[i] = 0;
    if (prio[i] === 1 || prio[i] === 2) {
      const t = a.tk === 3 ? w.antById.get(a.tgt) : a.tk === 4 ? w.creatureById.get(a.tgt) : undefined;
      if (t) {
        const dx = t.x - a.x;
        const dy = t.y - a.y;
        const d = dhypot(dx, dy);
        if (d > 1e-6) {
          tdx[i] = dx / d;
          tdy[i] = dy / d;
        }
      }
    }
    // under-pass (combat v2.2): how tall it is (with the margin), the clearance under its rear, middle and front in
    // its pose (its front held up while something under it is mid-attack: `fhd` from the last pass)
    need[i] = antNeed(a);
    antClear(a, CLR, (a.fhd ?? 0) > 0);
    clr[i * 3] = CLR[0];
    clr[i * 3 + 1] = CLR[1];
    clr[i * 3 + 2] = CLR[2];
    cmax[i] = Math.max(CLR[0], CLR[1], CLR[2]);
    udrN[i] = 0;
    ucnt[i] = 0;
    fhdN[i] = 0;
    const r = antRadius(a);
    rad[i] = r;
    mass[i] = antMass(a);
    len[i] = antLen(a);
    if (r <= BIG && r > maxR) maxR = r;
    if (flag[i] & 16) {
      if (r <= BIG && len[i] > maxFightL) maxFightL = len[i];
      if (len[i] > maxFightLBig) maxFightLBig = len[i];
    }
  }
  const PS = BALANCE.combat2.personalSpace;
  // Small ants find their neighbours with a short query (their radius + the
  // largest small radius); the few big ones (queens, majors, …) search wider
  // themselves, so the common query stays cheap. Pushes are summed per ant
  // and applied once at the end (one walkability test per ant moved).
  P.ants = ants;
  ants0 = ants;
  P.strength = S.strength;
  P.fightStrength = BALANCE.combat2.fightStrength;
  P.ps = PS;
  P.ws = BALANCE.combat21.waitSpace;
  P.dt = dt;
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
    P.foeK = foeKind(a);
    P.foeId = P.foeK ? foeId(a) : 0;
    P.team = a.team ?? a.colony;
    let q = ra + (P.big ? Math.max(maxR, ra) : maxR);
    // a fighting ant looks as far as a fighting ally's personal space (pairs with big ants are the big one's)
    if (fa & 16) q = Math.max(q, PS * Math.max(len[i], P.big ? maxFightLBig : maxFightL));
    w.antIdxNear(a.space, a.x, a.y, q, pairCb);
  }
  // the feet of tall ants push the small ants standing under them (combat v2.2)
  for (let t = 0; t < n; t++) {
    if (!ucnt[t]) continue;
    const B = ants[t];
    const d = antHeights(B.caste);
    FT.t = t;
    FT.r = footR(len[t]);
    for (let k = 0; k < feetN(d); k++) {
      footAt(d, len[t], B.x, B.y, B.h, k, FT);
      w.antIdxNear(B.space, FT.x, FT.y, FT.r + maxR, footAntCb);
    }
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
  // creature bodies push ants out (harder: a body is solid); small ants walk under (combat v2), only its feet push them
  for (const cr of w.s.creatures) {
    if (cr.dead) continue;
    const b = bodyHook.body(cr);
    const c = dcos(cr.h);
    const s = dsin(cr.h);
    CB.cr = cr;
    // (an anchored ant gives way only to a creature walking into it, not to one in its own attack: combat v2.1)
    CB.walking = cr.v > 0.5 && !creatureHooks.attacking(cr);
    w.antIdxNear(cr.space, cr.x, cr.y, b.hl + b.r + maxR, (i) => {
      if (!(flag[i] & 1) || (!(flag[i] & 2) && !(CB.walking && flag[i] & 32))) return false;
      const a = ants[i];
      if (a.gKind === 4 && a.gId === cr.id) return false; // holding on to it
      if (a.rideId === cr.id) return false;
      // under it where it fits (combat v2.2: the zone of the body over it, from the model), among the legs
      if (antFitsUnderCreatureAt(a, cr, a.x, a.y)) {
        udrN[i] = -cr.id;
        return false;
      }
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
      if (flag[i] & 32) cancel[i] = 1;
      return false;
    });
    // its feet push the ants on the ground aside, the ones under it too (combat v2.2: the feet of its model, every
    // kind; before, the climb rails' feet of the climbable ones)
    const C2 = BALANCE.combat2;
    CB.r = Math.max(C2.footMinMm, cr.scale * C2.footRadius);
    const hd = HEIGHTS.creature[cr.kind];
    if (hd) {
      for (let k = 0; k < feetN(hd); k++) {
        footAt(hd, cr.scale, cr.x, cr.y, cr.h, k, CB);
        w.antIdxNear(cr.space, CB.x, CB.y, CB.r + maxR, footCb);
      }
      continue;
    }
    const def = climbDef(cr.kind);
    if (!def) continue;
    for (const rail of def.rails) {
      const fx = rail.pts[0] * cr.scale;
      const fy = rail.pts[2] * cr.scale;
      CB.x = cr.x + fx * c - fy * s;
      CB.y = cr.y + fx * s + fy * c;
      w.antIdxNear(cr.space, CB.x, CB.y, CB.r + maxR, footCb);
    }
  }
  for (let i = 0; i < n; i++) {
    let dx = pushX[i];
    let dy = pushY[i];
    if (dx * dx + dy * dy < 1e-6) continue; // under a thousandth of a millimetre: not worth a terrain test
    // capped so it is a gentle drift, never a shove (out of a body: twice that; out of a termite queen: all of it)
    const m = dhypot(dx, dy);
    const lim = flag[i] & 8 ? m : flag[i] & 4 ? cap * 2 : flag[i] & 64 ? cap * BALANCE.combat2.fightCapMul : cap;
    if (m > lim) {
      dx *= lim / m;
      dy *= lim / m;
    }
    const a = ants[i];
    const x0 = a.x;
    const y0 = a.y;
    nudge(w, a, dx, dy);
    // a large creature walked into an anchored ant: its attack is cancelled, and it plants again (combat v2.1)
    if (cancel[i] && (a.x !== x0 || a.y !== y0)) cancelAttack(w, a);
  }
  // the under-pass map of this pass (render: hidden units; the next pass: who keeps its place, whose front waits)
  for (let i = 0; i < n; i++) {
    const a = ants[i];
    if ((a.udr ?? 0) !== udrN[i]) a.udr = udrN[i];
    if ((a.fhd ?? 0) !== fhdN[i]) a.fhd = fhdN[i];
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
    // (in an attack it stands its ground: the other one gives way — combat v2.1)
    if (a.dead || creatureHooks.attacking(a)) continue;
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
      // the smaller one gives way more (all of it to one in an attack)
      const share = creatureHooks.attacking(o) ? 1 : o.scale / (a.scale + o.scale);
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

/** The creature foot pushing (one shared callback). */
const CB = { cr: null as unknown as Creature, x: 0, y: 0, r: 0, walking: false }; // det-ok: scratch

function footCb(i: number): boolean {
  if (!(flag[i] & 1) || (!(flag[i] & 2) && !(CB.walking && flag[i] & 32))) return false;
  const a = ants0[i];
  if (a.rideId === CB.cr.id) return false;
  const dx = a.x - CB.x;
  const dy = a.y - CB.y;
  const min = CB.r + rad[i];
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  const d = dhypot(dx, dy);
  let nx = 1;
  let ny = 0;
  if (d > 1e-6) {
    nx = dx / d;
    ny = dy / d;
  } else if (a.id & 1) nx = -1;
  const push = (min - d) * BALANCE.separation.creatureStrength;
  pushX[i] += nx * push;
  pushY[i] += ny * push;
  flag[i] |= 4;
  if (flag[i] & 32) cancel[i] = 1;
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
const P = { ants: [] as Ant[], i: 0, a: null as unknown as Ant, fa: 0, ra: 0, big: false, strength: 0, fightStrength: 0, ps: 0, ws: 0, foeK: 0, foeId: 0, team: 0, dt: 0 }; // det-ok: scratch

/**
 * The foe whose attack slot an ant holds (Grapple), has reserved while closing in, or is spraying as it closes in:
 * kind (3 ant, 4 creature; 0 none).
 * Allies at the slots of one foe are spaced by the slots; chasing or waiting allies keep a personal space.
 */
function foeKind(a: Ant): number {
  if (a.state === AS.Grapple) return a.gKind === 3 || a.gKind === 4 ? a.gKind : 0;
  if ((a.state === AS.Attack && (a.rsv ?? 0) !== 0 && a.rsv === a.tgt) || a.state === AS.Spray) return a.tk === 3 || a.tk === 4 ? a.tk : 0;
  return 0;
}
/** Are two enemies fighting each other (one holding or going for the other)? */
function engaged(a: Ant, o: Ant): boolean {
  return (a.gKind === 3 && a.gId === o.id) || (o.gKind === 3 && o.gId === a.id) || (a.tk === 3 && a.tgt === o.id) || (o.tk === 3 && o.tgt === a.id);
}

function foeId(a: Ant): number {
  return a.state === AS.Grapple ? a.gId : a.tgt;
}

function pairCb(j: number): boolean {
  const i = P.i;
  if (j === i) return false;
  const fa = P.fa;
  const fo = flag[j];
  if (!(fo & 1)) return false;
  const pa = P.a;
  const po = P.ants[j];
  // Combat v2 (step 1): two allies who are both fighting keep a personal space from each other, unless they are going
  // for the same foe (its slots space them). Enemies keep only their bodies' radii (lines can meet; an attacker holds
  // its own foe at its hold point). An ant holding a foe (32), which does not give way to the crowd, is eased apart
  // from fighting allies round it.
  // (Guard lines keep their own spacing: an ally standing in a line keeps `GUARD.fightRoom` × the radii as before.)
  const ally = (po.team ?? po.colony) === P.team;
  if (ally && (under[i] || under[j])) return false;
  // …and two enemies each holding someone else (separate duels) drift apart too, so neighbouring duels keep ground
  // between them; enemies closing in, or fighting each other, keep only their bodies' radii
  const sameFoe = ally && P.foeK !== 0 && foeKind(po) === P.foeK && foeId(po) === P.foeId;
  // (a teammate waiting for a slot: `waitSpace` from another waiting one, a personal space from one fighting — same foe
  // or not: waiting)
  const wait = ally && (fa & fo & 16) !== 0 && (wt[i] | wt[j]) !== 0;
  const fight = wait || ((fa & fo & 16) !== 0 && (ally ? !sameFoe : pa.state === AS.Grapple && po.state === AS.Grapple && !engaged(pa, po)));
  const line = !fight && ally && ((fa | fo) & 128) !== 0 && (fa & 144) !== 0 && (fo & 144) !== 0;
  const ro = rad[j];
  // each pair once: by the lower id within a size class, else by the big one
  const oBig = ro > BIG;
  if (P.big === oBig ? po.id <= pa.id : !P.big) return false;
  // under-pass (combat v2.2): the shorter one fits under the taller one where it stands — no body push between them (the
  // taller one's feet push it: below); where it does not fit, beside it, only their bodies' radii (no personal space)
  let mixed = false;
  if ((ally ? UP.allies : UP.enemies) && (need[i] <= cmax[j] || need[j] <= cmax[i])) {
    const sm = need[i] <= cmax[j] && (need[j] > cmax[i] || need[i] <= need[j]) ? i : j;
    const r = underPair(sm, sm === i ? j : i);
    if (r !== 0) return false;
    mixed = true;
  }
  // (anchored ants never move: the other takes the whole push — combat v2.1)
  let ma = (fa & 2) !== 0;
  let mo = (fo & 2) !== 0;
  if (!ma && !mo) return false;
  // right of way between teammates: only the lower one gives way
  if (ally && ma && mo && prio[i] !== prio[j]) {
    if (prio[i] > prio[j]) ma = false;
    else mo = false;
  }
  const dx = po.x - pa.x;
  const dy = po.y - pa.y;
  // (user 2026-11-01: "make collision hitboxes 2x smaller … keep hitbox size but collision size of ants colliding each
  // other is smaller") every ant–ant distance × `antContact`; the hit shapes (bites, climbs, creatures) are unchanged
  const min = (fight && !mixed ? (wait && wt[i] && wt[j] ? P.ws : P.ps) * Math.max(len[i], len[j]) : (P.ra + ro) * (line && !mixed ? GUARD.fightRoom : 1)) * BALANCE.separation.antContact;
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
    const ang = ((pa.id * 7 + po.id * 13) % 360) * (Math.PI / 180);
    nx = dcos(ang);
    ny = dsin(ang);
  }
  // (two waiting ants ease apart at the walking strength: a crowd settling, not a fight's spacing)
  const calm = (wait && wt[i] && wt[j]) || mixed;
  const push = (min - d) * (fight && !calm ? P.fightStrength : P.strength);
  const wa = mass[i];
  const wo = mass[j];
  // share by mass: the lighter ant gives way more
  const ka = !ma ? 0 : !mo ? 1 : wo / (wa + wo);
  const ko = !mo ? 0 : !ma ? 1 : wa / (wa + wo);
  let ax = -nx * push * ka;
  let ay = -ny * push * ka;
  let ox = nx * push * ko;
  let oy = ny * push * ko;
  // a teammate never pushes a fighting ant toward its target (it would shove it into the fight)
  if (ally) {
    const da = ax * tdx[i] + ay * tdy[i];
    if (da > 0) {
      ax -= da * tdx[i];
      ay -= da * tdy[i];
    }
    const dO = ox * tdx[j] + oy * tdy[j];
    if (dO > 0) {
      ox -= dO * tdx[j];
      oy -= dO * tdy[j];
    }
  }
  pushX[i] += ax;
  pushY[i] += ay;
  pushX[j] += ox;
  pushY[j] += oy;
  if (fight && !calm) {
    flag[i] |= 64;
    flag[j] |= 64;
  }
  return false;
}

let ants0: Ant[] = []; // det-ok: this tick's ant list (for the queen callback)
let pushX = new Float64Array(0); // det-ok: scratch, cleared every tick
let pushY = new Float64Array(0); // det-ok: scratch, cleared every tick
let flag = new Uint8Array(0); // det-ok: scratch, rebuilt every tick
let rad = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let mass = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let len = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let prio = new Uint8Array(0); // det-ok: scratch, rebuilt every tick
let tdx = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let tdy = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let cancel = new Uint8Array(0); // det-ok: scratch, rebuilt every tick
let under = new Uint8Array(0); // det-ok: scratch, rebuilt every tick
/** under-pass (combat v2.2): height with the margin, clearance per zone (3 per ant) and its largest, the unit each stands
 * under this pass (an ant's id, a creature's −id), how many stand under each, front held up */
let need = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let clr = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let cmax = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let udrN = new Float64Array(0); // det-ok: scratch, rebuilt every tick
let ucnt = new Uint8Array(0); // det-ok: scratch, rebuilt every tick
let fhdN = new Uint8Array(0); // det-ok: scratch, rebuilt every tick
const CLR = [0, 0, 0]; // det-ok: scratch
const UP = BALANCE.underpass;

/**
 * The shorter ant `sm` and the taller `tl` (combat v2.2). Where `sm` stands, does it fit under `tl` (the zone of `tl`'s
 * body over it, in `tl`'s pose)? Under its body, it counts toward `tl`'s stack (at most stackCap at once; one already
 * under it keeps its place); when the stack is full it stays beside instead. Returns 1: under it (no push between them);
 * 2: it was under `tl` and no longer fits (`tl` lowered): it steps out sideways — only it moves — or, mid-attack, stays
 * till its attack is done (and `tl`'s front waits); 0: beside `tl` where it does not fit (bodies' radii only).
 */
function underPair(sm: number, tl: number): number {
  const A = P.ants[sm];
  const B = P.ants[tl];
  const d = antHeights(B.caste);
  const LB = len[tl];
  const z = zoneAt(d, LB, B.x, B.y, B.h, A.x, A.y);
  const c = clr[tl * 3 + z];
  const cs = dcos(B.h);
  const sn = dsin(B.h);
  const lx = (A.x - B.x) * cs + (A.y - B.y) * sn;
  const ly = -(A.x - B.x) * sn + (A.y - B.y) * cs;
  const half = d.hw * LB;
  // (under its body: within its length along it and its half-width across)
  const underBody = Math.abs(ly) < half + rad[sm] * 0.5 && Math.abs(lx) < LB * 0.5 + rad[sm] * 0.5;
  const was = (A.udr ?? 0) === B.id;
  if (need[sm] <= c) {
    if (underBody) {
      if (!was && ucnt[tl] >= stackCap(len[sm], LB)) return 0;
      if (ucnt[tl] < 255) ucnt[tl]++;
      udrN[sm] = B.id;
      if (z === 2 && flag[sm] & 32) fhdN[tl] = 1;
    }
    return 1;
  }
  if (!was || !underBody) return 0;
  udrN[sm] = B.id;
  // mid-attack under it: it finishes first (no push); its front waits to lower
  if (flag[sm] & 32) {
    if (z === 2) fhdN[tl] = 1;
    return 2;
  }
  if (!(flag[sm] & 2)) return 2;
  // steps out sideways, to the side it is on, clear of the body: a short planned move at the small-step speed
  const out = half + rad[sm] + UP.stepOut * len[sm] - Math.abs(ly);
  const side = ly >= 0 ? 1 : -1;
  const step = Math.min(out, casteOf(A.caste).speed * BALANCE.combat21.stepSpeed * P.dt);
  pushX[sm] += -sn * side * step;
  pushY[sm] += cs * side * step;
  flag[sm] |= 4;
  return 2;
}

/** A tall ant's feet push the small ants standing under it (only those: the rest meet its body as usual). */
const FT = { t: 0, x: 0, y: 0, r: 0 }; // det-ok: scratch
function footAntCb(j: number): boolean {
  if (udrN[j] !== P.ants[FT.t].id || !(flag[j] & 2)) return false;
  const a = P.ants[j];
  const dx = a.x - FT.x;
  const dy = a.y - FT.y;
  const min = FT.r + rad[j];
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  const d = dhypot(dx, dy);
  const nx = d > 1e-6 ? dx / d : a.id & 1 ? 1 : -1;
  const ny = d > 1e-6 ? dy / d : 0;
  pushX[j] += nx * (min - d) * P.strength;
  pushY[j] += ny * (min - d) * P.strength;
  return false;
}
let wt = new Uint8Array(0); // det-ok: scratch, rebuilt every tick (waiting for a slot)

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

function antLen(a: Ant): number {
  return casteOf(a.caste).length;
}

function antMass(a: Ant): number {
  let m = massOf.get(a.caste);
  if (m === undefined) {
    m = casteOf(a.caste).mass;
    massOf.set(a.caste, m);
  }
  return m;
}

/** Fighting (closing in, spraying, holding a foe): keeps a personal space from fighting allies. */
function fighting(a: Ant): boolean {
  return a.state === AS.Attack || a.state === AS.Spray || a.state === AS.Grapple;
}

/**
 * Waiting for a free slot (every slot on its foe taken), 2026-10-31 (user note: dozens of ants circling one fight): two
 * waiting teammates keep `combat21.waitSpace` × the larger one's length (less than a personal space), whatever foe
 * they wait for; a waiting ant and a teammate fighting keep a personal space even when they are on the same foe (the
 * crowd stays out of the fight). Before, ants waiting on the same foe kept only their bodies' room and stood shoulder
 * to shoulder round the ring.
 */
function waiting(a: Ant): boolean {
  return a.state === AS.Attack && (a.waitT ?? 0) > 0;
}

/** Standing in a guard line / squad place at a marker (guardLine.ts sets the line's own spacing). */
function inLine(a: Ant): boolean {
  return a.state === AS.Rally && a.task === 'marker';
}

/** In the separation at all (as a body that pushes or is pushed)? */
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
