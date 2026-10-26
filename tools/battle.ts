/**
 * Battle harness: two groups meet at a marker on open ground.
 *   npx vite-node tools/battle.ts -- formica_soldier:6 fire_minor:30 [seconds]
 * Prints survivors over time, grapples, pins, acid shots and venom deaths.
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { CASTES } from '../src/sim/species';
import { makeAnt } from '../src/sim/factory';
import { placeMarker } from '../src/sim/markers';

const args = process.argv.slice(2).filter((a) => a !== '--');
const [aSpec, bSpec] = [args[0] ?? 'formica_soldier:6', args[1] ?? 'fire_minor:30'];
const secs = Number(args[2] ?? 90);
/** "caste:n" or a mixed army "caste:n,caste:n" */
const parse = (s: string) => {
  const parts = s.split(',').map((p) => {
    const [caste, n] = p.split(':');
    return { caste, n: Number(n) };
  });
  return { caste: parts[0].caste, n: parts.reduce((t, p) => t + p.n, 0), parts };
};
const A = parse(aSpec);
const B = parse(bSpec);
const ev = new EventBus();
const w = createWorld({ seed: 3, style: 'meadow', width: 600, depth: 600, colonies: [{ species: CASTES[A.caste].species, player: true, ai: false }, { species: CASTES[B.caste].species, player: false, ai: false }], food: 0, aphids: 0, plants: 0 }, ev);
w.s.settings.foodRespawn = 0;
// clear starting workers out of the way: only the fighters meet at the centre
const fighters: number[][] = [[], []];
[A, B].forEach((g, ci) => {
  const c = w.colony(ci)!;
  placeMarker(w, c, 0, SURFACE, 300, 300);
  // shooters get their own marker a little behind their side's line
  placeMarker(w, c, 1, SURFACE, 300 + (ci === 0 ? -35 : 35), 300);
  const castes = g.parts.flatMap((p) => Array.from({ length: p.n }, () => p.caste));
  for (let i = 0; i < g.n; i++) {
    const ang = (i / g.n) * Math.PI * 2;
    // shooters start behind the line
    const back = castes[i].includes('mortar') || castes[i].includes('rapid') ? 18 : 0;
    const x = 300 + (ci === 0 ? -60 - back : 60 + back) + Math.cos(ang) * 12;
    const y = 300 + Math.sin(ang) * 12;
    const a = makeAnt(w, c.id, castes[i], SURFACE, x, y, ci === 0 ? 0 : Math.PI);
    a.task = 'marker';
    a.marker = back ? 1 : 0;
    fighters[ci].push(a.id);
  }
});
w.reindex();
let acid = 0;
let bites = 0;
let stings = 0;
ev.on('acid', () => acid++);
ev.on('bite', () => bites++);
ev.on('sting', () => stings++);
let grapSamples = 0;
let pinSamples = 0;
const alive = (ci: number) => fighters[ci].filter((id) => {
  const a = w.antById.get(id);
  return a && a.state !== AS.Dead;
}).length;
for (let t = 0; t <= secs * 20; t++) {
  w.step(0.05);
  ev.drain();
  // keep the marker assignment (task allocation would otherwise re-task these test ants)
  for (const ids of fighters) for (const id of ids) {
    const a = w.antById.get(id);
    if (a && a.state !== AS.Dead) {
      a.marker = a.caste.includes('mortar') || a.caste.includes('rapid') ? 1 : 0;
      a.task = 'marker';
      if (a.state === AS.Grapple) grapSamples++;
      if (a.pinned > 0) pinSamples++;
    }
  }
  if (t % 200 === 0) console.log(`t=${(t / 20).toFixed(0).padStart(3)}s  ${A.caste} ${alive(0)}/${A.n}   ${B.caste} ${alive(1)}/${B.n}`);
  if (!alive(0) || !alive(1)) {
    console.log(`  ended at ${(t / 20).toFixed(1)}s: ${A.caste} ${alive(0)}/${A.n}, ${B.caste} ${alive(1)}/${B.n}`);
    break;
  }
}
console.log(`bites ${bites}, stings ${stings}, acid shots ${acid}, grapple-seconds ${(grapSamples / 20).toFixed(0)}, pinned-seconds ${(pinSamples / 20).toFixed(0)}`);
