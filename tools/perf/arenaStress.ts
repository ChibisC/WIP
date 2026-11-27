/**
 * Performance v7: the battle arena's simulation under load, by species (claude/performance/07-spec §2 "Simulation":
 * ticks over budget at the counts the user plays with, work bunching up on one tick). Builds the arena world the game
 * builds (`main.ts launchArena`), drops each team's army in with the arena's own spawn, and runs the fight to its
 * end, timing every tick. The game runs 20 ticks a second, so a tick over 50 ms on the user's device falls behind
 * real time and the picture comes in bunches.
 *
 *   npx vite-node tools/perf/arenaStress.ts -- [fights] [n=50,100,300] [maxTicks=1800] [--prof]
 *       fights: comma list of a:b caste pairs, or presets: saiy (the Saiy-Ants against the others), all
 *   e.g.  npx vite-node tools/perf/arenaStress.ts -- saiy 100
 *
 * Prints per fight: ticks run, the winner, mean / p95 / worst tick ms, ticks over 25 and 50 ms, and the worst ticks
 * with the units alive then. --sys adds the per-system split of the worst ticks (world.ts's system timers).
 */
import { EventBus } from '../../src/core/events';
import { createWorld, type GameSetup } from '../../src/sim/mapGen';
import { ARENA } from '../../src/sim/balance';
import { arenaLayout, arenaSpawn, TEAM_NAMES } from '../../src/sim/arena';
import { arenaOf } from '../../src/sim/arenaState';
import { CommandSchedule, stepWithCommands } from '../../src/sim/commands';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const pos = argv.filter((a) => !a.startsWith('--'));
const FIGHTS = pos[0] ?? 'saiy';
const NS = (pos[1] ?? '50,100').split(',').map(Number);
const MAX_TICKS = Number(pos[2] ?? 1800);
const TICK_DT = 0.05;

const PRESETS: Record<string, string[]> = {
  saiy: [
    'aurimyrmex_soldier:fire_major',
    'aurimyrmex_worker:fire_minor',
    'aurimyrmex_blaster:fire_major',
    'aurimyrmex_soldier:aurimyrmex_soldier',
    'aurimyrmex_blaster:aurimyrmex_blaster',
    'fire_minor:fire_major',
    'lasius_soldier:formica_soldier',
  ],
  all: [
    'aurimyrmex_soldier:fire_major',
    'aurimyrmex_blaster:fire_major',
    'fire_minor:fire_major',
    'lasius_soldier:formica_soldier',
    'atta_major:eciton_soldier',
    'hell_soldier:termant_soldier',
    'nasute_soldier:rhy_soldier',
  ],
};
const fights = (PRESETS[FIGHTS] ?? FIGHTS.split(',')).map((f) => f.split(':'));

function arenaWorld(seed: number) {
  const L = arenaLayout(ARENA.size, 2);
  const setup: GameSetup = {
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
  } as GameSetup;
  return createWorld(setup, new EventBus());
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

console.log(`arena stress: ${fights.length} fights × n ${NS.join('/')} a team, up to ${MAX_TICKS} ticks (${(MAX_TICKS / 20).toFixed(0)} s)`);
for (const n of NS) {
  for (const [a, b] of fights) {
    const w = arenaWorld(3);
    const err: string[] = [];
    for (const [team, unit] of [
      [0, a],
      [1, b],
    ] as Array<[number, string]>) {
      let left = n;
      while (left > 0) {
        const k = Math.min(ARENA.maxPerSpawn, left);
        const e = arenaSpawn(w, team, 'ant:' + unit, k, 1, null);
        if (e) {
          err.push(e);
          break;
        }
        left -= k;
      }
    }
    const sched = new CommandSchedule();
    const ms: number[] = [];
    const alive: number[] = [];
    const A = arenaOf(w)!;
    let t = 0;
    let after = -1;
    for (; t < MAX_TICKS; t++) {
      const t0 = performance.now();
      stepWithCommands(w, TICK_DT, sched);
      w.events.drain();
      ms.push(performance.now() - t0);
      alive.push(w.s.ants.filter((x) => x.hp > 0).length);
      if (A.winner >= 0 && after < 0) after = t + 60; // 3 s after the win
      if (after >= 0 && t >= after) break;
    }
    const body = ms.slice(20); // (the first ticks: the JIT warming)
    const mean = body.reduce((s, x) => s + x, 0) / Math.max(1, body.length);
    const worst = ms
      .map((x, i) => [x, i] as [number, number])
      .sort((p, q) => q[0] - p[0])
      .slice(0, 4)
      .map(([x, i]) => `#${i} ${x.toFixed(1)} (${alive[i]} alive)`)
      .join(', ');
    console.log(
      `${(a + ' vs ' + b).padEnd(44)} n=${String(n).padEnd(4)} ${String(t).padStart(5)} ticks, winner ${A.winner}${err.length ? ' ERR ' + err[0] : ''} | mean ${mean.toFixed(2)} p95 ${pct(body, 0.95).toFixed(1)} worst ${Math.max(...body).toFixed(1)} ms | >25 ms ${body.filter((x) => x > 25).length}, >50 ms ${body.filter((x) => x > 50).length} | ${worst}`,
    );
  }
}
