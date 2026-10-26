import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE, nestSpace } from '../src/sim/types';
import { designateDig } from '../src/sim/colony';
import { applyLevel, casteCosts, canPlaceTile, canUpgrade, completeDelete, completeUpgrade, groupCounts, markDelete, markUpgrade, placeTile, QUEEN_TILES, removeTile, tileAnts, tileAt, upgradePoints } from '../src/sim/tiles';
import { BALANCE, ENTRANCE } from '../src/sim/balance';
import { canEnter, passEntrance } from '../src/sim/entrances';
import { JOB, assignJobs, listJobs } from '../src/sim/jobs';
import { antSpeed, nearestEntrance } from '../src/sim/movement';
import { updateFlowCosts } from '../src/sim/colony';
import { assignGroup, placeMarker, removeMarker, markerCounts } from '../src/sim/markers';
import { killAnt } from '../src/sim/antAI';
import { makeAnt } from '../src/sim/factory';
import { damageAnt } from '../src/sim/combat';
import { CASTES, SPECIES, casteOf } from '../src/sim/species';
import { World } from '../src/sim/world';
import { areaOpen, areasFor, hasRouteHome } from '../src/sim/areas';
import { DET_SETUP, runDeterminism, scriptedOrders } from '../src/dev/determinism';
import { FrameBuilder } from '../src/worker/frames';
import { Replica } from '../src/game/replica';
import { Command, CommandBody, CommandSchedule, applyCommand, applyCommandsNow, decodeCommandLog, decodeTickPacket, encodeCommandLog, encodeTickPacket, quantize, stepWithCommands } from '../src/sim/commands';
import { encodeState, fnv1a64, hashState, restoreWorld } from '../src/sim/snapshot';
import { datan2, dcos, dexp, dpow, dsin } from '../src/sim/dmath';
import { CreatureRenderer } from '../src/render/creatures/creatureRenderer';
import { CombatFx } from '../src/render/game/combatFx';
import { BUILDERS } from '../src/render/creatures/builders';
import { CREATURES } from '../src/sim/creatures/kinds';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import type { Creature } from '../src/sim/types';
import { broodWarmth } from '../src/sim/brood';
import { nestToSurface } from '../src/sim/colony';
import { MISSIONS, missionOf, rivalsMayRaid } from '../src/sim/missions';
import { decodeSave, encodeSave, listSaves, putSave, readSaveHeader, SaveHeader } from '../src/game/saves';
import { bindingChanges, bindingsOf, keyLabel, medalFor, profile, rebind, recordMedal, resetCache, sanitizeSettings, settings, updateSettings } from '../src/game/profile';
import { DEFAULT_BINDINGS } from '../src/core/input';
import { decodeReplay, encodeReplay } from '../src/game/replay';

/** Headless simulation tests: run with `npm test`. */
let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}

function run(w: World, seconds: number): void {
  const n = Math.round(seconds * 20);
  for (let i = 0; i < n; i++) w.step(0.05);
}

function summary(w: World, cid: number): string {
  const c = w.colony(cid)!;
  const ants = w.s.ants.filter((a) => a.colony === cid && a.state !== AS.Dead);
  const tasks: Record<string, number> = {};
  for (const a of ants) tasks[a.task] = (tasks[a.task] ?? 0) + 1;
  return `t=${w.s.time.toFixed(0)}s ants=${ants.length} brood=${w.s.brood.filter((b) => b.colony === cid).length} food=${c.food.toFixed(1)}/${c.foodCap} pop=${c.pop}/${c.popLimit} collected=${c.stats.food.toFixed(0)} tasks=${JSON.stringify(tasks)}`;
}

/** Free dug hexes next to the existing floor (nearest the queen first). */
function freeDugHexes(w: World, cid: number): number[] {
  const c = w.colony(cid)!;
  const g = w.nest(cid)!;
  const q0 = c.tiles.find((t) => t.type === 'queen')!.q;
  const out: number[] = [];
  for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q) && !g.isEntrance(q) && !tileAt(c, q)) out.push(q);
  return out.sort((a, b) => g.hexDistance(a, q0) - g.hexDistance(b, q0));
}

const t0 = Date.now();

// ---------------------------------------------------------------- founding + tiles
{
  const w = createWorld({ seed: 7, style: 'meadow', width: 600, depth: 600, colonies: [{ species: 'lasius', player: true, ai: false }], food: 1.2 }, new EventBus());
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const queenT = c.tiles.filter((t) => t.type === 'queen');
  const q0 = queenT[0].q;
  check("founding: the queen's chamber is 7 tiles (her hex + the ring around it)", queenT.length === QUEEN_TILES && queenT.slice(1).every((t) => g.hexDistance(t.q, q0) === 1));
  check('founding: queen tiles raise nanitics', queenT.every((t) => t.caste === 'lasius_nanitic'));
  check('founding: the colony starts with the queen and 3 workers', c.living === 3 && w.s.ants.filter((a) => a.colony === 0 && a.caste === 'lasius_nanitic').length === 3, `${c.living} workers`);
  check('founding: 7 queen tiles hold 70 food', c.foodCap === QUEEN_TILES * BALANCE.queenTileFood, `cap ${c.foodCap}`);
  check("founding: the chamber is one commandable group", new Set(queenT.map((t) => t.group)).size === 1);
  check("chamber tiles cannot be built", !!canPlaceTile(w, c, 'queen', q0));
  check("chamber tiles cannot be removed or upgraded", !!markDelete(w, c, queenT[3].q) && !!canUpgrade(w, c, queenT[3]));
  check('hex radius scaled to the species', Math.abs(g.R - 6) < 0.01, `R=${g.R}`);

  // placement rules
  const undug = (() => {
    for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDiggable(q)) return q;
    return -1;
  })();
  check('cannot place on undug soil', !!canPlaceTile(w, c, 'food', undug), canPlaceTile(w, c, 'food', undug) ?? '');
  check('cannot place on the entrance ramp', !!canPlaceTile(w, c, 'food', c.entrances[0].q));
  c.food = 500;
  // merge: a worker brood tile next to another joins its group
  const seedQ = freeDugHexes(w, 0)[0];
  const t0 = placeTile(w, c, 'brood', seedQ, 'lasius_worker', true)!;
  const grp0 = t0.group;
  const brood = [t0];
  const adj = freeDugHexes(w, 0).find((q) => g.neighbors(q).includes(seedQ));
  const t1 = adj !== undefined ? placeTile(w, c, 'brood', adj, 'lasius_worker', true) : null;
  check('adjacent same-caste tile merges into the group', !!t1 && t1.group === t0.group, `${t1?.group} vs ${t0.group} (was ${grp0}) adj ${adj}`);
  check('brood tile next to the chamber does not merge with it', t0.group !== tileAt(c, q0)!.group);
  // a different type next to it does not merge
  const adj2 = freeDugHexes(w, 0).find((q) => g.neighbors(q).some((n) => tileAt(c, n)?.group === grp0));
  const tf = adj2 !== undefined ? placeTile(w, c, 'food', adj2, undefined, true) : null;
  check('different tile type forms its own group', !!tf && tf.group !== grp0);
  // split: build a line of three in fresh ground, remove the middle
  for (let q = 0; q < g.cols * g.rows; q++) if (g.hexDistance(q, q0) >= 4 && g.hexDistance(q, q0) <= 5) g.completeHex(q);
  const ring = freeDugHexes(w, 0).filter((q) => g.hexDistance(q, q0) >= 4);
  let line: number[] = [];
  for (const a of ring) {
    const b = g.neighbors(a).find((n) => ring.includes(n));
    if (b === undefined) continue;
    const cc = g.neighbors(b).find((n) => ring.includes(n) && n !== a && !g.neighbors(a).includes(n));
    if (cc !== undefined) {
      line = [a, b, cc];
      break;
    }
  }
  for (const q of line) placeTile(w, c, 'food', q, undefined, true);
  const gidLine = tileAt(c, line[0])?.group;
  check('line of 3 is one group', line.length === 3 && line.every((q) => tileAt(c, q)?.group === gidLine));
  completeDelete(w, c, tileAt(c, line[1])!);
  check('removing the middle splits the group', tileAt(c, line[0])!.group !== tileAt(c, line[2])!.group);
  check('one half keeps the old group id', [tileAt(c, line[0])!.group, tileAt(c, line[2])!.group].includes(gidLine!));
  // pop limit
  c.pop = c.tiles.filter((t) => t.type === 'brood' || t.type === 'queen').length;
  c.popLimit = c.pop;
  const spot = freeDugHexes(w, 0)[0];
  check('population limit blocks brood tiles', !!canPlaceTile(w, c, 'brood', spot, 'lasius_worker'), canPlaceTile(w, c, 'brood', spot, 'lasius_worker') ?? '');
}

// ---------------------------------------------------------------- Revision 2: jobs, spawning, upgrades, highways
/** A clean world with one Lasius colony (no surface food), for nest-rule tests. */
function nestWorld(seed = 21): World {
  return createWorld({ seed, style: 'meadow', width: 500, depth: 500, colonies: [{ species: 'lasius', player: true, ai: false }], food: 0 }, new EventBus());
}
/** Dig every hex within r of hex qc (plus a corridor is not needed for point maths). */
function digDisc(w: World, cid: number, qc: number, r: number): number[] {
  const g = w.nest(cid)!;
  const out: number[] = [];
  for (let q = 0; q < g.cols * g.rows; q++) if (g.hexDistance(q, qc) <= r) {
    g.softenHex(q);
    g.completeHex(q);
    out.push(q);
  }
  return out;
}
{
  // pre-staging: a larva on a tile whose ant lives waits at 50 %; when the ant dies it resumes
  const w = nestWorld();
  const c = w.colony(0)!;
  c.food = 70;
  c.infiniteFood = true;
  const q = freeDugHexes(w, 0)[0];
  const t = placeTile(w, c, 'brood', q, 'lasius_worker', true)!;
  let firstAnt = 0;
  let tFirst = 0;
  for (let i = 0; i < 120 * 20 && !firstAnt; i++) {
    w.step(0.05);
    if (t.ant) {
      firstAnt = t.ant;
      tFirst = i / 20;
    }
  }
  check('a new brood tile gets an egg and hatches its ant', !!firstAnt, `after ${tFirst.toFixed(0)} s`);
  run(w, 40);
  const b = t.brood ? w.broodById.get(t.brood) : undefined;
  check('a new egg is pre-staged and waits at 50 %', !!b && b.stage === 1 && Math.abs(b.t - BALANCE.prestage) < 0.02, b ? `larva at ${(b.t * 100).toFixed(0)} %` : 'no larva');
  killAnt(w, w.antById.get(firstAnt)!);
  let tRe = -1;
  for (let i = 0; i < 60 * 20 && tRe < 0; i++) {
    w.step(0.05);
    if (t.ant && t.ant !== firstAnt) tRe = i / 20;
  }
  const grow = BALANCE.tiers.worker.grow;
  check('the paused larva resumes: the replacement comes faster than a fresh spawn', tRe > 0 && tRe < grow * 0.6 && tRe < tFirst, `replacement in ${tRe.toFixed(1)} s vs fresh ${tFirst.toFixed(1)} s (grow ${grow} s)`);
}
{
  // larvae grow only while there is food
  const w = nestWorld();
  const c = w.colony(0)!;
  const q = freeDugHexes(w, 0)[0];
  const t = placeTile(w, c, 'brood', q, 'lasius_worker', true)!;
  c.food = 30;
  for (let i = 0; i < 60 * 20 && !(t.brood && w.broodById.get(t.brood)?.stage === 1); i++) w.step(0.05);
  const b = w.broodById.get(t.brood)!;
  run(w, 3);
  const grew = b ? b.t : 0;
  c.food = 0;
  const t0b = b ? b.t : 0;
  run(w, 10);
  check('growth pauses when the stores are empty (colony starving)', !!b && grew > 0.05 && Math.abs(b.t - t0b) < 1e-6 && c.starving, `grew to ${(t0b * 100).toFixed(0)} %, then ${b ? (b.t * 100).toFixed(0) : '?'} % after 10 s without food`);
}
{
  // job priority dig → build → spawn, and worker limits
  const w = nestWorld();
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const workers = w.s.ants.filter((a) => a.colony === 0 && a.id !== c.queen);
  for (let i = 0; i < 5; i++) {
    const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), workers[0].x, workers[0].y, 0);
    a.task = 'idle';
  }
  w.reindex();
  const frontier = (() => {
    for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDiggable(q) && g.neighbors(q).some((n) => n >= 0 && g.isHexDug(n)) && g.spotIndex(q) < 0) return q;
    return -1;
  })();
  g.designateHex(frontier, true);
  const planned = placeTile(w, c, 'food', freeDugHexes(w, 0)[0])!;
  for (const a of w.s.ants) if (a.colony === 0 && a.id !== c.queen) {
    a.task = 'idle';
    a.jobK = 0;
  }
  assignJobs(w, c);
  const by = (k: number) => w.s.ants.filter((a) => a.colony === 0 && a.task === 'job' && a.jobK === k).length;
  check('job priority: dig first (max 2 per hex), then build (1), then spawn', by(JOB.Dig) === 2 && by(JOB.Build) === 1, `dig ${by(JOB.Dig)}, build ${by(JOB.Build)}, spawn ${by(JOB.Spawn)}`);
  check('planned tile is a ghost until built; food is paid on completion', !planned.built);
  const f0 = c.food;
  run(w, 15);
  check('a worker builds the planned tile and pays for it', planned.built && c.food < f0 + 1, `food ${f0.toFixed(0)} → ${c.food.toFixed(0)}`);
  check('workers dig the marked hex (6 points)', g.isHexDug(frontier));
}
{
  // a worker on a job ignores enemies
  const w = createWorld({ seed: 4, style: 'meadow', width: 500, depth: 500, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: false }], food: 0 }, new EventBus());
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  let target = -1;
  for (let q = 0; q < g.cols * g.rows && target < 0; q++) if (g.isHexDiggable(q) && g.neighbors(q).some((n) => n >= 0 && g.isHexDug(n)) && g.spotIndex(q) < 0) target = q;
  // a big designation so the job lasts
  g.designateHex(target, true);
  run(w, 2);
  const digger = w.s.ants.find((a) => a.colony === 0 && a.task === 'job' && a.jobK === JOB.Dig)!;
  run(w, 0.5);
  const foe = makeAnt(w, 1, 'formica_worker', nestSpace(0), digger.x + 3, digger.y, 0);
  foe.task = 'idle';
  foe.stun = 99; // a harmless intruder standing next to it
  w.reindex();
  let fought = false;
  for (let i = 0; i < 40; i++) {
    w.step(0.05);
    if (digger.state === AS.Attack || digger.state === AS.Grapple) fought = true;
  }
  check('a worker on a nest job ignores enemies', !fought && (digger.task === 'job' || g.isHexDug(target)));
}
{
  // movement: built tiles slow ants, highways speed them up; weighted paths prefer highways
  const w = nestWorld();
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const free = freeDugHexes(w, 0);
  const tq = free[0];
  const hq = free.find((q) => g.hexDistance(q, tq) >= 2)!;
  placeTile(w, c, 'food', tq, undefined, true);
  placeTile(w, c, 'highway', hq, undefined, true);
  const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), 0, 0, 0);
  const at = (q: number) => {
    const p = g.hexCenter(q);
    a.x = p.x;
    a.y = p.y;
    return antSpeed(w, a);
  };
  const floorQ = free.find((q) => q !== tq && q !== hq && g.hexDistance(q, tq) >= 1 && g.hexDistance(q, hq) >= 1)!;
  const vf = at(floorQ);
  const vt = at(tq);
  const vh = at(hq);
  check('ants move 35 % slower on built tiles and faster on highways', Math.abs(vt / vf - 0.65) < 0.01 && Math.abs(vh / vf - 1.1) < 0.01, `floor ${vf.toFixed(1)}, tile ${vt.toFixed(1)}, highway ${vh.toFixed(1)} mm/s`);
  updateFlowCosts(w, c);
  const flow = w.flow(0)!;
  const cellOf = (q: number) => {
    const p = g.hexCenter(q);
    return Math.floor(p.y / g.cell) * g.w + Math.floor(p.x / g.cell);
  };
  const d = flow.field('test', () => [cellOf(floorQ)]);
  const viaTile = d[cellOf(tq)] / Math.hypot(g.hexCenter(tq).x - g.hexCenter(floorQ).x, g.hexCenter(tq).y - g.hexCenter(floorQ).y);
  const viaHw = d[cellOf(hq)] / Math.hypot(g.hexCenter(hq).x - g.hexCenter(floorQ).x, g.hexCenter(hq).y - g.hexCenter(floorQ).y);
  check('weighted nest paths: crossing a highway is cheaper than crossing a tile', viaHw < viaTile, `cost per mm: highway ${viaHw.toFixed(3)}, tile ${viaTile.toFixed(3)}`);
}
{
  // upgrade points: a 19-hex chamber can be taken entirely to level 3; a 7-hex chamber's edge cannot
  const w = nestWorld(33);
  const c = w.colony(0)!;
  c.infiniteFood = true;
  const g = w.nest(0)!;
  const q0 = c.tiles.find((t) => t.type === 'queen')!.q;
  const far = (min: number, avoid: number[]) => {
    for (let q = 0; q < g.cols * g.rows; q++) if (g.hexDistance(q, q0) >= min && g.hexCol(q) > 3 && g.hexCol(q) < g.cols - 4 && g.hexRow(q) > 3 && g.hexRow(q) < g.rows - 4 && avoid.every((a) => g.hexDistance(a, q) > 7) && !g.spots.some((sp) => sp.some((sh) => g.hexDistance(sh, q) <= 3))) return q;
    return -1;
  };
  const upgradeAll = (tiles: ReturnType<typeof placeTile>[]) => {
    for (let pass = 0; pass < 20; pass++) {
      let changed = false;
      for (const t of tiles) if (t && !canUpgrade(w, c, t)) {
        completeUpgrade(w, c, t);
        changed = true;
      }
      if (!changed) break;
    }
  };
  const c19 = far(9, []);
  const hex19 = digDisc(w, 0, c19, 2);
  const t19 = hex19.map((q) => placeTile(w, c, 'brood', q, 'lasius_worker', true));
  const pts = t19.map((t) => upgradePoints(w, c, t!));
  check('19-hex chamber: every tile has at least 6 points at level 1', pts.every((p) => p >= 6), `min ${Math.min(...pts)}`);
  upgradeAll(t19);
  check('a 19-hex chamber can be upgraded entirely to level 3', t19.every((t) => t!.level === 3), `levels ${t19.map((t) => t!.level).join('')}`);
  const c7 = far(9, [c19]);
  const hex7 = digDisc(w, 0, c7, 1);
  const t7 = hex7.map((q) => placeTile(w, c, 'brood', q, 'lasius_worker', true));
  upgradeAll(t7);
  const centre7 = t7.find((t) => t!.q === c7)!;
  const edge7 = t7.filter((t) => t!.q !== c7);
  check("a 7-hex chamber's centre reaches level 3 but its edge tiles cannot", centre7.level === 3 && edge7.every((t) => t!.level === 2), `centre ${centre7.level}, edges ${edge7.map((t) => t!.level).join('')}`);
  check('short of points: the EotU message', (canUpgrade(w, c, edge7[0]!) ?? '').includes('done all they can'));
  // upgraded ants heal and gain stats; storage capacity grows
  const tb = t19[0]!;
  const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), g.hexCenter(tb.q).x, g.hexCenter(tb.q).y, 0);
  a.tile = tb.q;
  tb.ant = a.id;
  a.level = 3;
  a.hp = 2;
  completeDelete(w, c, tb); // 3 → 2: healed
  check('downgrading heals the ant and lowers its stats', tb.level === 2 && a.hp === a.maxHp && Math.abs(a.maxHp - casteOf('lasius_worker').hp * BALANCE.levelHp[1]) < 1e-6, `hp ${a.hp.toFixed(1)}/${a.maxHp.toFixed(1)}`);
  a.hp = 2;
  completeUpgrade(w, c, tb);
  check('upgrading heals the ant and raises its stats', tb.level === 3 && a.hp === a.maxHp && a.maxHp > casteOf('lasius_worker').hp * 1.4 && a.power > 1.3, `hp ${a.maxHp.toFixed(1)}, damage ×${a.power}`);
  const cap0 = c.foodCap;
  const st = placeTile(w, c, 'food', freeDugHexes(w, 0)[0], undefined, true)!;
  const cap1 = c.foodCap;
  st.level = 3;
  completeDelete(w, c, st); // to level 2
  check('food storage holds 10 / 40 at levels 1 / 2', cap1 - cap0 === 10 && c.foodCap - cap0 === 40, `+${cap1 - cap0}, +${c.foodCap - cap0}`);
}
{
  // delete: downgrade first, then remove (ant dies, larva dropped), refunding two-thirds as seeds
  const w = nestWorld(8);
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const q = freeDugHexes(w, 0)[0];
  const t = placeTile(w, c, 'brood', q, 'lasius_worker', true)!;
  t.level = 2;
  const a = makeAnt(w, 0, 'lasius_worker', nestSpace(0), g.hexCenter(q).x, g.hexCenter(q).y, 0);
  a.tile = q;
  t.ant = a.id;
  w.reindex();
  const seeds = () => w.s.food.filter((f) => f.kind === 'seed' && f.space === nestSpace(0)).reduce((s2, f) => s2 + f.amount, 0);
  check('delete tool marks a job', markDelete(w, c, q) === null && t.pend === 2);
  completeDelete(w, c, t);
  check('delete downgrades one level first; the ant lives', t.level === 1 && !!tileAt(c, q) && a.state !== AS.Dead);
  const s1 = seeds();
  completeDelete(w, c, t);
  check('at level 1 the tile is removed and its ant dies', !tileAt(c, q) && a.state === AS.Dead);
  check('each step refunds two-thirds of the build cost as seeds on the floor', Math.abs(seeds() - 2 * BALANCE.tiers.worker.build * BALANCE.refund) < 0.01 && Math.abs(s1 - BALANCE.tiers.worker.build * BALANCE.refund) < 0.01, `${seeds().toFixed(2)} food in seeds`);
  run(w, 40);
  check('workers carry the refunded seeds back to storage', seeds() < 0.5, `${seeds().toFixed(1)} left on the floor`);
}
{
  // failsafe: no workers and no food → one free nanitic
  const w = nestWorld(9);
  const c = w.colony(0)!;
  for (const a of w.s.ants) if (a.colony === 0 && a.id !== c.queen) killAnt(w, a);
  c.food = 0;
  run(w, 3);
  check('failsafe: with no workers and no food a nanitic appears', w.s.ants.some((a) => a.colony === 0 && a.state !== AS.Dead && a.caste === 'lasius_nanitic'), `${c.living} workers`);
}

{
  // job locality: a group at a marker in the nest takes only jobs near its marker; at a surface marker, none
  const w = nestWorld(23);
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const qg = c.groups.find((gr) => gr.type === 'queen')!;
  const frontier: number[] = [];
  for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDiggable(q) && g.neighbors(q).some((n) => n >= 0 && g.isHexDug(n) && !g.isEntrance(n))) frontier.push(q);
  // marker on dug floor next to one frontier hex; the farthest frontier hex is the far job
  const near = frontier[0];
  const nb = g.neighbors(near).find((n) => n >= 0 && g.isHexDug(n) && !g.isEntrance(n))!;
  const mp = g.hexCenter(nb);
  const np = g.hexCenter(near);
  const far = frontier.reduce((best, q) => {
    const p = g.hexCenter(q);
    const bp = g.hexCenter(best);
    return Math.hypot(p.x - np.x, p.y - np.y) > Math.hypot(bp.x - np.x, bp.y - np.y) ? q : best;
  }, near);
  placeMarker(w, c, 0, nestSpace(0), mp.x, mp.y);
  assignGroup(w, c, qg.id, 0);
  designateDig(w, c, near, true);
  designateDig(w, c, far, true);
  run(w, 2);
  const onNear = w.s.ants.filter((a) => a.task === 'job' && a.jobQ === near).length;
  const onFar = w.s.ants.filter((a) => a.task === 'job' && a.jobQ === far).length;
  check('marker-group workers take only jobs near their marker', onNear > 0 && onFar === 0, `near ${onNear}, far ${onFar}`);
  placeMarker(w, c, 0, SURFACE, c.entrances[0].sx + 40, c.entrances[0].sy);
  run(w, 3);
  const jobs = w.s.ants.filter((a) => a.colony === 0 && a.task === 'job').length;
  check('…and none while their marker is out on the surface', jobs === 0, `${jobs} on jobs`);
  assignGroup(w, c, qg.id, -1);
  run(w, 2);
  check('home workers take any job, near or far', w.s.ants.some((a) => a.task === 'job' && a.jobQ === far) || g.isHexDug(far));
}

// ---------------------------------------------------------------- colony life
{
  const w = createWorld({ seed: 7, style: 'meadow', width: 600, depth: 600, colonies: [{ species: 'lasius', player: true, ai: false }], food: 1.2 }, new EventBus());
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  c.popLimit = 60;
  let onSurface = 0;
  for (let i = 0; i < 30 * 20; i++) {
    w.step(0.05);
    onSurface = Math.max(onSurface, w.s.ants.filter((a) => a.space === SURFACE).length);
  }
  console.log(summary(w, 0));
  check('EotU: with no marker placed, home workers stay inside the nest', onSurface === 0, `${onSurface} on surface`);
  // Send the queen's group to a marker on the nearest food: they go out and forage there.
  const e0 = c.entrances[0];
  const near = w.s.food.filter((f) => f.space === SURFACE && f.kind !== 'corpse' && f.kind !== 'wood').sort((a, b) => Math.hypot(a.x - e0.sx, a.y - e0.sy) - Math.hypot(b.x - e0.sx, b.y - e0.sy))[0];
  placeMarker(w, c, 0, SURFACE, near.x, near.y);
  assignGroup(w, c, c.groups.find((gr) => gr.type === 'queen')!.id, 0);
  onSurface = 0;
  for (let i = 0; i < 30 * 20; i++) {
    w.step(0.05);
    onSurface = Math.max(onSurface, w.s.ants.filter((a) => a.space === SURFACE).length);
  }
  check('a group sent to a marker on food goes out to forage', onSurface > 0, `${onSurface} on surface`);
  run(w, 60);
  check('food collected at the marker', c.stats.food > 10, c.stats.food.toFixed(1));
  check('trail pheromone laid', w.phero.trail[0].some((v) => v > 0.2));
  // Bring the group home: home workers do the nest jobs (dig, build, carry eggs).
  assignGroup(w, c, c.groups.find((gr) => gr.type === 'queen')!.id, -1);
  // designate digging around the existing floor
  let marked = 0;
  for (let q = 0; q < g.cols * g.rows && marked < 8; q++) {
    if (!g.isHexDiggable(q)) continue;
    if (g.neighbors(q).some((n) => n >= 0 && g.isHexDug(n) && !g.isEntrance(n))) if (designateDig(w, c, q, true)) marked++;
  }
  const dug0 = g.dugHexCount();
  // new brood tiles on free floor → eggs → carried to tiles → adults
  c.food = Math.max(c.food, 120);
  const free = freeDugHexes(w, 0).slice(0, 5);
  for (const q of free) placeTile(w, c, 'brood', q, 'lasius_worker');
  run(w, 150);
  console.log(summary(w, 0));
  check('hexes dug', g.dugHexCount() >= dug0 + 3, `${dug0} → ${g.dugHexCount()}`);
  run(w, 200);
  console.log(summary(w, 0));
  const filled = free.filter((q) => {
    const t = tileAt(c, q);
    return t && t.ant && w.antById.get(t.ant);
  }).length;
  check('new brood tiles raise their ants', filled >= 3, `${filled}/${free.length}`);
  check('ants hatch bound to their tile', w.s.ants.filter((a) => free.includes(a.tile)).every((a) => tileAt(c, a.tile)!.ant === a.id));
  // replacement after death
  const victimTile = tileAt(c, free[0])!;
  const victim = w.antById.get(victimTile.ant);
  if (victim) killAnt(w, victim);
  run(w, 2);
  check('dead ant frees its tile', victimTile.ant === 0 || victimTile.ant !== victim?.id);
  run(w, 110);
  check('dead ant is replaced', !!victimTile.ant && victimTile.ant !== victim?.id && !!w.antById.get(victimTile.ant), `ant=${victimTile.ant} brood=${victimTile.brood}`);
  check('brood rests on its own tile', w.s.brood.filter((b) => b.colony === 0 && !b.carrier && b.stage > 0).every((b) => g.hexAt(b.x, b.y) === b.tile));
}

// ---------------------------------------------------------------- markers
{
  const w = createWorld({ seed: 3, style: 'meadow', width: 500, depth: 500, colonies: [{ species: 'formica', player: true, ai: false, startWorkers: 10 }], food: 0.6 }, new EventBus());
  const c = w.colony(0)!;
  const grp = c.groups.find((g) => g.type === 'brood')!;
  const e = c.entrances[0];
  const mx = Math.min(460, e.sx + 70);
  const my = e.sy;
  placeMarker(w, c, 0, SURFACE, mx, my);
  assignGroup(w, c, grp.id, 0);
  check('group assigned to marker I', markerCounts(w, c, 0).max === groupCounts(w, c, grp.id).max);
  // Every ant of the group should reach the marker (some then carry food they find there home, as in EotU).
  const reached = new Set<number>();
  for (let i = 0; i < 40 * 20; i++) {
    w.step(0.05);
    for (const a of w.s.ants) if (a.colony === 0 && a.space === SURFACE && Math.hypot(a.x - mx, a.y - my) < 60) reached.add(a.id);
  }
  const ants = w.s.ants.filter((a) => a.colony === 0 && a.tile >= 0 && tileAt(c, a.tile)?.group === grp.id);
  const near = ants.filter((a) => reached.has(a.id)).length;
  check('ants travel to a surface marker', near >= ants.length * 0.8, `${near}/${ants.length} reached the marker within 40 s`);
  // nest marker
  const g = w.nest(0)!;
  const qn = freeDugHexes(w, 0)[0];
  const np = g.hexCenter(qn);
  placeMarker(w, c, 1, nestSpace(0), np.x, np.y);
  assignGroup(w, c, grp.id, 1);
  run(w, 45);
  const inNest = ants.filter((a) => a.space === nestSpace(0) && Math.hypot(a.x - np.x, a.y - np.y) < g.R * 3).length;
  check('dragging the group to marker II redirects it into the nest', inNest >= ants.length * 0.5, `${inNest}/${ants.length}`);
  removeMarker(w, c, 1);
  run(w, 25);
  const home = ants.filter((a) => a.marker === -1 && a.task !== 'marker' && Math.hypot(a.x - np.x, a.y - np.y) > g.R * 1.5).length;
  check('removing the marker releases its ants back to colony work', home >= ants.length * 0.7, `${home}/${ants.length}`);
  check('group stays in its column after marker removal', c.groups.find((x) => x.id === grp.id)!.marker === 1);
}

// ---------------------------------------------------------------- combat
{
  const w = createWorld({ seed: 11, style: 'meadow', width: 400, depth: 400, colonies: [{ species: 'formica', player: true, ai: false, startWorkers: 18 }, { species: 'solenopsis', player: false, ai: false, startWorkers: 26 }], food: 0.5 }, new EventBus());
  for (const c of w.s.colonies) {
    placeMarker(w, c, 0, SURFACE, 200, 200);
    for (const g of c.groups) if (g.type === 'brood') assignGroup(w, c, g.id, 0);
  }
  run(w, 90);
  const deaths = w.colony(0)!.stats.died + w.colony(1)!.stats.died;
  check('combat produces casualties', deaths > 0, `deaths=${deaths} kills=${w.colony(0)!.stats.kills}/${w.colony(1)!.stats.kills}`);
  const corpses = w.s.food.filter((f) => f.kind === 'corpse').length;
  check('corpses left as food', corpses + w.colony(0)!.stats.food + w.colony(1)!.stats.food > 0, `${corpses} corpses`);
}

// ---------------------------------------------------------------- entrances (sim/entrances.ts)
{
  const w = createWorld({ seed: 5, style: 'meadow', width: 600, depth: 600, colonies: [{ species: 'lasius', player: true, ai: false }], food: 1 }, new EventBus());
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  check('the main entrance is a tunnel of 3 hexes rising to the hole; tiles cannot go on any of it', g.tunnels.length === 1 && g.tunnels[0].length === ENTRANCE.tunnelLen && g.tunnels[0][0] === c.entrances[0].q && g.tunnels[0].every((q) => g.isHexDug(q) && !!canPlaceTile(w, c, 'food', q)));
  check('the tunnel is dug floor joined to the nest (its bottom touches more dug floor)', g.neighbors(g.tunnels[0][2]).filter((n) => n >= 0 && g.isHexDug(n) && !g.tunnels[0].includes(n)).length > 0);
  check('two marked extra-entrance spots (undug 3-hex tunnels), no hidden shafts', g.spots.length === ENTRANCE.maxExtra && g.spots.every((sp) => sp.length === ENTRANCE.tunnelLen && sp.every((q) => g.isHexDiggable(q))) && g.shafts.length === g.spots.length, `${g.spots.length} spots`);
  // digging ordinary soil next to the floor never opens an entrance
  const plain = (() => {
    for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDiggable(q) && g.spotIndex(q) < 0 && g.neighbors(q).some((n) => n >= 0 && g.isHexDug(n))) return q;
    return -1;
  })();
  g.completeHex(plain);
  run(w, 1.1);
  check('digging anywhere else never opens an entrance', c.entrances.length === 1 && g.entrances.length === 1);
  // the Dig tool on a spot marks its whole tunnel (one entrance dig, up to 7 workers)
  const sp = g.spots[0].slice();
  check('the dig tool on one spot hex marks the whole spot', designateDig(w, c, sp[1], true) && sp.every((q) => g.hexDesig[q] === 1));
  {
    const bottom = sp[sp.length - 1];
    const nb = g.neighbors(bottom).find((n) => n >= 0 && !sp.includes(n) && g.isHexDiggable(n))!;
    g.completeHex(nb);
    const jobs = listJobs(w, c).filter((j) => sp.includes(j.q));
    check('a spot hex touching the floor is an entrance dig (after ordinary digs, up to 7 workers)', jobs.length >= 1 && jobs.every((j) => j.kind === JOB.Entrance && j.max === BALANCE.entranceDigWorkers && j.prio > 0), JSON.stringify(jobs));
  }
  for (const q of sp) g.completeHex(q);
  run(w, 1.1);
  check('a dug-out spot opens an entrance with its tunnel; the spot is gone', c.entrances.length === 2 && g.tunnels.length === 2 && g.tunnels[1].join() === sp.join() && g.spots.length === 1 && g.isEntrance(sp[0]));
  const e1 = c.entrances[1];
  check('its surface hole lies on dry walkable ground, away from the main hole', w.walkable(SURFACE, e1.sx, e1.sy) && Math.hypot(e1.sx - c.entrances[0].sx, e1.sy - c.entrances[0].sy) > 6, `(${e1.sx.toFixed(0)}, ${e1.sy.toFixed(0)})`);
  // closing and reopening (command)
  const cmd = (body: CommandBody) => applyCommand(w, { ...body, tick: w.s.tick, player: 0, seq: 0 } as Command);
  check('the main entrance cannot be closed', cmd({ type: 'entrance', i: 0, close: true }) !== null);
  check('an extra entrance closes after the plugging time', cmd({ type: 'entrance', i: 1, close: true }) === null && !e1.shut);
  run(w, ENTRANCE.closeS + 1.1);
  check('… then nobody can go in or out by it', e1.shut === 1 && nearestEntrance(c, e1.sx, e1.sy) === 0);
  check('reopening takes the same time', cmd({ type: 'entrance', i: 1, close: false }) === null);
  run(w, ENTRANCE.closeS + 1.1);
  check('… and it is open again', e1.shut === 0 && nearestEntrance(c, e1.sx, e1.sy) === 1);
  check('the entrance command survives the wire format', JSON.stringify(decodeCommandLog(encodeCommandLog([{ type: 'entrance', i: 1, close: true, tick: 3, player: 0, seq: 1 } as Command]))[0]) === JSON.stringify({ type: 'entrance', i: 1, close: true, tick: 3, player: 0, seq: 1 }));
  // the second spot opens too; a third is impossible (no spots left, cap reached)
  for (const q of g.spots[0]) g.completeHex(q);
  run(w, 1.1);
  check('the second extra entrance opens; no spots remain (at most 2 extras)', c.entrances.length === 3 && g.spots.length === 0);
  // throughput: at most ENTRANCE.passPerS a second through one hole
  const e0 = c.entrances[0];
  let passed = 0;
  e0.cr = 0;
  e0.crT = w.time;
  for (let t = 0; t < 20; t++) {
    w.s.time += 0.05;
    for (let k = 0; k < 5; k++) if (passEntrance(w, e0, false)) passed++;
  }
  check('an entrance lets about passPerS ants through a second (the rest queue)', passed >= ENTRANCE.passPerS - 1 && passed <= ENTRANCE.passPerS + 1, `${passed} in 1 s`);
  // a fallen colony's entrances cave in over a minute
  c.alive = false;
  run(w, 2.1);
  check('a fallen colony\'s entrances start caving in: nobody goes in', c.entrances.every((e) => (e.fall ?? 0) > 0 && !canEnter(e)));
  run(w, ENTRANCE.collapseS);
  check('… and have fallen in after collapseS', c.entrances.every((e) => e.fall === 1));
}
{
  // ants queue at a busy hole and still all get home
  const w = createWorld({ seed: 9, style: 'meadow', width: 600, depth: 600, colonies: [{ species: 'lasius', player: true, ai: false }], food: 0 }, new EventBus());
  const c = w.colony(0)!;
  const e = c.entrances[0];
  const outside: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = makeAnt(w, 0, 'lasius_worker', SURFACE, e.sx + Math.cos(i) * 12, e.sy + Math.sin(i) * 12, 0);
    a.task = 'idle';
    outside.push(a.id);
  }
  w.reindex();
  let firstSecond = 0;
  for (let t = 0; t < 400; t++) {
    w.step(0.05);
    if (t === 39) firstSecond = outside.filter((id) => w.antById.get(id)?.space === nestSpace(0)).length;
  }
  const inside = outside.filter((id) => w.antById.get(id)?.space === nestSpace(0)).length;
  check('a crowd at one hole goes in a few a second, then all of it', firstSecond <= ENTRANCE.passPerS * 2 + ENTRANCE.burst && inside >= 20, `${firstSecond} in the first 2 s, ${inside}/24 after 20 s`);
}
{
  // a big rival colony digs one extra entrance by the same rules (a marked spot, a passage to it)
  const w = createWorld({ seed: 6, style: 'meadow', width: 600, depth: 600, colonies: [{ species: 'lasius', player: false, ai: true, startWorkers: 40, popLimit: 300 }], food: 3 }, new EventBus());
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const at = ENTRANCE.aiExtraAt;
  ENTRANCE.aiExtraAt = 30; // the colony starts with about 40 ants
  let t = 0;
  while (c.entrances.length < 2 && t < 400) {
    run(w, 10);
    t += 10;
  }
  ENTRANCE.aiExtraAt = at;
  check('a big AI colony digs out one of its spots into an extra entrance (same rules as the player)', c.entrances.length === 2 && g.tunnels.length === 2 && g.spots.length === 1, `${c.living} ants, ${c.entrances.length} entrances after ${t} s`);
}
{
  // older saves: hidden shafts and one-hex entrances get tunnels and spots
  const w = createWorld({ seed: 5, style: 'meadow', width: 600, depth: 600, colonies: [{ species: 'lasius', player: true, ai: false }], food: 1 }, new EventBus());
  const st = w.serialize();
  const nd = st.nests[nestSpace(0)] as unknown as Record<string, unknown>;
  const tun = (nd.tunnels as number[][])[0];
  delete nd.tunnels;
  delete nd.spots;
  nd.shafts = [...(nd.shafts as number[]), (nd.shafts as number[])[0]];
  for (const e of st.colonies[0].entrances) for (const k of ['shut', 'work', 'cr', 'crT', 'fall']) delete (e as unknown as Record<string, unknown>)[k];
  const w2 = new World(JSON.parse(JSON.stringify(st)), new EventBus());
  const g2 = w2.nest(0)!;
  const e2 = w2.colony(0)!.entrances[0];
  check('an older save gets its entrance tunnel back from the dug corridor', g2.tunnels[0].join() === tun.join(), `${g2.tunnels[0]} vs ${tun}`);
  check('… its shafts become spots, trimmed to the allowance', g2.spots.length === ENTRANCE.maxExtra && g2.spots.every((sp) => sp.length >= 1));
  check('… and its entrances gain the throughput fields', e2.shut === 0 && e2.fall === 0 && e2.cr === ENTRANCE.burst);
}

// ---------------------------------------------------------------- Phase 7: colony life on tiles
{
  // A colony run by the builder brain, as a steady player would play it.
  const w = createWorld({ seed: 7, style: 'meadow', width: 900, depth: 900, colonies: [{ species: 'lasius', player: true, ai: true, popLimit: 300 }], food: 1 }, new EventBus());
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  let dug0 = 0;
  for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q)) dug0++;
  const seen: Record<string, number> = {};
  const stages = new Map<number, Set<number>>();
  let hatchedTracked = 0;
  for (let i = 0; i < 600 * 20; i++) {
    w.step(0.05);
    if (i % 10) continue;
    for (const a of w.s.ants) {
      if (a.colony !== 0) continue;
      const k = AS[a.state];
      seen[k] = (seen[k] ?? 0) + 1;
    }
    for (const b of w.s.brood) {
      if (b.colony !== 0) continue;
      let st = stages.get(b.id);
      if (!st) stages.set(b.id, (st = new Set()));
      st.add(b.stage === 0 && b.carrier ? 10 : b.stage);
    }
  }
  for (const [id, st] of stages) if (!w.broodById.get(id) && st.has(10) && st.has(1)) hatchedTracked++;
  let dug = 0;
  for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q)) dug++;
  const broodTiles = c.tiles.filter((t) => t.type === 'brood').length;
  const groups = c.groups.filter((gr) => gr.type === 'brood').length;
  // Growth varies by about ±20 % from seed to seed (small timing differences compound), so it is
  // checked as the mean of this run and a second seed.
  const w8 = createWorld({ seed: 8, style: 'meadow', width: 900, depth: 900, colonies: [{ species: 'lasius', player: true, ai: true, popLimit: 300 }], food: 1 }, new EventBus());
  run(w8, 600);
  const c8 = w8.colony(0)!;
  const tiles8 = c8.tiles.filter((t) => t.type === 'brood').length;
  const groups8 = c8.groups.filter((gr) => gr.type === 'brood').length;
  // (since 2026-10-25 a third of the workers stay home on nest jobs: a little slower than before, 23.7 vs 22.3 over seeds 7–9)
  check('builder colony grows (10 min; soldiers cost more; mean of 2 seeds)', (c.living + c8.living) / 2 >= 22, `${c.living} and ${c8.living} — ${summary(w, 0)}`);
  // EotU-style (2026-10-25): round 7-hex chambers for brood and stores, joined by short tunnels kept clear of tiles
  const rooms = (c.aiBuild?.chambers ?? []).filter((r) => [r.q, ...g.neighbors(r.q)].every((h) => h >= 0 && g.isHexDug(h)));
  const furnished = rooms.filter((r) => [r.q, ...g.neighbors(r.q)].filter((h) => tileAt(c, h)).length >= 4);
  const tunnelsClear = (c.aiBuild?.tunnels ?? []).every((q) => !tileAt(c, q));
  check('builder digs 7-hex chambers joined by short tunnels, and fills them', dug > dug0 && rooms.length >= 1 && furnished.length >= 1 && tunnelsClear, `${dug0} → ${dug} hexes; ${rooms.length} chambers dug (${furnished.length} furnished) of ${(c.aiBuild?.chambers ?? []).length} planned; tunnels ${(c.aiBuild?.tunnels ?? []).length} hexes, clear ${tunnelsClear}`);
  check('builder places brood tiles in several groups (mean of 2 seeds)', (broodTiles + tiles8) / 2 >= 17 && groups >= 3 && groups8 >= 3, `${broodTiles} and ${tiles8} tiles, ${groups} and ${groups8} groups`);
  check('eggs are carried to tiles, grow as larvae and hatch', hatchedTracked >= 10, `${hatchedTracked} tracked from carried egg to adult`);
  check('workers carry eggs from the queen', (seen.CarryBrood ?? 0) > 0, `${seen.CarryBrood ?? 0} samples`);
  check('ants groom', (seen.Groom ?? 0) > 0, `${seen.Groom ?? 0} samples`);
  check('ants share food by trophallaxis', (seen.Troph ?? 0) > 0, `${seen.Troph ?? 0} samples`);
  check('workers milk aphids for honeydew', (seen.TendAphids ?? 0) > 0, `${seen.TendAphids ?? 0} samples`);
  check('foragers follow pheromone trails', (seen.FollowTrail ?? 0) > 0, `${seen.FollowTrail ?? 0} samples`);
  // The dead (2026-10-25): no more necrophoresis; a dead ant lies a moment, then sinks into the floor and is gone.
  const victims = w.s.ants.filter((a) => a.colony === 0 && a.space === nestSpace(0) && a.id !== c.queen && a.state !== AS.Dead).slice(0, 3);
  for (const a of victims) killAnt(w, a);
  const ids = new Set<number>();
  run(w, 1);
  for (const f of w.s.food) if (f.kind === 'corpse' && f.colony === 0) ids.add(f.id);
  run(w, BALANCE.corpse.antFood + BALANCE.corpse.sink + 0.5);
  const left = [...ids].filter((id) => w.foodById.has(id)).length;
  check('the dead sink into the nest floor within seconds (nobody hauls them)', ids.size === victims.length && left === 0, `${ids.size} dead, ${left} left`);
}
{
  // Leafcutters cut leaves and farm them into food.
  const w = createWorld({ seed: 9, style: 'meadow', width: 700, depth: 700, colonies: [{ species: 'atta', player: true, ai: true, popLimit: 200 }], food: 1 }, new EventBus());
  const c = w.colony(0)!;
  const leaf0 = w.s.plants.reduce((s, p) => s + p.leaf, 0);
  let cutting = 0;
  let maxFungus = 0;
  for (let i = 0; i < 360 * 20; i++) {
    w.step(0.05);
    if (i % 10) continue;
    for (const a of w.s.ants) if (a.colony === 0 && a.state === AS.CutLeaf) cutting++;
    maxFungus = Math.max(maxFungus, c.fungus);
  }
  const taken = leaf0 - w.s.plants.reduce((s, p) => s + p.leaf, 0) + w.s.plants.length * 0.15 * 360;
  check('leafcutters cut leaf fragments', cutting > 0 && taken > 0, `${cutting} samples`);
  check('leaves reach the fungus garden', maxFungus > 0, `peak fungus ${maxFungus.toFixed(1)}`);
  check('leafcutter colony grows', c.living >= 14, summary(w, 0));
}
{
  // Rival colonies build their own nests.
  const w = createWorld({ seed: 4, style: 'meadow', width: 800, depth: 800, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'solenopsis', player: false, ai: true }], food: 1 }, new EventBus());
  const r = w.colony(1)!;
  const t0r = r.tiles.length;
  run(w, 300);
  check('rival AI digs and builds tiles', r.tiles.length >= t0r + 5, `${t0r} → ${r.tiles.length} tiles, ${r.living} ants`);
  check('player colony is not auto-built', w.colony(0)!.tiles.length === w.colony(0)!.tiles.filter((t) => t.type === 'queen').length + (w.colony(0)!.tiles.length - w.colony(0)!.tiles.filter((t) => t.type === 'queen').length) && w.nest(0)!.designatedCount === 0);
}

// ---------------------------------------------------------------- Phase 8: combat and invasions
/**
 * Spawn an army of its own: a fresh brood tile (its own group) that the
 * ants are bound to, sent to marker I. Only group members follow markers.
 */
function army(w: World, cid: number, caste: string, n: number, space: number, x: number, y: number): number[] {
  const c = w.colony(cid)!;
  const q = freeDugHexes(w, cid).find((h) => !w.nest(cid)!.neighbors(h).some((nb) => tileAt(c, nb)?.caste === caste));
  const t = placeTile(w, c, 'brood', q ?? freeDugHexes(w, cid)[0], caste, true)!;
  t.wait = 1e9; // demo tile: never raises its own ant
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, cid, caste, space, x + Math.cos(i * 2.4) * (3 + i * 0.5), y + Math.sin(i * 2.4) * (3 + i * 0.5), 0);
    a.tile = t.q;
    ids.push(a.id);
  }
  assignGroup(w, c, t.group, 0);
  w.reindex();
  return ids;
}
const living = (w: World, ids: number[]) => ids.filter((id) => w.antById.get(id) && w.antById.get(id)!.state !== AS.Dead).length;
{
  // damage types: acid mostly ignores armour, bites don't
  const w = createWorld({ seed: 2, style: 'meadow', width: 400, depth: 400, colonies: [{ species: 'formica', player: true, ai: false }], food: 0 }, new EventBus());
  const m1 = makeAnt(w, 0, 'formica_soldier', SURFACE, 100, 100, 0);
  const m2 = makeAnt(w, 0, 'formica_soldier', SURFACE, 120, 100, 0);
  const h0 = m1.hp;
  damageAnt(w, m1, 4, 'bite', null);
  damageAnt(w, m2, 4, 'acid', null);
  check('acid pierces armour that blunts bites', h0 - m2.hp > (h0 - m1.hp) * 1.5, `bite ${(h0 - m1.hp).toFixed(1)} vs acid ${(h0 - m2.hp).toFixed(1)}`);
}
{
  // a surface battle: grappling, spread-eagling, venom
  const w = createWorld({ seed: 3, style: 'meadow', width: 600, depth: 600, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'solenopsis', player: false, ai: false }], food: 0, aphids: 0, plants: 0 }, new EventBus());
  w.s.settings.foodRespawn = 0;
  placeMarker(w, w.colony(0)!, 0, SURFACE, 300, 300);
  placeMarker(w, w.colony(1)!, 0, SURFACE, 300, 300);
  const A = army(w, 0, 'formica_worker', 8, SURFACE, 250, 300);
  const B = army(w, 1, 'fire_minor', 30, SURFACE, 350, 300);
  let grapple = 0;
  let pinned = 0;
  let maxVenom = 0;
  for (let i = 0; i < 40 * 20; i++) {
    w.step(0.05);
    for (const id of A) {
      const a = w.antById.get(id);
      if (!a) continue;
      if (a.pinned > 0) pinned++;
      maxVenom = Math.max(maxVenom, a.venom);
    }
    for (const id of B) if (w.antById.get(id)?.state === AS.Grapple) grapple++;
  }
  check('fighters grapple their enemies', grapple > 50, `${grapple} grapple samples`);
  check('several grapplers spread-eagle a victim (pinned)', pinned > 10, `${pinned} pinned samples`);
  check('fire ant stings stack venom', maxVenom >= 3, `max stacks ${maxVenom}`);
  check('the battle produces casualties on both sides', living(w, A) < 8 && living(w, B) < 30, `wood ants ${living(w, A)}/8, fire ants ${living(w, B)}/30`);
}
{
  // defend-only stance: unalarmed ants outside the nest leave passing enemies alone
  const mk = (aggr: boolean) => {
    const w = createWorld({ seed: 4, style: 'meadow', width: 400, depth: 400, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], food: 0 }, new EventBus());
    for (const c of w.s.colonies) c.aggressive = aggr;
    const a = makeAnt(w, 0, 'formica_worker', SURFACE, 200, 200, 0);
    const b = makeAnt(w, 1, 'lasius_worker', SURFACE, 207, 200, Math.PI);
    a.task = b.task = 'forage';
    w.reindex();
    let fought = false;
    for (let i = 0; i < 60; i++) {
      w.step(0.05);
      if (a.state === AS.Attack || a.state === AS.Grapple || b.state === AS.Attack || b.state === AS.Grapple) fought = true;
    }
    return fought;
  };
  check('attack stance: ants fight enemies they meet', mk(true));
  check('defend-only stance: unprovoked ants pass enemies by', !mk(false));
}
{
  // a raid: a party walks across the map into the rival nest; defenders converge; the queen falls
  const w = createWorld({ seed: 6, style: 'meadow', width: 700, depth: 700, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'solenopsis', player: false, ai: true }], food: 1 }, new EventBus());
  run(w, 240);
  const P = w.colony(0)!;
  const R = w.colony(1)!;
  const q = w.antById.get(R.queen)!;
  placeMarker(w, P, 0, nestSpace(1), q.x + 6, q.y);
  const e = P.entrances[0];
  // the full wood ant army: tanks in front, rapid sprayers and mortars behind, workers to carry off brood
  const raiders = [
    ...army(w, 0, 'formica_soldier', 5, SURFACE, e.sx, e.sy + 8),
    ...army(w, 0, 'formica_rapid', 4, SURFACE, e.sx - 6, e.sy + 10),
    ...army(w, 0, 'formica_mortar', 3, SURFACE, e.sx + 3, e.sy + 12),
  ];
  const workers = army(w, 0, 'formica_worker', 10, SURFACE, e.sx + 6, e.sy + 8);
  let inside = 0;
  let defending = 0;
  let lost = false;
  w.events.on('colonyLost', (ev) => {
    if (ev.colony === 1) lost = true;
  });
  const brood0 = w.s.brood.filter((b) => b.colony === 1).length;
  let stolen = 0;
  let raidable = 0;
  for (let i = 0; i < 150 * 20; i++) {
    w.step(0.05);
    w.events.drain();
    if (i % 20) continue;
    inside = Math.max(inside, [...raiders, ...workers].filter((id) => w.antById.get(id)?.space === nestSpace(1)).length);
    defending = Math.max(defending, w.s.ants.filter((a) => a.colony === 1 && a.space === nestSpace(1) && (a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Guard) && a.alarm > 0.5).length);
    for (const f of w.s.food) if (f.from === 'brood' && f.heldBy && w.antById.get(f.heldBy)?.colony === 0) stolen = Math.max(stolen, 1);
    // brood the raiding workers could have taken: uncarried, while they are in the nest
    if (workers.some((id) => w.antById.get(id)?.space === nestSpace(1))) raidable = Math.max(raidable, w.s.brood.filter((b) => b.colony === 1 && !b.carrier).length);
  }
  // brood left in a fallen nest is carried off by the raiding workers (give them a minute more to find it)
  for (let i = 0; i < 60 * 20 && !(P.stats.stolen > 0 || stolen > 0); i++) {
    w.step(0.05);
    w.events.drain();
    if (i % 20) continue;
    for (const f of w.s.food) if (f.from === 'brood' && f.heldBy && w.antById.get(f.heldBy)?.colony === 0) stolen = Math.max(stolen, 1);
    if (workers.some((id) => w.antById.get(id)?.space === nestSpace(1))) raidable = Math.max(raidable, w.s.brood.filter((b) => b.colony === 1 && !b.carrier).length);
  }
  check('raiders path across the surface into the rival nest', inside >= 10, `${inside} inside at once`);
  check('defenders converge on intruders (job workers ignore them, EotU)', defending >= 2, `${defending} defenders engaged`);
  check('a strong raid kills the queen and the colony is lost', !R.alive && lost, `queen ${w.antById.get(R.queen)?.state === AS.Dead || !w.antById.get(R.queen) ? 'dead' : 'alive'}`);
  // (fast-growing brood may all have hatched before the raiders got in: then there was nothing to take)
  check('raiding workers carry off enemy brood they find', P.stats.stolen > 0 || stolen > 0 || raidable === 0, `${P.stats.stolen} brood taken (${raidable} within reach while they were inside; ${brood0} at the start)`);
}
{
  // a small raid is beaten off
  const w = createWorld({ seed: 6, style: 'meadow', width: 700, depth: 700, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'solenopsis', player: false, ai: true }], food: 1 }, new EventBus());
  run(w, 480);
  const P = w.colony(0)!;
  const R = w.colony(1)!;
  const q = w.antById.get(R.queen)!;
  placeMarker(w, P, 0, nestSpace(1), q.x + 6, q.y);
  const e = P.entrances[0];
  const party = army(w, 0, 'formica_worker', 3, SURFACE, e.sx, e.sy + 8);
  run(w, 150);
  const qh = w.antById.get(R.queen);
  check('a small raid is beaten off and the queen survives', R.alive && !!qh && qh.hp >= 0.7 * casteOf(qh.caste).hp, `${living(w, party)}/3 raiders left, queen ${qh ? qh.hp.toFixed(0) : 'dead'} hp, rival ${R.living} ants`);
}

// ---------------------------------------------------------------- Revision 2: underground areas (System 8)
{
  const w = createWorld(
    {
      seed: 12,
      style: 'meadow',
      width: 800,
      depth: 800,
      colonies: [
        { species: 'formica', player: true, ai: false, startWorkers: 8 },
        { species: 'solenopsis', player: false, ai: true },
        { species: 'lasius', player: false, ai: true, team: 0, name: 'Allied black ants' },
      ],
      caves: [
        { name: 'Root hollow', kind: 'cave', food: 60 },
        { name: 'Beetle den', kind: 'lair', food: 30 },
      ],
      food: 0.4,
    },
    new EventBus(),
  );
  const P = w.colony(0)!;
  const areas = areasFor(w, 0);
  check('a level lists home first and up to six numbered, coloured areas', areas.length === 5 && areas[0].kind === 'home' && areas.every((a, i) => a.number === i + 1) && new Set(areas.map((a) => a.color)).size === 5, areas.map((a) => `${a.number}:${a.kind}`).join(' '));
  check('area kinds: enemy nest, allied nest, neutral caves', areas[1].kind === 'enemy' && areas[2].kind === 'allied' && areas[3].kind === 'neutral' && areas[4].kind === 'neutral');
  const cave = areas[3];
  const caveG = w.nestOf(cave.space)!;
  check('a cave is a pre-dug cavern joined to the surface by an entrance', caveG.dugHexCount() > 15 && w.entrancesOf(cave.space).length === 1, `${caveG.dugHexCount()} hexes`);
  const open0 = areas.map((a) => areaOpen(w, P, a.space));
  check('access: home and the allied nest (allies inside) are open; enemy nest and caves are closed', open0[0] && !open0[1] && open0[2] && !open0[3] && !open0[4], open0.join(','));
  check('sandbox setting reveals every area (a viewer setting, not simulation state)', areas.every((a) => areaOpen(w, P, a.space, undefined, true)));
  // A marker dropped on the cave's surface entrance goes down into the cave.
  const ce = w.entrancesOf(cave.space)[0];
  placeMarker(w, P, 0, SURFACE, ce.sx + 3, ce.sy - 2);
  check('a marker placed on an entrance moves into that area', P.markers[0].space === cave.space, `space ${P.markers[0].space}`);
  const grp = P.groups.find((g) => g.type === 'brood')!;
  assignGroup(w, P, grp.id, 0);
  const caveFood0 = w.s.food.filter((f) => f.space === cave.space).reduce((s, f) => s + f.amount, 0);
  const food0 = P.stats.food;
  let openedAt = -1;
  for (let t = 0; t < 120 && openedAt < 0; t++) {
    run(w, 1);
    if (areaOpen(w, P, cave.space)) openedAt = t;
  }
  const inCave = w.s.ants.filter((a) => a.colony === 0 && a.space === cave.space && a.state !== AS.Dead).length;
  check('the group walks across the surface and down into the cave', openedAt >= 0, `tab opened after ${openedAt} s, ${inCave} inside`);
  // With the cave open, the marker is moved inside it, onto the cache.
  const cache = w.s.food.filter((f) => f.space === cave.space);
  const cx = cache.reduce((s, f) => s + f.x, 0) / cache.length;
  const cy = cache.reduce((s, f) => s + f.y, 0) / cache.length;
  placeMarker(w, P, 0, cave.space, cx, cy);
  run(w, 150);
  const caveFood1 = w.s.food.filter((f) => f.space === cave.space && !f.heldBy).reduce((s, f) => s + f.amount, 0);
  check('foragers carry the cave’s food home', caveFood1 < caveFood0 - 10 && P.stats.food > food0 + 10, `cave ${caveFood0.toFixed(0)} → ${caveFood1.toFixed(0)}, collected +${(P.stats.food - food0).toFixed(0)}`);
  // Lifting the marker brings them home; the cave closes again once empty.
  removeMarker(w, P, 0);
  run(w, 120);
  check('ants come home when the marker is lifted; the tab closes again', !areaOpen(w, P, cave.space), `${w.s.ants.filter((a) => a.colony === 0 && a.space === cave.space && a.state !== AS.Dead).length} still inside`);
  // Allies: their ants never fight ours, and count for area access.
  const ally = w.colony(2)!;
  const mine = makeAnt(w, 0, 'formica_soldier', SURFACE, 300, 300, 0);
  const theirs = makeAnt(w, 2, 'lasius_worker', SURFACE, 305, 300, Math.PI);
  mine.task = theirs.task = 'idle';
  w.reindex();
  let fought = false;
  for (let i = 0; i < 60; i++) {
    w.step(0.05);
    if (mine.state === AS.Attack || mine.state === AS.Grapple || theirs.state === AS.Attack || theirs.state === AS.Grapple) fought = true;
  }
  check('allied ants never fight each other', !fought && ally.team === P.team);
  const scout = makeAnt(w, 2, 'lasius_worker', cave.space, caveG.hexCenter(w.entrancesOf(cave.space)[0].q).x, caveG.hexCenter(w.entrancesOf(cave.space)[0].q).y, 0);
  w.reindex();
  check('allied ants inside an area open its tab', areaOpen(w, P, cave.space));
  killAnt(w, scout);
  // No route home: ants of a fallen colony weaken and die.
  const R = w.colony(1)!;
  const rq = w.antById.get(R.queen)!;
  killAnt(w, rq);
  run(w, 2);
  const left0 = w.s.ants.filter((a) => a.colony === 1 && a.state !== AS.Dead).length;
  run(w, BALANCE.lostDeathTime + 3);
  const left1 = w.s.ants.filter((a) => a.colony === 1 && a.state !== AS.Dead).length;
  check('ants with no route back to a living queen die', !R.alive && left0 > 0 && left1 === 0, `${left0} → ${left1}`);
  // An ant cut off in a sealed pocket of the cave dies too.
  const pocket = caveG.cols * caveG.rows - caveG.cols - 3;
  caveG.softenHex(pocket);
  caveG.completeHex(pocket);
  const pp = caveG.hexCenter(pocket);
  const cut = makeAnt(w, 0, 'formica_worker', cave.space, pp.x, pp.y, 0);
  w.reindex();
  check('an ant with no path to any exit has no route home', !hasRouteHome(w, cut));
  run(w, BALANCE.lostDeathTime + 2);
  check('…and dies after the lost-ant time', cut.state === AS.Dead);
}

// ---------------------------------------------------------------- castes (user note 2026-10-24)
{
  const workers = ['lasius_worker', 'formica_worker', 'fire_minor', 'atta_minim', 'atta_media', 'eciton_minor', 'plagiaria_worker'];
  const builds = new Set(workers.map((cs) => casteCosts(cs).build));
  check('every worker caste costs the same to build', builds.size === 1, [...builds].join(','));
  const order = (a: string, b: string) => casteCosts(a).hatch < casteCosts(b).hatch && casteCosts(a).build <= casteCosts(b).build;
  check('costs rise worker → soldier → major', order('fire_minor', 'fire_soldier') && order('fire_soldier', 'fire_major') && order('atta_media', 'atta_soldier') && order('atta_soldier', 'atta_major') && order('lasius_worker', 'lasius_soldier'));
  check('castes: black garden 2, wood ant 4, tropical fire ant 3, leafcutter 4', SPECIES.lasius.castes.length === 2 && SPECIES.formica.castes.length === 4 && SPECIES.solenopsis.castes.length === 3 && SPECIES.atta.castes.length === 4);
  check('tropical fire ant soldier is the worker model, scaled up', CASTES.fire_soldier.morph === CASTES.fire_minor.morph && (CASTES.fire_soldier.scale ?? 1) > 1.3);

  // shooters: one wood ant of each kind against a lone enemy
  const duel = (caste: string, foe: string, level = 1, foes = 1, secs = 6, dist = 40) => {
    const w = createWorld({ seed: 31, style: 'meadow', width: 400, depth: 400, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], food: 0, aphids: 0, plants: 0 }, new EventBus());
    w.s.settings.foodRespawn = 0;
    // a clear strip of ground for the duel
    let Y = 200;
    for (let y = 120; y < 300; y += 4) {
      let ok = true;
      for (let x = 140; x <= 215 && ok; x += 1) for (let dy = -6; dy <= 6 && ok; dy += 3) ok = w.walkable(SURFACE, x, y + dy);
      if (ok) {
        Y = y;
        break;
      }
    }
    const a = makeAnt(w, 0, caste, SURFACE, 150, Y, 0);
    applyLevel(a, level);
    a.task = 'guard';
    // no brood tile wants an egg (the queen always has one ready now, so a free worker out here would be sent to fetch it)
    for (const t of w.colony(0)!.tiles) t.wait = 1e9;
    const enemies = Array.from({ length: foes }, (_, i) => makeAnt(w, 1, foe, SURFACE, 150 + dist + (i % 3) * 1.5, Y + Math.floor(i / 3) * 1.5, Math.PI));
    for (const o of enemies) {
      o.task = 'idle';
      o.maxHp = o.hp = 400;
    }
    w.reindex();
    let shots = 0;
    let lobs = 0;
    let minD = Infinity;
    let slowed = 0;
    w.events.on('acid', (e) => {
      shots++;
      if (e.lob) lobs++;
    });
    for (let i = 0; i < secs * 20; i++) {
      for (const o of enemies) {
        o.x = o.px = 150 + dist + (enemies.indexOf(o) % 3) * 1.5; // hold the targets still
        o.state = AS.Idle;
        if (o.slowT > 0) slowed++;
      }
      w.step(0.05);
      w.events.drain();
      minD = Math.min(minD, Math.hypot(a.x - enemies[0].x, a.y - enemies[0].y));
    }
    const hurt = enemies.filter((o) => o.hp < 400).length;
    return { shots, lobs, minD, hurt, slowed, a };
  };
  const m = duel('formica_mortar', 'lasius_worker');
  check('mortar lobs acid from long range and keeps its distance', m.lobs >= 3 && m.minD > 25 && m.hurt === 1, `${m.lobs} lobs, closest ${m.minD.toFixed(0)} mm`);
  const m3 = duel('formica_mortar', 'lasius_worker', 3, 6);
  check('level 3 mortar splash hits several enemies', m3.hurt >= 3, `${m3.hurt}/6 hurt`);
  const r = duel('formica_rapid', 'lasius_worker', 1, 1, 6, 28);
  check('rapid sprayer fires several jets a second from mid range', r.shots >= 14 && r.minD > 20, `${r.shots} jets in 6 s, closest ${r.minD.toFixed(0)} mm`);
  const r3 = duel('formica_rapid', 'lasius_worker', 3, 1, 6, 28);
  check('level 3 rapid sprayer slows its target', r3.slowed > 0 && r.slowed === 0);
  const wk = duel('formica_worker', 'lasius_worker', 1, 1, 6, 8);
  check('wood ant worker opens with a short spray, then closes in to bite', wk.shots >= 1 && wk.shots <= 2 && wk.minD < 6, `${wk.shots} sprays, closest ${wk.minD.toFixed(1)} mm`);
  // tanks draw attacks
  {
    const w = createWorld({ seed: 32, style: 'meadow', width: 400, depth: 400, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], food: 0, aphids: 0, plants: 0 }, new EventBus());
    const tank = makeAnt(w, 0, 'formica_soldier', SURFACE, 200, 212, 0);
    const wkr = makeAnt(w, 0, 'formica_worker', SURFACE, 200, 190, 0);
    const foe = makeAnt(w, 1, 'lasius_soldier', SURFACE, 200, 200, 0);
    for (const x of [tank, wkr]) {
      x.task = 'guard';
      x.state = AS.Idle;
    }
    foe.task = 'idle';
    w.reindex();
    let tgt = 0;
    for (let i = 0; i < 20 && !tgt; i++) {
      w.step(0.05);
      if (foe.state === AS.Attack || foe.state === AS.Grapple) tgt = foe.tgt;
    }
    check('enemies prefer to attack the tank soldier', tgt === tank.id, `target ${tgt === tank.id ? 'tank' : tgt === wkr.id ? 'worker' : 'none'}`);
  }
}

// ---------------------------------------------------------------- determinism (multiplayer Part B)
{
  // 1 minute of a 4-colony game, run twice and once restored from a snapshot at 20 s
  const r = runDeterminism(1200, 100, 400);
  check('determinism: two runs from the same seed and orders give identical state hashes', r.bDiff < 0, r.bDiff < 0 ? `${r.a.length} checkpoints` : `differs from tick ${(r.bDiff + 1) * 100}`);
  check('determinism: a world restored from a binary snapshot continues identically', r.cDiff < 0, r.cDiff < 0 ? `${(r.snapshotBytes / 1024).toFixed(0)} KB snapshot` : `differs from tick ${(r.cDiff + 1) * 100}`);
  check('flow fields: every cached nest path field equals a fresh build (no stale caches)', r.staleFields.length === 0, r.staleFields.slice(0, 5).join(', '));
  const w = createWorld(DET_SETUP, new EventBus());
  run(w, 5);
  const snap = encodeState(w);
  const w2 = restoreWorld(snap, new EventBus());
  check('snapshot: restoring and re-encoding gives the same bytes', fnv1a64(encodeState(w2)) === fnv1a64(snap));
  const h0 = hashState(w2);
  w2.s.ants[0].x += 1e-9;
  check('snapshot: the hash changes with a 1e-9 mm move of one ant', hashState(w2) !== h0);
  check('dmath: deterministic sin/cos/atan2/exp/pow agree with Math to ~1 ulp', Math.abs(dsin(1.234) - Math.sin(1.234)) < 1e-15 && Math.abs(dcos(-7.5) - Math.cos(-7.5)) < 1e-15 && Math.abs(datan2(-0.3, -2) - Math.atan2(-0.3, -2)) < 1e-15 && Math.abs(dexp(3.3) / Math.exp(3.3) - 1) < 1e-15 && Math.abs(dpow(0.5, 0.0714) / Math.pow(0.5, 0.0714) - 1) < 1e-14);
}

// ---------------------------------------------------------------- commands (multiplayer Part C)
{
  const bodies: CommandBody[] = [
    { type: 'placeMarker', i: 3, space: 0, x: 123.456789, y: 98.7654321 },
    { type: 'removeMarker', i: 4 },
    { type: 'assignGroup', group: 70001, marker: -1 },
    { type: 'dig', q: 517, on: true },
    { type: 'buildTile', q: 33, tile: 'brood', caste: 'formica_mortar' },
    { type: 'markUpgrade', q: 1200 },
    { type: 'markDelete', q: 0 },
    { type: 'setAggression', on: false },
    { type: 'recall' },
    { type: 'useAbility' },
    { type: 'setControl', colony: 2, human: true },
  ];
  const cmds = bodies.map((b, i) => ({ ...quantize({ ...b }), tick: 4321, player: 2, seq: 65530 + i }) as Command).map((c) => ({ ...c, seq: c.seq & 0xffff }));
  const pkt = encodeTickPacket(4321, 2, cmds);
  const back = decodeTickPacket(pkt);
  check('commands: every type survives the tick-packet encoding exactly', back.tick === 4321 && back.player === 2 && JSON.stringify(back.cmds) === JSON.stringify(cmds), `${pkt.length} bytes for ${cmds.length} commands`);
  check('commands: an empty tick packet is 6 bytes', encodeTickPacket(99, 1, []).length === 6);
  const log = decodeCommandLog(encodeCommandLog(cmds));
  check('commands: the replay log encoding round-trips', JSON.stringify(log) === JSON.stringify(cmds));

  // Validation: only a colony's own human player can order it; bad parameters are ignored.
  const w = createWorld(DET_SETUP, new EventBus());
  run(w, 2);
  const seen: Array<{ ok: boolean; why?: string; type: string }> = [];
  w.events.onAny((e) => {
    if (e.t === 'command') seen.push({ ok: e.ok, why: e.why, type: e.type });
  });
  const mk = (player: number, b: CommandBody, seq = 0): Command => ({ ...quantize(b), tick: w.s.tick + 1, player, seq }) as Command;
  const P = w.colony(0)!;
  const before = JSON.stringify(w.colony(1)!.markers);
  applyCommandsNow(w, [mk(1, { type: 'placeMarker', i: 0, space: SURFACE, x: 100, y: 100 })]);
  w.events.drain();
  check('commands: orders for an AI colony are ignored', JSON.stringify(w.colony(1)!.markers) === before && seen.at(-1)?.ok === false, seen.at(-1)?.why);
  applyCommandsNow(w, [mk(0, { type: 'placeMarker', i: 7, space: SURFACE, x: 100, y: 100 }), mk(0, { type: 'dig', q: 99999, on: true }, 1), mk(0, { type: 'buildTile', q: 5, tile: 'nonsense' as never, caste: '' }, 2), mk(0, { type: 'placeMarker', i: 0, space: nestSpace(0), x: 1, y: 1 }, 3)]);
  w.events.drain();
  check('commands: bad marker, hex, tile type and a marker in solid soil are all ignored', seen.slice(-4).every((s) => !s.ok), seen.slice(-4).map((s) => s.why).join(' | '));
  P.ai = false;
  applyCommandsNow(w, [mk(1, { type: 'setControl', colony: 0, human: false })]);
  w.events.drain();
  check('commands: only the host can hand a colony to the AI', !P.ai && seen.at(-1)?.ok === false);
  applyCommandsNow(w, [mk(0, { type: 'setControl', colony: 0, human: false })]);
  check('commands: the host can let the AI drive a dropped player\'s colony (it stays a player slot)', (P.ai as boolean) && P.player);

  // Single-player applies commands as they are issued; a replay applies them inside the tick loop. Same state.
  const play = (immediate: boolean, replay?: Command[]): { hash: string; log: Command[] } => {
    const ww = createWorld(DET_SETUP, new EventBus());
    const sched = new CommandSchedule();
    if (replay) for (const c of replay) sched.add({ ...c });
    let seq = 0;
    for (let t = 0; t < 900; t++) {
      if (!replay && t % 37 === 5) {
        const c0 = ww.colony(0)!;
        const g = ww.nest(0)!;
        const bodies: CommandBody[] = [
          { type: 'placeMarker', i: t % 5, space: SURFACE, x: 200 + (t % 300), y: 250 + ((t * 7) % 200) },
          { type: 'assignGroup', group: c0.groups[t % c0.groups.length].id, marker: (t % 6) - 1 },
          { type: 'dig', q: (t * 13) % (g.cols * g.rows), on: true },
          { type: 'useAbility' },
          { type: 'setAggression', on: t % 2 === 0 },
        ];
        for (const b of bodies) {
          const cmd = { ...quantize(b), tick: ww.s.tick + 1, player: 0, seq: seq++ } as Command;
          sched.add(cmd);
          if (immediate) applyCommandsNow(ww, sched.take(cmd.tick)); // what LocalCommands does with delay 0
        }
      }
      stepWithCommands(ww, 0.05, sched);
      ww.events.drain();
    }
    return { hash: hashState(ww), log: sched.log };
  };
  const a = play(true);
  const b = play(false);
  check('commands: applying at once (single-player) and inside the tick loop give the same state', a.hash === b.hash && a.log.length > 50, `${a.log.length} commands`);
  const r = play(false, decodeCommandLog(encodeCommandLog(a.log)));
  check('replay: the setup plus the recorded command log reproduces the game exactly', r.hash === a.hash);
}

// ---------------------------------------------------------------- worker frames → replica (performance Part A)
{
  // The main thread's replica must hold the same state as the worker after applying its frames.
  const canon = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
    if (Array.isArray(v)) return v.map(canon);
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined && k !== 'hexSpeed') out[k] = canon(o[k]);
    return out;
  };
  const view = (w: World) =>
    JSON.stringify(
      canon({
        tick: w.s.tick,
        ants: w.s.ants,
        food: w.s.food,
        brood: w.s.brood,
        creatures: w.s.creatures,
        projectiles: w.s.projectiles,
        colonies: w.s.colonies,
        caves: w.s.caves,
        plants: w.s.plants,
        aphids: w.s.aphids,
        grids: [...w.grids].map(([sp, g]) => [sp, g.soil, g.hexSoil, g.hexWork, g.hexDesig, g.hexEntry, g.designated, g.entrances, g.shafts]),
      }),
    );
  const replicaWorld = createWorld(DET_SETUP, new EventBus());
  const worker = restoreWorld(encodeState(replicaWorld), new EventBus());
  const fb = new FrameBuilder(worker, true);
  const rep = new Replica(replicaWorld);
  const sched = new CommandSchedule();
  let frames = 0;
  let bytes = 0;
  let maxMsg = 0;
  for (let t = 0; t < 1400; t++) {
    scriptedOrders(worker, worker.s.tick, sched);
    stepWithCommands(worker, 0.05, sched);
    worker.events.drain();
    if (t % 3 === 0 || t > 1380) {
      const { msg, transfer } = fb.build(worker, 1, [], 0);
      const size = transfer.reduce((s, b) => s + b.byteLength, 0);
      bytes += size;
      maxMsg = Math.max(maxMsg, size);
      rep.apply(structuredClone(msg, { transfer }));
      frames++;
    }
  }
  check('worker frames: the replica matches the simulation exactly (entities, colonies, nest grids)', view(rep.world) === view(worker), `${frames} frames, avg ${(bytes / frames / 1024).toFixed(0)} KB, max ${(maxMsg / 1024).toFixed(0)} KB transferred`);

  // The same through shared ring buffers (cross-origin isolated pages): nothing transferred per frame.
  const replica2 = createWorld(DET_SETUP, new EventBus());
  const worker2 = restoreWorld(encodeState(replica2), new EventBus());
  const ctrl = new Int32Array(new SharedArrayBuffer(4));
  const fb2 = new FrameBuilder(worker2, true, ctrl);
  const rep2 = new Replica(replica2, ctrl);
  const sched2 = new CommandSchedule();
  for (let t = 0; t < 600; t++) {
    scriptedOrders(worker2, worker2.s.tick, sched2);
    stepWithCommands(worker2, 0.05, sched2);
    worker2.events.drain();
    const { msg, transfer } = fb2.build(worker2, 1, [], 0);
    // posting a view of a SharedArrayBuffer shares it; structuredClone does the same
    rep2.apply(structuredClone(msg, { transfer }));
  }
  const st = fb2.sharedStats!;
  check('worker frames (shared memory): the replica matches, and entity columns live in reused shared buffers', view(rep2.world) === view(worker2) && st.shared === 600 * 10 && st.fallback === 0, `${st.shared} column arrays shared, ${st.fallback} fell back`);
}

// ---------------------------------------------------------------- rival AI keeps growing (all four species)
{
  // Regression: with full stores the builder used to plan a storage tile every few seconds; the
  // plans piled up unbuilt and the colony never added brood tiles again (Formica and Atta stuck at
  // their starting size). Now it keeps one plan of a kind at a time.
  const w = createWorld({ ...DET_SETUP, settings: { creatures: 0 } }, new EventBus());
  let maxPlans = 0;
  for (let m = 0; m < 6; m++) {
    run(w, 60);
    for (const c of w.s.colonies) maxPlans = Math.max(maxPlans, c.tiles.filter((t) => t.type === 'food' && !t.built).length);
  }
  const sizes = w.s.colonies.map((c) => c.living);
  // (a third of each colony's workers stay home on nest jobs since 2026-10-25, so growth is a little slower)
  check('rival AI: every species grows in a 4-colony game (6 min, from 17)', sizes.every((n) => n >= 21), w.s.colonies.map((c, i) => `${c.species} ${sizes[i]}`).join(', '));
  check('rival AI: never more than one storage tile planned and unbuilt at a time', maxPlans <= 1, `max ${maxPlans}`);
}

// ---------------------------------------------------------------- Phase 12: species — the fire ant mound
{
  // Fire ants: no entrance in the middle of the mound; the tunnel surfaces away from it.
  const offset = (species: 'solenopsis' | 'lasius') => {
    const w = createWorld({ seed: 21, style: 'meadow', width: 900, depth: 900, food: 1, colonies: [{ species, player: true, ai: true }] }, new EventBus());
    const c = w.colony(0)!;
    const g = w.nest(0)!;
    const qs = c.tiles.filter((t) => t.type === 'queen');
    let nx = 0;
    let ny = 0;
    for (const t of qs) {
      const p = g.hexCenter(t.q);
      nx += p.x / qs.length;
      ny += p.y / qs.length;
    }
    const m = nestToSurface(w, c, nx, ny);
    return Math.hypot(c.entrances[0].sx - m.x, c.entrances[0].sy - m.y);
  };
  const fire = offset('solenopsis');
  const black = offset('lasius');
  check('fire ants: the entrance opens away from the mound (no hole in the middle)', fire >= 40 && fire > black * 1.5, `${fire.toFixed(0)} mm from the mound centre (black garden ants ${black.toFixed(0)} mm)`);
  // The sun-warmed mound speeds brood by day, a quarter as much at night; bonuses are capped.
  const w = createWorld({ seed: 22, style: 'meadow', width: 600, depth: 600, food: 1, colonies: [{ species: 'solenopsis', player: true, ai: false }] }, new EventBus());
  const c = w.colony(0)!;
  const base = broodWarmth(w, c);
  const free = c.tiles.length;
  const g = w.nest(0)!;
  const spots: number[] = [];
  for (let q = 0; q < g.cols * g.rows && spots.length < 8; q++) if (g.isHexDug(q) && !g.isEntrance(q) && !tileAt(c, q)) spots.push(q);
  const placed = spots.slice(0, 2).map((q) => placeTile(w, c, 'mound', q, undefined, true));
  const day = broodWarmth(w, c);
  w.s.night = 1;
  const night = broodWarmth(w, c);
  w.s.night = 0;
  for (const q of spots.slice(2, 8)) placeTile(w, c, 'mound', q, undefined, true);
  const capped = broodWarmth(w, c);
  check('fire ants: mound tiles speed brood growth by day, a quarter as much at night, capped', base === 0 && placed.every(Boolean) && Math.abs(day - 0.16) < 1e-9 && Math.abs(night - 0.04) < 1e-9 && Math.abs(capped - 0.5) < 1e-9, `${free} tiles; +${(day * 100).toFixed(0)} % by day, +${(night * 100).toFixed(0)} % at night, ${spots.length} mounds +${(capped * 100).toFixed(0)} %`);
  // the builder AI adds mounds as the colony grows
  const wa = createWorld({ seed: 7, style: 'meadow', width: 900, depth: 900, food: 1, colonies: [{ species: 'solenopsis', player: true, ai: true, popLimit: 300 }] }, new EventBus());
  run(wa, 720);
  const mounds = wa.colony(0)!.tiles.filter((t) => t.type === 'mound');
  check('fire ants: the builder AI raises brood mounds as the colony grows', mounds.length >= 1, `${mounds.length} mound tiles, ${wa.colony(0)!.tiles.filter((t) => t.type === 'brood').length} brood tiles after 12 min`);
}

// ---------------------------------------------------------------- Phase 12: the rival AI goes to war
{
  // defence: enemies at its entrance get marker II and the fighters
  const w = createWorld({ seed: 31, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: true }] }, new EventBus());
  run(w, 30);
  const R = w.colony(1)!;
  army(w, 1, 'formica_soldier', 6, nestSpace(1), w.antById.get(R.queen)!.x + 8, w.antById.get(R.queen)!.y);
  const e = R.entrances[0];
  army(w, 0, 'lasius_soldier', 5, SURFACE, e.sx + 30, e.sy + 10);
  // the intruders hold their ground there (their own marker I), rather than wandering home before the defence arrives
  placeMarker(w, w.colony(0)!, 0, SURFACE, e.sx + 30, e.sy + 10);
  let sent = false;
  let engaged = 0;
  for (let i = 0; i < 40 * 20; i++) {
    w.step(0.05);
    w.events.drain();
    if (i % 20) continue;
    const m = R.markers[1];
    sent ||= m.placed && m.space === SURFACE && Math.hypot(m.x - e.sx, m.y - e.sy) < 120 && R.groups.some((g) => g.caste === 'formica_soldier' && g.marker === 1);
    engaged = Math.max(engaged, w.s.ants.filter((a) => a.colony === 1 && a.caste === 'formica_soldier' && a.space === SURFACE && (a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Spray)).length);
  }
  check('rival AI: enemies at its entrance get marker II and its soldiers', sent && engaged >= 2, `marker II ${sent ? 'placed, soldiers sent' : 'not used'}, ${engaged} soldiers fighting`);
  // once clear, the defenders go home
  run(w, 40);
  const lifted = !R.markers[1].placed || !w.s.ants.some((a) => a.colony === 0 && a.state !== AS.Dead && a.space === SURFACE && Math.hypot(a.x - e.sx, a.y - e.sy) < 90);
  check('rival AI: the defence marker is lifted once the entrance is clear', lifted && (!R.markers[1].placed || R.aiWar!.defending), `marker II ${R.markers[1].placed ? 'still placed' : 'lifted'}`);
}
{
  // attack: a strong AI army raids a weak rival after the opening peace and kills its queen
  const w = createWorld({ seed: 32, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'lasius', player: false, ai: false }, { species: 'formica', player: false, ai: true }] }, new EventBus());
  run(w, 20);
  const R = w.colony(1)!;
  const L = w.colony(0)!;
  const q = w.antById.get(R.queen)!;
  army(w, 1, 'formica_soldier', 10, nestSpace(1), q.x + 8, q.y);
  army(w, 1, 'formica_mortar', 6, nestSpace(1), q.x - 8, q.y);
  let raided = -1;
  let early = false;
  for (let i = 0; i < 60 * 20; i++) {
    w.step(0.05);
    if (R.aiWar && R.aiWar.target >= 0) early = true;
  }
  w.s.time = Math.max(w.s.time, BALANCE.aiWar.firstRaid);
  for (let i = 0; i < 300 * 20 && L.alive; i++) {
    w.step(0.05);
    w.events.drain();
    if (raided < 0 && R.aiWar && R.aiWar.target === 0) raided = w.s.time;
  }
  check('rival AI: no raids during the opening peace', !early);
  check('rival AI: a strong army raids a weak rival and kills its queen', raided >= 0 && !L.alive, `raid set out at ${raided.toFixed(0)} s; rival ${L.alive ? 'still alive' : 'lost'} at ${w.s.time.toFixed(0)} s`);
  run(w, BALANCE.aiWar.every + 1);
  check('rival AI: the raid is called off once the rival has fallen', !R.markers[2].placed && R.aiWar!.target === -1, `marker III ${R.markers[2].placed ? 'still out' : 'home'}`);
}

// ---------------------------------------------------------------- Phase 13: missions and sandbox
{
  const setup = (mission: 'meadow' | 'forest', seed = 41): Parameters<typeof createWorld>[0] => ({
    seed,
    style: MISSIONS[mission].style,
    width: 640,
    depth: 640,
    food: 1.2,
    colonies: [{ species: MISSIONS[mission].species, player: true, ai: false, team: 0 }, ...(MISSIONS[mission].rival ? [{ species: MISSIONS[mission].rival!, player: false, ai: true }] : [])],
    mission,
  });
  const w = createWorld(setup('meadow'), new EventBus());
  const said: string[] = [];
  w.events.onAny((e) => {
    if (e.t === 'message' && e.kind === 'narrator') said.push(e.text);
  });
  run(w, 3);
  w.events.drain();
  const m = missionOf(w)!;
  check('missions: a mission starts at its first stage with live goals and a narrator', !!m && m.stage === 0 && m.goals.length > 0 && !m.goals[0].done && said.length >= 1, `${m?.goals.map((g) => g.text + ' ' + g.progress).join('; ')}; "${(said[0] ?? '').slice(0, 50)}…"`);
  // meeting the goal moves the mission on
  const c = w.colony(0)!;
  for (let i = 0; i < 12; i++) makeAnt(w, 0, CASTES[c.castes[0]] ? c.castes[0] : 'lasius_worker', nestSpace(0), w.antById.get(c.queen)!.x + 5, w.antById.get(c.queen)!.y);
  w.reindex();
  run(w, 3);
  check('missions: meeting the goals moves on to the next stage', missionOf(w)!.stage === 1, `stage ${missionOf(w)!.stage}, ${c.living} ants`);
  // the finale brings the boss, weaker than in the sandbox; killing it wins the mission
  const last = MISSIONS.meadow.stages.length - 1;
  missionOf(w)!.stage = last;
  missionOf(w)!.entered = false;
  run(w, 2);
  const boss = w.creatureById.get(missionOf(w)!.target);
  check('missions: the finale brings the boss toward the nest', !!boss && boss.kind === 'stagBeetle' && boss.maxHp < CREATURES.stagBeetle.hp && boss.data.gx !== undefined, boss ? `${boss.kind}, ${boss.maxHp} hp` : 'none');
  if (boss) {
    boss.hp = 0;
    boss.dead = true;
  }
  run(w, 2);
  check('missions: bringing the boss down completes the mission', missionOf(w)!.result === 'won');
  // losing: the queen dies
  const w2 = createWorld(setup('forest'), new EventBus());
  run(w2, 2);
  killAnt(w2, w2.antById.get(w2.colony(0)!.queen)!);
  run(w2, 3);
  check('missions: the mission is lost with the queen', missionOf(w2)!.result === 'lost' && !w2.colony(0)!.alive);
  // the forest rival (a developed AI colony) waits for the story's war stage before it raids (Phase 15 playtest)
  const w3 = createWorld({ ...setup('forest'), colonies: [setup('forest').colonies[0], { species: 'lasius', player: false, ai: true, developed: 6, startWorkers: 14 }] }, new EventBus());
  run(w3, 12 * 60);
  const rivalBrain = w3.colony(1)!.aiWar;
  const early = !rivalBrain || rivalBrain.target < 0;
  missionOf(w3)!.stage = MISSIONS.forest.stages.findIndex((st) => st.name === 'The rival colony');
  missionOf(w3)!.entered = false;
  check('missions: the forest rival does not raid before the war stage (it may raid from then on)', early && rivalsMayRaid(w3), `stage ${missionOf(w3)!.stage}`);
  // a mission game is deterministic
  const a = createWorld(setup('forest', 9), new EventBus());
  const b = createWorld(setup('forest', 9), new EventBus());
  run(a, 90);
  run(b, 90);
  check('missions: two runs of a mission game agree exactly', hashState(a) === hashState(b) && missionOf(a)!.goals.length > 0, hashState(a));
  // sandbox commands: refused in other games, working in a sandbox
  const mk = (body: CommandBody, seq = 0): Command => ({ ...body, tick: 0, player: 0, seq }) as Command;
  const results: Array<{ ok: boolean; why?: string }> = [];
  const plain = createWorld({ ...setup('meadow'), mission: undefined }, new EventBus());
  plain.events.onAny((e) => e.t === 'command' && results.push({ ok: e.ok, why: e.why }));
  applyCommandsNow(plain, [mk({ type: 'sandboxSpawn', kind: 'tarantula', space: SURFACE, x: 300, y: 300 })]);
  plain.events.drain();
  const sb = createWorld({ ...setup('meadow'), mission: undefined, sandbox: true }, new EventBus());
  const n0 = sb.s.creatures.length;
  const sc = sb.colony(0)!;
  sc.food = 0;
  applyCommandsNow(sb, [mk({ type: 'sandboxSpawn', kind: 'tarantula', space: SURFACE, x: 300, y: 300 }), mk({ type: 'sandboxFood' }, 1), mk({ type: 'sandboxSet', key: 'infiniteFood', on: true }, 2), mk({ type: 'sandboxSet', key: 'creatures', on: false }, 3)]);
  check('sandbox: its commands are refused outside sandbox games', results.length === 1 && !results[0].ok, results[0]?.why ?? '');
  check('sandbox: spawn a boss, fill the stores, infinite food and creatures off', sb.s.creatures.length === n0 + 1 && sb.s.creatures[sb.s.creatures.length - 1].kind === 'tarantula' && sc.food === sc.foodCap && sc.infiniteFood && sb.s.settings.creatures === 0);
  // and they survive the wire format (replays, multiplayer logs)
  const log = [mk({ type: 'sandboxSpawn', kind: 'hogna', space: SURFACE, x: 12.5, y: 40.25 }), mk({ type: 'sandboxSet', key: 'creatures', on: true }, 1), mk({ type: 'sandboxFood' }, 2)];
  const back = decodeCommandLog(encodeCommandLog(log));
  check('sandbox: the commands encode and decode exactly', JSON.stringify(back) === JSON.stringify(log), JSON.stringify(back[0]));
}

// ---------------------------------------------------------------- Phase 11: creatures
{
  // Every kind has a model, and every state it can be in (alive, dead, half eaten) poses to finite transforms.
  const w = createWorld({ seed: 11, style: 'meadow', width: 400, depth: 400, food: 1, colonies: [{ species: 'lasius', player: true, ai: true }] }, new EventBus());
  const kinds = Object.keys(CREATURES);
  check('creatures: every kind has a body plan', kinds.every((k) => !!BUILDERS[k]), kinds.filter((k) => !BUILDERS[k]).join(','));
  const r = new CreatureRenderer('test');
  const list: Creature[] = kinds.map((k, i) => spawnCreature(w, k, SURFACE, 60 + (i % 5) * 60, 60 + Math.floor(i / 5) * 60));
  const flat = () => 0;
  let bad = '';
  let minInst = Infinity;
  for (let st = 0; st <= 18 && !bad; st++) {
    for (const variant of [0, 1, 2]) {
      for (const cr of list) {
        cr.state = st;
        cr.st = 0.7;
        cr.dead = variant > 0;
        cr.deadT = 2;
        cr.data.eaten = variant === 2 ? 0.6 : 0;
        cr.px = cr.x;
        cr.x += 0.4; // walking
      }
      r.update(list, SURFACE, 1, 1 / 30, flat, null, 720);
      const pools = (r.batch as unknown as { pools: Record<string, { mesh: { instanceMatrix: { array: Float32Array } }; n: number }> }).pools;
      for (const [name, pool] of Object.entries(pools)) {
        const a = pool.mesh.instanceMatrix.array;
        for (let i = 0; i < pool.n * 16; i++)
          if (!Number.isFinite(a[i])) {
            bad = `state ${st} variant ${variant}: non-finite ${name} matrix`;
            break;
          }
      }
      minInst = Math.min(minInst, r.stats.instances);
    }
  }
  check('creatures: all kinds pose to finite transforms in every state, alive, dead and half eaten', !bad && minInst > kinds.length * 3, bad || `${minInst}+ instances per frame for ${kinds.length} creatures`);
  // the renderer's cost per frame for 100 wild creatures on screen
  const many: Creature[] = [];
  const wild = ['pillbug', 'cutworm', 'groundBeetle', 'wolfSpider', 'lithobius', 'rove', 'mantis', 'antlion'];
  for (let i = 0; i < 100; i++) many.push(spawnCreature(w, wild[i % wild.length], SURFACE, 20 + (i % 10) * 36, 20 + Math.floor(i / 10) * 36));
  for (const cr of many) cr.state = 0;
  const r2 = new CreatureRenderer('bench');
  const t1 = performance.now();
  for (let f = 0; f < 120; f++) {
    for (const cr of many) {
      cr.px = cr.x;
      cr.x += 0.3;
    }
    r2.update(many, SURFACE, 0.5, 1 / 60, flat, null, 720);
  }
  const ms = (performance.now() - t1) / 120;
  check('creatures: posing 100 wild creatures takes under 8 ms a frame (about 2 ms on an idle machine)', ms < 8, `${ms.toFixed(2)} ms, ${r2.stats.instances} instances`);
  // a chain follows its own path: after walking a quarter circle, the tail lies on the arc, not on a straight line
  const cw = spawnCreature(w, 'cutworm', SURFACE, 200, 200);
  cw.h = 0;
  const r3 = new CreatureRenderer('chain');
  const R = 60;
  for (let k = 0; k <= 90; k++) {
    const a = (k / 90) * (Math.PI / 2);
    cw.px = cw.x;
    cw.py = cw.y;
    cw.x = 200 + Math.sin(a) * R;
    cw.y = 200 + R - Math.cos(a) * R;
    cw.ph = cw.h;
    cw.h = a;
    r3.update([cw], SURFACE, 1, 1 / 30, flat, null, 720);
  }
  const pool = (r3.batch as unknown as { pools: Record<string, { mesh: { instanceMatrix: { array: Float32Array } }; n: number }> }).pools.ell;
  const m = pool.mesh.instanceMatrix.array;
  // the last body ellipsoid is the tail segment: its distance from the circle centre should be ≈ R
  const tailIdx = pool.n - 3; // body, back stripe, side stripe of the last segment
  const tx = m[tailIdx * 16 + 12];
  const tz = m[tailIdx * 16 + 14];
  const dCentre = Math.hypot(tx - 200, tz - (200 + R));
  // boss telegraphs: a circle and a cone appear, fill up and are cleaned away; a slam ring fades
  const fx = new CombatFx();
  const flatH = () => 0;
  fx.emit({ t: 'telegraph', x: 10, y: 10, space: SURFACE, radius: 20, duration: 1.2, creature: 1 }, flatH);
  fx.emit({ t: 'telegraph', x: 10, y: 10, space: SURFACE, radius: 30, duration: 0.8, creature: 1, dir: 0.5, half: 0.6 }, flatH);
  fx.emit({ t: 'slam', x: 10, y: 10, space: SURFACE, radius: 25, power: 1 }, flatH);
  fx.emit({ t: 'hairs', x: 10, y: 10, space: SURFACE, radius: 25 }, flatH);
  const shown = fx.group.children.length;
  for (let i = 0; i < 15; i++) fx.update(0.05, flatH, 900);
  const mid = fx.group.children.length;
  for (let i = 0; i < 20; i++) fx.update(0.05, flatH, 900);
  check('creatures: boss telegraphs (circle, cone) and slam rings show, then clear away', shown === 4 && mid === 3 && fx.group.children.length === 1 && fx.liveCount > 0, `${shown} → ${mid} → ${fx.group.children.length} (the particle layer stays)`);
  check('creatures: a caterpillar body follows its path round a bend', Math.abs(dCentre - R) < R * 0.08, `tail ${dCentre.toFixed(1)} mm from the bend centre (path radius ${R})`);
}

// ---------------------------------------------------------------- Phase 14: saves, settings, medals
{
  // a save holds the whole game: restored, it hashes the same and runs on identically, mission and all
  const setup = { seed: 77, style: 'meadow' as const, width: 640, depth: 640, food: 1.2, colonies: [{ species: 'lasius' as const, player: true, ai: true, team: 0 }, { species: 'formica' as const, player: false, ai: true }], mission: 'meadow' as const };
  const w = createWorld(setup, new EventBus());
  run(w, 40);
  const snap = encodeState(w);
  const header: SaveHeader = { build: 'test', title: 'A Meadow Kingdom', mode: 'mission', mission: 'meadow', local: 0, species: 'lasius', colonyName: w.colony(0)!.name, ants: w.colony(0)!.living, time: w.s.time, tick: w.s.tick, date: new Date().toISOString() };
  const bytes = await encodeSave(header, snap);
  const back = await decodeSave(bytes);
  const r = restoreWorld(back.snapshot, new EventBus());
  check('saves: a save file restores the same world (header, snapshot, mission state)', hashState(r) === hashState(w) && readSaveHeader(bytes).title === 'A Meadow Kingdom' && missionOf(r)?.stage === missionOf(w)?.stage, `${(snap.length / 1024).toFixed(0)} kB snapshot → ${(bytes.length / 1024).toFixed(0)} kB file`);
  run(w, 60);
  run(r, 60);
  check('saves: a loaded game runs on exactly as the saved one', hashState(r) === hashState(w), hashState(r));
  let bad = '';
  try {
    readSaveHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  } catch (e) {
    bad = e instanceof Error ? e.message : String(e);
  }
  check('saves: a file that is not a save is refused with a message', bad.startsWith('Not an Underground Dominion save'), bad);
  await putSave('2', bytes);
  const list = await listSaves();
  check('saves: slots keep their saves (memory when there is no IndexedDB)', list.length === 1 && list[0].slot === '2' && list[0].header.ants === header.ants);
  // a replay of a loaded game carries its start snapshot
  const rp = encodeReplay({ build: 't', local: 0, ticks: 5, finalHash: 'x', date: '' }, encodeCommandLog([]), snap);
  const dr = decodeReplay(rp);
  check('saves: a replay of a loaded game starts from its snapshot', !!dr.snapshot && dr.snapshot.length === snap.length && fnv1a64(dr.snapshot) === fnv1a64(snap) && !dr.header.setup);

  // settings: stored, sanitized, and read back after a "reload"
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, String(v)) };
  resetCache();
  const table = rebind(bindingsOf(settings()), 'dig', 'KeyR');
  check('settings: rebinding to a key in use swaps the two', table.dig === 'KeyR' && table.recall === DEFAULT_BINDINGS.dig, `dig ${table.dig}, recall ${table.recall}`);
  updateSettings({ uiScale: 1.15, volume: { music: 0.2 } as never, bindings: bindingChanges(table), muted: true });
  resetCache();
  const st = settings();
  check('settings: they survive a reload', st.uiScale === 1.15 && st.volume.music === 0.2 && st.volume.master === 0.8 && st.volume.combat === 0.8 && st.muted && bindingsOf(st).dig === 'KeyR' && Object.keys(st.bindings).length === 2, JSON.stringify(st.bindings));
  const junk = sanitizeSettings({ quality: 'ultra', uiScale: 9, volume: { master: 7, creatures: NaN }, bindings: { nonsense: 'KeyQ', dig: '' } } as never);
  check('settings: malformed stored values fall back to the defaults', junk.quality === 'auto' && junk.uiScale === 1 && junk.volume.master === 1 && junk.volume.creatures === 0.8 && Object.keys(junk.bindings).length === 0);
  const old = sanitizeSettings({ volume: { master: 0.5, effects: 0.3, ambience: 0.4, music: 0.2 } } as never);
  check('settings: an old single effects slider becomes creatures, combat and interface', old.volume.creatures === 0.3 && old.volume.combat === 0.3 && old.volume.ui === 0.3 && old.volume.narration === 0.8);
  check('settings: keys print as on the keyboard', keyLabel('KeyW') === 'W' && keyLabel('Shift+Digit3') === 'Shift+3' && keyLabel('ArrowLeft') === '←' && keyLabel('Equal') === '=');
  // medals: by game time, the best kept
  const m1 = recordMedal('meadow', 33 * 60, 'lasius');
  const m2 = recordMedal('meadow', 50 * 60, 'formica');
  const m3 = recordMedal('meadow', 22 * 60, 'atta');
  resetCache();
  const kept = profile().medals.meadow;
  check('medals: gold under 25 min, silver under 40, bronze after; the best is kept', medalFor(24 * 60) === 'gold' && medalFor(39 * 60) === 'silver' && medalFor(41 * 60) === 'bronze' && m1.best && m1.record.medal === 'silver' && !m2.best && m2.record.medal === 'silver' && m3.best && kept?.medal === 'gold' && kept.species === 'atta');
}

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
