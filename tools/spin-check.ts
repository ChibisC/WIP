/**
 * Combat spinning check (fix brief, part 1): a 50 v 50 battle on open ground,
 * 30 ants on one beetle, and 60 workers squeezing out of a crowded nest.
 * Prints how many ants spin (a full turn the same way round within 3 s), the
 * mean turn rate in a fight, overlapping pairs, ants stacked on the beetle,
 * and the tunnel flow. Scenes: `tools/spinScenes.ts`.
 *
 *   npx vite-node tools/spin-check.ts
 */
import { battleStats, beetleRing, creatureOrbit, tunnelFlow } from './spinScenes';

const b = battleStats();
console.log(`50 v 50: ${b.fighters} fought; ${b.spinners} spun (a full turn one way within 3 s); mean turn rate ${(b.turnRate * 57.3).toFixed(0)}°/s; ${b.overlapPairs.toFixed(1)} overlapping pairs per sample`);
const r = beetleRing();
console.log(`30 on a beetle: ${r.latched} latched, ${r.spinners} spun, ${r.stacked} pairs stacked (< 1 mm apart)`);
const t = tunnelFlow();
console.log(`tunnels: ${t.out} of 60 workers out of the nest, mean ${t.meanT.toFixed(1)} s`);
for (const kind of ['groundBeetle', 'wolfSpider', 'lithobius', 'mantis', 'stagBeetle', 'tarantula']) {
  const o = creatureOrbit(kind);
  console.log(`${kind.padEnd(12)} latched ant: slides ${o.slideMmPerS.toFixed(2)} mm/s over the ground, swings ${o.orbitDegPerS.toFixed(1)}°/s round it (the creature turned ${o.creatureTurnDeg.toFixed(0)}° in 20 s; ${o.biting} biting at the end)`);
}
