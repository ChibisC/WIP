/**
 * Headless tests for the army ants (claude/army-ants package, plan Step 7): the five castes and the old soldier
 * id, the diet, the swarm raid (front, pulses, lanes, porters, flushing), Soldier posts along the whole trail (and
 * none with too few Soldiers), team carries, the living bridge (forms on a busy trail, ants cross it, it lets go
 * when the raid ends), pothole plugs, the Soldier's hook and group pinning, other species' models unchanged, and
 * determinism.
 *   npx vite-node tests/eciton.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt, makeFood } from '../src/sim/factory';
import { ECITON } from '../src/sim/balance';
import { CASTES, SPECIES, casteOf, canonCaste } from '../src/sim/species';
import { edible } from '../src/sim/diet';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { removeMarker } from '../src/sim/markers';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { MORPHS } from '../src/render/ants/morphs';
import { raidScene } from '../tools/ecitonScene';
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
function world(seed = 5): World {
  return createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 0, colonies: [{ species: 'eciton', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
}
function open(w: World): { x: number; y: number } {
  for (let k = 0; k < 400; k++) {
    const x = 220 + (k % 20) * 15;
    const y = 220 + Math.floor(k / 20) * 15;
    let ok = true;
    for (let dx = -30; dx <= 30 && ok; dx += 3) for (let dy = -30; dy <= 30 && ok; dy += 3) if (!w.walkable(SURFACE, x + dx, y + dy)) ok = false;
    if (ok) return { x, y };
  }
  return { x: 350, y: 350 };
}

// ---- data
{
  const sp = SPECIES.eciton;
  check('five army-ant castes: Worker 4, Porter 6.5, Media 8, Soldier 11, Queen 22 mm', sp.castes.join() === 'eciton_minor,eciton_submajor,eciton_media,eciton_major' && [4, 6.5, 8, 11].every((L, i) => CASTES[sp.castes[i]].length === L) && CASTES.eciton_queen.length === 22, sp.castes.map((k) => `${CASTES[k].name} ${CASTES[k].length}`).join(', '));
  check('the Soldier is the major, never carries, and has the hook; the Porter carries under the body', casteOf('eciton_major').name === 'Soldier' && !casteOf('eciton_major').forage && casteOf('eciton_major').carry === 0 && !!casteOf('eciton_major').hook && !!casteOf('eciton_submajor').porter);
  check('the old eciton_soldier id still works (saves, URLs, models)', casteOf('eciton_soldier').id === 'eciton_major' && canonCaste('eciton_soldier') === 'eciton_major' && MORPHS.eciton_soldier === MORPHS.eciton_major);
  const w = world();
  const c = w.colony(0)!;
  const kinds = (['insect', 'corpse'] as const).every((k) => edible(c, makeFood(w, k, SURFACE, 100, 100, 1)));
  const not = !edible(c, makeFood(w, 'seed', SURFACE, 100, 100, 1)) && !edible(c, makeFood(w, 'berry', SURFACE, 100, 100, 1)) && !edible(c, makeFood(w, 'crumb', SURFACE, 100, 100, 1, 'berry')) && !edible(c, makeFood(w, 'honeydew', SURFACE, 100, 100, 1));
  check('army ants eat insects, corpses and crumbs of them — no seeds, fruit or honeydew', kinds && not && edible(c, makeFood(w, 'crumb', SURFACE, 100, 100, 1, 'insect')));
  // a save from before the upgrade: its eciton_soldier ants load as Soldiers
  const a = makeAnt(w, 0, 'eciton_major', SURFACE, 300, 300, 0);
  a.caste = 'eciton_soldier';
  const w2 = restoreWorld(encodeState(w), new EventBus());
  check('a saved eciton_soldier loads as eciton_major', w2.antById.get(a.id)?.caste === 'eciton_major');
}

// ---- other species' models are unchanged by the builder options (hashes from before the upgrade)
{
  const base = morphBase as Record<string, string>;
  const changed = Object.keys(base).filter((k) => MORPHS[k] && hashMorph(k) !== base[k]);
  check(`other species' ant models are byte-identical (${Object.keys(base).length} morphs, LOD0 and LOD1)`, changed.length === 0, changed.join(', '));
}

// ---- the swarm raid
{
  const r = raidScene({ minors: 40, porters: 8, medias: 5, majors: 8, seconds: 120, seed: 5, creatures: 4 });
  const L = r.minL;
  check('the front roams the raid area (it creeps on and turns back in at its edge)', r.frontTravel > 150 && r.maxFrontDist <= r.radius * ECITON.raid.areaMul + 1, `roamed ${r.frontTravel.toFixed(0)} mm, at most ${r.maxFrontDist.toFixed(0)} mm from the marker`);
  check('raiders pulse: run ahead, fall back, wait', r.pulseShare > 0.3 && r.pulseShare < 0.9 && r.raidStates > 200, `${(100 * r.pulseShare).toFixed(0)} % of raid samples surging forward`);
  check('three lanes: outbound ants keep to the sides of the trail, laden ants to the middle', r.laneOut - r.laneIn > 0.5 * L && r.laneOutN > 100 && r.laneInN > 100, `outbound ${(r.laneOut / L).toFixed(2)} L, laden ${(r.laneIn / L).toFixed(2)} L from the centre`);
  check('porters carry their load under the body', r.porterCarry > 50 && r.porterUnderShare > 0.99, `${(100 * r.porterUnderShare).toFixed(0)} % of ${r.porterCarry} samples`);
  check('the raid brings prey home and leaves the seeds', r.food > 100 && r.seedsTaken === 0, `food ${r.food.toFixed(0)}`);
  check('small creatures near the front are flushed', r.flushed > 0, `${r.flushed} samples`);
  check('team carries: porters lead helpers carrying big prey whole', r.teamSec > 2, `${r.teamSec.toFixed(0)} s of team carrying`);
  const total = r.routeLen;
  const arcs = r.postArcs.slice().sort((a, b) => a - b);
  check('Soldiers guard posts along the whole trail, from near the entrance to the front', r.posts.length >= 5 && arcs[0] < 40 && arcs[arcs.length - 1] > total - 15 && r.guards >= 4, `${r.posts.length} posts at ${arcs.map((s) => s.toFixed(0)).join(', ')} of ${total.toFixed(0)} mm; ${r.guards} at their posts`);
  check('every post faces away from the trail', r.outward === r.posts.length);
  const mid = arcs.filter((s) => s > total * 0.3 && s < total * 0.7).length;
  const ends = arcs.filter((s) => s < total * 0.3 || s > total * 0.7).length;
  check('posts are densest at both ends of the trail', ends > mid, `${ends} in the outer 30 % at each end, ${mid} in the middle 40 %`);
  const few = raidScene({ minors: 40, porters: 8, medias: 5, majors: ECITON.guard.minMajors - 1, seconds: 40, seed: 5 });
  const raidingMajors = few.w.s.ants.filter((a) => a.caste === 'eciton_major' && a.state !== AS.Dead && a.state !== AS.Guard).length;
  check(`with fewer than ${ECITON.guard.minMajors} Soldiers there are no posts: they raid with the others`, few.posts.length === 0 && few.guards === 0 && raidingMajors === ECITON.guard.minMajors - 1);
}

// ---- living bridge and pothole plugs
{
  let doneAt = -1;
  let released = -1;
  const r = raidScene({
    minors: 40,
    porters: 8,
    medias: 5,
    majors: 8,
    seconds: 110,
    seed: 5,
    puddle: true,
    onSecond: (w, t) => {
      const c = w.colony(0)!;
      if (doneAt < 0 && (c.ecLinks ?? []).some((L) => L.kind === 1 && L.done === 1)) doneAt = t;
      if (t === 60) removeMarker(w, c, 0);
      if (t > 60 && released < 0 && !w.s.ants.some((a) => a.state === AS.Bridge || a.state === AS.Plug)) released = t;
    },
  });
  check('a living bridge forms where the busy trail runs over water', doneAt >= 0 && doneAt < 60, `finished at ${doneAt} s`);
  check('ants cross the finished bridge', r.crossings > 20, `${r.crossings} crossings`);
  check('pothole plugs: workers lie in dips on the trail', r.pluggedTicks > 0, `${(r.pluggedTicks / 20).toFixed(0)} plug-seconds`);
  check('when the raid ends the bridge and the plugs let go, and the workers walk off dry', released > 60 && released <= 60 + ECITON.bridge.dissolveAfter + 30 && r.w.s.ants.every((a) => a.state === AS.Dead || a.space !== SURFACE || r.w.walkable(SURFACE, a.x, a.y) || (a.link ?? -1) >= 0), `released at ${released} s`);
}

// ---- the Soldier's hook and group pinning
{
  const w = world();
  const p = open(w);
  const maj = makeAnt(w, 0, 'eciton_major', SURFACE, p.x - 8, p.y, 0);
  const vic = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x, p.y, Math.PI);
  vic.hp = vic.maxHp = 500;
  maj.task = 'guard';
  maj.tgt = vic.id;
  maj.tk = 3;
  maj.state = AS.Attack;
  w.reindex();
  let pinned = 0;
  let bitten = 0;
  for (let i = 0; i < 100 && !bitten; i++) {
    run(w, 1);
    if (vic.hp < 500) {
      bitten = 500 - vic.hp;
      pinned = vic.pinned;
    }
  }
  const expect = 11 * ECITON.hook.softBonus; // armour 0: the soft bonus (statMul 1)
  check(`the Soldier's hook holds its victim (pinned ${ECITON.hook.hold} s) and bites ×${ECITON.hook.softBonus} through no armour`, pinned > ECITON.hook.hold - 0.2 && Math.abs(bitten / w.s.settings.statMul - expect) < 0.6, `pinned ${pinned.toFixed(2)} s, bite ${bitten.toFixed(1)} (expected ${expect})`);
  // three army ants latched on a caterpillar: it cannot walk
  const w3 = world();
  const q = open(w3);
  const cr = spawnCreature(w3, 'cutworm', SURFACE, q.x, q.y);
  cr.hp = cr.maxHp = 1e6;
  for (let i = 0; i < ECITON.pin.minAttackers; i++) {
    const a = makeAnt(w3, 0, 'eciton_minor', SURFACE, q.x + Math.cos(i * 2.1) * 6, q.y + Math.sin(i * 2.1) * 6, 0);
    a.task = 'guard';
    a.tgt = cr.id;
    a.tk = 4;
    a.state = AS.Attack;
  }
  w3.reindex();
  let rooted = 0;
  for (let i = 0; i < 200; i++) {
    run(w3, 1);
    if ((cr.data.root ?? 0) > w3.s.tick) rooted++;
  }
  check(`${ECITON.pin.minAttackers} army ants holding (or riding) a creature spread-eagle it (it cannot walk)`, rooted > 50, `${rooted} of 200 ticks pinned`);
}

// ---- determinism
{
  const a = raidScene({ seconds: 60, seed: 7, puddle: true, creatures: 3 });
  const b = raidScene({ seconds: 60, seed: 7, puddle: true, creatures: 3 });
  const ha = hashState(a.w);
  check('determinism: two runs of the same raid give the same state hash', ha === hashState(b.w), ha);
  // a world restored mid-raid carries on exactly like the original
  const c = raidScene({ seconds: 30, seed: 7, puddle: true, creatures: 3 });
  const r = restoreWorld(encodeState(c.w), new EventBus());
  run(c.w, 400);
  run(r, 400);
  check('determinism: a world restored mid-raid stays in step with the original', hashState(c.w) === hashState(r));
}

console.log(failed ? `\n${failed} army-ant test(s) FAILED` : `\nall army-ant tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
