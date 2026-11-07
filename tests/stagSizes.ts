/**
 * Stag beetle males of four sizes (claude/story/06-spec-levels-5-7-and-lengths.md §2): the kinds and their model sizes,
 * the titan untouched, wrestling (meeting, the bout, parting; broken off by ants; deterministic), wild spawning by biome,
 * and the balance targets in quick headless fights (tools/balance-matrix.ts `creatureFight`).
 *   npx vite-node tests/stagSizes.ts
 */
import * as THREE from 'three';
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { BALANCE, STAG, STAG_MALE } from '../src/sim/balance';
import { CREATURES, STAG_MALES, isStagMale, stagMaleGeom, wildKinds } from '../src/sim/creatures/kinds';
import { CS, creatureBody, spawnCreature } from '../src/sim/creatures/creatureAI';
import { startStagWrestle, wrestling } from '../src/sim/creatures/stagWrestle';
import { canDig } from '../src/sim/creatures/titanDig';
import { mountClass } from '../src/sim/creatures/climb';
import { CLIMB_DATA } from '../src/sim/creatures/climbData';
import { HEIGHTS } from '../src/sim/heightData';
import { hashState } from '../src/sim/snapshot';
import { BUILDERS, CrPose } from '../src/render/creatures/builders';
import { PrimitiveBatch, partGeometry } from '../src/render/creatures/primitives';
import { Rig } from '../src/render/creatures/rig';
import { SB } from '../src/render/creatures/stagBeetle';
import { stagMandibleShare } from '../src/render/anatomy/mandibleSpecs';
import { creatureFight } from '../tools/creatureFight';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const run = (w: World, ticks: number, each?: (t: number) => void) => {
  for (let i = 0; i < ticks; i++) {
    w.step(0.05);
    w.events.drain();
    each?.(i);
  }
};
function world(seed = 5, style = 'formicarium'): World {
  const w = createWorld({ seed, style, width: 700, depth: 700, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0 } } as never, new EventBus());
  w.terrain.clearArea(120, 120, 580, 580);
  return w;
}

// ---- the kinds
{
  const ks = STAG_MALES.map((id) => CREATURES[id]);
  check('four males: stagMinor, stagSmall, stagMedium, stagLarge (Lucanus cervus)', ks.every((k) => !!k && k.sci === 'Lucanus cervus' && isStagMale(k.id)), ks.map((k) => k?.name).join(', '));
  const up = (f: (k: (typeof ks)[0]) => number) => ks.every((k, i) => i === 0 || f(k) > f(ks[i - 1]));
  check('they grow in length, health, bite, strength and food', up((k) => k.length) && up((k) => k.hp) && up((k) => k.bite) && up((k) => k.strength) && up((k) => k.food), ks.map((k) => `${k.length} mm ${k.hp} hp`).join(' · '));
  const T = CREATURES.stagBeetle.length;
  check('scaled down from the titan: about 0.45 / 0.55 / 0.7 / 0.85 of its length', ks.every((k, i) => Math.abs(k.length / T - [0.45, 0.55, 0.7, 0.85][i]) < 0.03));
  check('not bosses, never dig into nests, large creatures for mounting', ks.every((k) => !k.boss && !k.dig && !canDig(k) && mountClass(k.id) === 'large'));
  check('every male has its facts (larval nutrition, rivals thrown, larvae in dead wood, short adult life on sap)', ks.every((k) => k.facts.length >= 3) && ks.some((k) => k.facts.some((f) => /larva/.test(f) && /fed|feed/.test(f))) && ks.some((k) => k.facts.some((f) => /throws/.test(f))) && ks.some((k) => k.facts.some((f) => /3 to 7 years/.test(f))) && ks.some((k) => k.facts.some((f) => /sap/.test(f))));
  check('climbing and height data for each (tools/climb-data.ts, tools/height-data.ts)', ks.every((k) => !!CLIMB_DATA[k.id] && CLIMB_DATA[k.id].slots.length >= 6 && CLIMB_DATA[k.id].slots.length <= BALANCE.mount.capLarge && !!HEIGHTS.creature[k.id]));
}

// ---- the model: male sizes 0–3 (heads and antlers), centred on the body; the sim's mirror of the layout agrees
{
  const M = STAG_MALE.model;
  check('the sim layout mirrors the model (elytra apex, antler hinge, antler length)', M.back === SB.elytra.x0 && M.hinge === SB.mand.x && STAG_MALES.every((id) => Math.abs(stagMaleGeom(id)!.share - stagMandibleShare(stagMaleGeom(id)!.msize)) < 1e-12));
  check('male sizes 0, 1, 2, 3 (msize q/4); the titan none', STAG_MALES.every((id, q) => STAG_MALE.size[id].msize === q / 4) && stagMaleGeom('stagBeetle') === null);
  const parts = (kind: string): string[] => {
    const batch = new PrimitiveBatch();
    const names: string[] = [];
    const ab = batch as unknown as { addPart: (...a: unknown[]) => void };
    const add = ab.addPart.bind(batch);
    ab.addPart = (name: unknown, ...rest: unknown[]) => {
      names.push(name as string);
      add(name, ...rest);
    };
    const rig = new Rig(batch);
    const L = CREATURES[kind].length;
    const pose = { L, x: 0, z: 0, h: 0, hx: 0, hz: 0, phase: 0, amp: 0, t: 0, state: 0, st: 0, dead: false, deadT: 0, eaten: 0, v2: 0.3, hurt: 0, data: {}, trail: new Float32Array(0), trailN: 0, trailStep: 1, ground: () => 0 } as CrPose;
    BUILDERS[kind](rig, pose);
    return names;
  };
  const ok = STAG_MALES.every((id, q) => {
    const n = parts(id);
    return n.includes(`stag_head${q}`) && n.includes(`stag_mandL${q}`) && n.includes(`stag_mandR${q}`);
  });
  const t = parts('stagBeetle');
  check('the models draw heads and antlers of sizes 0–3; the titan still a major (4)', ok && t.includes('stag_head4') && t.includes('stag_mandL4'));
  // centred: the body frame sits forward by the model shift; the outline capsule spans elytra apex to antler tips
  const frames = STAG_MALES.map((id) => CLIMB_DATA[id].frames.body[0]);
  check('each male is drawn forward so its body is centred on it (smaller males more: shorter antlers)', frames.every((f, i) => Math.abs(f - stagMaleGeom(STAG_MALES[i])!.off) < 1e-3 && (i === 0 || f < frames[i - 1])) && CLIMB_DATA.stagBeetle.frames.body[0] === 0, frames.join(', '));
  const w = world();
  const spans = STAG_MALES.map((id) => {
    const cr = spawnCreature(w, id, SURFACE, 300, 300);
    const b = creatureBody(cr);
    const G = stagMaleGeom(id)!;
    return Math.abs((b.hl + b.r) / cr.scale - (M.hinge + M.tipK * G.share - M.back) / 2);
  });
  check('their outline reaches from the elytra apex to the antler tips', spans.every((d) => d < 1e-9));
  // the posed model: the shell, head and antlers never below the ground, finite in every state it can be in (the wrestle
  // too; legs and feet left out: the feet stand on it)
  let bad = '';
  let lowest = Infinity;
  const v = new THREE.Vector3();
  for (const id of STAG_MALES) {
    const L = CREATURES[id].length;
    for (const st of [0, CS.WindUp, CS.Lift, CS.Rear, CS.Spar, CS.Lock, CS.Heave, CS.Thrown, CS.Display])
      for (const sec of [0.2, 0.9, 1.3, 1.7, 2.6, 3.5]) {
        const batch = new PrimitiveBatch();
        const ab = batch as unknown as { addPart: (...a: unknown[]) => void };
        const addP = ab.addPart.bind(batch);
        let low = Infinity;
        ab.addPart = (name: unknown, m: unknown, ...rest: unknown[]) => {
          const mm = m as THREE.Matrix4;
          if (!mm.elements.every(Number.isFinite)) bad ||= `${id} state ${st} at ${sec} s: ${name} not finite`;
          if (/elytra|pronotum|under|head|mand/.test(name as string)) {
            const pos = partGeometry(name as string).getAttribute('position');
            for (let i = 0; i < pos.count; i += 3) low = Math.min(low, v.fromBufferAttribute(pos, i).applyMatrix4(mm).y);
          }
          addP(name, m, ...rest);
        };
        const rig = new Rig(batch);
        const pose = { L, x: 0, z: 0, h: 0, hx: 0, hz: 0, phase: 0, amp: 0, t: 1, state: st, st: sec, dead: false, deadT: 0, eaten: 0, v2: 0.3, hurt: 0, data: { wrZ: 0.26 * L, wrSide: 1 }, dt: 1 / 30, trail: new Float32Array(0), trailN: 0, trailStep: 1, ground: () => 0 } as CrPose;
        BUILDERS[id](rig, pose);
        lowest = Math.min(lowest, low / L);
        if (low < -0.01 * L) bad ||= `${id} state ${st} at ${sec} s: ${(low / L).toFixed(3)} L under the ground`;
      }
  }
  check('posed in every state (walking, grabbing, rearing, the wrestle) with nothing under the ground', !bad, bad || `lowest ${lowest.toFixed(3)} L`);
}

// ---- the titan: stats and behaviour numbers exactly as before
{
  const k = CREATURES.stagBeetle;
  const same =
    k.length === 100 && k.hp === 2600 && k.armor === 6 && k.speed === 9 && k.bite === 26 && k.attackInterval === 2.2 && k.sense === 90 && k.strength === 140 && k.food === 400 && k.mass === 300 && k.fleeAt === 0 && k.boss === true && k.wild === 0 && k.ai === 'stag' && k.biomes === undefined &&
    // (dig 0.8 since main's easier titan holes, 2026-11-03: claude/creatures/02-spec)
    k.dig?.can === true && k.dig.speed === 0.8 && k.dig.style === 'bulldoze';
  check('the titan stag beetle: its stats unchanged', same);
  const S = STAG;
  check('the titan: its moves unchanged (STAG, reach, clearance, 12 mount slots, model at the centre)', S.windUp === 0.9 && S.hold === 2 && S.liftS === 0.85 && S.squeeze === 12 && S.toss === 2.6 && S.sideBite === 0.45 && S.sideFling === 1.2 && S.plough === 0.42 && S.ploughHalf === 0.9 && S.shove === 26 && S.liftH === 0.22 && S.jaw === 0.42 && BALANCE.creatureReach.stagBeetle.r === 0.15 && BALANCE.creatureReach.stagBeetle.arc === 0.6 && BALANCE.combat2.clearance.stagBeetle === 0.08 && CLIMB_DATA.stagBeetle.slots.length === 12 && mountClass('stagBeetle') === 'huge');
  const w = world(6);
  const t = spawnCreature(w, 'stagBeetle', SURFACE, 300, 300);
  const b = creatureBody(t);
  check('the titan: its outline as before (0.22 / 0.24 of its length)', Math.abs(b.hl - 22) < 1e-9 && Math.abs(b.r - 24) < 1e-9);
  const m = spawnCreature(w, 'stagMedium', SURFACE, 420, 300);
  check('the titan never wrestles (the helper refuses it)', !startStagWrestle(w, t, m) && !wrestling(t) && !wrestling(m));
}

// ---- wrestling
interface Bout {
  started: number;
  faced: number;
  locked: number;
  winner: string;
  thrown: boolean;
  landedOnBack: boolean;
  parted: number;
  hurt: boolean;
  hash: string;
  apart: number;
}
function bout(seed: number, ka: string, kb: string, gap = 90, staged = false): Bout {
  const w = world(seed);
  const a = spawnCreature(w, ka, SURFACE, 300, 350);
  const b = spawnCreature(w, kb, SURFACE, 300 + gap, 356);
  if (staged) startStagWrestle(w, a, b);
  const r: Bout = { started: -1, faced: -1, locked: -1, winner: '', thrown: false, landedOnBack: false, parted: -1, hurt: false, hash: '', apart: 0 };
  run(w, 20 * 60, (i) => {
    const t = i / 20;
    if (r.started < 0 && wrestling(a) && wrestling(b)) r.started = t;
    if (r.faced < 0 && a.state === CS.Spar && b.state === CS.Spar) r.faced = t;
    if (r.locked < 0 && a.state === CS.Lock && b.state === CS.Lock) r.locked = t;
    if (a.state === CS.Heave && b.state === CS.Thrown) r.winner = 'a';
    if (b.state === CS.Heave && a.state === CS.Thrown) r.winner = 'b';
    for (const c of [a, b]) if (c.state === CS.Thrown && c.data.wrLand) r.landedOnBack = true;
    if (r.winner && (a.state === CS.Thrown || b.state === CS.Thrown)) r.thrown = true;
    if (r.started >= 0 && r.parted < 0 && !wrestling(a) && !wrestling(b)) {
      r.parted = t;
      r.apart = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  r.hurt = a.hp < a.maxHp || b.hp < b.maxHp;
  r.hash = hashState(w);
  return r;
}
{
  const r = bout(3, 'stagMedium', 'stagSmall');
  check('two males meet with no ants about and wrestle: face-off, lock, the lift and throw', r.started >= 0 && r.faced > r.started && r.locked > r.faced && !!r.winner && r.thrown && r.landedOnBack, JSON.stringify(r));
  check('…then they part, unhurt, further apart than when locked', r.parted > r.locked && !r.hurt && r.apart > (CREATURES.stagMedium.length + CREATURES.stagSmall.length) * 0.4, `parted at ${r.parted} s, ${r.apart.toFixed(0)} mm apart`);
  const r2 = bout(3, 'stagMedium', 'stagSmall');
  check('deterministic: the same seed gives the same bout (state hash, winner, times)', r.hash === r2.hash && r.winner === r2.winner && r.locked === r2.locked && r.parted === r2.parted);
  const r3 = bout(4, 'stagMedium', 'stagSmall');
  check('another seed: another bout', r3.hash !== r.hash);
  // the bigger male wins most bouts
  let big = 0;
  let n = 0;
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const q = bout(seed, 'stagLarge', 'stagMinor', 90, true);
    if (q.winner) n++;
    if (q.winner === 'a') big++;
  }
  check('the bigger male wins most bouts (large v minor)', n >= 5 && big >= n - 1, `${big} of ${n}`);
  // staged by the story director: two males far apart walk up to each other and wrestle now
  const s = bout(5, 'stagMinor', 'stagLarge', 200, true);
  check('startStagWrestle stages a bout at once, from farther apart', s.started === 0 && s.locked > 0 && !!s.winner && s.parted > s.locked, JSON.stringify(s));
}
{
  // ants coming break it off: both turn on them
  const w = world(7);
  const a = spawnCreature(w, 'stagSmall', SURFACE, 300, 350);
  const b = spawnCreature(w, 'stagSmall', SURFACE, 380, 350);
  startStagWrestle(w, a, b);
  run(w, 20 * 6);
  const locked = a.state === CS.Lock || a.state === CS.Spar;
  for (let i = 0; i < 6; i++) makeAnt(w, 0, 'lasius_worker', SURFACE, 340 + i * 2, 380, -Math.PI / 2);
  w.reindex();
  run(w, 20 * 3);
  check('ants coming near break the bout off', locked && !wrestling(a) && !wrestling(b) && (a.data.wrCd ?? 0) > w.s.time, `locked ${locked}`);
}
{
  // wild males spawn on forest maps only (and rarely: the large one the rarest)
  const forest = wildKinds('forest').map((k) => k.id);
  const meadow = wildKinds('meadow');
  const before = Object.values(CREATURES).filter((k) => k.wild > 0 && !k.biomes);
  check('wild males on forest and rainforest maps only; other maps keep their list', STAG_MALES.every((id) => forest.includes(id) && wildKinds('rainforest').some((k) => k.id === id)) && meadow.length === before.length && meadow.every((k, i) => k.id === before[i].id && k.w === before[i].wild));
  const w = (id: string) => CREATURES[id].wild;
  check('rarer than the common creatures, the large male rarest', STAG_MALES.every((id) => w(id) < w('groundBeetle') && w(id) > 0) && w('stagLarge') < w('stagMedium') && w('stagMedium') < w('stagSmall'));
}

// ---- balance at even level (black garden ant workers and soldiers): a quick check of the targets
{
  // [kind, caste, too few (it lives), enough (it dies, taking some with it)]
  const cases: Array<[string, string, number, number]> = [
    ['stagMinor', 'lasius_worker', 6, 12],
    ['stagSmall', 'lasius_worker', 8, 17],
    ['stagMedium', 'lasius_worker', 14, 27],
    ['stagMedium', 'lasius_soldier', 4, 9],
    ['stagLarge', 'lasius_worker', 25, 45],
    ['stagLarge', 'lasius_soldier', 7, 14],
  ];
  for (const [kind, caste, few, many] of cases) {
    const lo = creatureFight(kind, caste, few, 3);
    const hi = creatureFight(kind, caste, many, 3);
    check(`balance: ${kind} beats ${few} ${caste}s and dies to ${many}, killing some`, !lo.dead && lo.lost > 0 && hi.dead && hi.lost >= 2, `${few}: ${lo.dead ? 'died' : 'lived'} −${lo.lost}; ${many}: ${hi.dead ? 'died' : 'lived'} −${hi.lost}`);
  }
}

console.log(failed ? `${failed} stag size test(s) FAILED` : 'all stag size tests passed');
(globalThis as { process?: { exitCode?: number } }).process!.exitCode = failed ? 1 : 0;
