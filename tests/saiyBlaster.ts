/**
 * Saiy-Ant Blaster (CHANGE_PLAN §31; user spec 2026-11-07, claude/saiy-ants/09-spec-saiy-blaster.md):
 *  - the caste: brood tile, cost, AI mix, Termants steal it as "Saiy-Ant Blaster", its own tile look;
 *  - the gold form lasts at least 10 s;
 *  - orbs: the first enemy on the path takes the hit (not the target behind it), a teammate in the way is passed
 *    through, physical damage (armour counts), walls stop them, white-blue outside the gold form and gold in it;
 *  - in the gold form every fifth shot is the beam, never outside it;
 *  - the beam: 3 s, the ant planted and facing along it, every enemy along it hurt each pulse, never a teammate, cut
 *    short by a wall, finished when the gold form ends during it, broken by a fling; aimed at the densest line;
 *  - determinism: the same fight twice gives the same result, and a save in the middle of a beam goes on the same;
 *  - balance rules: it backs off from melee only at a walk (melee catches it, gold or not); in a guard crowd it stands
 *    behind the melee line;
 *  - render: the pose (glow at rest, aiming with the jaws wide, braced for the beam); the effects (an orb runs on to the
 *    point it hit and bursts there; a beam shows until its end event and fades; pools reused); the sounds' catalog.
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
import { antToView } from '../src/game/antViews';
import type { AntView } from '../src/render/ants/antRenderer';
import { CombatFx } from '../src/render/game/combatFx';
import { SOUNDS } from '../src/audio/catalog';
import { guardSlot } from '../src/sim/guardLine';
import { placeMarker } from '../src/sim/markers';
import { hashState } from '../src/sim/snapshot';
import { Command, CommandSchedule, stepWithCommands } from '../src/sim/commands';
import { LocalHub } from '../src/net/transport';
import { NetGame, NetSim } from '../src/net/netGame';
import { Slot } from '../src/net/messages';
import { DEFAULT_LOBBY, matchPlayers, matchSetup } from '../src/net/match';
import { Rng } from '../src/core/rng';
import type { World } from '../src/sim/world';

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

// ---- balance rules: backing off at a walk; behind the melee line in a guard crowd
{
  const { w, ev } = arena(5);
  const b = put(w, 0, 'aurimyrmex_blaster', 300, 300, 0);
  const foe = put(w, 1, 'lasius_worker', 310, 300, Math.PI);
  w.reindex();
  freeze([foe]);
  engage(b, foe);
  b.surgeT = 9; // gold: × 1.5 speed — the back-off ignores it
  b.cd2 = 1;
  const x0 = b.x;
  for (let i = 0; i < 10; i++) {
    w.step(0.05);
    ev.drain();
    freeze([foe]);
    b.cd2 = Math.max(b.cd2, 0.5);
  }
  const v = (x0 - b.x) / 0.5;
  check('it backs off from melee at a walk (60 % of its own speed), gold or not', v > 0 && v <= casteOf(b.caste).speed * B.backoff * 1.05 + 1e-6, `${v.toFixed(1)} mm/s, its speed ${casteOf(b.caste).speed}, gold ${(casteOf(b.caste).speed * BALANCE.surge.speedMul).toFixed(0)}`);
}
{
  const { w } = arena(6);
  const c = w.colony(0)!;
  placeMarker(w, c, 0, SURFACE, 300, 300);
  const sol: Ant[] = [];
  const bl: Ant[] = [];
  for (let i = 0; i < 6; i++) sol.push(put(w, 0, 'aurimyrmex_soldier', 290 + i, 300 + i * 3, 0));
  for (let i = 0; i < 3; i++) bl.push(put(w, 0, 'aurimyrmex_blaster', 290 - i, 296 + i * 3, 0));
  for (const a of [...sol, ...bl]) {
    a.task = 'marker' as never;
    a.marker = 0;
  }
  c.markers[0].noGather = true;
  w.reindex();
  const m = c.markers[0];
  guardSlot(w, sol[0], c, 0);
  const face = m.face ?? 0;
  const depth = (a: Ant) => {
    const p = guardSlot(w, a, c, 0);
    return p ? (m.x - p.x) * Math.cos(face) + (m.y - p.y) * Math.sin(face) : NaN;
  };
  const ds = sol.map(depth);
  const db = bl.map(depth);
  check('in a guard crowd the Blasters stand behind the melee line', db.every((d) => d > Math.min(...ds) + B.holdBack * 0.6), `soldiers ${ds.map((d) => d.toFixed(0)).join(',')} mm back, Blasters ${db.map((d) => d.toFixed(0)).join(',')}`);
}

// ---- render: the pose
{
  const { w, ev } = arena(8);
  const b = put(w, 0, 'aurimyrmex_blaster', 300, 300, 0);
  const foe = put(w, 1, 'lasius_worker', 330, 310, Math.PI);
  w.reindex();
  const v = {} as AntView;
  antToView(w, b, v, 0, 0);
  check('pose: a faint mouth glow at rest, head straight', (v.mouthGlow ?? 0) > 0.02 && (v.mouthGlow ?? 0) < 0.2 && v.headYaw === 0, `glow ${v.mouthGlow?.toFixed(2)}`);
  engage(b, foe);
  b.state = AS.Spray;
  b.st = B.windup * 0.95;
  antToView(w, b, v, 0, 0);
  check('pose: aiming, the jaws part wide, the head turns to the target and the glow builds', v.mandible > 0.9 && Math.abs(v.headYaw) > 0.1 && (v.mouthGlow ?? 0) > 0.6, `jaws ${v.mandible.toFixed(2)}, head ${v.headYaw.toFixed(2)}, glow ${v.mouthGlow?.toFixed(2)}`);
  b.beamT = B.beamTime - 1;
  b.beamH = 0;
  b.beamL = 40;
  antToView(w, b, v, 0, 0);
  check('pose: braced for the beam (feet wide, body low, head steady, the mouth blazing)', (v.brace ?? 0) > 0.5 && (v.crouch ?? 0) > 0.2 && v.headYaw === 0 && (v.mouthGlow ?? 0) > 0.8, `brace ${v.brace?.toFixed(2)}, crouch ${v.crouch?.toFixed(2)}`);
  void ev;
}

// ---- render: the effects
{
  const fx = new CombatFx();
  const flat = () => 0;
  fx.emit({ t: 'orb', x: 0, y: 0, tx: 30, ty: 0, space: SURFACE, id: 1, pid: 77 }, flat);
  fx.update(0.05, flat, 900);
  check('effects: a fired orb is on screen', fx.blast.liveOrbs === 1);
  // the sim says it hit 30 mm on; the orb has flown 7.5 mm so far: it runs on (at most 60 ms more) and bursts there
  fx.emit({ t: 'orbHit', x: 30, y: 0, space: SURFACE, pid: 77 }, flat);
  fx.update(0.03, flat, 900);
  const still = fx.blast.liveOrbs;
  for (let i = 0; i < 4; i++) fx.update(0.03, flat, 900);
  check('effects: on a hit the orb runs on to the point and bursts there', still === 1 && fx.blast.liveOrbs === 0);
  fx.emit({ t: 'beam', x: 0, y: 0, h: 0, len: 50, space: SURFACE, id: 5 }, flat);
  for (let i = 0; i < 20; i++) fx.update(0.05, flat, 900);
  const on = fx.blast.liveBeams;
  fx.emit({ t: 'beamEnd', x: 0, y: 0, space: SURFACE, id: 5 }, flat);
  fx.update(0.1, flat, 900);
  const fading = fx.blast.liveBeams;
  fx.update(0.2, flat, 900);
  check('effects: a beam shows until its end and then fades out', on === 1 && fading === 1 && fx.blast.liveBeams === 0);
  for (let i = 0; i < 700; i++) fx.emit({ t: 'orb', x: 0, y: 0, tx: 30, ty: 0, space: SURFACE, id: 1, pid: 1000 + i }, flat);
  fx.update(0.01, flat, 900);
  check('effects: the orb pool reuses its oldest slots (512)', fx.blast.liveOrbs === 512);
}

// ---- sounds
{
  const ids = ['species.blaster_charge', 'species.blaster_orb', 'species.blaster_hit', 'species.blaster_beam'];
  check('sounds: the charge, the orb, the hit and the beam loop are in the catalog', ids.every((id) => SOUNDS.some((d) => d.id === id)) && !!SOUNDS.find((d) => d.id === 'species.blaster_beam')?.loop);
}

// ---- multiplayer: two clients in lockstep (an in-memory hub with lag), Blasters and Saiy soldiers fighting black
// garden ants by each client's base, orbs and beams flying; the same state hash at every checkpoint
{
  class Sim implements NetSim {
    sched = new CommandSchedule();
    constructor(public w: World) {}
    stepWith(cmds: Command[]): void {
      for (const c of cmds) this.sched.add(c);
      stepWithCommands(this.w, 0.05, this.sched);
      this.w.events.drain();
    }
    hash() {
      return Promise.resolve({ tick: this.w.s.tick, hash: hashState(this.w) });
    }
    snapshot() {
      return Promise.resolve(encodeState(this.w));
    }
  }
  const slot = (name: string, species: Slot['species'], peer: string): Slot => ({ kind: 'human', name, species, color: 0, ready: true, peer, ping: 0, token: peer, team: 0 });
  const players = matchPlayers([slot('Host', 'aurimyrmex', 'p0'), slot('Guest', 'lasius', 'p1')]);
  const setup = matchSetup(players, { ...DEFAULT_LOBBY, seed: 977 });
  const hub = new LocalHub();
  const lag = new Rng(3);
  hub.latency = () => 30 + lag.next() * 60;
  const eps = [hub.connect('p0', 'p0'), hub.connect('p1', 'p0')];
  const cl = [0, 1].map((i) => {
    const w = createWorld(setup, new EventBus());
    // the same armies on both machines, set up before the first tick (as a scenario would): 8 Blasters and 6 Saiy
    // soldiers against 24 workers and 6 soldiers, by the Saiy-Ants' entrance; the Blasters ready for their beam
    const e = w.colony(0)!.entrances[0];
    const ids: number[] = [];
    for (let k = 0; k < 14; k++) {
      const a = makeAnt(w, 0, k < 8 ? 'aurimyrmex_blaster' : 'aurimyrmex_soldier', SURFACE, e.sx + 30 - (k % 7) * 5, e.sy - 15 + Math.floor(k / 7) * 9, 0);
      // (the shot counter one short of the beam: the first shot in gold is the beam, so a 40 s test sees some)
      if (k < 8) a.shotN = B.beamEvery - 1;
      ids.push(a.id);
    }
    for (let k = 0; k < 30; k++) ids.push(makeAnt(w, 1, k < 24 ? 'lasius_worker' : 'lasius_soldier', SURFACE, e.sx + 100 + (k % 6) * 5, e.sy - 20 + Math.floor(k / 6) * 8, Math.PI).id);
    w.reindex();
    const sim = new Sim(w);
    const game = new NetGame(eps[i], i, players.map((p) => ({ ...p })), sim, { delay: 3, now: () => hub.now });
    return { w, sim, game, acc: 0, hashes: new Map<number, string>(), shots: 0, beams: 0, ids };
  });
  for (const c of cl) c.w.events.onAny((e) => {
    if (e.t === 'orb') c.shots++;
    if (e.t === 'beam') c.beams++;
  });
  const end = hub.now + 40_000;
  while (hub.now < end) {
    hub.deliver(hub.now + 16);
    for (const c of cl) {
      c.game.update();
      c.acc = Math.min(250, c.acc + 16);
      while (c.acc >= 50 && c.game.tryTick()) {
        c.acc -= 50;
        const t = c.w.s.tick;
        // keep the armies at it (as a player's attack order would): every ant targets the marker by the fight
        if (t % 20 === 0)
          for (const id of c.ids) {
            const a = c.w.antById.get(id);
            if (a && a.state !== AS.Dead) {
              (a as Ant).task = 'marker' as never;
              a.marker = 0;
            }
          }
        if (t === 1) for (const ci of [0, 1]) placeMarker(c.w, c.w.colony(ci)!, 0, SURFACE, c.w.colony(0)!.entrances[0].sx + 50, c.w.colony(0)!.entrances[0].sy);
        if (t % 40 === 0) c.hashes.set(t, hashState(c.w));
      }
    }
  }
  let common = 0;
  let diff = -1;
  for (const [t, h] of cl[0].hashes) {
    const o = cl[1].hashes.get(t);
    if (o === undefined) continue;
    common++;
    if (o !== h && diff < 0) diff = t;
  }
  check('multiplayer: two clients in lockstep stay in sync while Blasters fire (beams down the enemy line)', diff < 0 && common >= 15 && cl[0].shots + cl[0].beams >= 5 && cl[0].beams > 0 && cl[0].shots === cl[1].shots && !cl[0].game.status().desync, `${common} checkpoints, ${cl[0].shots} orbs, ${cl[0].beams} beams on each, ticks ${cl.map((c) => c.w.s.tick).join(' / ')}`);
}

console.log(`\n${failed ? `${failed} FAILED` : 'all Saiy-Ant Blaster tests passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failed) (globalThis as unknown as { process: { exit(n: number): void } }).process.exit(1);
