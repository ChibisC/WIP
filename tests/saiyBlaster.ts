/**
 * Saiy-Ant Blaster (CHANGE_PLAN §31; user spec 2026-11-07, claude/saiy-ants/09-spec-saiy-blaster.md):
 *  - the caste: brood tile, cost, AI mix, Termants steal it as "Saiy-Ant Blaster", its own tile look;
 *  - the gold form lasts at least 10 s;
 *  - orbs: the first enemy on the path takes the hit (not the target behind it), a teammate in the way is passed
 *    through, physical damage (armour counts), walls stop them, white-blue outside the gold form and gold in it;
 *  - in the gold form every fifth shot is the beam, never outside it;
 *  - the beam: 3 s, the ant planted and facing along it, every enemy along it hurt each pulse, never a teammate, cut
 *    short by a wall, finished when the gold form ends during it, broken by a fling; aimed at the densest line;
 *  - determinism: the same fight twice gives the same result, and a save in the middle of a beam goes on the same.
 *
 *   npx vite-node tests/saiyBlaster.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE, type Ant } from '../src/sim/types';
import { CASTES, SPECIES, casteOf } from '../src/sim/species';
import { BALANCE } from '../src/sim/balance';
import { makeAnt } from '../src/sim/factory';
import { casteCosts } from '../src/sim/tiles';
import { defaultMix } from '../src/sim/colonyAI';
import { STOLEN_CASTES, stolenName } from '../src/sim/termants';
import { surgeDuration } from '../src/sim/surge';
import { aimBeam, orbStep } from '../src/sim/saiyBlaster';
import { flingAnt } from '../src/sim/combat';
import { casteLook } from '../src/render/casteLook';
import { encodeState, restoreWorld } from '../src/sim/snapshot';

const t0 = Date.now();
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const B = BALANCE.blaster;

/** Open ground, a Saiy-Ant colony (0) against a black garden ant colony (1), nothing else. */
function arena(seed = 3) {
  const ev = new EventBus();
  const w = createWorld({ seed, style: 'formicarium', width: 600, depth: 600, colonies: [{ species: 'aurimyrmex', player: true, ai: false }, { species: 'lasius', player: false, ai: false }], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 } } as never, ev);
  w.s.settings.foodRespawn = 0;
  w.terrain.clearArea(150, 150, 450, 450);
  return { w, ev };
}

function put(w: ReturnType<typeof arena>['w'], colony: number, caste: string, x: number, y: number, h = 0): Ant {
  const a = makeAnt(w, colony, caste, SURFACE, x, y, h);
  a.task = 'idle' as never;
  return a;
}

/** Keep these ants where they are (stunned: they neither move nor fight). */
function freeze(ants: Ant[]): void {
  for (const a of ants) if (a.state !== AS.Dead) a.stun = 99;
}

/** The blaster attacking `tgt`. */
function engage(b: Ant, tgt: Ant): void {
  b.tgt = tgt.id;
  b.tk = 3;
  b.state = AS.Attack;
  b.st = 0;
}

// ---- the caste
{
  const cd = CASTES.aurimyrmex_blaster;
  check('caste: aurimyrmex_blaster exists, a Saiy-Ant soldier with the blast attack, light and fragile', !!cd && cd.species === 'aurimyrmex' && !!cd.blast && cd.hp < CASTES.aurimyrmex_worker.hp && cd.speed >= CASTES.aurimyrmex_worker.speed && cd.armor === 0 && cd.mount === 'none');
  check('caste: raised on its own brood tile (in the species list, costs and times in balance)', SPECIES.aurimyrmex.castes.includes('aurimyrmex_blaster') && !!BALANCE.castes.aurimyrmex_blaster && casteCosts('aurimyrmex_blaster').build > 0);
  const mix = defaultMix({ species: 'aurimyrmex' } as never);
  check('caste: the AI raises blasters', (mix.aurimyrmex_blaster ?? 0) > 0.05 && (mix.aurimyrmex_blaster ?? 0) < (mix.aurimyrmex_soldier ?? 0) + 0.01, JSON.stringify(mix));
  const st = STOLEN_CASTES.find((e) => e.caste === 'aurimyrmex_blaster');
  check('caste: Termants can steal it as "Saiy-Ant Blaster"', !!st && stolenName(st) === 'Saiy-Ant Blaster', st ? stolenName(st) : 'missing');
  const lk = casteLook('aurimyrmex_blaster');
  check('caste: its own tile look, unlike the other Saiy-Ant castes', lk.colour !== casteLook('aurimyrmex_worker').colour && lk.colour !== casteLook('aurimyrmex_soldier').colour && lk.pattern !== casteLook('aurimyrmex_worker').pattern && lk.pattern !== casteLook('aurimyrmex_soldier').pattern, `${lk.colour} ${lk.pattern}`);
  check('caste: its range is beyond any melee reach and short of the mortar', B.range > 20 && B.range < CASTES.formica_mortar.acid!.range);
}

// ---- the gold form lasts at least 10 s
{
  const { w } = arena();
  const a = put(w, 0, 'aurimyrmex_worker', 300, 300);
  const top = put(w, 0, 'aurimyrmex_worker', 300, 310);
  top.level = 3;
  check('gold form: at least 10 s (level 3 longer still)', surgeDuration(a) >= 10 && surgeDuration(top) >= surgeDuration(a), `${surgeDuration(a)} s, level 3 ${surgeDuration(top)} s`);
  void w;
}

// ---- orbs: the first enemy on the path
{
  const { w, ev } = arena();
  const b = put(w, 0, 'aurimyrmex_blaster', 280, 300, 0);
  const front = put(w, 1, 'lasius_worker', 300, 300.5);
  const back = put(w, 1, 'lasius_worker', 312, 300);
  const ally = put(w, 0, 'aurimyrmex_worker', 290, 300);
  w.reindex();
  engage(b, back);
  const hp0 = [front.hp, back.hp, ally.hp];
  let orbs = 0;
  let gold = false;
  const unsub = ev.onAny((e) => {
    if (e.t === 'orb') {
      orbs++;
      if (e.gold) gold = true;
    }
  });
  for (let i = 0; i < 40 && front.hp === hp0[0]; i++) {
    freeze([front, back, ally]);
    w.step(0.05);
    ev.drain();
  }
  check('orbs: fired outside the gold form are white-blue (not gold)', orbs >= 1 && !gold, `${orbs} orbs`);
  check('orbs: the first enemy on the path takes the hit, not the target behind it', front.hp < hp0[0] && back.hp === hp0[1], `front ${hp0[0]} → ${front.hp.toFixed(1)}, target ${back.hp.toFixed(1)}`);
  check('orbs: a teammate in the way is never hurt', ally.hp === hp0[2]);
  const dmg = hp0[0] - front.hp;
  check('orbs: physical damage (the full orb on an unarmoured ant)', Math.abs(dmg - B.orbDamage) < 1e-6, `${dmg.toFixed(2)}`);
}

// ---- armour counts (physical)
{
  const { w, ev } = arena();
  const b = put(w, 0, 'aurimyrmex_blaster', 280, 300, 0);
  const tank = put(w, 1, 'lasius_soldier', 310, 300);
  w.reindex();
  engage(b, tank);
  const hp0 = tank.hp;
  for (let i = 0; i < 40 && tank.hp === hp0; i++) {
    freeze([tank]);
    w.step(0.05);
    ev.drain();
  }
  const armor = casteOf('lasius_soldier').armor;
  const want = Math.max(B.orbDamage * 0.3, B.orbDamage - armor);
  check('orbs: armour counts as against a bite', Math.abs(hp0 - tank.hp - want) < 1e-6, `armour ${armor}: ${(hp0 - tank.hp).toFixed(2)} (expected ${want.toFixed(2)})`);
}

// ---- walls stop orbs
{
  const { w, ev } = arena();
  const T = w.terrain as unknown as { blocked: Uint8Array; nx: number; res: number };
  // a wall across x ≈ 300
  for (let y = 280; y <= 320; y += T.res * 0.5) {
    const k = Math.round(y / T.res) * T.nx + Math.round(300 / T.res);
    T.blocked[k] = 1;
  }
  const foe = put(w, 1, 'lasius_worker', 310, 300);
  w.reindex();
  const fizz: Array<{ wall?: boolean }> = [];
  ev.onAny((e) => {
    if (e.t === 'orbFizz') fizz.push(e);
  });
  const p = { id: w.nextId(), kind: 'orb' as const, space: SURFACE, x: 290, y: 300, vx: B.orbSpeed, vy: 0, t: 0, dmg: B.orbDamage, colony: 0, tgt: foe.id, tk: 3, life: 1 };
  let spent = false;
  for (let i = 0; i < 10 && !spent; i++) {
    const x0 = p.x;
    const y0 = p.y;
    p.t += 0.05;
    p.x += p.vx * 0.05;
    p.y += p.vy * 0.05;
    spent = orbStep(w, p as never, x0, y0);
  }
  ev.drain();
  check('orbs: a wall stops them (the enemy behind it is not hit)', spent && foe.hp === casteOf('lasius_worker').hp * w.s.settings.enemyStatMul && fizz.some((f) => f.wall));
  // and a blaster does not shoot into the wall: it walks round
  const b = put(w, 0, 'aurimyrmex_blaster', 280, 300, 0);
  w.reindex();
  engage(b, foe);
  let shot = 0;
  ev.onAny((e) => {
    if (e.t === 'orb') shot++;
  });
  for (let i = 0; i < 10; i++) {
    freeze([foe]);
    w.step(0.05);
    ev.drain();
  }
  check('orbs: a blaster with a wall in the way does not fire into it', shot === 0);
}

// ---- the gold form: every fifth shot is the beam; never outside it
{
  const { w, ev } = arena();
  const b = put(w, 0, 'aurimyrmex_blaster', 280, 300, 0);
  const foes = [put(w, 1, 'lasius_soldier', 305, 300)];
  w.reindex();
  foes[0].hp = foes[0].maxHp = 1e6;
  engage(b, foes[0]);
  b.surgeT = 60;
  const shots: string[] = [];
  ev.onAny((e) => {
    if (e.t === 'orb') shots.push(e.gold ? 'O' : 'o');
    if (e.t === 'beam') shots.push('B');
  });
  for (let i = 0; i < 20 * 30 && shots.length < 10; i++) {
    freeze(foes);
    b.surgeT = Math.max(b.surgeT ?? 0, 30);
    w.step(0.05);
    ev.drain();
  }
  check('gold: shots 1–4 are gold orbs, the fifth the beam, then again', shots.slice(0, 10).join('') === 'OOOOBOOOOB', shots.join(''));
  // outside the gold form: no beam however many shots
  const r = arena();
  const b2 = put(r.w, 0, 'aurimyrmex_blaster', 280, 300, 0);
  const f2 = put(r.w, 1, 'lasius_soldier', 305, 300);
  r.w.reindex();
  f2.hp = f2.maxHp = 1e6;
  engage(b2, f2);
  let beams = 0;
  let orbs = 0;
  r.ev.onAny((e) => {
    if (e.t === 'beam') beams++;
    if (e.t === 'orb') orbs++;
  });
  for (let i = 0; i < 20 * 14; i++) {
    freeze([f2]);
    b2.surgeT = 0;
    b2.surgeCd = 99;
    r.w.step(0.05);
    r.ev.drain();
  }
  check('normal form: orbs only, never the beam', beams === 0 && orbs >= 8, `${orbs} orbs, ${beams} beams`);
}

// ---- the beam
{
  const { w, ev } = arena();
  const b = put(w, 0, 'aurimyrmex_blaster', 250, 300, 0);
  const line = [268, 279, 297, 306].map((x) => put(w, 1, 'lasius_worker', x, 300));
  const beyond = put(w, 1, 'lasius_worker', 250 + casteOf('aurimyrmex_blaster').length * B.beamReach + 12, 300);
  const ally = put(w, 0, 'aurimyrmex_worker', 288, 300.5);
  w.reindex();
  for (const o of [...line, beyond]) o.hp = o.maxHp = 1e6;
  engage(b, line[0]);
  b.surgeT = 60;
  b.shotN = B.beamEvery - 1;
  b.cd2 = 0;
  let began = -1;
  let ended = -1;
  let tick = 0;
  ev.onAny((e) => {
    if (e.t === 'beam') began = tick;
    if (e.t === 'beamEnd') ended = tick;
  });
  const hp0 = line.map((o) => o.hp);
  let x0 = 0;
  let h0 = 0;
  let moved = 0;
  let turned = 0;
  for (; tick < 20 * 6 && ended < 0; tick++) {
    freeze([...line, beyond, ally]);
    if (began >= 0 && tick === began + 1) {
      x0 = b.x;
      h0 = b.h;
      // the gold form runs out a second into the beam: the beam goes on
      b.surgeT = 0.95;
      // an order to go elsewhere does nothing while it beams
      b.task = 'marker' as never;
    }
    if (began >= 0 && tick > began) {
      moved = Math.max(moved, Math.abs(b.x - x0));
      turned = Math.max(turned, Math.abs(b.h - h0));
    }
    w.step(0.05);
    ev.drain();
  }
  const pulses = Math.round(B.beamTime / B.beamTick);
  const per = B.beamDamage * BALANCE.surge.damageMul;
  const took = line.map((o, k) => hp0[k] - o.hp);
  check('beam: 3 s (60 ticks), and it finished after the gold form ended', began >= 0 && ended - began === Math.round(B.beamTime * 20), `began ${began}, ended ${ended}`);
  check('beam: the ant stays planted and facing along it', moved < 1e-9 && turned < 1e-9, `moved ${moved}, turned ${turned}`);
  check('beam: every enemy along it hurt every pulse', took.every((d) => Math.abs(d - per * pulses) < 1e-6), took.map((d) => d.toFixed(1)).join(', ') + ` (expected ${(per * pulses).toFixed(1)})`);
  check('beam: never a teammate, nor an enemy beyond its reach', ally.hp === ally.maxHp && beyond.hp === beyond.maxHp);
}

// ---- the beam: a wall cuts it short; a fling breaks it; aimed at the densest line
{
  const { w, ev } = arena();
  const T = w.terrain as unknown as { blocked: Uint8Array; nx: number; res: number };
  for (let y = 285; y <= 315; y += T.res * 0.5) T.blocked[Math.round(y / T.res) * T.nx + Math.round(290 / T.res)] = 1;
  const b = put(w, 0, 'aurimyrmex_blaster', 260, 300, 0);
  const near = put(w, 1, 'lasius_worker', 275, 300);
  const far = put(w, 1, 'lasius_worker', 300, 300);
  w.reindex();
  for (const o of [near, far]) o.hp = o.maxHp = 1e6;
  engage(b, near);
  b.surgeT = 60;
  b.shotN = B.beamEvery - 1;
  for (let i = 0; i < 20 * 2; i++) {
    freeze([near, far]);
    w.step(0.05);
    ev.drain();
  }
  check('beam: a wall cuts it short (the enemy behind it untouched)', (b.beamT ?? 0) > 0 && near.hp < near.maxHp && far.hp === far.maxHp, `reach ${(b.beamL ?? 0).toFixed(1)} mm`);
  flingAnt(w, b, b.x - 5, b.y, 1);
  check('beam: a fling ends it', (b.beamT ?? 0) === 0 && b.state === AS.Flung);
}
{
  const { w } = arena();
  const b = put(w, 0, 'aurimyrmex_blaster', 300, 300, 0);
  const lone = put(w, 1, 'lasius_worker', 320, 300);
  // four in a line to the north-east
  const row = [1, 2, 3, 4].map((k) => put(w, 1, 'lasius_worker', 300 + k * 9, 300 + k * 9));
  w.reindex();
  // (one tick builds the spatial hashes the aim reads)
  freeze([b, lone, ...row]);
  w.step(0.05);
  const h = aimBeam(w, b, lone.x, lone.y);
  check('beam: aimed at the densest line of enemies in reach', Math.abs(h - Math.PI / 4) < 0.2, `heading ${((h * 180) / Math.PI).toFixed(1)}°`);
}

// ---- determinism: the same fight twice; a save mid-beam
function blasterFight(seed: number, saveAt = -1): string {
  const { w, ev } = arena(seed);
  for (let i = 0; i < 8; i++) put(w, 0, i < 5 ? 'aurimyrmex_blaster' : 'aurimyrmex_soldier', 260 - (i % 4) * 6, 290 + Math.floor(i / 4) * 10, 0);
  for (let i = 0; i < 14; i++) put(w, 1, i < 10 ? 'lasius_worker' : 'lasius_soldier', 330 + (i % 5) * 6, 280 + Math.floor(i / 5) * 9, Math.PI);
  w.reindex();
  for (const a of w.s.ants) if (a.caste === 'aurimyrmex_blaster') a.surgeT = 0;
  let world = w;
  for (let i = 0; i < 20 * 30; i++) {
    if (i === saveAt) {
      const snap = encodeState(world);
      world = restoreWorld(snap, ev) as typeof world;
    }
    world.step(0.05);
    ev.drain();
  }
  return world.s.ants.map((a) => `${a.id}:${a.state}:${a.hp.toFixed(4)}:${a.x.toFixed(3)}:${(a.beamT ?? 0).toFixed(2)}`).join('|');
}
{
  const a = blasterFight(7);
  const b = blasterFight(7);
  check('determinism: the same blaster fight twice ends the same', a === b);
  // a save taken while a beam is under way (found by running once and looking)
  const c = blasterFight(7, 20 * 12);
  check('determinism: a save in the middle of the fight goes on exactly the same', a === c);
}

console.log(`\n${failed ? `${failed} FAILED` : 'all Saiy-Ant Blaster tests passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
