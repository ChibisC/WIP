/**
 * The simulation's stress scenes (performance v3, claude/performance/03-spec-performance-v3-big-colonies.md §1):
 * deterministic, repeatable worlds at 500–2,000 ants, timed per tick and per system, with a canonical state hash
 * every 50 ticks (tools/perf/canon.ts) so two builds can be compared (the same hash list = the same results).
 *
 *   npx vite-node tools/perf/simBench.ts -- [scenes=fight,economy,nests,ten,titan,tunnel] [ants=500,1000,1500,2000]
 *       [ticks=200] [--out results.json] [--systems] [--series] [--prof]
 *
 * Scenes:
 *  - fight:   four colonies' armies meet at the map's middle (the stress scene), 100 wild creatures;
 *  - economy: four developed colonies forage at markers near their own nests (trails, food, brood);
 *  - nests:   most ants in their nests on brood and dig jobs (full nests underground);
 *  - ten:     ten colonies on a big map, foraging at home with a fight in the middle;
 *  - titan:   the economy, and a tarantula raiding colony 0's nest;
 *  - tunnel:  two colonies with an open tunnel route, one army in the other's nest.
 */
import { writeFileSync } from 'node:fs';
import { EventBus } from '../../src/core/events';
import { createWorld, GameSetup } from '../../src/sim/mapGen';
import { World } from '../../src/sim/world';
import { SURFACE, nestSpace, type Colony } from '../../src/sim/types';
import { makeAnt } from '../../src/sim/factory';
import { placeTile, tileAt } from '../../src/sim/tiles';
import { assignGroup, placeMarker } from '../../src/sim/markers';
import { SPECIES } from '../../src/sim/species';
import { spawnCreature } from '../../src/sim/creatures/creatureAI';
import { startTitanRaid } from '../../src/sim/creatures/titanDig';
import { designateDig } from '../../src/sim/colony';
import { routes, ownHalf } from '../../src/sim/tunnels';
import { canonHash } from './canon';
import { stressSetup } from '../../src/dev/stressScene';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const outI = argv.indexOf('--out');
const OUT = outI >= 0 ? argv[outI + 1] : null;
const pos = argv.filter((a, i) => !a.startsWith('--') && !(outI >= 0 && i === outI + 1));
const SCENES = (pos[0] ?? 'fight,economy,nests,ten,titan,tunnel').split(',');
const ANTS = (pos[1] ?? '500,1000,1500,2000').split(',').map(Number);
const TICKS = Number(pos[2] ?? 200);
const WARM = 60;

/** A group of `n` ants of `caste` on a new brood tile of colony c, sent to `marker` (−1 home). */
function group(w: World, c: Colony, free: number[], caste: string, n: number, space: number, x: number, y: number, marker: number): void {
  const q = free.shift();
  if (q === undefined || n <= 0) return;
  const t = placeTile(w, c, 'brood', q, caste, true)!;
  t.wait = 1e9;
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, c.id, caste, space, x + w.rng.range(-15, 15), y + w.rng.range(-15, 15), w.rng.range(0, 6.28));
    a.tile = t.q;
  }
  w.reindex();
  assignGroup(w, c, t.group, marker);
}

function freeHexes(w: World, c: Colony): number[] {
  const g = w.nest(c.id)!;
  const free: number[] = [];
  for (let q = 0; q < g.cols * g.rows; q++) if (g.isHexDug(q) && !g.isEntrance(q) && !tileAt(c, q)) free.push(q);
  return free;
}

/** How many ants each colony should add so the world holds `total` living ants. */
function perColony(w: World, total: number, colonies = w.s.colonies.length): number {
  return Math.max(0, Math.round((total - w.s.ants.length) / colonies));
}

function creatures(w: World, n: number): void {
  const kinds = ['pillbug', 'cutworm', 'groundBeetle', 'wolfSpider', 'lithobius', 'rove', 'mantis', 'antlion'];
  for (let i = 0, tries = 0; i < n && tries < n * 50; tries++) {
    const x = w.rng.range(40, w.terrain.width - 40);
    const y = w.rng.range(40, w.terrain.depth - 40);
    if (!w.terrain.passable(x, y)) continue;
    spawnCreature(w, kinds[i % kinds.length], SURFACE, x, y);
    i++;
  }
}

/** Foraging at a marker out from the nest, away from the middle (the colonies keep to themselves). */
function forage(w: World, c: Colony, free: number[], n: number, frac = 1): void {
  const cx = w.terrain.width / 2;
  const cy = w.terrain.depth / 2;
  const e = c.entrances[0];
  const dx = e.sx - cx;
  const dy = e.sy - cy;
  const d = Math.hypot(dx, dy) || 1;
  const mx = Math.min(w.terrain.width - 30, Math.max(30, e.sx + (dx / d) * 70));
  const my = Math.min(w.terrain.depth - 30, Math.max(30, e.sy + (dy / d) * 70));
  placeMarker(w, c, 1, SURFACE, mx, my);
  const castes = SPECIES[c.species].castes;
  group(w, c, free, castes[0], Math.round(n * 0.7 * frac), SURFACE, e.sx, e.sy, 1);
  const g = w.nest(c.id)!;
  const p = g.hexCenter(free[0] ?? 0);
  group(w, c, free, castes[0], Math.round(n * 0.3 * frac), nestSpace(c.id), p.x, p.y, -1);
}

function build(scene: string, total: number): World {
  const ev = new EventBus();
  if (scene === 'fight') {
    const w = createWorld(stressSetup(), ev);
    const per = perColony(w, total - 0);
    const cx = w.terrain.width / 2;
    const cy = w.terrain.depth / 2;
    for (const c of w.s.colonies) {
      const free = freeHexes(w, c);
      const castes = SPECIES[c.species].castes;
      const e = c.entrances[0];
      placeMarker(w, c, 0, SURFACE, cx + (e.sx - cx) * 0.15, cy + (e.sy - cy) * 0.15);
      group(w, c, free, castes[0], Math.round(per * 0.45), SURFACE, e.sx, e.sy, 0);
      group(w, c, free, castes[castes.length - 1], Math.round(per * 0.2), SURFACE, e.sx, e.sy, 0);
      const p = w.nest(c.id)!.hexCenter(free[0] ?? 0);
      group(w, c, free, castes[0], Math.round(per * 0.35), nestSpace(c.id), p.x, p.y, -1);
    }
    creatures(w, 100);
    return w;
  }
  if (scene === 'economy' || scene === 'titan') {
    const w = createWorld(stressSetup(), ev);
    const per = perColony(w, total);
    for (const c of w.s.colonies) forage(w, c, freeHexes(w, c), per);
    creatures(w, 40);
    if (scene === 'titan') {
      const c = w.s.colonies[0];
      const e = c.entrances[0];
      const t = spawnCreature(w, 'tarantula', SURFACE, Math.min(w.terrain.width - 40, e.sx + 60), e.sy);
      startTitanRaid(w, t, c.id);
    }
    return w;
  }
  if (scene === 'nests') {
    const w = createWorld(stressSetup(), ev);
    const per = perColony(w, total);
    for (const c of w.s.colonies) {
      const free = freeHexes(w, c);
      const castes = SPECIES[c.species].castes;
      const g = w.nest(c.id)!;
      const p = g.hexCenter(free[0] ?? 0);
      group(w, c, free, castes[0], Math.round(per * 0.5), nestSpace(c.id), p.x, p.y, -1);
      group(w, c, free, castes[0], Math.round(per * 0.3), nestSpace(c.id), p.x, p.y, -1);
      group(w, c, free, castes[castes.length - 1], Math.round(per * 0.2), nestSpace(c.id), p.x, p.y, -1);
      // dig jobs: the diggable hexes next to the dug floor
      let k = 0;
      for (let q = 0; q < g.cols * g.rows && k < 40; q++) {
        if (g.isHexDug(q) || !g.isHexDiggable(q)) continue;
        if (g.neighbors(q).some((o) => o >= 0 && g.isHexDug(o)) && designateDig(w, c, q, true)) k++;
      }
    }
    return w;
  }
  if (scene === 'ten') {
    const sp = ['lasius', 'formica', 'solenopsis', 'atta', 'lasius', 'formica', 'solenopsis', 'atta', 'lasius', 'formica'];
    const s: GameSetup = { ...stressSetup(), width: 1500, depth: 1500, colonies: sp.map((x, i) => ({ species: x as never, player: i === 0, ai: true, developed: 6, startWorkers: 10, popLimit: 600 })) };
    const w = createWorld(s, ev);
    const per = perColony(w, total);
    const cx = w.terrain.width / 2;
    const cy = w.terrain.depth / 2;
    for (const c of w.s.colonies) {
      const free = freeHexes(w, c);
      forage(w, c, free, per, 0.75);
      const e = c.entrances[0];
      placeMarker(w, c, 0, SURFACE, cx + (e.sx - cx) * 0.12, cy + (e.sy - cy) * 0.12);
      const castes = SPECIES[c.species].castes;
      group(w, c, free, castes[castes.length - 1], Math.round(per * 0.25), SURFACE, e.sx, e.sy, 0);
    }
    creatures(w, 60);
    return w;
  }
  if (scene === 'tunnel') {
    const s: GameSetup = { ...stressSetup(['lasius', 'formica']), width: 700, depth: 700, colonies: ['lasius', 'formica'].map((x, i) => ({ species: x as never, player: i === 0, ai: true, developed: 8, startWorkers: 10, popLimit: 1200 })) };
    const w = createWorld(s, ev);
    const r = routes(w)[0];
    if (r) {
      for (const half of r.halves) for (const st of half.steps) for (const q of st) if (q >= 0) (w.nestOf(half.space)!.softenHex(q), w.nestOf(half.space)!.completeHex(q));
      r.open = true;
    }
    const per = perColony(w, total);
    const [a, b] = w.s.colonies;
    const freeA = freeHexes(w, a);
    const freeB = freeHexes(w, b);
    // a's army in b's nest at b's gate; b's defenders at home
    const og = r ? w.nest(b.id)! : null;
    const gate = r ? ownHalf(r, b.id)!.gate : -1;
    if (og && gate >= 0) {
      const gp = og.hexCenter(gate);
      placeMarker(w, a, 2, nestSpace(b.id), gp.x, gp.y);
    }
    const pa = w.nest(a.id)!.hexCenter(freeA[0] ?? 0);
    const pb = w.nest(b.id)!.hexCenter(freeB[0] ?? 0);
    const ca = SPECIES[a.species].castes;
    const cb = SPECIES[b.species].castes;
    group(w, a, freeA, ca[ca.length - 1], Math.round(per * 0.4), nestSpace(a.id), pa.x, pa.y, og ? 2 : -1);
    group(w, a, freeA, ca[0], Math.round(per * 0.6), nestSpace(a.id), pa.x, pa.y, -1);
    group(w, b, freeB, cb[cb.length - 1], Math.round(per * 0.4), nestSpace(b.id), pb.x, pb.y, -1);
    group(w, b, freeB, cb[0], Math.round(per * 0.6), nestSpace(b.id), pb.x, pb.y, -1);
    return w;
  }
  throw new Error(`unknown scene ${scene}`);
}

interface Result {
  scene: string;
  ants: number;
  antsEnd: number;
  avg: number;
  p95: number;
  max: number;
  over40: number;
  hashes: string[];
  systems?: Record<string, number>;
}

const results: Result[] = [];
for (const scene of SCENES)
  for (const total of ANTS) {
    const w = build(scene, total);
    const sys: Record<string, number> = {};
    if (flags.has('--systems'))
      for (const s of w.systems) {
        const fn = s.fn;
        const name = s.name;
        sys[name] = 0;
        s.fn = (ww, dt) => {
          const t0 = performance.now();
          fn(ww, dt);
          sys[name] += performance.now() - t0;
        };
      }
    for (let i = 0; i < WARM; i++) {
      w.step(0.05);
      w.events.drain();
    }
    for (const k of Object.keys(sys)) sys[k] = 0;
    const times: number[] = [];
    const hashes: string[] = [];
    const ants0 = w.s.ants.length;
    for (let i = 0; i < TICKS; i++) {
      const t0 = performance.now();
      w.step(0.05);
      times.push(performance.now() - t0);
      w.events.drain();
      // (canonical: keys sorted, so a build that only orders an object's fields differently compares equal)
      if ((i + 1) % 50 === 0) hashes.push(canonHash(w));
    }
    const sorted = times.slice().sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const r: Result = { scene, ants: ants0, antsEnd: w.s.ants.length, avg: +avg.toFixed(2), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), max: +sorted[sorted.length - 1].toFixed(2), over40: times.filter((t) => t > 40).length, hashes };
    if (flags.has('--systems')) {
      r.systems = {};
      for (const [k, v] of Object.entries(sys).sort((a, b) => b[1] - a[1])) if (v / TICKS > 0.05) r.systems[k] = +(v / TICKS).toFixed(2);
    }
    results.push(r);
    // (--series: the average of each 50 ticks, to see a fight's phases)
    if (flags.has('--series')) {
      const seg: string[] = [];
      for (let k = 0; k < times.length; k += 50) {
        const part = times.slice(k, k + 50);
        seg.push(`${(part.reduce((x, y) => x + y, 0) / part.length).toFixed(1)}/${Math.max(...part).toFixed(0)}`);
      }
      console.log(`           per 50 ticks (avg/max ms): ${seg.join(' ')}`);
    }
    console.log(`${scene.padEnd(8)} ${String(ants0).padStart(5)} ants: tick avg ${r.avg.toFixed(2)} ms, p95 ${r.p95.toFixed(2)}, max ${r.max.toFixed(2)}, over 40 ms ${r.over40}/${TICKS}  hash ${hashes[hashes.length - 1]}` + (r.systems ? `\n           ${Object.entries(r.systems).map(([k, v]) => `${k} ${v}`).join(' · ')}` : ''));
  }
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
