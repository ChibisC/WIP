/**
 * Combat v2.2 (CHANGE_PLAN §20, user spec claude/combat/04-spec-height-and-underpass.md): unit heights from the models
 * and the under-pass — smaller ants walk and fight under taller allies (and enemies), only their feet in the way.
 *
 *   npx vite-node tests/underpass.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { Ant, AS, Carry, SURFACE } from '../src/sim/types';
import { World } from '../src/sim/world';
import { makeAnt } from '../src/sim/factory';
import { casteOf, CASTES } from '../src/sim/species';
import { BALANCE } from '../src/sim/balance';
import { HEIGHTS } from '../src/sim/heightData';
import { antClear, antHeights, antNeed } from '../src/sim/underpass';
import { separationSystem } from '../src/sim/separation';
import { allHeights } from '../tools/heightLib';
import { mixedVsCreature, walkThrough } from '../tools/underpassScenes';
import { openGround } from '../tools/spinScenes';

const t0 = Date.now();
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? '  ok ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const U = BALANCE.underpass as { allies: boolean; enemies: boolean };

// ---------------------------------------------------------------- 1. the data matches the models
{
  const now = allHeights();
  const diff: string[] = [];
  const cmp = (kind: 'ant' | 'creature') => {
    const a = now[kind];
    const b = HEIGHTS[kind];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!a[k] || !b[k]) {
        diff.push(`${kind} ${k} missing`);
        continue;
      }
      const x = [a[k].h, ...a[k].zx, ...a[k].c, a[k].hw, ...a[k].feet];
      const y = [b[k].h, ...b[k].zx, ...b[k].c, b[k].hw, ...b[k].feet];
      if (x.length !== y.length || x.some((v, i) => Math.abs(v - y[i]) > 2e-4)) diff.push(`${kind} ${k}`);
    }
  };
  cmp('ant');
  cmp('creature');
  check('height data: src/sim/heightData.ts matches the models (else: npx vite-node tools/height-data.ts)', diff.length === 0, diff.slice(0, 6).join(', ') || `${Object.keys(now.ant).length} ant models, ${Object.keys(now.creature).length} creatures`);
}

// ---------------------------------------------------------------- 2. who fits under whom (Atta and Eciton)
const fits = (small: string, tall: string) => {
  const need = antHeights(small).h * casteOf(small).length * (1 + BALANCE.underpass.margin);
  const d = antHeights(tall);
  const L = casteOf(tall).length;
  return ['rear', 'middle', 'front'].filter((_, z) => need <= d.c[z] * L);
};
{
  const under = ['atta_media', 'atta_soldier', 'atta_major', 'atta_queen'].map((t) => [t, fits('atta_minim', t)] as const);
  check('Atta: the minim fits under the media, soldier, major and queen', under.every(([, z]) => z.length > 0), under.map(([t, z]) => `${t}: ${z.join('/') || '—'}`).join('; '));
  const none = Object.keys(CASTES).filter((c) => (CASTES[c] as { species?: string }).species === 'atta' && c !== 'atta_minim' && fits(c, 'atta_minim').length);
  check('Atta: nothing fits under the minim', none.length === 0, none.join(', '));
  const ec = ['eciton_major', 'eciton_queen'].map((t) => [t, fits('eciton_minor', t)] as const);
  check('Eciton: the worker fits under the soldier and the queen', ec.every(([, z]) => z.length > 0), ec.map(([t, z]) => `${t}: ${z.join('/')}`).join('; '));
  // the spec's other expectations depend on the models (docs/combat/underpass.md): reported, not required
  console.log(`  ..  Eciton worker under the porter: ${fits('eciton_minor', 'eciton_submajor').join('/') || 'no'}; under the media: ${fits('eciton_minor', 'eciton_media').join('/') || 'no'}; Atta media under the major: ${fits('atta_media', 'atta_major').join('/') || 'no'}; Eciton porter under the soldier: ${fits('eciton_submajor', 'eciton_major').join('/') || 'no'}`);
}

// ---------------------------------------------------------------- 3. walking under
{
  for (const [sp, tall, small] of [
    ['atta', 'atta_major', 'atta_minim'],
    ['eciton', 'eciton_major', 'eciton_minor'],
  ]) {
    U.allies = true;
    const on = walkThrough(sp, tall, small);
    U.allies = false;
    const off = walkThrough(sp, tall, small);
    U.allies = true;
    check(`walking: a ${small} goes straight under a column of ${tall}s (no detour, no foot overlap, nobody shoved)`, on.arrived && on.dev < 0.3 && on.footIn <= 0 && on.shove < 0.01 && on.under > 0, `strays ${on.dev.toFixed(2)} mm, ${on.under} ticks under, foot overlap ${Math.max(0, on.footIn).toFixed(2)} mm, shoved ${on.shove.toFixed(2)} mm; under-pass off: strays ${off.dev.toFixed(2)} mm, shoves ${off.shove.toFixed(2)} mm`);
  }
}

// ---------------------------------------------------------------- 4. poses: nothing under a loaded porter or a lowered head
function field(seed = 5): { w: World; p: { x: number; y: number } } {
  const w = createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 0, colonies: [{ species: 'atta' as never, player: true, ai: false, startWorkers: 0 }, { species: 'eciton' as never, player: false, ai: false, startWorkers: 0 }], settings: { creatures: 0 } }, new EventBus());
  w.s.creatures.length = 0;
  w.s.food.length = 0;
  return { w, p: openGround(w, 140) };
}
function sepOnly(w: World, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    w.touch();
    w.prepareQueries();
    separationSystem(w, 0.1);
  }
}
{
  const CL = [0, 0, 0];
  const { w, p } = field();
  const porter = makeAnt(w, 1, 'eciton_submajor', SURFACE, p.x, p.y, 0);
  const free = antClear(porter, CL)[1];
  porter.carry = Carry.Food;
  const loaded = antClear(porter, CL)[1];
  check('poses: nothing passes under a porter carrying prey slung under it (its middle drops to nothing)', loaded === 0 && free > 0, `middle clearance ${free.toFixed(2)} → ${loaded.toFixed(2)} mm`);
  const maj = makeAnt(w, 0, 'atta_major', SURFACE, p.x + 40, p.y, 0);
  const up = antClear(maj, CL)[2];
  maj.state = AS.Grapple;
  const down = antClear(maj, CL)[2];
  check('poses: a braced bite lowers the major\'s head (front clearance)', down < up, `${up.toFixed(2)} → ${down.toFixed(2)} mm`);
  const same = antNeed(makeAnt(w, 0, 'atta_major', SURFACE, p.x + 80, p.y, 0)) > Math.max(...antClear(maj, CL));
  check('poses: an ant as big as the other never passes under it', same);
  const dead = makeAnt(w, 0, 'atta_major', SURFACE, p.x + 120, p.y, 0);
  dead.state = AS.Dead;
  check('poses: nothing passes under a dead ant', Math.max(...antClear(dead, CL)) === 0);
}
// a minim under a major's head: the major lowers it for a braced bite → the minim steps out sideways; mid-attack, the
// major's head waits
for (const busy of [false, true]) {
  const { w, p } = field(7);
  const maj = makeAnt(w, 0, 'atta_major', SURFACE, p.x, p.y, 0);
  const Lm = casteOf('atta_major').length;
  const d = antHeights('atta_major');
  // under its head (front zone), on its axis
  const fx = p.x + ((d.zx[1] + 0.5) / 2) * Lm * 0.8;
  const mini = makeAnt(w, 0, 'atta_minim', SURFACE, fx, p.y + 0.2, 0);
  for (const a of [maj, mini]) a.state = AS.Idle;
  sepOnly(w, 2);
  const wasUnder = (mini.udr ?? 0) === maj.id;
  maj.state = AS.Grapple;
  if (busy) mini.anc = 5;
  const m0 = { x: maj.x, y: maj.y };
  const s0 = { x: mini.x, y: mini.y };
  sepOnly(w, 30);
  const out = Math.abs(mini.y - p.y);
  const majMoved = Math.hypot(maj.x - m0.x, maj.y - m0.y);
  if (!busy) check('pose change: a minim under a major\'s head steps out sideways when the major braces (the major is not moved)', wasUnder && out >= d.hw * Lm && majMoved < 1e-6, `under first: ${wasUnder}; ${out.toFixed(2)} mm out (body half-width ${(d.hw * Lm).toFixed(2)}), major moved ${majMoved.toFixed(3)} mm`);
  else check('pose change: mid-attack it stays (the major\'s head waits to lower)', wasUnder && Math.hypot(mini.x - s0.x, mini.y - s0.y) < 1e-6 && (maj.fhd ?? 0) === 1, `moved ${Math.hypot(mini.x - s0.x, mini.y - s0.y).toFixed(3)} mm, front held ${maj.fhd ?? 0}`);
}

// ---------------------------------------------------------------- 5. fighting from beneath
{
  // a tall enemy (an Eciton soldier, held where it stands) and 30 Atta minims after it: every place round it taken,
  // some fight from under it (with enemies' under-pass on), none with it off
  const run = (on: boolean) => {
    U.enemies = on;
    const { w, p } = field(9);
    const tall = makeAnt(w, 1, 'eciton_major', SURFACE, p.x, p.y, 0);
    tall.hp = tall.maxHp = 1e7;
    const minis: Ant[] = [];
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2;
      const a = makeAnt(w, 0, 'atta_minim', SURFACE, p.x + Math.cos(ang) * 14, p.y + Math.sin(ang) * 14, ang + Math.PI);
      a.task = 'guard';
      a.alarm = 1;
      a.tgt = tall.id;
      a.tk = 3;
      a.state = AS.Attack;
      a.hp = a.maxHp = 1e5;
      minis.push(a);
    }
    w.reindex();
    let under = 0;
    let most = 0;
    for (let t = 0; t < 20 * 12; t++) {
      tall.x = p.x;
      tall.y = p.y;
      tall.stun = 1;
      w.step(0.05);
      w.events.drain();
      under = Math.max(under, minis.filter((a) => a.state === AS.Grapple && (a.gUn ?? 0) > 0).length);
      most = Math.max(most, minis.filter((a) => a.state === AS.Grapple && a.gId === tall.id).length);
    }
    U.enemies = true;
    return { under, most };
  };
  const on = run(true);
  const off = run(false);
  check('from beneath: small ants fight a tall enemy ant from under its body when every place round it is taken', on.under >= 1 && off.under === 0 && on.most >= off.most, `${on.under} under it (${on.most} holding at most); with enemies' under-pass off: ${off.under} (${off.most})`);
}
// mixed squads against creatures: no fewer fighting at once with the under-pass (EotU)
for (const [name, sp, squad, kind] of [
  ['4 Atta majors + 20 minims v a ground beetle', 'atta', [['atta_major', 4], ['atta_minim', 20]], 'groundBeetle'],
  ['3 Eciton soldiers + 3 porters + 30 workers v a tarantula', 'eciton', [['eciton_major', 3], ['eciton_submajor', 3], ['eciton_minor', 30]], 'tarantula'],
] as Array<[string, string, Array<[string, number]>, string]>) {
  U.allies = true;
  const on = mixedVsCreature(sp, squad, kind, 4, 30);
  U.allies = false;
  const off = mixedVsCreature(sp, squad, kind, 4, 30);
  U.allies = true;
  check(`mixed squad: ${name} — as many fighting at once with the under-pass`, on.mean >= off.mean * 0.85, `holding ${on.mean.toFixed(1)} on average (${on.most} at most, ${on.underTall} under a tall teammate), killed ${on.diedAt >= 0 ? on.diedAt.toFixed(1) + ' s' : 'no'}; off: ${off.mean.toFixed(1)} (${off.most}), killed ${off.diedAt >= 0 ? off.diedAt.toFixed(1) + ' s' : 'no'}`);
}

// ---------------------------------------------------------------- 6. determinism
{
  const sig = () => {
    const r = mixedVsCreature('atta', [['atta_major', 3], ['atta_minim', 12]], 'groundBeetle', 6, 6);
    return `${r.mean.toFixed(6)} ${r.most} ${r.underTall} ${r.lost}`;
  };
  const a = sig();
  const b = sig();
  check('determinism: the same mixed fight twice gives the same result', a === b, a);
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all under-pass tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
