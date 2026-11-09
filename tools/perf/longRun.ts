/**
 * A long natural game, timed tick by tick (performance v4, claude/performance/04-spec-performance-v4-on-screen-spikes-story.md
 * §1): a skirmish as the menu builds it (four colonies on Meadow Pond, grown by `developed` tiles, wild creatures and
 * titan raids on), the rivals played by the AI and the player's colony by the AI too or left to itself (`idle`: a
 * player who builds nothing and sends no one out — its ants rest and work in the nest). Every tick timed; the ticks
 * over 40 ms listed with the systems that took the time and the full flow-field builds of that tick (a field cache
 * that thrashes shows there).
 *
 *   tools/perf/bundle.sh-style: npx esbuild tools/perf/longRun.ts --bundle --platform=node --format=esm --outfile=/tmp/lr.mjs
 *   node /tmp/lr.mjs [minutes=30] [seed=3] [player=ai|idle] [--trees] [--map=meadowPond] [--developed=6] [--every=5]
 */
import { EventBus } from '../../src/core/events';
import { createWorld, GameSetup } from '../../src/sim/mapGen';
import { canonHash } from './canon';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const flags = new Map(argv.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.split('=')[1] : '1']));
const pos = argv.filter((a) => !a.startsWith('--'));
const MINUTES = Number(pos[0] ?? 30);
const SEED = Number(pos[1] ?? 3);
const PLAYER = pos[2] ?? 'ai';
const EVERY = Number(flags.get('every') ?? 5);

const species = ['lasius', 'formica', 'solenopsis', 'atta'] as const;
const setup: GameSetup = {
  seed: SEED,
  style: 'meadow',
  width: 800,
  depth: 800,
  colonies: species.map((sp, i) => ({ species: sp, player: i === 0, ai: i > 0 || PLAYER === 'ai', developed: Number(flags.get('developed') ?? 6) })),
  caves: [{ name: 'Root hollow', kind: 'cave', food: 70 }],
  food: 1.2,
  settings: { creatures: 1 },
  map: (flags.get('map') ?? 'meadowPond') as never,
  ...(flags.has('trees') ? { trees: true } : {}),
};
const w = createWorld(setup, new EventBus());

const sysNow: Record<string, number> = {};
const sysAll: Record<string, number> = {};
for (const sy of w.systems) {
  const fn = sy.fn;
  const name = sy.name;
  sy.fn = (ww, dt) => {
    const a = performance.now();
    fn(ww, dt);
    const d = performance.now() - a;
    sysNow[name] = (sysNow[name] ?? 0) + d;
    sysAll[name] = (sysAll[name] ?? 0) + d;
  };
}
const gf = (w as unknown as { gridFlows: Map<number, { stats: { full: number }; size: number; grid: { w: number; h: number } }> }).gridFlows;
const fullSeen = new Map<number, number>();
const slow: Array<{ tick: number; ms: number; what: string }> = [];
const times: number[] = [];
const T = MINUTES * 1200;
const t0 = performance.now();
for (let t = 0; t < T; t++) {
  const a = performance.now();
  w.step(0.05);
  const ms = performance.now() - a;
  w.events.drain();
  times.push(ms);
  let builds = 0;
  const big: string[] = [];
  for (const [sp, f] of gf) {
    const d = f.stats.full - (fullSeen.get(sp) ?? 0);
    fullSeen.set(sp, f.stats.full);
    builds += d;
    if (d > 5) big.push(`area ${sp} ${f.grid.w}×${f.grid.h}: ${d} builds, ${f.size} cached`);
  }
  if (ms > 40) {
    const top = Object.entries(sysNow).filter(([, v]) => v > 3).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
    slow.push({ tick: w.s.tick, ms, what: `${top}${builds ? ` | flow builds ${builds}${big.length ? ' (' + big.join('; ') + ')' : ''}` : ''}` });
  }
  for (const k in sysNow) sysNow[k] = 0;
  if (EVERY > 0 && t % (EVERY * 1200) === EVERY * 1200 - 1) {
    const last = times.slice(-EVERY * 1200);
    const s = last.slice().sort((x, y) => x - y);
    const living = w.s.colonies.map((c) => c.living).join('/');
    console.log(`${((t + 1) / 1200).toFixed(0).padStart(3)} min: ants ${w.s.ants.length} (${living}), creatures ${w.s.creatures.length} · tick avg ${(last.reduce((x, y) => x + y, 0) / last.length).toFixed(2)} ms, p99 ${s[Math.floor(s.length * 0.99)].toFixed(1)}, max ${s[s.length - 1].toFixed(1)}, over 40 ms ${last.filter((x) => x > 40).length}`);
  }
}
const s = times.slice().sort((x, y) => x - y);
console.log(`\n${MINUTES} min, seed ${SEED}, player ${PLAYER}${flags.has('trees') ? ', trees on' : ''}: ${T} ticks in ${((performance.now() - t0) / 1000).toFixed(0)} s · avg ${(times.reduce((x, y) => x + y, 0) / T).toFixed(2)} ms, p99 ${s[Math.floor(T * 0.99)].toFixed(1)}, max ${s[T - 1].toFixed(1)}, over 40 ms ${slow.length} · hash ${canonHash(w)}`);
console.log('systems (ms a tick): ' + Object.entries(sysAll).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${k} ${(v / T).toFixed(2)}`).join(' · '));
for (const x of slow.sort((p, q) => q.ms - p.ms).slice(0, 20)) console.log(`  #${x.tick} (${(x.tick / 1200).toFixed(1)} min) ${x.ms.toFixed(0)} ms ${x.what}`);
