/**
 * Army-ant raid scene for tools/eciton-raid.ts and tests/eciton.ts: an army-ant colony sends Workers, Porters,
 * Medias and Soldiers to a surface marker 150 mm out, with insect prey and a few small creatures scattered round
 * it, and measures what the package asks for: the front (width, pulsing, how far it roams), the three lanes
 * (outbound ants to the sides of the trail, laden ants down the middle), prey carried home (porters under the
 * body), Soldier posts along the whole trail facing out (and none with too few Soldiers), flushing.
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, Carry, POSE, SURFACE } from '../src/sim/types';
import { makeAnt, makeFood } from '../src/sim/factory';
import { assignGroup, placeMarker, markerRadius } from '../src/sim/markers';
import { CASTES } from '../src/sim/species';
import { ECITON } from '../src/sim/balance';
import { raidRoute, frontHalfWidth } from '../src/sim/eciton';
import { routeNearest, routeLength } from '../src/sim/route';
import { spawnCreature } from '../src/sim/creatures/creatureAI';

export interface RaidOpts {
  minors?: number;
  porters?: number;
  medias?: number;
  majors?: number;
  seed?: number;
  seconds?: number;
  prey?: number;
  creatures?: number;
  /** a puddle across the way, 80 mm out (the trail bends round it: a living bridge forms over it) */
  puddle?: boolean;
  /** keep running and call back every second (render tools) */
  onSecond?: (w: World, t: number) => void;
}

export function raidScene(o: RaidOpts = {}) {
  const sd = o.seed ?? 5;
  const w: World = createWorld({ seed: sd, style: 'meadow', width: 700, depth: 700, food: 0, colonies: [{ species: 'eciton', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
  const c = w.colony(0)!;
  const e = c.entrances[0];
  let mx = e.sx + 150;
  let my = e.sy;
  for (let k = 0; k < 24; k++) {
    const ang = (k / 24) * Math.PI * 2;
    const x = e.sx + Math.cos(ang) * 150;
    const y = e.sy + Math.sin(ang) * 150;
    let ok = x > 90 && y > 90 && x < 610 && y < 610;
    for (let r = 0; ok && r <= 60; r += 10) for (let q = 0; ok && q < 8; q++) ok = w.walkable(SURFACE, x + Math.cos(q) * r, y + Math.sin(q) * r);
    if (ok) {
      mx = x;
      my = y;
      break;
    }
  }
  if (o.puddle) {
    const ang = Math.atan2(my - e.sy, mx - e.sx);
    // a round puddle right across the way: the trail goes round it
    w.terrain.addPuddle(e.sx + Math.cos(ang) * 80, e.sy + Math.sin(ang) * 80, 22);
  }
  // prey scattered round the raid area (insects: what army ants eat), and seeds they must leave alone
  const rngPts = (n: number, r: number, f: (x: number, y: number, i: number) => void) => {
    for (let i = 0; i < n; i++) {
      const a = i * 2.399;
      const rr = r * Math.sqrt((i + 0.5) / n);
      const x = mx + Math.cos(a) * rr;
      const y = my + Math.sin(a) * rr;
      if (w.walkable(SURFACE, x, y)) f(x, y, i);
    }
  };
  rngPts(o.prey ?? 30, 60, (x, y, i) => makeFood(w, 'insect', SURFACE, x, y, i % 4 === 0 ? 1.8 : 1.0, ['fly', 'cricket', 'moth', 'beetle'][i % 4]));
  rngPts(8, 50, (x, y) => makeFood(w, 'seed', SURFACE, x + 3, y + 2, 1));
  for (let i = 0; i < (o.creatures ?? 0); i++) spawnCreature(w, i % 2 ? 'pillbug' : 'cutworm', SURFACE, mx + Math.cos(i * 1.7) * 30, my + Math.sin(i * 1.7) * 30);
  placeMarker(w, c, 0, SURFACE, mx, my);
  const chamber = c.tiles.find((t) => t.type === 'queen')!;
  const spawn = (caste: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = makeAnt(w, 0, caste, SURFACE, e.sx + Math.cos(i * 2.4) * (6 + i * 0.4), e.sy + Math.sin(i * 2.4) * (6 + i * 0.4), 0);
      a.tile = chamber.q;
      a.task = 'marker';
      a.marker = 0;
    }
  };
  spawn('eciton_minor', o.minors ?? 40);
  spawn('eciton_submajor', o.porters ?? 8);
  spawn('eciton_media', o.medias ?? 5);
  spawn('eciton_major', o.majors ?? 8);
  assignGroup(w, c, chamber.group, 0);
  w.reindex();
  const seconds = o.seconds ?? 120;
  const radius = markerRadius(w, c, 0);
  const near = { s: 0, d: 0, x: 0, y: 0, ux: 0, uy: 0 };
  // measurements
  let laneOut = 0;
  let laneOutN = 0;
  let laneIn = 0;
  let laneInN = 0;
  const frontPts: Array<[number, number]> = [];
  let pulses = 0;
  let raidStates = 0;
  let maxFrontDist = 0;
  let porterUnder = 0;
  let porterCarry = 0;
  let flushed = 0;
  const food0 = c.stats.food;
  let seedsTaken = 0;
  let bridgeDoneT = -1;
  let crossings = 0;
  let teamT = 0;
  let plugged = 0;
  let bridgeMembers = 0;
  const crossing = new Set<number>();
  for (let t = 0; t < 20 * seconds; t++) {
    w.step(0.05);
    w.events.drain();
    for (const a of w.s.ants) {
      if ((a.xing ?? 0) !== 0 && !crossing.has(a.id)) {
        crossing.add(a.id);
        crossings++;
      } else if ((a.xing ?? 0) === 0) crossing.delete(a.id);
    }
    for (const L of c.ecLinks ?? []) {
      if (L.kind === 1 && L.done === 1 && bridgeDoneT < 0) bridgeDoneT = t / 20;
      if (L.kind === 2 && L.done === 1) plugged++;
    }
    bridgeMembers = Math.max(bridgeMembers, w.s.ants.filter((a) => a.state === AS.Bridge).length);
    if (w.s.ants.some((a) => (a.helpOf ?? 0) !== 0)) teamT++;
    const R = c.ecRaid?.[0];
    if (!R || t % 10) continue;
    if (t % 20 === 0) o.onSecond?.(w, t / 20);
    frontPts.push([R.x, R.y]);
    maxFrontDist = Math.max(maxFrontDist, Math.hypot(R.x - mx, R.y - my));
    for (const cr of w.s.creatures) if ((cr.data.flushT ?? 0) > 0) flushed++;
    const rt = raidRoute(w, c, 0);
    for (const a of w.s.ants) {
      if (a.colony !== 0 || a.space !== SURFACE || a.state === AS.Dead) continue;
      if (a.state === AS.Raid) {
        raidStates++;
        if (a.ecPh === 0) pulses++;
      }
      const cd = CASTES[a.caste];
      if (a.carry === Carry.Food) {
        const f = w.foodById.get(a.carryId);
        if (f && f.kind === 'seed') seedsTaken++;
        if (cd.porter) {
          porterCarry++;
          if (f && Math.hypot(f.x - a.x, f.y - a.y) < cd.length * 0.2) porterUnder++;
        }
      }
      // lanes, on the middle stretch of the trail
      routeNearest(rt, a.x, a.y, near);
      const total = routeLength(rt);
      if (near.d > 12 || near.s < total * 0.25 || near.s > total * 0.75) continue;
      if (a.carry === Carry.Food && a.state === AS.Return) {
        laneIn += near.d;
        laneInN++;
      } else if (a.state === AS.FollowTrail && a.carry === Carry.None) {
        laneOut += near.d;
        laneOutN++;
      }
    }
  }
  const R = c.ecRaid![0];
  const posts: Array<{ x: number; y: number; h: number }> = [];
  for (let i = 0; i < R.posts.length; i += 3) posts.push({ x: R.posts[i], y: R.posts[i + 1], h: R.posts[i + 2] });
  const guards = w.s.ants.filter((a) => a.colony === 0 && a.state === AS.Guard && a.pose === POSE.GUARD);
  const rt = raidRoute(w, c, 0);
  const postArcs = posts.map((p) => {
    routeNearest(rt, p.x, p.y, near);
    return routeLength(rt) - near.s; // from the entrance
  });
  // outward: the post faces away from the trail (the route, or its run on from the marker to the front)
  let outward = 0;
  for (const p of posts) {
    routeNearest(rt, p.x, p.y, near);
    let nx = near.x;
    let ny = near.y;
    const fx = R.x - mx;
    const fy = R.y - my;
    const l2 = fx * fx + fy * fy;
    if (l2 > 1e-6) {
      const t = Math.max(0, Math.min(1, ((p.x - mx) * fx + (p.y - my) * fy) / l2));
      const qx = mx + fx * t;
      const qy = my + fy * t;
      if (Math.hypot(p.x - qx, p.y - qy) < near.d) {
        nx = qx;
        ny = qy;
      }
    }
    if ((p.x - nx) * Math.cos(p.h) + (p.y - ny) * Math.sin(p.h) > 0) outward++;
  }
  return {
    w,
    c,
    mx,
    my,
    radius,
    frontHalf: frontHalfWidth(w, c, 0, (o.minors ?? 40) + (o.porters ?? 8) + (o.medias ?? 5)),
    maxFrontDist,
    frontTravel: frontPts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - frontPts[i - 1][0], p[1] - frontPts[i - 1][1]) : 0), 0),
    pulseShare: raidStates ? pulses / raidStates : 0,
    raidStates,
    laneOut: laneOutN ? laneOut / laneOutN : 0,
    laneIn: laneInN ? laneIn / laneInN : 0,
    laneOutN,
    laneInN,
    porterUnderShare: porterCarry ? porterUnder / porterCarry : 0,
    porterCarry,
    food: c.stats.food - food0,
    seedsTaken,
    posts,
    postArcs,
    routeLen: routeLength(rt),
    guards: guards.length,
    outward,
    flushed,
    bridges: (c.ecLinks ?? []).filter((L) => L.kind === 1 && L.done !== -1).map((L) => ({ n: L.n, done: L.done, span: Math.hypot(L.ax - L.bx, L.ay - L.by), last: L.last })),
    plugs: (c.ecLinks ?? []).filter((L) => L.kind === 2 && L.done !== -1).length,
    pluggedTicks: plugged,
    bridgeDoneT,
    bridgeMembers,
    crossings,
    teamSec: teamT / 20,
    minL: CASTES.eciton_minor.length,
    laneOffset: ECITON.lanes.laneOffset,
  };
}
