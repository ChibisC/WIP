/**
 * Headless tests for the caste abilities and the army ants' stings (user 2026-10-31, after Empires of the
 * Undergrowth; sim/casteAbilities.ts): leafcutters have no sting; army ants sting every third bite, each sting a
 * little stronger than a fire ant's, so fire ants still stack venom fastest; the leafcutter major's taunt (only the
 * major; its chance, reach, cooldown, health floor; enemy ants and creatures turn on it); the army-ant soldier's rage
 * (only the soldier; stacks from kills up to +45 %, its nestmates nearby fight harder, it fades); determinism.
 *   npx vite-node tests/casteAbilities.ts
 */
import { EventBus, SimEvent } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, Ant, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { BALANCE } from '../src/sim/balance';
import { CASTES, casteOf } from '../src/sim/species';
import { biteMul, damageAnt } from '../src/sim/combat';
import { casteOnBite, casteOnKill, rageMul } from '../src/sim/casteAbilities';
import { hashState } from '../src/sim/snapshot';
import { spawnCreature } from '../src/sim/creatures/creatureAI';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();
const TA = BALANCE.casteAbility.taunt;
const RA = BALANCE.casteAbility.rage;

function world(a: string, b: string, seed = 5): World {
  return createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 0, colonies: [{ species: a as never, player: true, ai: false }, { species: b as never, player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
}
function open(w: World): { x: number; y: number } {
  for (let k = 0; k < 400; k++) {
    const x = 220 + (k % 20) * 15;
    const y = 220 + Math.floor(k / 20) * 15;
    let ok = true;
    for (let dx = -40; dx <= 40 && ok; dx += 3) for (let dy = -40; dy <= 40 && ok; dy += 3) if (!w.walkable(SURFACE, x + dx, y + dy)) ok = false;
    if (ok) return { x, y };
  }
  return { x: 350, y: 350 };
}
/** take the queued events (the bus's own queue: drain() only dispatches) */
function take(w: World): SimEvent[] {
  const bus = w.events as unknown as { queue: SimEvent[] };
  const q = bus.queue;
  bus.queue = [];
  return q;
}
/** step, collecting the events */
function run(w: World, ticks: number, ev?: SimEvent[]): void {
  for (let i = 0; i < ticks; i++) {
    w.step(0.05);
    const e = take(w);
    if (ev) ev.push(...e);
  }
}
function fight(w: World, a: Ant, o: Ant): void {
  a.tgt = o.id;
  a.tk = 3;
  a.state = AS.Attack;
  a.task = 'guard';
  w.reindex();
}

// ---- stings
{
  const atta = Object.values(CASTES).filter((c) => c.species === 'atta');
  check('leafcutters have no sting (every Atta caste)', atta.length >= 5 && atta.every((c) => !c.sting));
  const fire = casteOf('fire_minor').sting!;
  const eci = casteOf('eciton_minor').sting!;
  check('army ants sting only every third bite; fire ants every bite', eci.every === 3 && !fire.every);
  check('each army-ant sting a little stronger than a fire ant’s (worker for worker)', eci.dps > fire.dps && eci.dps < fire.dps * 1.4, `${eci.dps} v ${fire.dps} venom/s per stack`);
  // one ant on a dummy for 30 s: count the bites and stings, and the venom it piled on
  const duel = (sp: string, caste: string) => {
    const w = world(sp, 'lasius');
    const p = open(w);
    const a = makeAnt(w, 0, caste, SURFACE, p.x - 5, p.y, 0);
    const o = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x, p.y, Math.PI);
    o.hp = o.maxHp = 1e6;
    fight(w, a, o);
    const ev: SimEvent[] = [];
    let venomSum = 0;
    for (let i = 0; i < 600; i++) {
      run(w, 1, ev);
      o.stun = 1;
      venomSum += o.venom * o.venomDps * 0.05;
    }
    const bites = ev.filter((e) => e.t === 'bite' && (e as { by?: string }).by === caste).length;
    const stings = ev.filter((e) => e.t === 'sting' && (e as { by?: string }).by === caste).length;
    return { bites, stings, venomSum };
  };
  const f = duel('solenopsis', 'fire_minor');
  const e = duel('eciton', 'eciton_minor');
  check('a fire ant stings at every bite', f.bites > 10 && f.stings === f.bites, `${f.stings}/${f.bites}`);
  check('an army ant stings at every third bite', e.bites > 10 && Math.abs(e.stings - Math.floor(e.bites / 3)) <= 1, `${e.stings}/${e.bites}`);
  check('fire ants still pile on more venom than army ants (stinging stays their thing)', f.venomSum > e.venomSum * 1.3, `venom dealt in 30 s: fire ${f.venomSum.toFixed(1)}, army ${e.venomSum.toFixed(1)}`);
}

// ---- the leafcutter major's taunt
{
  const only = Object.values(CASTES).filter((c) => c.taunt).map((c) => c.id);
  check('only the leafcutter major taunts', only.join() === 'atta_major', only.join());
  const w = world('atta', 'formica');
  const p = open(w);
  const maj = makeAnt(w, 0, 'atta_major', SURFACE, p.x, p.y, 0);
  const media = makeAnt(w, 0, 'atta_media', SURFACE, p.x + 20, p.y + 12, 0);
  // five enemies near the major, fighting the media; one far off
  const near: Ant[] = [];
  for (let k = 0; k < 5; k++) {
    const e = makeAnt(w, 1, 'formica_worker', SURFACE, p.x + 18 + k * 2, p.y + 6 + k * 2, Math.PI);
    near.push(e);
    fight(w, e, media);
  }
  const far = makeAnt(w, 1, 'formica_worker', SURFACE, p.x + 120, p.y, Math.PI);
  fight(w, far, media);
  w.reindex();
  // (outside a step: the spatial hashes the taunt queries are built at the start of each tick)
  (w as unknown as { rebuildHashes(): void }).rebuildHashes();
  const ev: SimEvent[] = [];
  // force the roll: the chance is drawn from the world RNG — try bites until it fires
  let fired = false;
  for (let i = 0; i < 60 && !fired; i++) {
    casteOnBite(w, maj);
    ev.push(...take(w));
    fired = (maj.tauntCd ?? 0) > 0;
  }
  const tauntEv = ev.find((e) => e.t === 'taunt') as { radius: number } | undefined;
  check('the taunt goes off on a bite (EotU: 30 % a bite, above 30 % health)', fired && !!tauntEv && Math.abs(tauntEv.radius - casteOf('atta_major').length * TA.radiusL) < 1e-6);
  check('every enemy within reach drops its fight and comes for the major', near.every((e) => e.tgt === maj.id && e.tk === 3 && (e.tauntT ?? 0) > 0), near.map((e) => e.tgt === maj.id).join());
  check('an enemy out of reach is not taunted', far.tgt === media.id && !(far.tauntT ?? 0));
  // cooldown: no second taunt for cooldownSec
  const cd0 = maj.tauntCd!;
  let again = 0;
  for (let i = 0; i < 50; i++) {
    casteOnBite(w, maj);
    if (take(w).some((e) => e.t === 'taunt')) again++;
  }
  check(`then nothing for ${TA.cooldownSec} s (cooldown)`, again === 0 && cd0 === TA.cooldownSec);
  // taunted ants stay on the major while the taunt lasts, even when the media bites them
  run(w, 20);
  damageAnt(w, near[0], 1, 'bite', media);
  check('a taunted ant bitten by another keeps on the major', near[0].state === AS.Dead || near[0].tgt === maj.id);
  run(w, Math.ceil((TA.durSec + 0.5) / 0.05));
  check(`the taunt wears off after ${TA.durSec} s`, near.every((e) => e.state === AS.Dead || !(e.tauntT ?? 0)), near.map((e) => `${e.state === AS.Dead ? 'dead' : (e.tauntT ?? 0).toFixed(2)}`).join());
  // below the health floor: never
  const w2 = world('atta', 'formica');
  const q = open(w2);
  const hurt = makeAnt(w2, 0, 'atta_major', SURFACE, q.x, q.y, 0);
  makeAnt(w2, 1, 'formica_worker', SURFACE, q.x + 10, q.y, Math.PI);
  w2.reindex();
  (w2 as unknown as { rebuildHashes(): void }).rebuildHashes();
  hurt.hp = hurt.maxHp * (TA.minHpFrac - 0.05);
  let n2 = 0;
  for (let i = 0; i < 80; i++) {
    casteOnBite(w2, hurt);
    if (take(w2).some((e) => e.t === 'taunt')) n2++;
  }
  check(`no taunt at ${Math.round((TA.minHpFrac - 0.05) * 100)} % health`, n2 === 0);
  // other majors never taunt
  const fm = makeAnt(w2, 1, 'formica_soldier', SURFACE, q.x + 40, q.y, 0);
  for (let i = 0; i < 40; i++) casteOnBite(w2, fm);
  check('a non-leafcutter never taunts', !(fm.tauntCd ?? 0));
  // a creature turns on the taunting major
  const w3 = world('atta', 'lasius');
  const r = open(w3);
  const m3 = makeAnt(w3, 0, 'atta_major', SURFACE, r.x, r.y, 0);
  const bait = makeAnt(w3, 0, 'atta_media', SURFACE, r.x + 30, r.y, 0);
  const cr = spawnCreature(w3, 'groundBeetle', SURFACE, r.x + 18, r.y + 4);
  w3.reindex();
  (w3 as unknown as { rebuildHashes(): void }).rebuildHashes();
  for (let i = 0; i < 60 && !(m3.tauntCd ?? 0); i++) casteOnBite(w3, m3);
  check('a creature in reach is taunted too', (cr.tauntT ?? 0) > 0 && cr.tauntBy === m3.id);
  void bait;
}

// ---- the army-ant soldier's rage
{
  const only = Object.values(CASTES).filter((c) => c.rage).map((c) => c.id);
  check('only the army-ant soldier rages', only.join() === 'eciton_major', only.join());
  const w = world('eciton', 'lasius');
  const p = open(w);
  const sol = makeAnt(w, 0, 'eciton_major', SURFACE, p.x, p.y, 0);
  const mate = makeAnt(w, 0, 'eciton_minor', SURFACE, p.x + 10, p.y, 0);
  const away = makeAnt(w, 0, 'eciton_minor', SURFACE, p.x + 150, p.y, 0);
  const foe = makeAnt(w, 1, 'lasius_worker', SURFACE, p.x + 60, p.y + 60, 0);
  w.reindex();
  const c0 = w.colony(0)!;
  const base = biteMul(w, mate, c0);
  for (let k = 0; k < 7; k++) casteOnKill(w, sol);
  run(w, 1);
  check(`each kill adds a stack, up to ${RA.maxStacks} (+${Math.round(RA.maxStacks * RA.dmgPerStack * 100)} %)`, sol.rage === RA.maxStacks);
  const k = 1 + RA.maxStacks * RA.dmgPerStack;
  check('the soldier bites harder', Math.abs(rageMul(w, sol) - k) < 1e-9);
  check('so do its nestmates nearby', Math.abs(biteMul(w, mate, c0) / base - k) < 1e-9, `×${(biteMul(w, mate, c0) / base).toFixed(3)}`);
  check('but not those far off, nor the enemy', rageMul(w, away) === 1 && rageMul(w, foe) === 1);
  run(w, Math.ceil((RA.decaySec * 2 + 0.2) / 0.05));
  check(`a stack fades every ${RA.decaySec} s without a kill`, sol.rage === RA.maxStacks - 2, `${sol.rage}`);
  // a real kill in a fight counts
  const w2 = world('eciton', 'lasius');
  const q = open(w2);
  const s2 = makeAnt(w2, 0, 'eciton_major', SURFACE, q.x - 8, q.y, 0);
  const v = makeAnt(w2, 1, 'lasius_worker', SURFACE, q.x, q.y, Math.PI);
  v.hp = 1;
  fight(w2, s2, v);
  run(w2, 80);
  check('killing an enemy in a fight gives a stack', v.state === AS.Dead && (s2.rage ?? 0) >= 1, `rage ${s2.rage}`);
  // other castes never rage
  const m2 = makeAnt(w2, 0, 'eciton_media', SURFACE, q.x + 30, q.y, 0);
  casteOnKill(w2, m2);
  check('a media never rages', !(m2.rage ?? 0));
}

// ---- determinism: the same fight twice gives the same state
{
  const once = () => {
    const w = world('atta', 'eciton', 9);
    const p = open(w);
    for (let k = 0; k < 3; k++) makeAnt(w, 0, 'atta_major', SURFACE, p.x - 10, p.y + k * 9, 0);
    for (let k = 0; k < 4; k++) makeAnt(w, 0, 'atta_media', SURFACE, p.x - 14, p.y - 10 + k * 6, 0);
    for (let k = 0; k < 3; k++) makeAnt(w, 1, 'eciton_major', SURFACE, p.x + 12, p.y + k * 9, Math.PI);
    for (let k = 0; k < 8; k++) makeAnt(w, 1, 'eciton_minor', SURFACE, p.x + 16, p.y - 12 + k * 4, Math.PI);
    w.reindex();
    for (const a of w.s.ants) a.alarm = 1;
    const ev: SimEvent[] = [];
    run(w, 400, ev);
    return { h: hashState(w), taunts: ev.filter((e) => e.t === 'taunt').length, rages: ev.filter((e) => e.t === 'rage').length, stings: ev.filter((e) => e.t === 'sting').length };
  };
  const a = once();
  const b = once();
  check('determinism: a leafcutter v army-ant fight twice gives the same state', a.h === b.h && a.taunts === b.taunts && a.rages === b.rages, `${a.h}; ${a.taunts} taunts, ${a.rages} rage stacks, ${a.stings} stings`);
}

console.log(failed ? `\n${failed} caste-ability test(s) failed` : `\nall caste-ability tests passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
