import { World } from './world';
import { Ant, AS, Carry, Colony, POSE, SURFACE, nestSpace, snapping } from './types';
import { casteOf, tierOf } from './species';
import { BALANCE } from './balance';
import { canUpgrade, completeBuild, completeDelete, completeUpgrade, raisesAnts, tileAt, tileCapacity, tileAnts } from './tiles';
import { makeBrood } from './factory';
import { markerRadius } from './markers';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';
import { faceToward } from './movement';
import { abdomenTipBack } from './termites';

/**
 * Nest jobs (Revision 2, EotU — DESIGN.md 3.6). Workers do all nest work
 * physically, in strict priority: dig → build (incl. upgrade and delete) →
 * spawn (carry an egg from the queen's pile to a brood tile). Every
 * dig/build/upgrade/delete job needs 6 completion points; a worker adds
 * 2/4/6 per second by its level. One worker per job, except digging (2 per
 * hex, 7 on an entrance dig, which is the lowest-priority dig). Home-column
 * workers take any job; marker-group workers only jobs near their marker. A
 * worker on a job ignores food and enemies (see antAI: combat is skipped).
 */

export const JOB = { None: 0, Dig: 1, Entrance: 2, Build: 3, Upgrade: 4, Delete: 5, Spawn: 6 } as const;
export const JOB_NAMES = ['', 'Digging', 'Digging an entrance', 'Building a tile', 'Upgrading a tile', 'Taking a tile apart', 'Carrying an egg to a brood tile'];

export interface JobSpot {
  kind: number;
  q: number;
  /** lower runs first */
  prio: number;
  /** workers allowed */
  max: number;
}

const tmp = { x: 0, y: 0 };

/** Can this ant take nest jobs at all? (workers and nanitics; never soldiers or the queen) */
export function isJobWorker(c: Colony, a: Ant): boolean {
  if (a.id === c.queen || a.state === AS.Dead) return false;
  const t = tierOf(a.caste);
  return t === 'worker' || t === 'nanitic';
}

/** Does a brood tile want an egg delivered (empty, or pre-staging behind a living ant)? */
export function wantsEgg(w: World, c: Colony, q: number): boolean {
  const t = tileAt(c, q);
  if (!t || !raisesAnts(t) || t.pend === 2) return false;
  if (t.wait > 0) return false;
  if (!t.brood) return true;
  const b = w.broodById.get(t.brood);
  // an egg that was dropped on the way: someone must pick it up and finish the delivery
  return !!b && b.stage === 0 && !b.carrier;
}

/** Every job the colony has right now, in priority order. */
export function listJobs(w: World, c: Colony): JobSpot[] {
  const g = w.nest(c.id);
  if (!g) return [];
  const out: JobSpot[] = [];
  const N = g.cols * g.rows;
  for (let q = 0; q < N; q++) {
    if (!g.hexDesig[q] || !g.isHexDiggable(q)) continue;
    if (!g.neighbors(q).some((n) => n >= 0 && g.isHexDug(n))) continue; // unreachable: waits
    const entrance = g.spotIndex(q) >= 0;
    out.push({ kind: entrance ? JOB.Entrance : JOB.Dig, q, prio: entrance ? 1 : 0, max: entrance ? BALANCE.entranceDigWorkers : BALANCE.digWorkersPerHex });
  }
  for (const t of c.tiles) {
    if (!t.built) out.push({ kind: JOB.Build, q: t.q, prio: 2, max: 1 });
    else if (t.pend === 1) out.push({ kind: JOB.Upgrade, q: t.q, prio: 2, max: 1 });
    else if (t.pend === 2) out.push({ kind: JOB.Delete, q: t.q, prio: 2, max: 1 });
  }
  for (const t of c.tiles) if (raisesAnts(t) && wantsEgg(w, c, t.q)) out.push({ kind: JOB.Spawn, q: t.q, prio: 3 + (tileAnts(w, t).length >= tileCapacity(t) ? 1 : 0), max: 1 });
  out.sort((a, b) => a.prio - b.prio);
  return out;
}

function jobValid(w: World, c: Colony, kind: number, q: number): boolean {
  const g = w.nest(c.id);
  if (!g) return false;
  switch (kind) {
    case JOB.Dig:
    case JOB.Entrance:
      return !!g.hexDesig[q] && g.isHexDiggable(q);
    case JOB.Build:
      return !!tileAt(c, q) && !tileAt(c, q)!.built;
    case JOB.Upgrade:
      return tileAt(c, q)?.pend === 1;
    case JOB.Delete:
      return tileAt(c, q)?.pend === 2;
    case JOB.Spawn: {
      const t = tileAt(c, q);
      if (!t || !raisesAnts(t)) return false;
      return true;
    }
  }
  return false;
}

/** Stop a job: the ant goes back to its column's behaviour. */
export function endJob(w: World, a: Ant, c: Colony): void {
  if (a.carry === Carry.Brood) {
    // put an undelivered egg back in the pile
    const b = w.broodById.get(a.carryId);
    if (b && b.stage === 0) {
      const t = tileAt(c, b.tile);
      if (t && t.brood === b.id) t.brood = 0;
      w.removeBroodNow(b.id);
      c.eggs = Math.min(BALANCE.eggPileMax, c.eggs + 1);
    }
    a.carry = Carry.None;
    a.carryId = 0;
  }
  a.jobK = 0;
  a.jobQ = -1;
  a.task = a.marker >= 0 ? 'marker' : 'idle';
  a.taskT = 0;
  a.tgt = 0;
  a.tk = 0;
  if (a.state !== AS.Grapple && a.state !== AS.Attack && a.state !== AS.Spray && a.state !== AS.Flung && !snapping(a.state)) {
    a.state = AS.Idle;
    a.st = 0;
  }
}

/** Distance-like cost of sending this ant to hex q (in-nest ants first). */
function jobCost(w: World, c: Colony, a: Ant, q: number): number {
  const g = w.nest(c.id)!;
  const p = g.hexCenter(q, tmp);
  if (a.space === nestSpace(c.id)) return dhypot(p.x - a.x, p.y - a.y);
  if (a.space === SURFACE) {
    const e = c.entrances[0];
    return 5000 + (e ? dhypot(e.sx - a.x, e.sy - a.y) : 0);
  }
  return 20000;
}

/**
 * Hand jobs to free workers, strict priority first. Called every second.
 * Every empty brood tile gets a worker to fetch its egg (the queen always has one ready: colony.queenLay).
 */
export function assignJobs(w: World, c: Colony): void {
  const jobs = listJobs(w, c);
  const key = (k: number, q: number) => k * 100000 + q;
  const valid = new Set(jobs.map((j) => key(j.kind, j.q)));
  const count = new Map<number, number>();
  const free: Ant[] = [];
  for (const a of w.s.ants) {
    if (a.colony !== c.id || !isJobWorker(c, a)) continue;
    if (a.task === 'job') {
      const k = key(a.jobK, a.jobQ);
      // a marker group follows its marker: moved out of the nest or out of reach, its workers drop the job
      let leave = false;
      if (a.marker >= 0) {
        const m = c.markers[a.marker];
        if (!m.placed || m.space !== nestSpace(c.id)) leave = true;
        else {
          const ctr = w.nest(c.id)!.hexCenter(a.jobQ, { x: 0, y: 0 });
          leave = dhypot(m.x - ctr.x, m.y - ctr.y) > markerRadius(w, c, a.marker) * BALANCE.markerJobReach;
        }
      }
      if (leave || (!valid.has(k) && !(a.jobK === JOB.Spawn && a.carry === Carry.Brood))) {
        endJob(w, a, c);
      } else {
        count.set(k, (count.get(k) ?? 0) + 1);
        continue;
      }
    }
    if (a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Flung || snapping(a.state) || a.stun > 0) continue;
    if (a.carry !== Carry.None && a.carry !== Carry.Soil) continue;
    if (a.task === 'marker') {
      const m = a.marker >= 0 ? c.markers[a.marker] : null;
      if (!m || !m.placed || m.space !== nestSpace(c.id)) continue; // out in the world: no nest jobs
    } else if (!['idle', 'forage', 'haul', 'garden', 'tend', 'guard'].includes(a.task)) continue;
    free.push(a);
  }
  if (!free.length) return;
  for (const j of jobs) {
    if (!free.length) break;
    const k = key(j.kind, j.q);
    let need = j.max - (count.get(k) ?? 0);
    if (need <= 0) continue;
    const g = w.nest(c.id)!;
    const ctr = g.hexCenter(j.q, { x: 0, y: 0 });
    // nearest eligible workers
    const cand = free
      .filter((a) => {
        if (a.task !== 'marker') return true;
        const m = c.markers[a.marker];
        return dhypot(m.x - ctr.x, m.y - ctr.y) <= markerRadius(w, c, a.marker) * BALANCE.markerJobReach;
      })
      .map((a) => ({ a, d: jobCost(w, c, a, j.q) }))
      .sort((x, y) => x.d - y.d);
    for (const { a } of cand) {
      if (need <= 0) break;
      a.task = 'job';
      a.taskT = 0;
      a.jobK = j.kind;
      a.jobQ = j.q;
      a.tgt = 0;
      a.tk = 0;
      a.state = AS.Idle;
      a.st = 0;
      need--;
      count.set(k, (count.get(k) ?? 0) + 1);
      free.splice(free.indexOf(a), 1);
    }
  }
}

/** Where a worker stands to work on hex q (digging: just inside a dug neighbour at the shared edge). */
function workSpot(w: World, c: Colony, a: Ant, kind: number, q: number, out: { x: number; y: number; from: number }): boolean {
  const g = w.nest(c.id)!;
  if (kind === JOB.Dig || kind === JOB.Entrance) {
    const nb = g.neighbors(q);
    let best = -1;
    let bd = Infinity;
    let slot = 0;
    nb.forEach((n, d) => {
      if (n < 0 || !g.isHexDug(n)) return;
      const ctr = g.hexCenter(n);
      const dd = sq(ctr.x - a.x) + sq(ctr.y - a.y) + ((a.id + d) % 3) * 4;
      if (dd < bd) {
        bd = dd;
        best = n;
        slot = d;
      }
    });
    if (best < 0) return false;
    // edge between best and q, seen from best: direction index in best's neighbour list
    const back = g.neighbors(best).indexOf(q);
    const ctr = g.hexCenter(best);
    const e = g.edgeMid(best, back < 0 ? 0 : back);
    const side = ((a.id % 3) - 1) * g.R * 0.22;
    const ex = e.x - ctr.x;
    const ey = e.y - ctr.y;
    const len = dhypot(ex, ey) || 1;
    out.x = ctr.x + ex * 0.72 - (ey / len) * side;
    out.y = ctr.y + ey * 0.72 + (ex / len) * side;
    out.from = best;
    void slot;
    return true;
  }
  const ctr = g.hexCenter(q);
  const ang = (a.id * 2.399) % (Math.PI * 2);
  out.x = ctr.x + dcos(ang) * g.R * 0.3;
  out.y = ctr.y + dsin(ang) * g.R * 0.3;
  out.from = -1;
  return true;
}

export interface JobNav {
  goToNestPoint: (w: World, a: Ant, c: Colony, x: number, y: number, dt: number, speedMul?: number) => boolean;
  goHome: (w: World, a: Ant, dt: number) => boolean;
  goOut: (w: World, a: Ant, dt: number) => void;
}

const spot = { x: 0, y: 0, from: -1 };

/** The 'job' task: walk to the job and work it until done. */
export function jobWork(w: World, a: Ant, c: Colony, dt: number, nav: JobNav): void {
  const k = a.jobK;
  const q = a.jobQ;
  if (!k || !jobValid(w, c, k, q)) {
    endJob(w, a, c);
    return;
  }
  // get home first
  if (a.space !== nestSpace(c.id)) {
    if (a.carry !== Carry.None && a.carry !== Carry.Brood) a.carry = Carry.None;
    if (a.space === SURFACE) nav.goHome(w, a, dt);
    else nav.goOut(w, a, dt);
    return;
  }
  const g = w.nest(c.id)!;
  const rate = BALANCE.workRate[Math.max(0, Math.min(2, (a.level || 1) - 1))];
  if (k === JOB.Spawn) {
    spawnWork(w, a, c, q, dt, nav);
    return;
  }
  if (!workSpot(w, c, a, k, q, spot)) return; // waits
  const d = dhypot(spot.x - a.x, spot.y - a.y);
  if (d > 1.3 && a.state !== AS.Dig) {
    if (a.state !== AS.ToDig) {
      a.state = AS.ToDig;
      a.st = 0;
    }
    nav.goToNestPoint(w, a, c, spot.x, spot.y, dt);
    return;
  }
  if (a.state !== AS.Dig) {
    a.state = AS.Dig;
    a.st = 0;
  }
  a.v = 0;
  a.pose = POSE.DIG;
  const ctr = g.hexCenter(q);
  const h = datan2(ctr.y - a.y, ctr.x - a.x);
  a.h += datan2(dsin(h - a.h), dcos(h - a.h)) * Math.min(1, dt * 8);
  const pts = rate * dt;
  if (k === JOB.Dig || k === JOB.Entrance) {
    const total = g.hexTotal[q] || 1;
    const done = g.digHex(q, (pts / BALANCE.jobPoints) * total, spot.from);
    if (w.s.tick % 6 === a.id % 6) w.events.emit({ t: 'dig', colony: c.id, x: a.x + dcos(a.h) * 2, y: a.y + dsin(a.h) * 2 });
    if (done) endJob(w, a, c);
    return;
  }
  const t = tileAt(c, q)!;
  t.progress = Math.min(BALANCE.jobPoints, t.progress + pts);
  if (t.progress < BALANCE.jobPoints) return;
  if (k === JOB.Build) {
    if (!completeBuild(w, c, t)) {
      if (c.player && w.s.tick % 100 === a.id % 100) w.events.emit({ t: 'message', text: 'Not enough food to finish building — the workers are waiting.', kind: 'warn', colony: c.id });
      return;
    }
  } else if (k === JOB.Upgrade) {
    const why = completeUpgrade(w, c, t);
    if (why && why.startsWith('Needs')) {
      if (c.player && w.s.tick % 100 === a.id % 100) w.events.emit({ t: 'message', text: `${why} to finish the upgrade — the workers are waiting.`, kind: 'warn', colony: c.id });
      return;
    }
    if (why && c.player) w.events.emit({ t: 'message', text: why, kind: 'warn', colony: c.id });
  } else if (k === JOB.Delete) completeDelete(w, c, t);
  endJob(w, a, c);
}

/** Spawn job: fetch an egg (from the queen's pile, or one dropped on the way) and set it on the tile. */
function spawnWork(w: World, a: Ant, c: Colony, q: number, dt: number, nav: JobNav): void {
  const g = w.nest(c.id)!;
  const t = tileAt(c, q)!;
  const L = casteOf(a.caste).length;
  if (a.carry === Carry.Brood) {
    const b = w.broodById.get(a.carryId);
    if (!b) {
      endJob(w, a, c);
      return;
    }
    a.state = AS.CarryBrood;
    const ctr = g.hexCenter(q);
    if (nav.goToNestPoint(w, a, c, ctr.x, ctr.y, dt) || dhypot(ctr.x - a.x, ctr.y - a.y) < L * 0.6) {
      // set the egg down in the middle of the tile: it is now incubating
      b.carrier = 0;
      b.x = ctr.x;
      b.y = ctr.y;
      b.stage = 1;
      b.t = 0;
      b.fed = 0;
      t.brood = b.id;
      a.carry = Carry.None;
      a.carryId = 0;
      endJob(w, a, c);
    }
    return;
  }
  // a dropped egg for this tile lies somewhere: pick it up
  if (t.brood) {
    const b = w.broodById.get(t.brood);
    if (b && b.stage === 0 && !b.carrier) {
      a.state = AS.Nurse;
      if (dhypot(b.x - a.x, b.y - a.y) < L * 0.7 || nav.goToNestPoint(w, a, c, b.x, b.y, dt)) {
        b.carrier = a.id;
        a.carry = Carry.Brood;
        a.carryId = b.id;
      }
      return;
    }
    if (b) {
      endJob(w, a, c); // already delivered, or another worker is bringing it
      return;
    }
    t.brood = 0;
  }
  // EotU: go to the tip of the queen's abdomen and pull an egg out of her
  const queen = w.antById.get(c.queen);
  if (!queen || queen.space !== nestSpace(c.id)) return;
  if (a.state !== AS.TendQueen) {
    a.state = AS.TendQueen;
    a.st = 0;
  }
  // the tip, behind her: workers on an arc of five places around it, each facing it (where there is room)
  const tb = abdomenTipBack(queen);
  const tipX = queen.x - dcos(queen.h) * tb;
  const tipY = queen.y - dsin(queen.h) * tb;
  const back = queen.h + Math.PI;
  const ang = back + ((a.id % 5) - 2) * 0.6;
  let px = tipX + dcos(ang) * L * 0.55;
  let py = tipY + dsin(ang) * L * 0.55;
  if (!w.walkable(a.space, px, py)) {
    px = tipX + dcos(back) * L * 0.55;
    py = tipY + dsin(back) * L * 0.55;
  }
  // close in on the tip (once working an egg, a little jostling does not send her back)
  if (dhypot(px - a.x, py - a.y) > (a.st > 0 ? L * 0.6 : L * 0.3)) {
    nav.goToNestPoint(w, a, c, px, py, dt);
    a.st = 0;
    return;
  }
  a.v = 0;
  faceToward(a, tipX, tipY, dt);
  a.pose = POSE.TROPH;
  // working the egg free (she always has one ready: colony.queenLay)
  if (a.st < BALANCE.eggPullSec) return;
  c.eggs = Math.max(0, c.eggs - 1);
  w.events.emit({ t: 'egg', colony: c.id });
  const b = makeBrood(w, c.id, t.caste!, tipX, tipY, q);
  b.carrier = a.id;
  t.brood = b.id; // reserved for this tile
  a.carry = Carry.Brood;
  a.carryId = b.id;
}

/** Progress 0..1 of the job on a hex, for the progress ring (−1 when none). */
export function jobProgress(w: World, c: Colony, q: number): number {
  const g = w.nest(c.id);
  if (!g) return -1;
  if (g.hexDesig[q] && g.isHexDiggable(q)) {
    const p = g.hexProgress(q);
    return p > 0 ? p : -1;
  }
  const t = tileAt(c, q);
  if (t && (!t.built || t.pend) && t.progress > 0) return t.progress / BALANCE.jobPoints;
  return -1;
}

/** Back-compat for UI: why the tile can't be upgraded (null when it can). */
export { canUpgrade };
