/**
 * Nest floods and the all-out raid (claude/story/06-spec-levels-5-7-and-lengths.md §4, level 6 "High Water";
 * sim/nestFlood.ts, NEST_FLOOD in balance.ts, warAI.ts `startAllOut`).
 *
 *   npx vite-node tests/nestFlood.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, Carry, HIT, nestSpace, SURFACE } from '../src/sim/types';
import { BALANCE, NEST_FLOOD } from '../src/sim/balance';
import { floodCache, forceAllOut, isHexFlooded, nestFloodFraction, startNestFlood } from '../src/sim/nestFlood';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { makeAnt, makeBrood } from '../src/sim/factory';
import { canPlaceTile, raisesAnts, recomputeTileCaps } from '../src/sim/tiles';
import { listJobs } from '../src/sim/jobs';
import { designateDig } from '../src/sim/colony';
import { killAnt } from '../src/sim/antAI';
import { warBrain } from '../src/sim/warAI';
import { placeMarker } from '../src/sim/markers';
import { CASTES } from '../src/sim/species';
import { antSpeed } from '../src/sim/movement';

const t0 = Date.now();
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? '  ok ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const SETUP: GameSetup = {
  seed: 11,
  style: 'meadow',
  width: 640,
  depth: 640,
  colonies: [
    { species: 'lasius', player: true, ai: false, developed: 6, startWorkers: 14 },
    { species: 'lasius', player: false, ai: true, developed: 10, startWorkers: 20 },
  ],
  food: 1.2,
  settings: { creatures: 0 },
};

interface Run {
  w: World;
  ev: EventBus;
  floods: Array<{ colony: number; phase: string; t: number }>;
  lost: Array<{ colony: number; t: number }>;
  deaths: Map<number, { t: number; cause: number }>;
}

function make(setup: GameSetup = SETUP): Run {
  const ev = new EventBus();
  const w = createWorld(setup, ev);
  const r: Run = { w, ev, floods: [], lost: [], deaths: new Map() };
  ev.on('nestFlood', (e) => r.floods.push({ colony: e.colony, phase: e.phase, t: w.s.time }));
  ev.on('colonyLost', (e) => r.lost.push({ colony: e.colony, t: w.s.time }));
  ev.on('death', (e) => {
    if (e.kind === 'ant') r.deaths.set(e.id, { t: w.s.time, cause: e.cause ?? 0 });
  });
  return r;
}

function run(r: Run, sec: number): void {
  for (let i = 0, n = Math.round(sec * 20); i < n; i++) {
    r.w.step(0.05);
    r.ev.drain();
  }
}

const fighter = (cs: string) => CASTES[cs].role === 'soldier' || CASTES[cs].role === 'major';

// ---------------------------------------------------------------- 1. the fill: deepest first, full within fillSec
const A = make();
run(A, 30);
{
  const w = A.w;
  const c = w.colony(1)!;
  check('a colony without a nest, or one already flooding, is refused', !startNestFlood(w, 99) && startNestFlood(w, 1, { fillSec: 30 }) && !startNestFlood(w, 1));
  A.ev.drain();
  check("'start' is announced at once (event nestFlood start)", A.floods.length === 1 && A.floods[0].phase === 'start' && A.floods[0].colony === 1);
  run(A, 15);
  const half = nestFloodFraction(w, 1);
  check('half way through fillSec about half the nest is under water', half > 0.4 && half < 0.6 && c.nestFlood!.phase === 1, `${(half * 100).toFixed(0)} % at 15 s of 30`);
  run(A, 15.2);
  const full = A.floods.find((f) => f.phase === 'full');
  check('the whole nest is under water by fillSec (event nestFlood full, once)', nestFloodFraction(w, 1) === 1 && c.nestFlood!.phase === 2 && !!full && A.floods.length === 2, full ? `full ${(full.t - 30).toFixed(2)} s after the start` : 'not full');
  const fc = floodCache(w, c)!;
  const st = c.nestFlood!;
  let monotone = true;
  for (let i = 1; i < st.q.length; i++) if (fc.depth[st.q[i]] > fc.depth[st.q[i - 1]]) monotone = false;
  const g = w.nest(1)!;
  const tops = g.flowerEdges(0).top;
  const lastTop = st.q.slice(-tops.length).every((q) => tops.includes(q));
  check('the water pools deepest first (its depth along the tunnels never rises) and the entrance top goes last', monotone && lastTop && fc.depth[st.q[0]] === Math.max(...st.q.map((q) => fc.depth[q])), `${st.q.length} hexes, depth ${fc.depth[st.q[0]]} → 0`);
  check('every dug hex is under water and the mask agrees', Array.from({ length: g.cols * g.rows }, (_, q) => q).every((q) => !g.isHexDug(q) || isHexFlooded(w, 1, q)));
}

// ---------------------------------------------------------------- 2. the same seed floods in the same order
{
  const B = make();
  run(B, 30);
  startNestFlood(B.w, 1, { fillSec: 30 });
  run(B, 30.2);
  const a = A.w.colony(1)!.nestFlood!;
  const b = B.w.colony(1)!.nestFlood!;
  check('the same seed floods the same hexes in the same order at the same times', a.q.join() === b.q.join() && a.at.join() === b.at.join(), `${a.q.length} hexes`);
}

// ---------------------------------------------------------------- 3. the queen drowns: the colony is lost
{
  const w = A.w;
  const c = w.colony(1)!;
  const qa = w.antById.get(c.queen)!;
  const g = w.nest(1)!;
  const st = c.nestFlood!;
  const i = st.q.indexOf(g.hexAt(qa.x, qa.y));
  const under = st.at[i];
  run(A, 25);
  const d = A.deaths.get(qa.id);
  const want = NEST_FLOOD.breathS + 1 / NEST_FLOOD.drownFrac;
  check('the queen drowns breathS + 1 / drownFrac after her hex goes under', !!d && d.cause === HIT.DROWN && Math.abs(d.t - under - want) < 0.3, d ? `${(d.t - under).toFixed(2)} s (want ${want})` : 'alive');
  check('…and her colony is lost (the usual rule)', !c.alive && A.lost.some((l) => l.colony === 1));
  const home = w.s.ants.filter((a) => a.colony === 1 && a.space === nestSpace(1) && a.state !== AS.Dead).length;
  check('a full nest drowns everything left inside', home === 0 && !w.s.brood.some((b) => b.colony === 1), `${home} ants still alive inside`);
  // the colony next door is untouched
  const p = w.colony(0)!;
  const pg = w.nest(0)!;
  const capBefore = p.foodCap;
  recomputeTileCaps(p);
  check('a colony whose nest is not flooding is untouched (no flood state, no wet hex, no ant short of breath, stores as they were)', !p.nestFlood && nestFloodFraction(w, 0) === 0 && Array.from({ length: pg.cols * pg.rows }, (_, q) => q).every((q) => !isHexFlooded(w, 0, q)) && !w.s.ants.some((a) => a.colony === 0 && (a.uw !== undefined || a.fl)) && p.foodCap === capBefore);
}

// ---------------------------------------------------------------- 4. drowning: breath, then health; breath comes back
{
  const C = make();
  run(C, 30);
  const w = C.w;
  const c = w.colony(1)!;
  const g = w.nest(1)!;
  startNestFlood(w, 1, { fillSec: 40 });
  run(C, 3);
  const st = c.nestFlood!;
  const deep = g.hexCenter(st.q[0]);
  // a worker held still (stunned) in the deepest water, and one taken out of it after 3 s
  const a = makeAnt(w, 1, 'lasius_worker', nestSpace(1), deep.x, deep.y, 0);
  a.stun = 1e9;
  const b = makeAnt(w, 1, 'lasius_worker', nestSpace(1), deep.x + 0.5, deep.y, 0);
  b.stun = 1e9;
  const born = w.s.time;
  // an egg dropped in the water
  const egg = makeBrood(w, 1, 'lasius_worker', deep.x - 0.5, deep.y, -1);
  run(C, 3);
  const hpB = b.hp;
  const uwB = b.uw ?? 0;
  const top = g.hexCenter(g.flowerEdges(0).top[0]);
  b.x = top.x;
  b.y = top.y;
  run(C, 1);
  const uw1 = b.uw ?? 0;
  run(C, 1);
  check(`out of the water an ant gets its breath back ${NEST_FLOOD.breathBack}× as fast (and lost no health inside breathS)`, hpB === b.maxHp && Math.abs(uwB - 3) < 0.06 && Math.abs(uw1 - (uwB - NEST_FLOOD.breathBack)) < 0.11 && b.uw === undefined, `breath used ${uwB.toFixed(2)} s, ${uw1.toFixed(2)} s a second later, then none`);
  run(C, 4.5);
  const eggAlive = w.broodById.has(egg.id);
  run(C, 1);
  check('an egg under water is dead after breathS + broodS', eggAlive && !w.broodById.has(egg.id));
  run(C, 7.5);
  const d = C.deaths.get(a.id);
  const want = NEST_FLOOD.breathS + 1 / NEST_FLOOD.drownFrac;
  check(`an ant in a flooded hex drowns after breathS + its health ÷ the rate (${want} s from full health)`, !!d && d.cause === HIT.DROWN && Math.abs(d.t - born - want) < 0.2, d ? `${(d.t - born).toFixed(2)} s` : 'alive');
  // swimming: the same ant on the same spot, with and without the water
  const s1 = makeAnt(w, 0, 'lasius_worker', nestSpace(1), deep.x, deep.y, 0);
  const vWet = antSpeed(w, s1);
  const saved = c.nestFlood;
  delete c.nestFlood;
  const vDry = antSpeed(w, s1);
  c.nestFlood = saved;
  check('ants swim at swimMul of their speed in the water', Math.abs(vWet / vDry - NEST_FLOOD.swimMul) < 1e-9, `${vDry.toFixed(1)} → ${vWet.toFixed(1)} mm/s`);
  killAnt(w, s1);

  // ---------------------------------------------------------------- 5. tiles under water stop working
  const wetTiles = c.tiles.filter((t) => isHexFlooded(w, 1, t.q));
  const jobs = listJobs(w, c);
  const fc = floodCache(w, c)!;
  check('no nest job under the water or within keepAbove of it (dig, build, eggs)', jobs.every((j) => !isHexFlooded(w, 1, j.q) && !(fc.depth[j.q] >= fc.top - NEST_FLOOD.keepAbove)), `${jobs.length} jobs, ${wetTiles.length} tiles under`);
  const wetDug = st.q.find((q) => g.isHexDug(q) && !c.tiles.some((t) => t.q === q) && !g.isEntrance(q));
  check('no tile can be placed under water', wetDug !== undefined && canPlaceTile(w, c, 'food', wetDug) === 'This ground is under water');
  // a larva on a brood tile under water does not grow
  let tile = wetTiles.find((t) => raisesAnts(t) && t.built);
  let grew = -1;
  if (tile) {
    let b2 = tile.brood ? w.broodById.get(tile.brood) : undefined;
    if (!b2) {
      const p = g.hexCenter(tile.q);
      b2 = makeBrood(w, 1, tile.caste!, p.x, p.y, tile.q);
      b2.stage = 1;
      tile.brood = b2.id;
    }
    const before = b2.t;
    // (an egg-free moment: the larva's growth is all that could change it)
    for (let i = 0; i < 20; i++) {
      w.step(0.05);
      C.ev.drain();
    }
    grew = w.broodById.has(b2.id) ? b2.t - before : 0;
  }
  check('a larva on a brood tile under water does not grow', !!tile && grew === 0);
  // stores under water hold nothing: the cap is what the dry stores and queen tiles hold
  let cap = 0;
  for (const t of c.tiles) if (t.built && !isHexFlooded(w, 1, t.q)) cap += t.type === 'queen' ? BALANCE.queenTileFood : t.type === 'food' ? BALANCE.storage[t.level - 1] : 0;
  recomputeTileCaps(c);
  check('stores (and the queen tiles) under water hold nothing: the food cap is the dry stores’ and the food is cut to it', c.foodCap === cap && c.food <= c.foodCap + 1e-9, `cap ${c.foodCap}`);
  // no digging from the water: a soil hex whose dug neighbours are all under water
  let soil = -1;
  for (let q = 0; q < g.cols * g.rows && soil < 0; q++) {
    if (!g.isHexDiggable(q) || g.hexProgress(q) > 0) continue;
    const nb = g.neighbors(q).filter((n) => n >= 0 && g.isHexDug(n));
    if (nb.length && nb.every((n) => isHexFlooded(w, 1, n))) soil = q;
  }
  designateDig(w, c, soil, true);
  check('no hex is dug from the water', soil >= 0 && !listJobs(w, c).some((j) => j.q === soil));
}

// ---------------------------------------------------------------- 6. a save mid-flood plays on the same
{
  const D = make();
  run(D, 30);
  startNestFlood(D.w, 1);
  run(D, 14);
  const bytes = encodeState(D.w);
  const ev2 = new EventBus();
  const R = restoreWorld(bytes, ev2);
  check('a snapshot mid-flood restores to the same state', hashState(R) === hashState(D.w));
  for (let i = 0; i < 30 * 20; i++) {
    D.w.step(0.05);
    D.ev.drain();
    R.step(0.05);
    ev2.drain();
  }
  check('…and plays on to the same result (hashes equal 30 s later)', hashState(R) === hashState(D.w) && R.colony(1)!.nestFlood!.q.join() === D.w.colony(1)!.nestFlood!.q.join(), `${D.w.colony(1)!.nestFlood!.q.length} hexes under`);
  // a save from before nest floods existed (no `nestFlood`, no `uw`): loads and runs
  const E = make();
  run(E, 5);
  const old = restoreWorld(encodeState(E.w), new EventBus());
  for (let i = 0; i < 100; i++) old.step(0.05);
  check('a save without any flood state loads and runs', !old.s.colonies.some((c) => c.nestFlood) && old.s.tick === E.w.s.tick + 100);
}

// ---------------------------------------------------------------- 7. the colony climbs ahead of the water with its brood
{
  const F = make();
  run(F, 60);
  const w = F.w;
  startNestFlood(w, 1);
  let fled = 0;
  let carried = 0;
  for (let s = 0; s < 30; s++) {
    run(F, 1);
    for (const a of w.s.ants) {
      if (a.colony !== 1 || a.state === AS.Dead || a.space !== nestSpace(1)) continue;
      if (a.fl) fled++;
      if (a.fl && a.carry === Carry.Brood) carried++;
    }
  }
  const c = w.colony(1)!;
  const g = w.nest(1)!;
  const fc = floodCache(w, c)!;
  // those at home above the water are on the high side (none of them on a hex within keepAbove of it, but those climbing)
  const atHome = w.s.ants.filter((a) => a.colony === 1 && a.state !== AS.Dead && a.space === nestSpace(1) && a.fl && a.marker < 0 && a.id !== c.queen);
  const high = atHome.filter((a) => {
    const q = g.hexAt(a.x, a.y);
    return q >= 0 && fc.depth[q] <= fc.top;
  });
  check('the colony’s ants at home climb toward the entrance ahead of the water', fled > 0 && high.length >= atHome.length * 0.8, `${high.length}/${atHome.length} above the waterline (depth ${fc.top})`);
  check('workers carry brood up out of the water’s way', carried > 0, `${carried} ant-seconds carrying brood`);
}

// ---------------------------------------------------------------- 8. all-out: everything at the target's queen, no retreat
const allOutSetup: GameSetup = {
  ...SETUP,
  seed: 23,
  colonies: [
    { species: 'lasius', player: true, ai: false, developed: 4, startWorkers: 8 },
    {
      species: 'lasius',
      player: false,
      ai: true,
      startWorkers: 10,
      developPlan: [
        { type: 'brood', caste: 'lasius_worker', n: 10 },
        { type: 'brood', caste: 'lasius_soldier', n: 12 },
        { type: 'food', n: 4 },
      ],
    },
  ],
};
{
  const G = make(allOutSetup);
  run(G, 20);
  const w = G.w;
  const c = w.colony(1)!;
  const p = w.colony(0)!;
  const pq = w.antById.get(p.queen)!;
  forceAllOut(w, 1, 0);
  const b = c.aiWar!;
  const m = c.markers[2];
  const queenGroups = c.groups.filter((g) => g.type === 'queen');
  const others = c.groups.filter((g) => raisesAnts(g) && g.type !== 'queen');
  check('forceAllOut: the state shows it (aiWar.allOut, target)', b.allOut === true && b.target === 0);
  check('…marker III on the target queen, nothing carried home from it, the forage marker lifted', m.placed && m.space === pq.space && Math.hypot(m.x - pq.x, m.y - pq.y) < 1 && !!m.noGather && !c.markers[0].placed);
  check('…every group but the queen’s own goes (her nurses stay with her)', others.length > 0 && others.every((g) => g.marker === 2) && queenGroups.every((g) => g.marker < 0), `${others.length} groups out, ${queenGroups.length} home`);
  run(G, 30);
  const fightersNow = w.s.ants.filter((a) => a.colony === 1 && a.state !== AS.Dead && fighter(a.caste));
  for (const a of fightersNow.slice(0, Math.ceil(fightersNow.length * 0.8))) killAnt(w, a);
  run(G, 12);
  check('…and they do not retreat: 80 % of the fighters dead, still all-out on the queen, the groups still out', b.allOut === true && b.target === 0 && c.groups.filter((g) => raisesAnts(g) && g.type !== 'queen').every((g) => g.marker === 2), `${fightersNow.length} fighters before`);
  let inside = 0;
  let firstIn = -1;
  for (let s = 0; s < 240 && pq.state !== AS.Dead; s += 2) {
    run(G, 2);
    const n = w.s.ants.filter((a) => a.colony === 1 && a.state !== AS.Dead && a.space === nestSpace(0)).length;
    if (n && firstIn < 0) firstIn = w.s.time;
    inside = Math.max(inside, n);
  }
  check('…they march into the target’s nest at its queen', inside > 0, `up to ${inside} inside, first at ${firstIn.toFixed(0)} s; target queen ${pq.state === AS.Dead ? 'dead' : `${pq.hp.toFixed(0)} hp`}`);
  if (pq.state === AS.Dead) {
    run(G, 6);
    check('…until she is dead: then the all-out ends', !b.allOut && b.target === -1);
  }
}

// ---------------------------------------------------------------- 9. a skirmish without it: as before
{
  // a normal raid still calls it off when it has lost too many (retreatAt)
  const H = make(allOutSetup);
  run(H, 20);
  const w = H.w;
  const c = w.colony(1)!;
  const p = w.colony(0)!;
  const pq = w.antById.get(p.queen)!;
  const b = warBrain(c);
  const n = w.s.ants.filter((a) => a.colony === 1 && a.state !== AS.Dead && fighter(a.caste)).length;
  b.target = p.id;
  b.start = n;
  b.age = 0;
  b.t = 0;
  placeMarker(w, c, 2, pq.space, pq.x, pq.y);
  run(H, 6);
  const out = c.groups.filter((g) => raisesAnts(g) && g.type !== 'queen' && g.marker === 2).every((g) => g.caste && fighter(g.caste));
  const fs = w.s.ants.filter((a) => a.colony === 1 && a.state !== AS.Dead && fighter(a.caste));
  for (const a of fs.slice(0, Math.ceil(fs.length * 0.8))) killAnt(w, a);
  run(H, 10);
  check('a skirmish raid sends only the fighters and calls it off after heavy losses (unchanged)', out && b.target === -1 && !b.allOut);

  // four AI colonies for four minutes: nothing floods, nobody goes all-out, and the flood system changes nothing
  const setup: GameSetup = {
    seed: 777,
    style: 'meadow',
    width: 720,
    depth: 720,
    colonies: [
      { species: 'lasius', player: true, ai: true, developed: 6, startWorkers: 14 },
      { species: 'lasius', player: false, ai: true, developed: 6, startWorkers: 14 },
      { species: 'formica', player: false, ai: true, developed: 6, startWorkers: 14 },
      { species: 'solenopsis', player: false, ai: true, developed: 6, startWorkers: 14 },
    ],
    food: 1.2,
    settings: { creatures: 1, aggression: 2 },
  };
  const with_ = createWorld(setup, new EventBus());
  const without = createWorld(setup, new EventBus());
  without.systems = without.systems.filter((s) => s.name !== 'nestFlood');
  for (let i = 0; i < 4 * 60 * 20; i++) {
    with_.step(0.05);
    without.step(0.05);
  }
  check('a skirmish never floods or goes all-out, and the flood system leaves it exactly as it was', !with_.s.colonies.some((c) => c.nestFlood || c.aiWar?.allOut) && hashState(with_) === hashState(without) && !with_.s.ants.some((a) => a.uw !== undefined || a.fl), hashState(with_));
  void SURFACE;
}

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (failed) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
