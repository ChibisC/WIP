/**
 * Raid harness: a rival colony grows for a few minutes (builder brain), then a
 * raiding party is sent to a marker beside its queen.
 *   npx vite-node tools/raid.ts -- formica_soldier:8,formica_worker:10 solenopsis [growSeconds] [raidSeconds]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE, nestSpace } from '../src/sim/types';
import { CASTES, SpeciesId } from '../src/sim/species';
import { makeAnt } from '../src/sim/factory';
import { placeMarker } from '../src/sim/markers';

const args = process.argv.slice(2).filter((a) => a !== '--');
const party = (args[0] ?? 'formica_soldier:8,formica_worker:10').split(',').map((s) => ({ caste: s.split(':')[0], n: Number(s.split(':')[1]) }));
const rival = (args[1] ?? 'solenopsis') as SpeciesId;
const grow = Number(args[2] ?? 240);
const raid = Number(args[3] ?? 180);
const ev = new EventBus();
const w = createWorld({ seed: 6, style: 'meadow', width: 700, depth: 700, colonies: [{ species: CASTES[party[0].caste].species, player: true, ai: false }, { species: rival, player: false, ai: true }], food: 1 }, ev);
const P = w.colony(0)!;
const R = w.colony(1)!;
for (let i = 0; i < grow * 20; i++) {
  w.step(0.05);
  ev.drain();
}
const rg = w.nest(1)!;
const qa = w.antById.get(R.queen)!;
console.log(`rival after ${grow}s: ${R.living} ants, ${R.tiles.length} tiles, brood ${w.s.brood.filter((b) => b.colony === 1).length}; queen hp ${qa.hp.toFixed(0)}`);
placeMarker(w, P, 0, nestSpace(1), qa.x + 6, qa.y);
const ids: number[] = [];
const e = P.entrances[0];
for (const g of party)
  for (let i = 0; i < g.n; i++) {
    const a = makeAnt(w, P.id, g.caste, SURFACE, e.sx + Math.cos(i) * 8, e.sy + Math.sin(i) * 8, 0);
    a.task = 'marker';
    a.marker = 0;
    ids.push(a.id);
  }
w.reindex();
let bites = 0;
let inTunnel = 0;
let inChamber = 0;
let stolen = 0;
ev.on('bite', (b) => {
  if (b.space !== nestSpace(1)) return;
  bites++;
  const q = rg.hexAt(b.x, b.y);
  const t = R.tiles.find((x) => x.q === q);
  if (t) inChamber++;
  else inTunnel++;
});
const brood0 = () => w.s.brood.filter((b) => b.colony === 1).length;
let foodIn = 0;
ev.on('food', (f) => {
  if (f.colony === 0) foodIn += f.amount;
});
for (let t = 1; t <= raid * 20; t++) {
  w.step(0.05);
  ev.drain();
  for (const id of ids) {
    const a = w.antById.get(id);
    if (a && a.state !== AS.Dead) {
      a.task = 'marker';
      a.marker = 0;
    }
  }
  for (const f of w.s.food) if (f.from === 'brood' && f.heldBy && w.antById.get(f.heldBy)?.colony === 0 && !(f as { counted?: boolean }).counted) {
    (f as { counted?: boolean }).counted = true;
    stolen++;
  }
  if (t % 400 === 0) {
    const alive = ids.filter((id) => w.antById.get(id)?.state !== AS.Dead && w.antById.get(id)).length;
    const inside = ids.filter((id) => w.antById.get(id)?.space === nestSpace(1)).length;
    const defenders = w.s.ants.filter((a) => a.colony === 1 && a.space === nestSpace(1) && (a.state === AS.Attack || a.state === AS.Grapple)).length;
    const q = w.antById.get(R.queen);
    console.log(`t=${t / 20}s raiders ${alive}/${ids.length} (inside ${inside})  rival ${R.living} ants, fighting ${defenders}, queen ${q && q.state !== AS.Dead ? q.hp.toFixed(0) + 'hp' : 'DEAD'}, alive=${R.alive}  brood ${brood0()}`);
  }
}
console.log(`nest bites: ${bites} (tunnel/open floor ${inTunnel}, on tiles ${inChamber}); brood pieces stolen ${stolen}; food brought home ${foodIn.toFixed(0)}`);
{
  const e1 = R.entrances[0];
  console.log('rival entrance', e1.sx.toFixed(0), e1.sy.toFixed(0), 'player entrance', P.entrances[0].sx.toFixed(0), P.entrances[0].sy.toFixed(0));
  for (const id of ids.slice(0, 6)) {
    const a = w.antById.get(id);
    if (!a) continue;
    console.log(`#${id} ${AS[a.state]} task ${a.task} m${a.marker} sp${a.space} carry${a.carry} pos ${a.x.toFixed(0)},${a.y.toFixed(0)} dEnt ${Math.hypot(a.x - e1.sx, a.y - e1.sy).toFixed(0)} tk${a.tk}`);
  }
}
