/**
 * Scenes behind `tools/duels.ts` (run that). Probe: does a big melee break into small, readable duels with ground between them (combat v2, CHANGE_PLAN §16)?
 * Two arena teams charge each other. Every second, while most units fight, it groups the fighters into clusters
 * (two fighters are in one cluster when their centres are closer than `link` × their mean body length) and prints
 * how many clusters there are, the largest, the share of fighters in clusters of at most 4 (duels and small groups),
 * the share whose body overlaps another ant's (collision circles overlapping by a fifth) and the median distance from
 * a fighter to its nearest teammate (body lengths). At the end: the means over the samples.
 *
 *   npx vite-node tools/duels.ts -- [a=ant:lasius_worker] [na=60] [b=ant:fire_soldier] [nb=60] [secs=20] [seed=4]
 */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { ARENA, BALANCE } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout } from '../src/sim/arena';
import { Ant, AS } from '../src/sim/types';
import { casteOf } from '../src/sim/species';
import { applyCommand, Command, CommandBody, quantize } from '../src/sim/commands';

export interface DuelStats {
  samples: number;
  clusters: number;
  largest: number;
  small: number;
  overlap: number;
  nnTeam: number;
  fighters: number;
}

/** Cluster the fighters of a world (any team) and measure the spread. */
export function duelSample(ants: Ant[], link = 1.2): { clusters: number; largest: number; small: number; overlap: number; nnTeam: number; fighters: number } {
  const f = ants.filter((a) => a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Spray || a.state === AS.Climb);
  // bodies overlap when their collision circles (BALANCE.separation: 0.8 × width, width 0.28 × length) overlap by a fifth
  const S = BALANCE.separation;
  const rOf = (L: number) => L * S.widthOfLength * S.radiusOfWidth;
  const n = f.length;
  const par = f.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  let over = 0;
  const nn: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = f[i];
    const La = casteOf(a.caste).length;
    let o = false;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = f[j];
      const Lb = casteOf(b.caste).length;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = (La + Lb) / 2;
      if (d < (rOf(La) + rOf(Lb)) * 0.8) o = true;
      if (j > i && d < m * link) par[find(i)] = find(j);
      if ((a.team ?? a.colony) === (b.team ?? b.colony)) best = Math.min(best, d / La);
    }
    if (o) over++;
    if (best < Infinity) nn.push(best);
  }
  const size = new Map<number, number>();
  for (let i = 0; i < n; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  let largest = 0;
  let small = 0;
  for (const s of size.values()) {
    largest = Math.max(largest, s);
    if (s <= 4) small += s;
  }
  nn.sort((x, y) => x - y);
  return { clusters: size.size, largest, small: n ? small / n : 0, overlap: n ? over / n : 0, nnTeam: nn[nn.length >> 1] ?? 0, fighters: n };
}

export function duelBattle(ua = 'ant:lasius_worker', na = 60, ub = 'ant:fire_soldier', nb = 60, secs = 20, seed = 4, log = false): DuelStats {
  const L = arenaLayout(ARENA.size, 2);
  const setup: GameSetup = {
    seed, style: 'formicarium', width: ARENA.size, depth: ARENA.size,
    colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })),
    caves: [], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 }, arena: true,
  };
  const w = createWorld(setup, new EventBus());
  let seq = 0;
  const cmd = (b: CommandBody) => applyCommand(w, { ...quantize(b), tick: w.s.tick, player: 0, seq: seq++ } as Command);
  // (at most ARENA.maxPerSpawn a click)
  for (let k = 0; k < na; k += ARENA.maxPerSpawn) cmd({ type: 'arenaSpawn', team: 0, unit: ua, n: Math.min(ARENA.maxPerSpawn, na - k), level: 1, at: false, x: 0, y: 0 });
  for (let k = 0; k < nb; k += ARENA.maxPerSpawn) cmd({ type: 'arenaSpawn', team: 1, unit: ub, n: Math.min(ARENA.maxPerSpawn, nb - k), level: 1, at: false, x: 0, y: 0 });
  const acc: DuelStats = { samples: 0, clusters: 0, largest: 0, small: 0, overlap: 0, nnTeam: 0, fighters: 0 };
  const queens = new Set(w.s.colonies.map((c) => c.queen));
  for (let s = 1; s <= secs; s++) {
    for (let i = 0; i < 20; i++) {
      w.step(0.05);
      w.events.drain();
    }
    const live = w.s.ants.filter((a) => a.state !== AS.Dead && !queens.has(a.id));
    const r = duelSample(live);
    if (log) console.log(`${String(s).padStart(2)} s  ${live.length} alive, ${r.fighters} fighting: ${r.clusters} clusters, largest ${r.largest}, ${(r.small * 100).toFixed(0)} % in clusters ≤ 4, ${(r.overlap * 100).toFixed(0)} % overlapping, nn teammate ${r.nnTeam.toFixed(2)} BL`);
    if (r.fighters >= live.length / 2 && r.fighters >= 10) {
      acc.samples++;
      acc.clusters += r.clusters;
      acc.largest += r.largest;
      acc.small += r.small;
      acc.overlap += r.overlap;
      acc.nnTeam += r.nnTeam;
      acc.fighters += r.fighters;
    }
  }
  const k = Math.max(1, acc.samples);
  return { samples: acc.samples, clusters: acc.clusters / k, largest: acc.largest / k, small: acc.small / k, overlap: acc.overlap / k, nnTeam: acc.nnTeam / k, fighters: acc.fighters / k };
}

