/**
 * Titans dig into nests (claude/creatures/01-spec-digging-titans.md): digging a hole wider (time from its dig speed,
 * slowed by defenders, giving up when badly hurt), the breach (still the colony's hole, repaired later), walking through
 * the nest breaking soil and stone (built tiles untouched), reaching the queen, leaving, the skirmish raids (toggle,
 * peace period, cap) and determinism.
 *   npx vite-node tests/titans.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, SURFACE, nestSpace } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { killAnt } from '../src/sim/antAI';
import { TITAN_DIG } from '../src/sim/balance';
import { CREATURES } from '../src/sim/creatures/kinds';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { RAID, digPace, endTitanRaid, holeSecs, startTitanRaid, titanRaidSystem } from '../src/sim/creatures/titanDig';
import { SOIL_AIR, SOIL_STONE } from '../src/world/nestGrid';
import { hashState } from '../src/sim/snapshot';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    w.step(0.05);
    w.events.drain();
  }
};
function world(seed = 5, settings: Record<string, unknown> = {}): World {
  return createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: 'lasius', player: true, ai: false }], settings: { creatures: 0, ...settings } } as never, new EventBus());
}
/** the colony stripped to its queen (no defenders) */
function lonely(w: World): void {
  const c = w.colony(0)!;
  for (const a of w.s.ants) if (a.colony === 0 && a.id !== c.queen && a.state !== AS.Dead) killAnt(w, a);
  w.s.brood.length = 0;
  run(w, 2);
}
/** a titan a little way off the colony's first hole */
function titan(w: World, kind: string): ReturnType<typeof spawnCreature> {
  const c = w.colony(0)!;
  const e = c.entrances[0];
  const a = Math.atan2(e.sy - c.ny, e.sx - c.nx);
  w.terrain.clearArea(e.sx - 60, e.sy - 60, e.sx + 60, e.sy + 60);
  return spawnCreature(w, kind, SURFACE, e.sx + Math.cos(a) * 45, e.sy + Math.sin(a) * 45);
}
const holeSecsOf = (kind: string) => TITAN_DIG.holeWork / CREATURES[kind].dig!.speed;

// ---- data
check('diggers: tarantula, wolf spider mother, giant centipede, stag beetle; the giant mantis does not dig', !!CREATURES.tarantula.dig?.can && !!CREATURES.hogna.dig?.can && !!CREATURES.scolopendra.dig?.can && !!CREATURES.stagBeetle.dig?.can && !CREATURES.giantMantis.dig?.can);
check('burrowers dig fastest, the stag beetle slowest', CREATURES.tarantula.dig!.speed > CREATURES.scolopendra.dig!.speed && CREATURES.scolopendra.dig!.speed > CREATURES.stagBeetle.dig!.speed && CREATURES.hogna.dig!.speed > CREATURES.scolopendra.dig!.speed);

// ---- an undefended nest: dig, breach, walk in breaking ground, reach the queen
{
  const w = world();
  lonely(w);
  const c = w.colony(0)!;
  const g = w.nest(0)!;
  const cr = titan(w, 'tarantula');
  const tiles0 = c.tiles.length;
  const air0 = g.countAir();
  let stone = -1;
  check('a raid starts (the titan heads for the nearest hole)', startTitanRaid(w, cr, 0));
  check('…and a second raid on the same titan is refused', !startTitanRaid(w, cr, 0));
  let digT = 0;
  let inT = -1;
  let warned = false;
  w.events.on('titanDig', (e) => {
    if (e.phase === 'warn') warned = true;
  });
  w.events.on('message', (e) => {
    if (/digging toward your nest/.test(e.text)) warned = true;
  });
  for (let t = 0; t < 20 * 120 && inT < 0; t++) {
    run(w, 1);
    if (cr.data.rph === RAID.Dig) digT += 0.05;
    if (cr.space !== SURFACE) inT = t / 20;
  }
  const e = c.entrances[cr.data.rhole ?? 0];
  check(`it digs the hole wider in about holeWork ÷ dig speed (${holeSecsOf('tarantula').toFixed(0)} s undefended)`, Math.abs(digT - holeSecs(cr, CREATURES.tarantula)) < 1 && Math.abs(digT - holeSecsOf('tarantula')) < 2, `${digT.toFixed(1)} s`);
  check('the colony was warned before it got there', warned);
  check('the hole is now a breach the titan is in; still the colony\'s hole', (e.breach ?? 0) === 1 && e.breachBy === cr.id && c.entrances.length === 3);
  check('it walked into the nest', cr.space === nestSpace(0));
  // a stone hex in its way: put one between it and the queen
  const queen = w.antById.get(c.queen)!;
  const mid = { x: (cr.x + queen.x) / 2, y: (cr.y + queen.y) / 2 };
  stone = g.hexAt(mid.x, mid.y);
  if (stone >= 0 && !g.isHexDug(stone)) {
    g.hexSoil[stone] = SOIL_STONE;
    for (const k of g.hexCells[stone]) if (g.soil[k] !== SOIL_AIR) g.soil[k] = SOIL_STONE;
  }
  let reached = -1;
  for (let t = 0; t < 20 * 90 && reached < 0; t++) {
    run(w, 1);
    if (queen.state === AS.Dead || Math.hypot(queen.x - cr.x, queen.y - cr.y) < 30) reached = t / 20;
  }
  check('underground it walks straight through to the queen', reached >= 0, `after ${reached} s`);
  check('soil it touches breaks open (the nest grows)', g.countAir() > air0 + 50, `${g.countAir() - air0} cells opened`);
  check('stone breaks too', stone < 0 || g.isHexDug(stone), `hex ${stone}`);
  check('built tiles never break (the same tiles stand)', c.tiles.length === tiles0, `${tiles0} → ${c.tiles.length}`);
  // it leaves once the queen is dead (or below fleeHealth): back out of the breach
  if (queen.state !== AS.Dead) killAnt(w, queen);
  let out = -1;
  for (let t = 0; t < 20 * 120 && out < 0; t++) {
    run(w, 1);
    if (cr.space === SURFACE) out = t / 20;
  }
  check('with the queen dead it walks back out of the breach', out >= 0 && !(e.breachBy ?? 0), `after ${out} s`);
}

// ---- the hole's time (claude/creatures/02-spec-easier-titan-holes.md): undefended within the targets
{
  const w = world();
  const secs = (kind: string) => holeSecs(spawnCreature(w, kind, SURFACE, 100, 100), CREATURES[kind]);
  const t = { tarantula: secs('tarantula'), hogna: secs('hogna'), scolopendra: secs('scolopendra'), stag: secs('stagBeetle') };
  check('undefended: the burrowers open a hole in 8–12 s, the centipede in about 15 s, the stag beetle in about 20 s', t.tarantula >= 8 && t.tarantula <= 12 && t.hogna >= 8 && t.hogna <= 12 && Math.abs(t.scolopendra - 15) <= 2 && Math.abs(t.stag - 20) <= 2, JSON.stringify(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +v.toFixed(1)]))));
  check('a bigger titan of the same kind takes a little longer (its size)', (() => {
    const a = spawnCreature(w, 'tarantula', SURFACE, 100, 100);
    const b = spawnCreature(w, 'tarantula', SURFACE, 120, 100);
    b.scale = a.scale * 1.5;
    const r = holeSecs(b, CREATURES.tarantula) / holeSecs(a, CREATURES.tarantula);
    return r > 1.02 && r < 1.1;
  })());
  check('defence slows it by the damage it takes a second, with diminishing returns: a few ants barely matter, a big army nears the floor', digPace(0) === 1 && digPace(0.002) > 0.95 && digPace(0.01) < 0.8 && digPace(0.03) < 0.62 && digPace(1) >= TITAN_DIG.slowFloor && digPace(0.03) - digPace(0.06) < digPace(0.005) - digPace(0.03), [0.002, 0.01, 0.03, 1].map((r) => digPace(r).toFixed(2)).join(' '));
  check('the skirmish floor is 55–60 % of full speed', TITAN_DIG.slowFloor >= 0.55 && TITAN_DIG.slowFloor <= 0.6);
}

// ---- defenders slow it; heavy blows only back to the last checkpoint; the work is remembered; badly hurt, it gives up
{
  const w = world();
  const c = w.colony(0)!;
  lonely(w);
  const cr = titan(w, 'tarantula');
  startTitanRaid(w, cr, 0);
  for (let t = 0; t < 20 * 30 && cr.data.rph !== RAID.Dig; t++) run(w, 1);
  // a steady 2 % of its health a second
  let dig = 0;
  for (let t = 0; t < 20 * 4; t++) {
    cr.hp -= cr.maxHp * 0.02 * 0.05;
    const p0 = cr.data.rprog ?? 0;
    run(w, 1);
    dig += (cr.data.rprog ?? 0) - p0;
  }
  const free = (4 * 1) / holeSecs(cr, CREATURES.tarantula);
  check('under steady damage it digs at the damage-rate pace (not "any hit": 45 %)', dig < free * 0.9 && dig > free * TITAN_DIG.slowFloor, `${(dig / free).toFixed(2)} of its pace (floor ${TITAN_DIG.slowFloor})`);
  cr.data.rprog = 0.53;
  cr.data.rhp = cr.hp;
  cr.hp -= cr.maxHp * TITAN_DIG.heavyFrac * 1.01;
  run(w, 1);
  check('a heavy blow knocks a little back, never below the last checkpoint (50 %)', (cr.data.rprog ?? 0) >= 0.5 - 1e-9 && (cr.data.rprog ?? 0) < 0.53, `0.53 → ${(cr.data.rprog ?? 0).toFixed(3)}`);
  const e = c.entrances[cr.data.rhole ?? 0];
  check('the work shows on the hole as it goes (the stages are drawn from it)', Math.abs((e.dprog ?? 0) - (cr.data.rprog ?? 0)) < 1e-9);
  cr.hp = cr.maxHp * (TITAN_DIG.giveUpHealth - 0.05);
  run(w, 2);
  check('badly hurt while digging, it gives up (skirmish)', !(cr.data.raid ?? 0) && (c.entrances[0].breach ?? 0) === 0);
  const kept = e.dprog ?? 0;
  check('…and its work stays on the hole', kept >= 0.5, kept.toFixed(2));
  // another titan comes back to the hole within holeMemorySec: it carries on from there
  const cr2 = titan(w, 'tarantula');
  startTitanRaid(w, cr2, 0, cr.data.rhole ?? 0);
  for (let t = 0; t < 20 * 30 && cr2.data.rph !== RAID.Dig; t++) run(w, 1);
  check('a titan that comes back within holeMemorySec carries on from the work left', (cr2.data.rprog ?? 0) >= kept - 0.01, `${(cr2.data.rprog ?? 0).toFixed(2)} from ${kept.toFixed(2)}`);
  for (const x of w.s.creatures) x.dead = true;
  run(w, 20 * (TITAN_DIG.holeMemorySec + 3));
  check('…after holeMemorySec without digging, the colony fills it in', (e.dprog ?? 0) === 0);
}

// ---- a story raid never gives up; endTitanRaid sends it out; the breach is repaired afterwards
{
  const w = world();
  const c = w.colony(0)!;
  lonely(w);
  const cr = titan(w, 'hogna');
  startTitanRaid(w, cr, 0, 0, true);
  for (let t = 0; t < 20 * 30 && cr.data.rph !== RAID.Dig; t++) run(w, 1);
  cr.hp = cr.maxHp * (TITAN_DIG.giveUpHealth - 0.1);
  for (let t = 0; t < 20 * 90 && cr.space === SURFACE; t++) run(w, 1);
  check('a story raid digs on however hurt (the script decides)', cr.space === nestSpace(0));
  endTitanRaid(w, cr);
  for (let t = 0; t < 20 * 60 && cr.space !== SURFACE; t++) run(w, 1);
  run(w, 20 * 10);
  check('told to leave (dawn), it walks back out and its raid ends', cr.space === SURFACE && !(cr.data.raid ?? 0));
  const e = c.entrances[0];
  const r0 = e.repair ?? 0;
  check('the breach stays open until the colony repairs it', (e.breach ?? 0) === 1 && r0 >= 0);
  run(w, 20 * (TITAN_DIG.repairSec + 3));
  check(`the colony repairs the breach in about ${TITAN_DIG.repairSec} s`, (e.breach ?? 0) === 0);
}

// ---- skirmish raids: off by the setting; none in the peace period; at most maxRaiding at once
{
  const w = world(7, { titanRaids: false });
  const a = titan(w, 'stagBeetle');
  w.s.time = TITAN_DIG.peaceMin * 60 + 1;
  for (let i = 0; i < 600; i++) titanRaidSystem(w);
  check('"Titans raid nests" off: no raids', !(a.data.raid ?? 0));
  const w2 = world(7);
  const b = titan(w2, 'stagBeetle');
  const b2 = titan(w2, 'tarantula');
  for (let i = 0; i < 300; i++) titanRaidSystem(w2);
  check('no raids in the opening peace period', !(b.data.raid ?? 0) && !(b2.data.raid ?? 0));
  w2.s.time = TITAN_DIG.peaceMin * 60 + 1;
  for (let i = 0; i < 1200 && !(b.data.raid ?? 0) && !(b2.data.raid ?? 0); i++) titanRaidSystem(w2);
  check('after the peace a titan raids now and then', (b.data.raid ?? 0) > 0 || (b2.data.raid ?? 0) > 0);
  for (let i = 0; i < 1200; i++) titanRaidSystem(w2);
  check(`at most ${TITAN_DIG.maxRaiding} titan raiding at once`, [b, b2].filter((x) => (x.data.raid ?? 0) > 0).length <= TITAN_DIG.maxRaiding);
  const m = titan(w2, 'giantMantis');
  check('the giant mantis never raids', !startTitanRaid(w2, m, 0));
}

// ---- deterministic: two runs of a raid agree
{
  const go = () => {
    const w = world(9);
    const cr = titan(w, 'scolopendra');
    startTitanRaid(w, cr, 0);
    run(w, 20 * 60);
    return hashState(w);
  };
  check('two runs of a raid agree (same state hash)', go() === go());
}

console.log(failed ? `${failed} titan test(s) FAILED` : 'all titan tests passed');
(globalThis as { process?: { exitCode?: number } }).process!.exitCode = failed ? 1 : 0;
