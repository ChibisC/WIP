/**
 * How long a digging titan takes to open an anthill's hole (claude/creatures/02-spec-easier-titan-holes.md §1, §4): a
 * skirmish nest (Termants unless SPECIES=…), the titan sent on a raid from 45 mm off the hole; undefended, 20 or 80 soldiers waiting at
 * the hole (on the ground, no climbing), or 20 soldiers on it (riders: climbing allowed). Prints the seconds of digging
 * until the breach, or when it gave up (`giveUpHealth`), with the health it had left, as a Markdown table.
 *
 *   npx vite-node tools/titan-holes.ts -- [seed=5]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { killAnt } from '../src/sim/antAI';
import { placeTile } from '../src/sim/tiles';
import { spawnCreature } from '../src/sim/creatures/creatureAI';
import { RAID, startTitanRaid } from '../src/sim/creatures/titanDig';
import { assignGroup, placeMarker, setMarkerOrder } from '../src/sim/markers';
import { CREATURES } from '../src/sim/creatures/kinds';
import { TITAN_DIG } from '../src/sim/balance';
import type { World } from '../src/sim/world';

export type HoleSetup = 'undefended' | '20 defenders' | '80 defenders' | 'riders';
export const HOLE_SETUPS: HoleSetup[] = ['undefended', '20 defenders', '80 defenders', 'riders'];
export const DIGGERS = ['tarantula', 'hogna', 'scolopendra', 'stagBeetle'] as const;

export interface HoleRun {
  /** seconds of digging until the breach (−1 not opened) */
  open: number;
  /** it gave up digging (skirmish) after this many seconds (−1 it didn't) */
  gaveUp: number;
  /** its health left (fraction) when the hole opened or it gave up */
  hp: number;
  /** the lowest progress after it first reached each checkpoint (the checkpoint rule) */
  lowest: number[];
  /** most ants riding it at once */
  riders: number;
}

/** the defenders' species (its soldiers): Termants by default (they climb titans; Lasius soldiers here did not) */
export const SPECIES = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SPECIES ?? 'termant';

function world(seed: number): World {
  return createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 1, colonies: [{ species: SPECIES, player: true, ai: false }], settings: { creatures: 0, titanRaids: false } } as never, new EventBus());
}

export function holeRun(kind: string, setup: HoleSetup, seed = 5, maxSec = 240): HoleRun {
  const w = world(seed);
  const c = w.colony(0)!;
  const e = c.entrances[0];
  const a = Math.atan2(e.sy - c.ny, e.sx - c.nx);
  w.terrain.clearArea(e.sx - 60, e.sy - 60, e.sx + 60, e.sy + 60);
  // the colony stripped to its queen (the hole's defence is the soldiers below)
  for (const x of w.s.ants) if (x.colony === 0 && x.id !== c.queen && x.state !== AS.Dead) killAnt(w, x);
  w.s.brood.length = 0;
  const cr = spawnCreature(w, kind, SURFACE, e.sx + Math.cos(a) * 45, e.sy + Math.sin(a) * 45);
  const n = setup === 'undefended' ? 0 : setup === '80 defenders' ? 80 : 20;
  // (a soldier brood tile, so its group can be sent to a marker)
  let tile = c.tiles.find((t) => c.groups.some((g) => g.id === t.group && g.type === 'brood'));
  if (!tile && n) {
    const g = w.nest(0)!;
    const used = new Set(c.tiles.map((t) => t.q));
    for (let q = 0; q < g.cols * g.rows && !tile; q++) if (g.isHexDug(q) && !g.isEntrance(q) && !used.has(q)) tile = placeTile(w, c, 'brood', q, `${SPECIES}_soldier`, true) ?? undefined;
  }
  for (let i = 0; i < n; i++) {
    const s = makeAnt(w, 0, `${SPECIES}_soldier`, SURFACE, e.sx + ((i % 9) - 4) * 3, e.sy - 8 - Math.floor(i / 9) * 3, 0);
    if (tile) s.tile = tile.q;
  }
  if (n && tile) {
    if (setup === 'riders') placeMarker(w, c, 4, SURFACE, cr.x, cr.y);
    else placeMarker(w, c, 4, SURFACE, e.sx, e.sy);
    setMarkerOrder(c, 4, 'noClimb', setup !== 'riders');
    assignGroup(w, c, tile.group, 4);
  }
  startTitanRaid(w, cr, 0, 0);
  const res: HoleRun = { open: -1, gaveUp: -1, hp: 1, lowest: [1, 1, 1], riders: 0 };
  let dig = 0;
  const reached = [false, false, false];
  for (let t = 0; t < maxSec * 20; t++) {
    if (setup === 'riders' && t % 20 === 0 && !cr.dead) placeMarker(w, c, 4, cr.space, cr.x, cr.y);
    w.step(0.05);
    w.events.drain();
    const ph = cr.data.rph ?? 0;
    res.riders = Math.max(res.riders, cr.climbers ?? 0);
    if (ph === RAID.Dig) {
      dig += 0.05;
      const p = cr.data.rprog ?? 0;
      [0.25, 0.5, 0.75].forEach((cp, i) => {
        if (p >= cp) reached[i] = true;
        if (reached[i]) res.lowest[i] = Math.min(res.lowest[i], p);
      });
    }
    if (ph >= RAID.Inside) {
      res.open = dig;
      res.hp = cr.hp / cr.maxHp;
      break;
    }
    if (cr.dead || (!(cr.data.raid ?? 0) && dig > 0)) {
      res.gaveUp = dig;
      res.hp = cr.dead ? 0 : cr.hp / cr.maxHp;
      break;
    }
  }
  return res;
}

export function holeCell(r: HoleRun): string {
  if (r.open >= 0) return `${r.open.toFixed(1)} s`;
  if (r.gaveUp >= 0) return `gave up at ${r.gaveUp.toFixed(0)} s (${(r.hp * 100).toFixed(0)} %)`;
  return 'not open';
}

if (!(globalThis as { __titanHolesLib?: boolean }).__titanHolesLib) {
  const seed = Number(process.argv.slice(2).filter((x) => x !== '--')[0] ?? 5);
  console.log(`holeWork ${TITAN_DIG.holeWork} s at speed 1; ${SPECIES} soldiers; seed ${seed}\n`);
  console.log(`| titan (dig speed) | ${HOLE_SETUPS.join(' | ')} |`);
  console.log(`|---|${HOLE_SETUPS.map(() => '---').join('|')}|`);
  for (const k of DIGGERS) {
    const cells = HOLE_SETUPS.map((s) => holeCell(holeRun(k, s, seed)));
    console.log(`| ${CREATURES[k].name} (${CREATURES[k].dig!.speed}) | ${cells.join(' | ')} |`);
  }
}
