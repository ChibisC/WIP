/**
 * Equal-food battles: how many of each caste the same food buys (build + hatch),
 * then fight them with tools/battle.ts logic.
 *   npx vite-node tools/equal.ts -- casteA casteB [food]
 */
import { casteCosts } from '../src/sim/tiles';
const args = process.argv.slice(2).filter((a) => a !== '--');
const [a, b] = args;
const food = Number(args[2] ?? 150);
const n = (c: string) => Math.max(1, Math.round(food / (casteCosts(c).build + casteCosts(c).hatch)));
console.log(`${a}:${n(a)} ${b}:${n(b)}`);
