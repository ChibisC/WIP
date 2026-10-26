/**
 * Probe: how spread out a melee is (user note 2026-10-25: "fight too compact"). Two arena teams charge each other;
 * every second it prints, per team, the units' states and the median / 10th-percentile distance from each unit to
 * its nearest living teammate in body lengths, and how many units overlap a teammate (closer than 0.5 body lengths).
 *   npx vite-node tools/fightspread.ts -- [a=ant:lasius_soldier] [na=24] [b=ant:formica_soldier] [nb=24] [secs=16]
 */
import { EventBus } from '../src/core/events';
import { createWorld, GameSetup } from '../src/sim/mapGen';
import { ARENA } from '../src/sim/balance';
import { TEAM_NAMES, arenaLayout } from '../src/sim/arena';
import { AS } from '../src/sim/types';
import { casteOf } from '../src/sim/species';
import { applyCommand, Command, CommandBody, quantize } from '../src/sim/commands';

const args = process.argv.slice(2).filter((a) => a !== '--');
const [ua, na, ub, nb, secs] = [args[0] ?? 'ant:lasius_soldier', Number(args[1] ?? 24), args[2] ?? 'ant:formica_soldier', Number(args[3] ?? 24), Number(args[4] ?? 16)];
const L = arenaLayout(ARENA.size, 2);
const setup: GameSetup = {
  seed: 4, style: 'formicarium', width: ARENA.size, depth: ARENA.size,
  colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })),
  caves: [], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 }, arena: true,
};
const w = createWorld(setup, new EventBus());
let seq = 0;
const cmd = (b: CommandBody) => applyCommand(w, { ...quantize(b), tick: w.s.tick, player: 0, seq: seq++ } as Command);
cmd({ type: 'arenaSpawn', team: 0, unit: ua, n: na, level: 1, at: false, x: 0, y: 0 });
cmd({ type: 'arenaSpawn', team: 1, unit: ub, n: nb, level: 1, at: false, x: 0, y: 0 });
const units = (col: number) => w.s.ants.filter((a) => a.colony === col && a.state !== AS.Dead && a.id !== w.colony(col)!.queen);
let overlapSum = 0;
let distinct = 0;
let distinctN = 0;
let samples = 0;
for (let s = 1; s <= secs; s++) {
  for (let i = 0; i < 20; i++) {
    w.step(0.05);
    w.events.drain();
  }
  const line: string[] = [];
  for (const col of [0, 1]) {
    const u = units(col);
    const st: Record<string, number> = {};
    const nn: number[] = [];
    let over = 0;
    for (const a of u) {
      st[AS[a.state]] = (st[AS[a.state]] ?? 0) + 1;
      let best = Infinity;
      for (const o of u) if (o !== a) best = Math.min(best, Math.hypot(o.x - a.x, o.y - a.y));
      const bl = best / casteOf(a.caste).length;
      nn.push(bl);
      if (bl < 0.5) over++;
    }
    nn.sort((x, y) => x - y);
    const onAnts = u.filter((a) => (a.state === AS.Attack || a.state === AS.Grapple || a.state === AS.Spray) && a.tk === 3 && a.tgt);
    if (onAnts.length >= 8) {
      distinct += new Set(onAnts.map((a) => a.tgt)).size / onAnts.length;
      distinctN++;
    }
    const fighting = (st.Attack ?? 0) + (st.Grapple ?? 0) + (st.Spray ?? 0);
    if (fighting > u.length / 2 && u.length > 3) {
      overlapSum += over / u.length;
      samples++;
    }
    line.push(`T${col} ${u.length}: nn med ${(nn[nn.length >> 1] ?? 0).toFixed(2)} p10 ${(nn[Math.floor(nn.length * 0.1)] ?? 0).toFixed(2)} overlap ${over} [${Object.entries(st).map(([k, v]) => k + ' ' + v).join(', ')}]`);
  }
  console.log(`${String(s).padStart(2)} s  ${line.join('   |   ')}`);
}
console.log(`mean share of fighters overlapping a teammate (< 0.5 body lengths) while fighting: ${samples ? ((overlapSum / samples) * 100).toFixed(0) : '-'} %; distinct foes per 100 attackers ${distinctN ? ((distinct / distinctN) * 100).toFixed(0) : '-'}`);
if (process.env.PAIRS) {
  for (const col of [0, 1]) {
    const u = units(col);
    for (let i = 0; i < u.length; i++)
      for (let j = i + 1; j < u.length; j++) {
        const a = u[i];
        const o = u[j];
        const d = Math.hypot(o.x - a.x, o.y - a.y) / casteOf(a.caste).length;
        if (d > 0.3) continue;
        const ga = w.antById.get(a.gId);
        const go = w.antById.get(o.gId);
        console.log(`T${col} #${a.id} ${AS[a.state]} g${a.gId}${ga && ga.gId === a.id ? '(mutual)' : ''} slot ${a.gSlot.toFixed(2)} pinned ${a.pinned.toFixed(2)} | #${o.id} ${AS[o.state]} g${o.gId}${go && go.gId === o.id ? '(mutual)' : ''} slot ${o.gSlot.toFixed(2)} pinned ${o.pinned.toFixed(2)} — ${d.toFixed(2)} BL`);
      }
  }
}
