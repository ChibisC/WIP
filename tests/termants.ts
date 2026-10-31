/**
 * Headless tests for the Termants (claude/termyrms package, plan Step 8): data and the king, gene samples only
 * from enemy corpses delivered to the store, unlocking a stolen caste (its tile, its cost), the three-caste limit and
 * forgetting with refunds, the glue burst (slow, double acid), the wood store and digestion, carton walls (block
 * enemies, are chewed down, break), one queen and no replacement, other species' models
 * unchanged, and determinism.
 *   npx vite-node tests/termants.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Ant, AS, Carry, SURFACE, nestSpace } from '../src/sim/types';
import { makeAnt, makeFood } from '../src/sim/factory';
import { killAnt } from '../src/sim/antAI';
import { damageAnt, isEnemyAnt } from '../src/sim/combat';
import { antSpeed } from '../src/sim/movement';
import { BALANCE, TERMANT } from '../src/sim/balance';
import { CASTES, SPECIES, casteOf } from '../src/sim/species';
import { assignGroup, placeMarker } from '../src/sim/markers';
import { applyCommand } from '../src/sim/commands';
import { placeTile, tileAt, tileCost } from '../src/sim/tiles';
import { genesNear, genomeOf, STOLEN_CASTES, stolenOf, termantAI, threshold } from '../src/sim/termants';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { MORPHS } from '../src/render/ants/morphs';
import { hashMorph } from '../tools/morphHashLib';
import morphBase from './data/morph-hashes.json';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    w.step(0.05);
    w.events.drain();
  }
};
function world(rival = 'formica', ai = false, seed = 5): World {
  return createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'termant', player: true, ai }, { species: rival as 'formica', player: false, ai }], settings: { creatures: 0 } }, new EventBus());
}
/** workers at a surface marker beside the entrance, `n` of them */
function foragers(w: World, n: number, dx = 60): { mx: number; my: number } {
  const c = w.colony(0)!;
  const e = c.entrances[0];
  const mx = e.sx + dx;
  const my = e.sy;
  placeMarker(w, c, 0, SURFACE, mx, my);
  const ch = c.tiles.find((t) => t.type === 'queen')!;
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, 0, 'termant_worker', SURFACE, e.sx + (i % 5), e.sy + 2 + Math.floor(i / 5), 0);
    a.tile = ch.q;
    a.task = 'marker';
    a.marker = 0;
  }
  assignGroup(w, c, ch.group, 0);
  w.reindex();
  return { mx, my };
}
const cmd = (w: World, body: Parameters<typeof applyCommand>[1]) => applyCommand(w, body as never);

// ---- data
{
  const w = world();
  const c = w.colony(0)!;
  const king = w.antById.get(c.king ?? -1);
  const queen = w.antById.get(c.queen)!;
  check('Termants: worker, soldier, queen and king; display name from the config value', SPECIES.termant.common === 'Termants' && c.castes.join() === 'termant_worker,termant_soldier' && casteOf('termant_king').role === 'king');
  check('the king is spawned beside the queen in the royal chamber', !!king && king.caste === 'termant_king' && king.space === nestSpace(0) && Math.hypot(king.x - queen.x, king.y - queen.y) < 12, `${king ? Math.hypot(king.x - queen.x, king.y - queen.y).toFixed(1) : '-'} mm from her`);
  check('the stolen-caste table covers the species in the game', STOLEN_CASTES.length >= 8 && STOLEN_CASTES.every((e) => CASTES[e.caste]), STOLEN_CASTES.map((e) => e.name).join(', '));
  const base = morphBase as Record<string, string>;
  const changed = Object.keys(base).filter((k) => MORPHS[k] && hashMorph(k) !== base[k]);
  check(`other species' ant models are byte-identical (${Object.keys(base).length} morphs)`, changed.length === 0, changed.join(', '));
}

// ---- gene samples, unlocking
{
  const w = world();
  const c = w.colony(0)!;
  const { mx, my } = foragers(w, 12);
  // three dead Red Wood Ant soldiers by the marker, and two of the colony's own workers
  for (let i = 0; i < 3; i++) killAnt(w, makeAnt(w, 1, 'formica_soldier', SURFACE, mx + i * 6, my + 3, 0));
  for (let i = 0; i < 2; i++) killAnt(w, makeAnt(w, 0, 'termant_worker', SURFACE, mx - 6 - i * 5, my - 4, 0));
  w.reindex();
  const s0 = Object.keys(genomeOf(c).samples).length;
  let unlockedAt = -1;
  for (let t = 0; t < 20 * 150 && unlockedAt < 0; t++) {
    run(w, 1);
    if (c.castes.includes('formica_rapid')) unlockedAt = t / 20;
  }
  const G = genomeOf(c);
  check('no samples before anything is eaten', s0 === 0);
  check('enemy corpses carried home give gene samples for their species; the own dead give none', (G.samples.formica ?? 0) > 0 && !G.samples.termant, JSON.stringify(G.samples));
  check(`at ${TERMANT.geneThreshold.default} samples the Red Wood Ants' rapid sprayer is stolen: a brood tile the Termants can build`, unlockedAt > 0 && G.stolen.includes('formica_rapid'), `after ${unlockedAt.toFixed(0)} s`);
  check(`a stolen caste's tile costs ×${TERMANT.stolenCostMul} its own species' tile`, Math.abs(tileCost(c, 'brood', 'formica_rapid') - BALANCE.castes.formica_rapid.build * TERMANT.stolenCostMul) < 1e-9, `${tileCost(c, 'brood', 'formica_rapid')} food`);
  // raise one: the stolen ant is a Red Wood Ant rapid sprayer in the Termant colony
  const g = w.nest(0)!;
  let q = -1;
  for (let k = 0; k < g.cols * g.rows && q < 0; k++) if (g.isHexDug(k) && !g.isEntrance(k) && !tileAt(c, k)) q = k;
  const t = placeTile(w, c, 'brood', q, 'formica_rapid', true);
  check('its brood tile is placed like any other', !!t && t.caste === 'formica_rapid');
}

// ---- three at most; forgetting refunds the tiles
{
  const w = world('lasius');
  const c = w.colony(0)!;
  const G = genomeOf(c);
  for (const sp of ['formica', 'lasius', 'atta', 'solenopsis']) G.samples[sp] = 30;
  run(w, 40);
  check(`at most ${TERMANT.maxStolen} stolen castes; a fourth waits for one to be forgotten`, G.stolen.length === TERMANT.maxStolen && !!G.pending, `stolen ${G.stolen.join(', ')}, waiting ${G.pending}`);
  const g = w.nest(0)!;
  let q = -1;
  for (let k = 0; k < g.cols * g.rows && q < 0; k++) if (g.isHexDug(k) && !g.isEntrance(k) && !tileAt(c, k)) q = k;
  const forget = G.stolen[0];
  placeTile(w, c, 'brood', q, forget, true);
  const ants = w.s.ants.length;
  const food0 = w.s.food.filter((f) => f.space === nestSpace(0)).reduce((s, f) => s + f.amount, 0);
  const err = cmd(w, { type: 'forgetCaste', caste: forget, tick: w.s.tick, player: 0, seq: 1 });
  const food1 = w.s.food.filter((f) => f.space === nestSpace(0)).reduce((s, f) => s + f.amount, 0);
  check('forgetting a stolen caste removes its tiles with a refund (and kills nothing), and the waiting caste comes in', err === null && !c.castes.includes(forget) && !tileAt(c, q) && food1 > food0 && w.s.ants.length === ants && G.stolen.length === TERMANT.maxStolen && !G.pending, `refund ${(food1 - food0).toFixed(1)}; stolen ${G.stolen.join(', ')}`);
  check('the forgotten caste keeps only part of its samples', (G.samples[STOLEN_CASTES.find((e) => e.caste === forget)!.source] ?? 0) <= threshold(STOLEN_CASTES.find((e) => e.caste === forget)!) * TERMANT.forgetKeep);
}

// ---- glue burst, acid on glue
{
  const w = world('lasius');
  const p = { x: 380, y: 380 };
  const sol = makeAnt(w, 0, 'termant_soldier', SURFACE, p.x - 6, p.y, 0);
  const vic = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x, p.y, Math.PI);
  vic.hp = vic.maxHp = 500;
  sol.task = 'guard';
  sol.tgt = vic.id;
  sol.tk = 3;
  sol.state = AS.Attack;
  w.reindex();
  const v0 = antSpeed(w, vic);
  let gluedAt = -1;
  for (let t = 0; t < 120 && gluedAt < 0; t++) {
    run(w, 1);
    if ((vic.glueT ?? 0) > w.s.tick) gluedAt = t;
  }
  // (the glue alone: the soldier's grip also drags its victim to half speed while it holds on — combat v2.1)
  vic.slowT = 0;
  const v1 = antSpeed(w, vic);
  check(`the soldier's glue burst slows its target to ${TERMANT.glue.slowMul} ×`, gluedAt >= 0 && Math.abs(v1 / v0 - TERMANT.glue.slowMul) < 0.01, `speed ${v0.toFixed(1)} → ${v1.toFixed(1)}`);
  const hp = vic.hp;
  damageAnt(w, vic, 4, 'acid', null);
  const glueHit = hp - vic.hp;
  vic.glueT = 0;
  const hp2 = vic.hp;
  damageAnt(w, vic, 4, 'acid', null);
  const plainHit = hp2 - vic.hp;
  check(`formic acid hurts a glued target ×${TERMANT.glue.acidMul}`, Math.abs(glueHit - plainHit * TERMANT.glue.acidMul) < 1e-6, `${glueHit.toFixed(2)} vs ${plainHit.toFixed(2)}`);
}

// ---- wood
{
  const w = world();
  const c = w.colony(0)!;
  const { mx, my } = foragers(w, 8);
  const wood = makeFood(w, 'wood', SURFACE, mx, my, 1, 'branch');
  wood.amount = wood.max = 40;
  w.reindex();
  const food0 = c.food;
  let maxWood = 0;
  for (let t = 0; t < 20 * 90; t++) {
    run(w, 1);
    maxWood = Math.max(maxWood, c.wood ?? 0);
  }
  check('workers chew dead wood and store it apart from food', maxWood > 3, `wood store peaked at ${maxWood.toFixed(1)}`);
  const sol = makeAnt(w, 0, 'termant_soldier', SURFACE, mx, my, 0);
  check('soldiers leave the wood to the workers', !casteOf(sol.caste).wood && !!casteOf('termant_worker').wood);
  c.wood = TERMANT.wood.cap + 50;
  c.food = 0;
  const w0 = c.wood;
  run(w, 20 * 10);
  check(`wood digests slowly into food (${TERMANT.wood.digestRate} per s per 10 stored, × ${TERMANT.wood.toFood})`, (c.wood ?? 0) < w0 && c.food > 0, `${w0} wood → ${(c.wood ?? 0).toFixed(1)}; food ${c.food.toFixed(1)} (from ${food0.toFixed(0)} before)`);
}

// ---- carton walls
{
  const w = world('lasius');
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  // a wall on a dug hex next to the queen's chamber; an enemy worker inside the nest walking through it
  const qt = c.tiles.find((t) => t.type === 'queen')!;
  let wq = -1;
  for (const n of g.neighbors(qt.q)) if (n >= 0 && g.isHexDug(n) && !tileAt(c, n) && !g.isEntrance(n)) wq = n;
  if (wq < 0) for (let k = 0; k < g.cols * g.rows && wq < 0; k++) if (g.isHexDug(k) && !g.isEntrance(k) && !tileAt(c, k)) wq = k;
  const wall = placeTile(w, c, 'carton', wq, undefined, true)!;
  const ctr = g.hexCenter(wq);
  // an enemy two hexes away, heading straight through the wall's centre
  const nb = g.neighbors(wq).find((n) => n >= 0 && g.isHexDug(n) && !tileAt(c, n));
  const start = nb !== undefined ? g.hexCenter(nb) : { x: ctr.x - g.R * 1.7, y: ctr.y };
  const foe = makeAnt(w, 1, 'lasius_soldier', nestSpace(0), start.x, start.y, Math.atan2(ctr.y - start.y, ctr.x - start.x));
  foe.task = 'guard';
  w.reindex();
  let inside = false;
  let chewed = false;
  for (let t = 0; t < 20 * 6; t++) {
    foe.h = Math.atan2(ctr.y - foe.y, ctr.x - foe.x);
    foe.state = AS.Wander;
    // drive it at the wall each tick
    const before = wall.hp ?? 0;
    // (the movement path is what blocks it)
    (await import('../src/sim/movement')).moveForward(w, foe, 20, 0.05);
    if (g.hexAt(foe.x, foe.y) === wq) inside = true;
    if ((wall.hp ?? 0) < before) chewed = true;
    foe.cd = Math.max(0, foe.cd - 0.05);
  }
  check('a carton wall stops enemies; they chew at it instead', !inside && chewed, `hp ${wall.hp?.toFixed(0)} / ${TERMANT.cartonWall.hp}`);
  const own = makeAnt(w, 0, 'termant_worker', nestSpace(0), start.x, start.y, 0);
  let ownIn = false;
  for (let t = 0; t < 20 * 4 && !ownIn; t++) {
    own.h = Math.atan2(ctr.y - own.y, ctr.x - own.x);
    (await import('../src/sim/movement')).moveForward(w, own, 20, 0.05);
    if (g.hexAt(own.x, own.y) === wq) ownIn = true;
  }
  check("the colony's own ants pass through its doorway", ownIn);
  wall.hp = 2;
  foe.cd = 0;
  for (let t = 0; t < 40 && tileAt(c, wq); t++) {
    foe.h = Math.atan2(ctr.y - foe.y, ctr.x - foe.x);
    (await import('../src/sim/movement')).moveForward(w, foe, 20, 0.05);
    foe.cd = 0;
  }
  check('chewed down to nothing, the wall is gone', !tileAt(c, wq));
  check('carton walls are paid in wood', tileCost(c, 'carton') === TERMANT.cartonWall.cost);
}

// ---- the king (user note 2026-10-25): never targeted, no damage, a weak bite, dies with the queen; one queen, no replacement
{
  const w = world('lasius');
  const c = w.colony(0)!;
  const ch = c.tiles.find((t) => t.type === 'queen')!;
  for (let i = 0; i < 4; i++) makeAnt(w, 0, 'termant_worker', nestSpace(0), w.antById.get(c.queen)!.x + 8 + i, w.antById.get(c.queen)!.y, 0).tile = ch.q;
  w.reindex();
  const king = w.antById.get(c.king ?? -1)!;
  const foe = makeAnt(w, 1, 'lasius_soldier', nestSpace(0), king.x + 2, king.y, 0);
  const hp0 = king.hp;
  damageAnt(w, king, 500, 'bite', foe);
  damageAnt(w, king, 500, 'acid', foe);
  damageAnt(w, king, 500, 'pure', null);
  check('the king is never a target and takes no damage', !isEnemyAnt(foe, king) && king.hp === hp0 && king.state !== AS.Dead);
  check('the king bites weakly (less than a worker)', CASTES.termant_king.bite / CASTES.termant_king.attackInterval < CASTES.termant_worker.bite / CASTES.termant_worker.attackInterval);
  killAnt(w, foe);
  killAnt(w, w.antById.get(c.queen)!);
  check('the king dies the moment his queen does', king.state === AS.Dead);
  run(w, 40);
  check('one queen and no replacement: when she dies the colony is lost', !c.alive && w.s.ants.filter((a) => a.colony === 0 && a.caste === 'termant_queen' && a.state !== AS.Dead).length === 0);
}

// ---- AI decisions
{
  const w = world('lasius');
  const c = w.colony(0)!;
  const G = genomeOf(c);
  for (const sp of ['formica', 'lasius', 'atta', 'solenopsis']) G.samples[sp] = 30;
  run(w, 40);
  // the colony raises two of one stolen caste and none of the others: the AI forgets one with no ants
  const keep = G.stolen[0];
  c.counts[keep] = 2;
  for (const cs of G.stolen.slice(1)) c.counts[cs] = 0;
  const before = G.stolen.slice();
  termantAI(w, c);
  check('Termant AI: with a fourth caste waiting it forgets the stolen caste with the fewest living ants', G.stolen.includes(keep) && !G.pending && G.stolen.length === TERMANT.maxStolen && before.filter((cs) => !G.stolen.includes(cs)).length === 1 && before.indexOf(before.find((cs) => !G.stolen.includes(cs))!) === 1, `${before.join(', ')} → ${G.stolen.join(', ')}`);
  // intruders inside, wood in store: a carton wall planned beside the entrance
  const g = w.nest(0)!;
  c.wood = 30;
  c.intruders = [{ x: 0, y: 0 }];
  termantAI(w, c);
  const wall = c.tiles.find((t) => t.type === 'carton');
  check('Termant AI: under invasion, with the wood, it plans a carton wall beside the entrance', !!wall && !wall.built && g.neighbors(wall.q).some((n) => n >= 0 && g.isEntrance(n)));
  c.intruders = [];
  check('Termant AI: raids sooner a rival whose genes it nearly has', ((G.samples.eciton = threshold(stolenOf('eciton_major')!) * 0.8), genesNear(c, 'eciton')) && !genesNear(c, 'formica'));
}

// ---- AI and determinism
{
  const a = world('formica', true, 7);
  const b = world('formica', true, 7);
  run(a, 20 * 240);
  run(b, 20 * 240);
  const ca = a.colony(0)!;
  check('determinism: two 4-minute AI games (Termants v Red Wood Ants) give the same state hash', hashState(a) === hashState(b), hashState(a));
  check('the Termant AI grows its colony', a.s.ants.filter((x) => x.colony === 0 && x.state !== AS.Dead).length > 6 && ca.alive, `${a.s.ants.filter((x) => x.colony === 0 && x.state !== AS.Dead).length} ants, wood ${(ca.wood ?? 0).toFixed(1)}, samples ${JSON.stringify(genomeOf(ca).samples)}`);
  // two castes stolen mid-game (and their ants raised); a world restored from a snapshot stays in step
  const G = genomeOf(ca);
  G.samples.formica = 13;
  G.samples.lasius = 13;
  run(a, 40);
  const r = restoreWorld(encodeState(a), new EventBus());
  run(a, 20 * 120);
  run(r, 20 * 120);
  check('determinism: with two castes stolen, a world restored from a snapshot stays in step for 2 minutes', G.stolen.length === 2 && hashState(a) === hashState(r), `stolen ${G.stolen.join(', ')}`);
}

// ---- a stolen ant is its own species' ant, obeying the Termant colony
{
  const w = world('lasius');
  const c = w.colony(0)!;
  genomeOf(c).samples.formica = 13;
  run(w, 40);
  const p = { x: 380, y: 380 };
  const lancer = makeAnt(w, 0, 'formica_rapid', SURFACE, p.x - 12, p.y, 0);
  const foe = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x, p.y, Math.PI);
  foe.hp = foe.maxHp = 400;
  lancer.task = 'guard';
  foe.task = 'guard';
  c.aggressive = true;
  w.reindex();
  let sprayed = false;
  for (let t = 0; t < 20 * 5; t++) {
    run(w, 1);
    if (lancer.state === AS.Spray) sprayed = true;
  }
  check("a stolen Acid Lancer fights with its own species' formic-acid spray, for the Termants", sprayed && lancer.colony === 0 && foe.hp < 400, `foe ${foe.hp.toFixed(0)} / 400`);
}

void Carry;
void (null as unknown as Ant);
console.log(failed ? `\n${failed} Termant test(s) FAILED` : `\nall Termant tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
