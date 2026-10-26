/**
 * AI-only tournament (Phase 15 balance): every pair of species, several
 * seeds, both starting sides, run by the AI (builder + war brain) for up to
 * N game minutes. A game is won when the other queen falls; at the time
 * limit the larger colony (living ants, plus a little for stored food) takes
 * it on points.
 *
 *   [TUNE=caste.field=v,cost.caste.build=v,…] [PART=k/n] [OUT=games.json] npx vite-node tools/tournament.ts -- [minutes=30] [seeds=3] [species,…]
 *
 * Prints a win table and each species' win rate, kills and peak size. PART=k/n plays every n-th game starting at k
 * (run n processes side by side), OUT writes each game's result as JSON lines; `tools/tournament-merge.ts` merges them.
 * FOCUS=<species> plays only that species' games.
 * The Gene Thief borrows the menu's default castes (Red Wood Ant mortar, fire-ant major).
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { CASTES, SpeciesId } from '../src/sim/species';
import { BALANCE } from '../src/sim/balance';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const minutes = Number(args[0] ?? 30);
const seeds = Number(args[1] ?? 3);
const list = (args[2] ?? 'lasius,formica,atta,solenopsis,eciton,nasutitermes,rhynchotermes,hell,aurimyrmex,termant,plagiaria').split(',') as SpeciesId[];
const [partK, partN] = (process.env.PART ?? '0/1').split('/').map(Number);
const OUT = process.env.OUT ?? '';
// FOCUS=atta: only the games one species plays (a quick check of one species against the field while tuning it)
const FOCUS = process.env.FOCUS ?? '';
let gameNo = -1;
// games already in OUT are skipped (a stopped run picks up where it left off)
const done = new Set<string>(
  OUT && existsSync(OUT)
    ? readFileSync(OUT, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const g = JSON.parse(l) as { a: string; b: string; seed: number };
          return `${g.a}|${g.b}|${g.seed}`;
        })
    : [],
);
// Balance experiments without editing the source: TUNE="atta_major.hp=180,cost.atta_major.build=90,bal.atta.fungusToFood=1.2"
for (const kv of (process.env.TUNE ?? '').split(',').filter(Boolean)) {
  const [path, v] = kv.split('=');
  const parts = path.split('.');
  const obj = (parts[0] === 'cost' ? (BALANCE.castes as Record<string, unknown>)[parts[1]] : parts[0] === 'bal' ? (BALANCE as unknown as Record<string, unknown>)[parts[1]] : CASTES[parts[0]]) as unknown as Record<string, number>;
  const key = parts[parts.length - 1];
  if (!obj || !(key in obj)) throw new Error(`TUNE: unknown ${path}`);
  console.log(`TUNE ${path}: ${obj[key]} -> ${v}`);
  obj[key] = Number(v);
}

interface Tally {
  played: number;
  won: number;
  byKill: number;
  kills: number;
  peak: number;
  minutesToWin: number[];
}
const tally = new Map<SpeciesId, Tally>(list.map((s) => [s, { played: 0, won: 0, byKill: 0, kills: 0, peak: 0, minutesToWin: [] }]));
const vs = new Map<string, number>();
const t0 = performance.now();

for (let i = 0; i < list.length; i++) {
  for (let j = i + 1; j < list.length; j++) {
    for (let s = 0; s < seeds; s++) {
      for (const flip of [false, true]) {
        const a = flip ? list[j] : list[i];
        const b = flip ? list[i] : list[j];
        if (FOCUS && a !== FOCUS && b !== FOCUS) continue;
        if (++gameNo % partN !== partK) continue;
        if (done.has(`${a}|${b}|${s}`)) continue;
        const borrow = (sp: SpeciesId) => (sp === 'plagiaria' ? ['formica_mortar', 'fire_major'] : undefined);
        const w = createWorld(
          {
            seed: 1000 + s * 17 + (flip ? 1 : 0),
            style: 'meadow',
            width: 640,
            depth: 640,
            food: 1.2,
            colonies: [
              { species: a, player: false, ai: true, team: 1, borrowed: borrow(a) },
              { species: b, player: false, ai: true, team: 2, borrowed: borrow(b) },
            ],
            settings: { creatures: 1 },
          },
          new EventBus(),
        );
        const [ca, cb] = w.s.colonies;
        let end = minutes;
        for (let m = 0; m < minutes * 1200; m++) {
          w.step(0.05);
          if (m % 200 === 0) {
            for (const c of [ca, cb]) {
              const t = tally.get(c.species)!;
              t.peak = Math.max(t.peak, c.living);
            }
            if (!ca.alive || !cb.alive) {
              end = m / 1200;
              break;
            }
          }
        }
        const score = (c: typeof ca) => (c.alive ? c.living + c.food / 20 : -1);
        const winner = score(ca) >= score(cb) ? ca : cb;
        const loser = winner === ca ? cb : ca;
        for (const c of [ca, cb]) {
          const t = tally.get(c.species)!;
          t.played++;
          t.kills += c.stats.kills;
        }
        const tw = tally.get(winner.species)!;
        tw.won++;
        if (!loser.alive) {
          tw.byKill++;
          tw.minutesToWin.push(end);
        }
        const key = `${winner.species}>${loser.species}`;
        vs.set(key, (vs.get(key) ?? 0) + 1);
        if (OUT) appendFileSync(OUT, JSON.stringify({ a, b, seed: s, winner: winner.species, loser: loser.species, byKill: !loser.alive, end, living: [ca.living, cb.living], kills: [ca.stats.kills, cb.stats.kills], peak: [tally.get(a)!.peak, tally.get(b)!.peak] }) + '\n');
        console.log(`${a.padEnd(10)} vs ${b.padEnd(10)} seed ${s}: ${winner.species} wins ${loser.alive ? 'on points' : `by killing the queen at ${end.toFixed(1)} min`} (${ca.living} vs ${cb.living} ants)`);
      }
    }
  }
}

console.log('\nwins (row beat column):');
console.log(''.padEnd(12) + list.map((s) => s.slice(0, 9).padStart(10)).join(''));
for (const r of list) console.log(r.padEnd(12) + list.map((c) => (r === c ? '—' : String(vs.get(`${r}>${c}`) ?? 0)).padStart(10)).join(''));
console.log('\nspecies     win%   by kill   avg kills   peak ants');
for (const [s, t] of tally) console.log(`${s.padEnd(10)} ${((100 * t.won) / Math.max(1, t.played)).toFixed(0).padStart(5)}%   ${String(t.byKill).padStart(7)}   ${(t.kills / Math.max(1, t.played)).toFixed(0).padStart(9)}   ${String(t.peak).padStart(9)}`);
console.log(`\n${((performance.now() - t0) / 1000).toFixed(0)} s`);
