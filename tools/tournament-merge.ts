/**
 * Merge the JSON lines written by `tools/tournament.ts` (OUT=…, one file per PART) into one win table.
 *   npx vite-node tools/tournament-merge.ts -- games-0.json games-1.json …
 */
import { readFileSync } from 'node:fs';

interface Game {
  a: string;
  b: string;
  seed: number;
  winner: string;
  loser: string;
  byKill: boolean;
  end: number;
  living: [number, number];
  kills: [number, number];
}
const files = process.argv.slice(2).filter((a) => a !== '--');
const games: Game[] = files.flatMap((f) =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Game),
);
const species = [...new Set(games.flatMap((g) => [g.a, g.b]))];
const vs = new Map<string, number>();
const t = new Map(species.map((s) => [s, { played: 0, won: 0, byKill: 0, kills: 0, size: 0, lostByKill: 0, mins: [] as number[] }]));
for (const g of games) {
  vs.set(`${g.winner}>${g.loser}`, (vs.get(`${g.winner}>${g.loser}`) ?? 0) + 1);
  [g.a, g.b].forEach((s, i) => {
    const r = t.get(s)!;
    r.played++;
    r.kills += g.kills[i];
    r.size += g.living[i];
  });
  const w = t.get(g.winner)!;
  w.won++;
  if (g.byKill) {
    w.byKill++;
    w.mins.push(g.end);
    t.get(g.loser)!.lostByKill++;
  }
}
console.log(`${games.length} games\n\nwins (row beat column):`);
console.log(''.padEnd(14) + species.map((s) => s.slice(0, 8).padStart(9)).join(''));
for (const r of species) console.log(r.padEnd(14) + species.map((c) => (r === c ? '—' : String(vs.get(`${r}>${c}`) ?? 0)).padStart(9)).join(''));
console.log('\nspecies         win%  won by kill  lost by kill  avg kills  avg ants at end  avg min to kill');
for (const s of [...species].sort((x, y) => t.get(y)!.won / t.get(y)!.played - t.get(x)!.won / t.get(x)!.played)) {
  const r = t.get(s)!;
  const m = r.mins.length ? (r.mins.reduce((a, b) => a + b, 0) / r.mins.length).toFixed(1) : '-';
  console.log(`${s.padEnd(14)} ${((100 * r.won) / Math.max(1, r.played)).toFixed(0).padStart(4)}%  ${String(r.byKill).padStart(11)}  ${String(r.lostByKill).padStart(12)}  ${(r.kills / r.played).toFixed(0).padStart(9)}  ${(r.size / r.played).toFixed(0).padStart(15)}  ${m.padStart(15)}`);
}
