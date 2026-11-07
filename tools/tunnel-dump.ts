/** Dev: dump a nest's hexes round route 0's gate after the tunnel demo digs (tools only). */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { routes, dugFromGate, routeFrontier } from '../src/sim/tunnels';
import { chainToward, SOIL_GATE, SOIL_ROCK, SOIL_ROUTE, SOIL_AIR } from '../src/world/nestGrid';
const w = createWorld({ seed: 3, style: 'meadow', width: 640, depth: 640, colonies: [{ species: 'formica', player: true, ai: false }, { species: 'lasius', player: false, ai: true }], food: 1, settings: { creatures: 0 } }, new EventBus());
const me = w.s.colonies[0];
const g = w.nest(me.id)!;
const r = routes(w)[0];
const own = r.halves[0].colony === me.id ? r.halves[0] : r.halves[1];
const q0 = me.tiles.find((t) => t.type === 'queen')!.q;
const chain = chainToward(g, q0, own.gate, 80, (q) => g.isHexDiggable(q) || g.isHexDug(q));
console.log('chain', chain.length, 'ends at gate?', chain[chain.length - 1] === own.gate, 'gate', own.gate, g.hexCol(own.gate), g.hexRow(own.gate), 'soil', g.hexSoil[own.gate]);
for (const q of chain) if (q !== own.gate && !g.isHexDug(q)) { g.softenHex(q); g.completeHex(q); }
me.routeDig = r.id;
console.log('gate dug?', g.isHexDug(own.gate), 'neighbours dug', g.neighbors(own.gate).map((n) => n >= 0 && g.isHexDug(n)));
console.log('frontier', routeFrontier(w, me));
for (let i = 0; i < 1200; i++) w.step(0.05);
console.log('after 60s: dugFromGate', dugFromGate(w, own), 'jobs', w.s.ants.filter((a) => a.colony === me.id && a.task === 'job').map((a) => [a.jobK, a.jobQ, a.jobS]));
const c0 = g.hexCol(own.gate), r0 = g.hexRow(own.gate);
for (let rr = r0 - 6; rr <= r0 + 6; rr++) { let line = ''; for (let cc = c0 - 10; cc <= c0 + 10; cc++) { const q = g.hexIndex(cc, rr); const s = q < 0 ? '~' : g.isHexDug(q) ? '.' : g.hexSoil[q] === SOIL_ROCK ? '#' : g.hexSoil[q] === SOIL_ROUTE ? 'r' : g.hexSoil[q] === SOIL_GATE ? 'G' : g.hexDesig[q] ? 'd' : ' '; line += s; } console.log(line); }
