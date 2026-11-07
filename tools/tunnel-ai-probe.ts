/**
 * AI colonies and tunnel routes, headless (CHANGE_PLAN §27): on a map with the player and AI rivals (and an AI ally),
 * at an AI level, how soon an AI colony starts a tunnel raid, whether the route opens and its fighters go through,
 * whether a warned AI colony guards its gate (and digs to meet, Hard+), and whether AI allies link nests.
 * Run: npx vite-node tools/tunnel-ai-probe.ts [-- level minutes seed]
 */
import { EventBus, SimEvent } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { nestSpace } from '../src/sim/types';
import { routes, routeUsable } from '../src/sim/tunnels';

const argv = (globalThis as unknown as { process: { argv: string[] } }).process;
const args = argv.argv.slice(2).filter((a) => a !== '--');
const level = Number(args[0] ?? 3);
const minutes = Number(args[1] ?? 25);
const seed = Number(args[2] ?? 5);
const events = new EventBus();
const log: string[] = [];
events.onAny((e: SimEvent) => {
  if (e.t === 'tunnelWarn' || e.t === 'tunnelOpen' || e.t === 'tunnelBreach') log.push(`${w.time.toFixed(0)}s ${e.t} ${JSON.stringify(e)}`);
});
const w = createWorld(
  {
    seed,
    style: 'meadow',
    width: 800,
    depth: 800,
    colonies: [
      { species: 'formica', player: true, ai: false, developed: 6, startWorkers: 10 },
      { species: 'lasius', player: false, ai: true, developed: 6, startWorkers: 10 },
      { species: 'solenopsis', player: false, ai: true, developed: 6, startWorkers: 10 },
      { species: 'atta', player: false, ai: true, team: 0, developed: 6, startWorkers: 10 },
    ],
    food: 1,
    settings: { creatures: 0, aiLevel: level, titanRaids: false },
  },
  events,
);
// the player sits idle; its AI rivals do their thing
const rs = routes(w);
console.log(`level ${level}, ${rs.length} routes: ${rs.map((r) => `${r.id}:${r.a}-${r.b}`).join(' ')}`);
let lastLine = '';
for (let t = 0; t < minutes * 60; t += 10) {
  for (let i = 0; i < 200; i++) w.step(0.05);
  events.drain();
  const line = w.s.colonies
    .map((c) => {
      const b = c.aiWar;
      const r = rs[c.routeDig ?? -1];
      const prog = r ? r.halves.map((h) => h.steps.filter((st) => st.every((q) => q < 0 || w.nestOf(h.space)!.isHexDug(q))).length + '/' + h.steps.length).join('+') : '-';
      return `${c.name.slice(0, 10)}: dig ${c.routeDig ?? -1} ${prog} target ${b?.target ?? '-'} tunnel ${b?.tunnel ?? '-'}${b?.tunnelled ? '!' : ''} def ${b?.defending ? 'Y' : 'n'} alive ${c.alive ? c.living : 'dead'}`;
    })
    .join(' | ');
  if (line !== lastLine) {
    lastLine = line;
    console.log(`${(w.time / 60).toFixed(1)}m ${line}`);
  }
}
for (const l of log) console.log(l);
console.log('open routes:', rs.filter((r) => r.open).map((r) => `${r.a}-${r.b}`).join(' ') || 'none');
for (const c of w.s.colonies) {
  const away = w.s.ants.filter((a) => a.colony === c.id && a.space !== nestSpace(c.id) && a.space !== 0).length;
  console.log(`${c.name}: ${away} ants in other nests; linked to ${w.s.colonies.filter((o) => o !== c && rs.some((r) => ((r.a === c.id && r.b === o.id) || (r.a === o.id && r.b === c.id)) && routeUsable(w, r, c.id))).map((o) => o.name).join(', ') || 'nobody'}`);
}
