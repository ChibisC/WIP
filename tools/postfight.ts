/**
 * Probe: what fighters do once their foes are dead (user note 2026-10-25: "a weird glitchy movement"). Arena, two
 * teams; team 1 is a few weak workers; after the last one dies, every team-0 unit is sampled each tick for 12 s:
 * heading reversals (the turn changing sign between ticks, both turns over `jitterRad`), speed toggles (moving ↔
 * still), state changes, and path length against net travel. Prints the worst units and a per-state summary.
 *   npx vite-node tools/postfight.ts -- [unit=ant:lasius_soldier] [n=20] [foes=ant:lasius_worker] [nFoes=6] [secs=12]
 */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { ARENA } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout } from '../src/sim/arena';
import { AS } from '../src/sim/types';
import { applyCommand, Command, CommandBody, quantize } from '../src/sim/commands';

const args = process.argv.slice(2).filter((a) => a !== '--');
const unit = args[0] ?? 'ant:lasius_soldier';
const n = Number(args[1] ?? 20);
const foes = args[2] ?? 'ant:lasius_worker';
const nFoes = Number(args[3] ?? 6);
const secs = Number(args[4] ?? 12);
const L = arenaLayout(ARENA.size, 2);
const setup: GameSetup = {
  seed: 4, style: 'formicarium', width: ARENA.size, depth: ARENA.size,
  colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })),
  caves: [], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 }, arena: true,
};
const w = createWorld(setup, new EventBus());
let seq = 0;
const cmd = (b: CommandBody) => applyCommand(w, { ...quantize(b), tick: w.s.tick, player: 0, seq: seq++ } as Command);
cmd({ type: 'arenaSpawn', team: 0, unit, n, level: 1, at: false, x: 0, y: 0 });
cmd({ type: 'arenaSpawn', team: 1, unit: foes, n: nFoes, level: 1, at: false, x: 0, y: 0 });
const mine = () => w.s.ants.filter((a) => a.colony === 0 && a.state !== AS.Dead && a.id !== w.colony(0)!.queen && a.id !== w.colony(0)!.king);
const theirs = () => w.s.ants.filter((a) => a.colony === 1 && a.state !== AS.Dead && a.id !== w.colony(1)!.queen && a.id !== w.colony(1)!.king).length + w.s.creatures.filter((c) => !c.dead && c.faction === 1).length;
let t = 0;
while (theirs() > 0 && t < 20 * 240) {
  w.step(0.05);
  w.events.drain();
  t++;
}
console.log(`${unit} ×${n} vs ${foes} ×${nFoes}: foes dead after ${(t / 20).toFixed(1)} s, ${mine().length} left`);
const J = 0.06;
type S = { id: number; caste: string; lastH: number; lastDh: number; rev: number; tog: number; lastMoving: boolean; states: Map<string, number>; trans: number; lastState: number; path: number; x0: number; y0: number; lx: number; ly: number; pose: Map<number, number> };
const st = new Map<number, S>();
for (const a of mine()) st.set(a.id, { id: a.id, caste: a.caste, lastH: a.h, lastDh: 0, rev: 0, tog: 0, lastMoving: a.v > 0.01, states: new Map(), trans: 0, lastState: a.state, path: 0, x0: a.x, y0: a.y, lx: a.x, ly: a.y, pose: new Map() });
const logs = new Map<number, string[]>();
for (let k = 0; k < secs * 20; k++) {
  w.step(0.05);
  w.events.drain();
  for (const a of mine()) {
    const s = st.get(a.id);
    if (!s) continue;
    let dh = a.h - s.lastH;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > J && Math.abs(s.lastDh) > J && Math.sign(dh) !== Math.sign(s.lastDh)) s.rev++;
    s.lastDh = dh;
    s.lastH = a.h;
    const moving = Math.hypot(a.x - s.lx, a.y - s.ly) > 0.02;
    if (moving !== s.lastMoving) s.tog++;
    s.lastMoving = moving;
    s.path += Math.hypot(a.x - s.lx, a.y - s.ly);
    s.lx = a.x;
    s.ly = a.y;
    const sn = AS[a.state] + '/' + a.task;
    s.states.set(sn, (s.states.get(sn) ?? 0) + 1);
    if (a.state !== s.lastState) s.trans++;
    s.lastState = a.state;
    (logs.get(a.id) ?? logs.set(a.id, []).get(a.id)!).push(`${k} ${AS[a.state]}/${a.task} x ${a.x.toFixed(2)} y ${a.y.toFixed(2)} h ${a.h.toFixed(2)} v ${a.v.toFixed(2)} pause ${a.pause.toFixed(2)} pose ${a.pose}`);
  }
}
const all = [...st.values()];
const tot = (f: (s: S) => number) => all.reduce((x, s) => x + f(s), 0);
console.log(`over ${secs} s, ${all.length} units: heading reversals ${tot((s) => s.rev)}, move/stop toggles ${tot((s) => s.tog)}, state changes ${tot((s) => s.trans)}, path ${tot((s) => s.path).toFixed(0)} mm, net ${tot((s) => Math.hypot(s.lx - s.x0, s.ly - s.y0)).toFixed(0)} mm`);
const states = new Map<string, number>();
for (const s of all) for (const [k, v] of s.states) states.set(k, (states.get(k) ?? 0) + v);
console.log('states:', [...states.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / all.length / 20).toFixed(1)}s`).join(', '));
for (const s of all.sort((a, b) => b.rev + b.tog - a.rev - a.tog).slice(0, 4)) console.log(`  #${s.id} ${s.caste}: rev ${s.rev}, toggles ${s.tog}, states ${s.trans}, path ${s.path.toFixed(1)} net ${Math.hypot(s.lx - s.x0, s.ly - s.y0).toFixed(1)}  [${[...s.states.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}]`);
if (process.env.TRACE) {
  const worst = all[0];
  console.log(`trace #${worst.id}:`);
  console.log((logs.get(worst.id) ?? []).slice(Number(process.env.TRACE) || 0).join('\n'));
}
