/**
 * Tunnel digging, headless (CHANGE_PLAN §27): two colonies on a map; the player's nest is dug out to its gate on the
 * route to the rival, then the route is dug with a normal crew, and the probe logs the frontier, the warning, the
 * crossing of the rim and the opening; then a marker in the rival's nest sends a group through. Run:
 * npx vite-node tools/tunnel-dig-probe.ts [-- workers seed]
 */
import { EventBus, SimEvent } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { applyCommand } from '../src/sim/commands';
import { nestSpace } from '../src/sim/types';
import { chainToward } from '../src/world/nestGrid';
import { dugFromGate, dugFromRim, routeProgress, routes } from '../src/sim/tunnels';

const argv = (globalThis as unknown as { process: { argv: string[] } }).process;
const args = argv.argv.slice(2).filter((a) => a !== '--');
const workers = Number(args[0] ?? 6);
const seed = Number(args[1] ?? 3);
const events = new EventBus();
const log: string[] = [];
events.onAny?.((e: SimEvent) => {
  if (e.t === 'tunnelWarn' || e.t === 'tunnelOpen' || e.t === 'tunnelBreach') log.push(`${e.t} @${w.time.toFixed(0)}s ${JSON.stringify(e)}`);
});
const w = createWorld({ seed, style: 'meadow', width: 100, depth: 100, map: 'meadowPond', colonies: [{ species: 'formica', player: true, ai: false, startWorkers: workers - 3 }, { species: 'lasius', player: false, ai: false, startWorkers: 4 }], food: 1, settings: { creatures: 0 } }, events);
const me = w.s.colonies[0];
const g = w.nest(me.id)!;
const r = routes(w)[0];
const own = r.halves[0].colony === me.id ? r.halves[0] : r.halves[1];
// dig the nest out to the gate: a straight passage from the queen's chamber
const q0 = me.tiles.find((t) => t.type === 'queen')!.q;
for (const q of chainToward(g, q0, own.gate, 60, (q) => g.isHexDiggable(q) || g.isHexDug(q))) if (q !== own.gate && !g.isHexDug(q)) {
  g.softenHex(q);
  g.completeHex(q);
}
for (let i = 0; i < 40; i++) w.step(0.05);
me.infiniteFood = true;
const res = applyCommand(w, { type: 'dig', q: own.gate, on: true, tick: w.s.tick, player: me.id, seq: 1 });
console.log(`route ${r.id}: ${r.a}–${r.b}; own half ${own.steps.length} steps, partner ${(r.halves[0] === own ? r.halves[1] : r.halves[0]).steps.length}; dig command: ${res ?? 'ok'}; routeDig ${me.routeDig}; workers ${w.s.ants.filter((a) => a.colony === me.id).length - 1}`);
let last = -1;
let crossedAt = -1;
let openAt = -1;
for (let t = 0; t < 900 && !r.open; t++) {
  for (let i = 0; i < 20; i++) w.step(0.05);
  events.drain();
  const other = r.halves[0] === own ? r.halves[1] : r.halves[0];
  const prog = routeProgress(w, r);
  const diggers = w.s.ants.filter((a) => a.colony === me.id && a.task === 'job' && a.jobK === 1);
  const inOther = w.s.ants.filter((a) => a.colony === me.id && a.space === other.space).length;
  if (inOther && crossedAt < 0) crossedAt = w.time;
  const key = Math.floor(prog * 20);
  if (key !== last) {
    last = key;
    console.log(`${w.time.toFixed(0)}s progress ${(prog * 100).toFixed(0)}% own ${dugFromGate(w, own)}/${own.steps.length} partner from rim ${dugFromRim(w, other)}/${other.steps.length} diggers ${diggers.length} (in partner nest ${inOther})`);
  }
}
if (r.open) openAt = w.time;
const other = r.halves[0] === own ? r.halves[1] : r.halves[0];
for (let t = 0; t < 300 && !other.joined; t++) {
  for (let i = 0; i < 20; i++) w.step(0.05);
  events.drain();
}
console.log(`breach into the rival's floor ${other.joined ? `done at ${w.time.toFixed(0)}s (${other.breach?.length} hexes)` : 'never done'}; routeDig now ${me.routeDig}`);
console.log(`crossed the rim at ${crossedAt.toFixed(0)}s; open at ${openAt.toFixed(0)}s (${(openAt / 60).toFixed(1)} min) with ${workers} workers`);
for (const l of log) console.log(l);
// a marker in the rival's nest: the group walks through
const rival = w.s.colonies[1];
const rg = w.nest(rival.id)!;
const rq = rival.tiles.find((t) => t.type === 'queen')!.q;
const rp = rg.hexCenter(rq);
console.log('marker:', applyCommand(w, { type: 'placeMarker', i: 2, space: nestSpace(rival.id), x: rp.x, y: rp.y, tick: w.s.tick, player: me.id, seq: 2 }) ?? 'ok');
for (const gr of me.groups) console.log('group', gr.id, applyCommand(w, { type: 'assignGroup', group: gr.id, marker: 2, tick: w.s.tick, player: me.id, seq: 3 }) ?? 'ok');
let arrived = -1;
for (let t = 0; t < 240 && arrived < 0; t++) {
  for (let i = 0; i < 20; i++) w.step(0.05);
  events.drain();
  const near = w.s.ants.filter((a) => a.colony === me.id && a.space === nestSpace(rival.id) && Math.hypot(a.x - rp.x, a.y - rp.y) < 45).length;
  if (near >= 3) arrived = w.time;
}
console.log(arrived >= 0 ? `group reached the rival queen by the tunnel at ${arrived.toFixed(0)}s` : 'group never reached the rival queen');
