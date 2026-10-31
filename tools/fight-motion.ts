/**
 * Fight movement probe (melee reach, user note 2026-10-31: "maybe a factor that makes them move so much is that they
 * all have too short of a range"): how far units walk while they fight, and why.
 *
 * Every sim system is wrapped (World.systems), so each tick's movement is put down to the system that made it.
 *  - Creatures, while engaged (an enemy ant holding it, or closing on it within two of its own lengths of the body):
 *    mm walked per second as % of the creature's length, by system and by the state it was in (Chase: walking to an
 *    ant; Pounce, Leap: lunges; …), how often it walked with ants holding it (each such tick can shove them and
 *    cancel their attacks), and how far it walked in the second before each of its bites.
 *  - Ants, while fighting (closing in, holding, spraying, backing off, going round, waiting for a slot): mm per
 *    second as % of the ant's length, by what it was doing; holds that ended with the foe still alive (re-grips) and
 *    holds a creature's shove cancelled, per ant-minute.
 *  - `kill` mode: real health — seconds until the creature dies and the ants it killed (for balance).
 *
 *   npx vite-node tools/fight-motion.ts -- [scene=all] [secs=20] [seed=4] [mode=move|kill]
 *   scenes: a creature kind (groundBeetle, rove, lithobius, wolfSpider, mantis, stagBeetle, tarantula, scolopendra,
 *   giantMantis, hogna) fighting 40 Black garden ants (a quarter soldiers) that start round it; six (6 ground beetles
 *   v 45 workers, arena); clash (60 Black garden workers v 60 fire-ant soldiers, arena); all = every one of them.
 */
import { World } from '../src/sim/world';
import { KINDS, arenaWorld, creatureScene, measure, report, spawn } from './fightMotion';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const SCENE = argv[0] ?? 'all';
const SECS = Number(argv[1] ?? 20);
const SEED = Number(argv[2] ?? 4);
const MODE = argv[3] ?? 'move';

const scenes: Array<[string, () => World]> = [];
for (const k of KINDS) scenes.push([k, () => creatureScene(k, SEED, 40, MODE !== 'kill')]);
scenes.push(['six', () => {
  const { w, cmd } = arenaWorld(SEED);
  spawn(cmd, 1, 'cr:groundBeetle', 6, [300, 300]);
  spawn(cmd, 0, 'ant:lasius_worker', 45);
  return w;
}]);
scenes.push(['clash', () => {
  const { w, cmd } = arenaWorld(SEED);
  spawn(cmd, 0, 'ant:lasius_worker', 60);
  spawn(cmd, 1, 'ant:fire_soldier', 60);
  return w;
}]);
for (const [name, mk] of scenes) {
  if (SCENE !== 'all' && SCENE !== name) continue;
  const w = mk();
  report(`${name}${MODE === 'kill' ? ' (real health)' : ''}`, measure(w, SECS, MODE === 'kill'), MODE === 'kill');
}
