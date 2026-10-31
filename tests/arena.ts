/**
 * Headless tests for the battle arena (DESIGN 3.13, sim/arena.ts): 2/3/4-team layouts with no economy, spawning
 * (counts, levels, the place tool, the cap, refusals), ants against ants with a winner, creatures against creatures,
 * teams never hurting their own units, the three stances, ants climbing a passive titan, clearing, the commands'
 * wire format, a replay of the command log, a snapshot restore mid-battle, and the tick time with 600 units.
 *   npx vite-node tests/arena.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, SURFACE } from '../src/sim/types';
import { ARENA, BALANCE } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout, arenaUnitOk } from '../src/sim/arena';
import { STANCE, arenaOf } from '../src/sim/arenaState';
import { Command, CommandBody, CommandSchedule, applyCommand, decodeCommandLog, encodeCommandLog, quantize, stepWithCommands } from '../src/sim/commands';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { CASTES } from '../src/sim/species';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();

function setup(n: number, seed = 4): GameSetup {
  const L = arenaLayout(ARENA.size, n);
  return {
    seed,
    style: 'formicarium',
    width: ARENA.size,
    depth: ARENA.size,
    colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })),
    caves: [],
    food: 0,
    aphids: 0,
    plants: 0,
    puddles: 0,
    settings: { creatures: 0 },
    arena: true,
  };
}
function arena(n: number, seed = 4): { w: World; msgs: string[]; cmd: (b: CommandBody) => string | null } {
  const ev = new EventBus();
  const msgs: string[] = [];
  ev.on('message', (e) => msgs.push(e.text));
  const w = createWorld(setup(n, seed), ev);
  let seq = 0;
  const cmd = (b: CommandBody) => applyCommand(w, { ...quantize(b), tick: w.s.tick, player: 0, seq: seq++ } as Command);
  return { w, msgs, cmd };
}
const run = (w: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) {
    w.step(0.05);
    w.events.drain();
  }
};
const spawn = (team: number, unit: string, n: number, level = 1, at: { x: number; y: number } | null = null): CommandBody => ({ type: 'arenaSpawn', team, unit, n, level, at: !!at, x: at?.x ?? 0, y: at?.y ?? 0 });
const units = (w: World, colony: number) => w.s.ants.filter((a) => a.colony === colony && a.state !== AS.Dead && a.id !== w.colony(colony)!.queen);
const crs = (w: World, colony: number) => w.s.creatures.filter((c) => c.faction === colony && !c.dead);

// ---- layouts, no economy
for (const n of [2, 3, 4]) {
  const { w } = arena(n);
  const A = arenaOf(w)!;
  const L = arenaLayout(ARENA.size, n);
  const spread = Math.min(...A.teams.flatMap((T, i) => A.teams.map((U, j) => (i < j ? Math.hypot(T.x - U.x, T.y - U.y) : Infinity))));
  run(w, 40);
  const ants = w.s.ants.filter((a) => w.s.colonies.some((c) => c.id === a.colony && c.queen !== a.id && c.king !== a.id));
  check(`${n} teams: one colony each, spawn points ${spread.toFixed(0)}+ mm apart, nests out at the edge, the field empty`, A.teams.length === n && spread > 150 && ants.length === 0 && L.every((p) => Math.hypot(p.nx - ARENA.size / 2, p.ny - ARENA.size / 2) > ARENA.size * 0.35));
}
{
  const { w, cmd } = arena(2);
  cmd(spawn(0, 'ant:lasius_worker', 10));
  run(w, 20 * 60);
  const c = w.colony(0)!;
  check('no economy: no eggs or brood in a minute, food stays 0, no nanitics, the colonies stand', w.s.brood.length === 0 && c.food === 0 && units(w, 0).length === 10 && w.s.colonies.every((o) => o.alive));
}

// ---- spawning
{
  const { w, cmd } = arena(3);
  const A = arenaOf(w)!;
  check('spawn: 25 Red Wood Ant soldiers round Red\'s corner', cmd(spawn(0, 'ant:formica_soldier', 25)) === null && units(w, A.teams[0].colony).length === 25 && units(w, A.teams[0].colony).every((a) => Math.hypot(a.x - A.teams[0].x, a.y - A.teams[0].y) < 60));
  cmd(spawn(1, 'ant:fire_major', 3, 3));
  const lv = units(w, A.teams[1].colony);
  check('spawn: a level III fire-ant major has ×1.5 health and level III damage', lv.length === 3 && lv.every((a) => a.level === 3 && Math.abs(a.maxHp - CASTES.fire_major.hp * BALANCE.levelHp[2]) < 1e-6 && a.power === BALANCE.levelDamage[2]));
  cmd(spawn(2, 'cr:wolfSpider', 2, 2, { x: A.cx, y: A.cy + 30 }));
  const sp = crs(w, A.teams[2].colony);
  check('place tool: two level II wolf spiders where clicked, for Green', sp.length === 2 && sp.every((c) => Math.hypot(c.x - A.cx, c.y - A.cy - 30) < 40 && c.data.level === 2 && Math.abs(c.maxHp - 140 * BALANCE.levelHp[1]) < 1e-6));
  check('refused: queens, kings, the antlion, unknown units, a fifth team', cmd(spawn(0, 'ant:lasius_queen', 1)) !== null && cmd(spawn(0, 'ant:termant_king', 1)) !== null && cmd(spawn(0, 'cr:antlion', 1)) !== null && cmd(spawn(0, 'cr:dragon', 1)) !== null && cmd(spawn(4, 'ant:lasius_worker', 1)) !== null);
  check('the roster: every non-royal caste and every creature but the antlion', Object.values(CASTES).filter((c) => arenaUnitOk('ant:' + c.id)).length >= 25 && !arenaUnitOk('ant:eciton_queen') && arenaUnitOk('cr:scolopendra'));
  let why: string | null = null;
  for (let i = 0; i < 20 && !why; i++) why = cmd(spawn(i % 3, 'ant:lasius_worker', 50));
  const n = w.s.ants.filter((a) => a.state !== AS.Dead && !w.s.colonies.some((c) => c.queen === a.id || c.king === a.id)).length + w.s.creatures.filter((c) => !c.dead).length;
  check(`the cap: at most ${ARENA.maxUnits} units, then the arena is full`, n === ARENA.maxUnits && !!why && /full/.test(why), why ?? '');
}

// ---- ants against ants: a winner
{
  const { w, cmd, msgs } = arena(2);
  cmd(spawn(0, 'ant:formica_soldier', 20));
  cmd(spawn(1, 'ant:lasius_worker', 20));
  const A = arenaOf(w)!;
  let t = 0;
  while (A.winner === -1 && t < 20 * 180) {
    run(w, 20);
    t += 20;
  }
  check('ants v ants: the teams charge, fight, and the last team standing wins the round', A.winner === 0 && A.teams[1].alive === 0 && A.teams[0].alive > 0 && msgs.some((m) => /Red wins/.test(m)), `${(t / 20).toFixed(0)} s, ${A.teams[0].alive} left; "${msgs.at(-1)}"`);
}

// ---- creatures against creatures (three teams)
{
  const { w, cmd } = arena(3);
  const A = arenaOf(w)!;
  cmd(spawn(0, 'cr:groundBeetle', 3));
  cmd(spawn(1, 'cr:wolfSpider', 3));
  cmd(spawn(2, 'cr:rove', 2));
  const hp0 = A.teams.map((T) => crs(w, T.colony).reduce((s, c) => s + c.hp, 0));
  let bites = 0;
  let dead = 0;
  w.events.on('bite', (e) => {
    if (e.on === 'creature' && e.by) bites++;
  });
  w.events.on('death', (e) => {
    if (e.kind === 'creature') dead++;
  });
  run(w, 20 * 60);
  const hp1 = A.teams.map((T) => crs(w, T.colony).reduce((s, c) => s + c.hp, 0));
  check('creatures v creatures: beetles, spiders and rove beetles of three teams bite each other and die (no fleeing in the arena)', bites > 20 && dead > 0 && hp1.every((h, i) => h < hp0[i]) && w.s.creatures.every((c) => c.state !== 3 && c.state !== 12), `${bites} creature bites, ${dead} dead`);
}

// ---- a team never hurts its own
{
  const { w, cmd } = arena(2);
  const A = arenaOf(w)!;
  cmd(spawn(0, 'ant:lasius_soldier', 12));
  cmd(spawn(0, 'cr:wolfSpider', 1, 1, { x: A.teams[0].x + 10, y: A.teams[0].y }));
  cmd(spawn(0, 'cr:mantis', 1, 1, { x: A.teams[0].x - 15, y: A.teams[0].y }));
  run(w, 20 * 20);
  const own = units(w, A.teams[0].colony);
  check('one team: its ants, wolf spider and mantis leave each other alone', own.length === 12 && own.every((a) => a.hp === a.maxHp) && crs(w, A.teams[0].colony).every((c) => c.hp === c.maxHp));
}

// ---- stances
{
  const { w, cmd } = arena(2);
  const A = arenaOf(w)!;
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.HOLD });
  cmd(spawn(1, 'ant:formica_soldier', 10));
  cmd(spawn(1, 'cr:groundBeetle', 1));
  run(w, 20 * 20);
  const far = units(w, A.teams[1].colony).every((a) => Math.hypot(a.x - A.teams[1].x, a.y - A.teams[1].y) < 60) && crs(w, A.teams[1].colony).every((c) => Math.hypot(c.x - c.homeX, c.y - c.homeY) < ARENA.holdLeash + 5);
  check('hold: with no enemy near, the team stays at its corner', far);
  cmd({ type: 'arenaStance', team: 0, stance: STANCE.PASSIVE });
  const at = { x: A.teams[1].x + 30, y: A.teams[1].y };
  cmd(spawn(0, 'ant:lasius_soldier', 6, 1, at));
  run(w, 20 * 3);
  const foes = units(w, A.teams[1].colony);
  const hp = foes.reduce((s, a) => s + a.hp, 0);
  // they never walk (being shoved by the crowd is allowed)
  let moved = false;
  for (let t = 0; t < 20 * 5; t++) {
    run(w, 1);
    if (units(w, A.teams[0].colony).some((a) => a.v > 0 && a.state !== AS.Flung)) moved = true;
  }
  const hp2 = foes.reduce((s, a) => s + a.hp, 0);
  const hurt = units(w, A.teams[0].colony).filter((a) => a.hp < a.maxHp).length + (6 - units(w, A.teams[0].colony).length);
  check('passive: the dummies stand still and never bite (the holding team still fights them)', !moved && hp2 === hp && hurt > 0, `moved ${moved}, enemy health ${hp.toFixed(0)} → ${hp2.toFixed(0)}, dummies hurt or dead ${hurt}`);
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.CHARGE });
  check('stance command changes the team', A.teams[1].stance === STANCE.CHARGE && cmd({ type: 'arenaStance', team: 1, stance: 7 }) !== null);
}

// ---- climbing: ants on a passive titan
{
  const { w, cmd } = arena(2);
  const A = arenaOf(w)!;
  cmd({ type: 'arenaStance', team: 1, stance: STANCE.PASSIVE });
  cmd(spawn(1, 'cr:stagBeetle', 1, 1, { x: A.cx, y: A.cy }));
  cmd(spawn(0, 'ant:lasius_soldier', 40));
  let riders = 0;
  for (let s = 0; s < 20; s++) {
    run(w, 20);
    riders = Math.max(riders, w.s.ants.filter((a) => (a.ridePh ?? 0) >= 1).length);
  }
  const beetle = crs(w, A.teams[1].colony)[0];
  // (combat v2: a titan carries at most 12 riders, and at most 30 % of the 40 attackers ride)
  check('climbing: charging ants swarm up a passive stag beetle and ride it, biting', riders >= 10 && riders <= BALANCE.mount.capHuge && !!beetle && beetle.hp < beetle.maxHp && beetle.v === 0, `${riders} riding at most`);
}

// ---- clearing
{
  const { w, cmd } = arena(2);
  const A = arenaOf(w)!;
  cmd(spawn(0, 'ant:lasius_soldier', 10));
  cmd(spawn(1, 'cr:wolfSpider', 2));
  run(w, 20 * 3);
  cmd({ type: 'arenaClear', team: 1 });
  run(w, 20 * 2);
  check('clear a team: its units are gone, the other stays', crs(w, A.teams[1].colony).length === 0 && units(w, A.teams[0].colony).length === 10);
  cmd({ type: 'arenaClear', team: -1 });
  run(w, 20 * 2);
  check('clear all: an empty field and a new round', units(w, A.teams[0].colony).length === 0 && A.winner === -1 && A.fought === 0 && A.t === 0);
}

// ---- determinism: the command log replays exactly; a snapshot restore mid-battle stays in step
{
  const bodies: Array<[number, CommandBody]> = [
    [2, spawn(0, 'ant:formica_rapid', 12)],
    [2, spawn(1, 'cr:mantis', 2)],
    [40, spawn(2, 'ant:eciton_major', 6, 2)],
    [41, { type: 'arenaStance', team: 2, stance: STANCE.HOLD }],
    [60, spawn(3, 'ant:nasute_soldier', 10, 1, { x: 300, y: 300 })],
    [300, { type: 'arenaClear', team: 1 }],
    [320, spawn(1, 'cr:scolopendra', 1)],
  ];
  const play = (log?: Command[]): { hash: string; log: Command[]; mid: string; w: World } => {
    const w = createWorld(setup(4, 9), new EventBus());
    const sched = new CommandSchedule();
    if (log) for (const c of log) sched.add({ ...c });
    else bodies.forEach(([t, b], i) => sched.add({ ...quantize(b), tick: t, player: 0, seq: i } as Command));
    let mid = '';
    for (let t = 0; t < 20 * 60; t++) {
      stepWithCommands(w, 0.05, sched);
      w.events.drain();
      if (t === 600) mid = encodeState(w) as unknown as string;
    }
    return { hash: hashState(w), log: sched.log, mid, w };
  };
  const a = play();
  const b = play(decodeCommandLog(encodeCommandLog(a.log)));
  check('determinism: a minute of four-team battle replays exactly from its command log (wire format round trip)', a.hash === b.hash && a.log.length === bodies.length, a.hash);
  // restore at tick 601 and play on alongside
  const ref = createWorld(setup(4, 9), new EventBus());
  const sched = new CommandSchedule();
  bodies.forEach(([t, bb], i) => sched.add({ ...quantize(bb), tick: t, player: 0, seq: i } as Command));
  for (let t = 0; t <= 600; t++) {
    stepWithCommands(ref, 0.05, sched);
    ref.events.drain();
  }
  const r = restoreWorld(encodeState(ref), new EventBus());
  for (let t = 0; t < 400; t++) {
    ref.step(0.05);
    r.step(0.05);
    ref.events.drain();
    r.events.drain();
  }
  check('determinism: a world restored mid-battle (arena state included) stays in step', hashState(ref) === hashState(r) && !!arenaOf(r));
}

// ---- tick time with 600 units
{
  const { w, cmd } = arena(4, 5);
  const mix = ['ant:lasius_soldier', 'ant:formica_soldier', 'ant:fire_minor', 'ant:atta_media'];
  for (let k = 0; k < 3; k++) for (let t = 0; t < 4; t++) cmd(spawn(t, mix[t], 50));
  for (let t = 0; t < 4; t++) cmd(spawn(t, 'cr:groundBeetle', 5));
  const n = w.s.ants.filter((a) => a.state !== AS.Dead).length + w.s.creatures.length;
  run(w, 40);
  const s0 = Date.now();
  run(w, 20 * 15);
  const ms = (Date.now() - s0) / (20 * 15);
  check(`600 units fighting (four teams of 150): ${ms.toFixed(1)} ms a tick`, n >= 620 && ms < 25, `${n} units incl. queens`);
}

void SURFACE;
console.log(failed ? `\n${failed} arena test(s) FAILED` : `\nall arena tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
