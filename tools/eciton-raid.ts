/**
 * Army-ant swarm raid numbers (scene: tools/ecitonScene.ts).
 *
 *   npx vite-node tools/eciton-raid.ts -- [minors=40] [porters=8] [medias=5] [majors=8] [seconds=120] [seed=5] [puddle=1]
 */
import { raidScene } from './ecitonScene';

const args = process.argv.slice(2).filter((a) => a !== '--').map(Number);
const t0 = Date.now();
const r = raidScene({ minors: args[0] ?? 40, porters: args[1] ?? 8, medias: args[2] ?? 5, majors: args[3] ?? 8, seconds: args[4] ?? 120, seed: args[5] ?? 5, creatures: 4, puddle: (args[6] ?? 1) === 1 });
const L = r.minL;
console.log(`raid at ${r.mx.toFixed(0)},${r.my.toFixed(0)} (marker radius ${r.radius} mm), trail ${r.routeLen.toFixed(0)} mm`);
console.log(`front: half-width ${r.frontHalf.toFixed(0)} mm, roamed ${r.frontTravel.toFixed(0)} mm, at most ${r.maxFrontDist.toFixed(0)} mm from the marker`);
console.log(`raiders pulsing forward ${(100 * r.pulseShare).toFixed(0)} % of raid time (${r.raidStates} samples)`);
console.log(`lanes: outbound ants ${(r.laneOut / L).toFixed(2)} L off the trail centre (${r.laneOutN}), laden ants ${(r.laneIn / L).toFixed(2)} L (${r.laneInN}); lane offset ${r.laneOffset} L`);
console.log(`porters carrying: ${r.porterCarry} samples, load under the body ${(100 * r.porterUnderShare).toFixed(0)} %`);
console.log(`food brought home ${r.food.toFixed(1)}; seed loads seen ${r.seedsTaken}; creature-ticks flushed ${r.flushed}`);
console.log(`Soldier posts ${r.posts.length} (facing out: ${r.outward}), guards at posts ${r.guards}; posts at ${r.postArcs.map((s) => s.toFixed(0)).join(', ')} mm from the entrance`);
console.log(`team carries going ${r.teamSec.toFixed(0)} s; bridges ${JSON.stringify(r.bridges.map((b) => ({ ...b, span: +b.span.toFixed(1) })))}, finished at ${r.bridgeDoneT} s with ${r.bridgeMembers} links, ${r.crossings} crossings; potholes ${r.plugs} (plugged ${(r.pluggedTicks / 20).toFixed(0)} plug-s)`);
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
