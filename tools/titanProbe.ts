/**
 * Story titan raid probe (claude/story/05-spec-story-titans-get-inside.md §1): starts The Long Nights or The Spider
 * Mother at its titan's moment, sets up the player's defence the way a person plays, and logs the titan's raid state
 * every tick (`data.raid`, `rph`, `rprog`, `rstag`, health, space, position, its director cue, its creature state).
 * Prints a summary (when each phase began, why it ended) and, with LOG=1, the per-tick lines.
 *
 * Run it with tools/titan-raid-probe.ts; tests/storyCh1.ts uses it too.
 *
 * Setups: none (no orders: the colony's own ants only), hole (the whole army waiting at the hole it will dig),
 * attack (the army on a marker that follows it, no climbing), riders (the same, climbing allowed: ants mount it),
 * block (the army standing on its way to the hole, ordered not to attack), burrow (no defence; the titan starts the
 * cue at its burrow — the spider mother resting in it, the tarantula still at its den).
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { storySetup } from '../src/sim/story/runner';
import { storyOf, actorIndex } from '../src/sim/story/state';
import { members, wherePt } from '../src/sim/story/director';
import { nightStart } from '../src/sim/story/dayNight';
import { missionOf } from '../src/sim/missions';
import { STORY_LEVELS } from '../src/story/levels';
import { AS, Creature, SURFACE, nestSpace } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { assignGroup, placeMarker, setMarkerOrder } from '../src/sim/markers';
import { damageCreature } from '../src/sim/combat';
import { RAID } from '../src/sim/creatures/titanDig';
import { CS } from '../src/sim/creatures/creatureAI';
import type { Difficulty, StoryLevelId } from '../src/sim/story/types';
import type { World } from '../src/sim/world';

export type ProbeSetup = 'none' | 'hole' | 'attack' | 'riders' | 'block' | 'burrow';
export interface ProbeResult {
  level: StoryLevelId;
  setup: ProbeSetup;
  diff: Difficulty;
  /** game seconds from the cue to: the raid starting, digging, inside (−1 never) */
  start: number;
  dig: number;
  inside: number;
  /** seconds of digging */
  digSec: number;
  /** the titan died before getting in / the cue was marked done before it was in */
  diedOutside: boolean;
  doneEarly: boolean;
  /** seconds after getting in until the titan or the queen died (−1 neither within the probe) */
  titanDiedIn: number;
  queenDied: number;
  /** health fraction on breaking in, and at the end */
  hpIn: number;
  hpEnd: number;
  lines: string[];
  notes: string[];
}

const STATE_NAMES = Object.fromEntries(Object.entries(CS).map(([k, v]) => [v, k]));
const ASSIST = 4;

/** The level at its titan's moment. */
export function titanMoment(level: StoryLevelId, diff: Difficulty, seed: number): { w: World; actor: string } {
  const w = createWorld(storySetup(level, diff, [], seed), new EventBus());
  const m = missionOf(w)!;
  if (level === 'longNights') {
    const D = STORY_LEVELS.longNights.dayNight!;
    m.stage = 2;
    m.entered = false;
    w.s.time = nightStart(D, 3) - 2;
    return { w, actor: 'tarantula' };
  }
  m.stage = 1;
  m.entered = false;
  return { w, actor: 'mother' };
}

/** An army of the player's ants by the nest (in a group, so markers can send them). */
export function playerArmy(w: World, n: number): number[] {
  const c = w.colony(0)!;
  const tile = c.tiles.find((t) => t.type === 'brood' && c.groups.some((g) => g.id === t.group && g.type === 'brood'));
  const e0 = c.entrances[0];
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, 0, i % 3 === 2 ? 'termant_worker' : 'termant_soldier', SURFACE, e0.sx + ((i % 9) - 4) * 4, e0.sy + Math.floor(i / 9) * 4 + 10, 0);
    if (tile) a.tile = tile.q;
    ids.push(a.id);
  }
  return ids;
}

export function probe(level: StoryLevelId, setup: ProbeSetup, diff: Difficulty, seed = 5, army = 60, maxSec = 300, log = false, after = 60): ProbeResult {
  const { w, actor } = titanMoment(level, diff, seed);
  const st = storyOf(w)!;
  const c = w.colony(0)!;
  const groupId = c.tiles.find((t) => t.type === 'brood')?.group ?? 2;
  const res: ProbeResult = { level, setup, diff, start: -1, dig: -1, inside: -1, digSec: 0, diedOutside: false, doneEarly: false, titanDiedIn: -1, queenDied: -1, hpIn: 0, hpEnd: 0, lines: [], notes: [] };
  const defended = setup !== 'none' && setup !== 'burrow';
  if (defended) playerArmy(w, army);
  // the spider mother: in real play the army has worn her down to her last phase. Her health goes to just above 30 %
  // (the 80 % and 60 % marks pass: her retreat, her spiderlings); the last blow comes from the army (or, undefended, a
  // single blow after a few seconds).
  let t0 = -1;
  let cueAt = -1;
  const step = () => {
    w.step(0.05);
    w.events.drain();
  };
  const act = () => st.actors[actorIndex(st, actor)];
  const titan = (): Creature | undefined => (act()?.ids.length ? w.creatureById.get(act().ids[0]) : undefined);
  if (level === 'spiderMother') {
    for (let i = 0; i < 20; i++) step();
    const mom = titan()!;
    mom.hp = mom.maxHp * 0.315;
    if (setup === 'burrow') {
      // she rests in her burrow (the 80 % scene) when the last blow lands: down in it
      const b = wherePt(w, 'burrowEdge');
      for (let i = 0; i < 20 * 60 && Math.hypot(mom.x - b[0], mom.y - b[1]) > 12; i++) step();
      if (!intoLair(w, mom, STORY_LEVELS.spiderMother.lairs![0].name)) res.notes.push('no lair to put her in');
    }
  }
  const digIdx = (() => {
    const L = STORY_LEVELS[level];
    for (const S of [...L.stages.flatMap((s) => s.scenes ?? []), ...(L.scenes ?? [])]) {
      const k = S.cues.findIndex((q) => 'digInto' in q);
      if (k >= 0 && S.actor === actor) return k;
    }
    return -1;
  })();
  let lastPh = -1;
  let assigned = false;
  let inLair = false;
  let queenId = c.queen;
  for (let tick = 0; tick < maxSec * 20 * 3; tick++) {
    const cr = titan();
    const a = act();
    const sc = a && a.scene >= 0 ? st.scenes[a.scene] : undefined;
    const L = STORY_LEVELS[level];
    const sdef = sc ? (sc.stage < 0 ? L.scenes?.[sc.idx] : L.stages[sc.stage]?.scenes?.[sc.idx]) : undefined;
    const cue = sdef && sc && !sc.done ? sdef.cues[sc.cue] : undefined;
    // (d) the tarantula in its burrow when its dig cue fires: down the lair as it comes out, its walk to the hollow done
    if (level === 'longNights' && setup === 'burrow' && cr && !inLair && cue && 'path' in cue) {
      inLair = intoLair(w, cr, 'Tarantula burrow');
      cr.data.dirW = 99;
      if (!inLair) res.notes.push('no lair to put it in');
    }
    const onDig = !!cue && 'digInto' in cue;
    if (onDig && cueAt < 0) {
      cueAt = w.s.time;
      t0 = w.s.time;
      if (cr) res.notes.push(`the dig cue began with it in space ${cr.space}${cr.space >= 100 ? ' (a lair)' : ''} at ${cr.x.toFixed(0)},${cr.y.toFixed(0)}`);
    }
    // the moment's trigger: the spider's last blow
    if (level === 'spiderMother' && cr && !cr.dead && cueAt < 0 && cr.hp > cr.maxHp * 0.3 && (!defended || setup === 'block' || setup === 'hole') && tick === (setup === 'burrow' ? 0 : 20 * 3)) damageCreature(w, cr, cr.hp - cr.maxHp * 0.295, 'pure', null);
    // the player's orders, once a second
    if (defended && tick % 20 === 0 && cr && !cr.dead) {
      const e = c.entrances[cr.data.raid ? (cr.data.rhole ?? 0) : nearestHole(w, cr)];
      if (setup === 'hole') placeMarker(w, c, ASSIST, SURFACE, e.sx + (cr.x - e.sx) * 0.05, e.sy + (cr.y - e.sy) * 0.05);
      else if (setup === 'block') {
        const p = { x: e.sx + (cr.x - e.sx) * 0.25, y: e.sy + (cr.y - e.sy) * 0.25 };
        if (!assigned) placeMarker(w, c, ASSIST, SURFACE, p.x, p.y);
        setMarkerOrder(c, ASSIST, 'noAttack', true);
      } else {
        placeMarker(w, c, ASSIST, cr.space, cr.x, cr.y);
        setMarkerOrder(c, ASSIST, 'noClimb', setup === 'attack');
      }
      if (!assigned) assignGroup(w, c, groupId, ASSIST);
      assigned = true;
    }
    if (cr && cueAt >= 0) {
      const ph = cr.data.rph ?? 0;
      const T = w.s.time - t0;
      if (ph !== lastPh) {
        res.notes.push(`${T.toFixed(1)} s: phase ${ph} (${Object.entries(RAID).find(([, v]) => v === ph)?.[0] ?? 'none'}), hp ${((cr.hp / cr.maxHp) * 100).toFixed(0)} %, at ${cr.x.toFixed(0)},${cr.y.toFixed(0)} space ${cr.space}`);
        if (ph === RAID.Approach && res.start < 0) res.start = T;
        if (ph === RAID.Dig && res.dig < 0) res.dig = T;
        if (ph === RAID.Inside && res.inside < 0) {
          res.inside = T;
          res.hpIn = cr.hp / cr.maxHp;
        }
        lastPh = ph;
      }
      if (ph === RAID.Dig) res.digSec += 0.05;
      if (log || tick % 20 === 0)
        res.lines.push(
          `${T.toFixed(2)} cue ${sc ? `${sc.stage}.${sc.idx}:${sc.cue}${sc.done ? ' done' : ''}` : '-'} raid ${cr.data.raid ?? 0} rph ${ph} rprog ${(cr.data.rprog ?? 0).toFixed(3)} rate ${((cr.data.rrate ?? 0) * 100).toFixed(2)}%/s floor ${(cr.data.hpFloor ?? 0).toFixed(0)} hp ${cr.hp.toFixed(0)}/${cr.maxHp.toFixed(0)} space ${cr.space} at ${cr.x.toFixed(1)},${cr.y.toFixed(1)} v ${cr.v.toFixed(1)} state ${STATE_NAMES[cr.state] ?? cr.state} riders ${cr.climbers ?? 0} hit ${(cr.data.hitT ?? 0).toFixed(1)} mode ${a?.mode}`,
        );
      // the cue moved on (or the scene ended) without it inside
      if (!res.doneEarly && sc && (sc.done || (sdef && sc.cue > digIdx)) && res.inside < 0) {
        res.doneEarly = true;
        res.notes.push(`${T.toFixed(1)} s: the digInto cue ended with the titan not inside (raid ${cr.data.raid ?? 0}, rph ${ph}, dead ${cr.dead})`);
      }
      if (cr.dead) {
        if (res.inside < 0) res.diedOutside = true;
        else if (res.titanDiedIn < 0) res.titanDiedIn = T - res.inside;
        res.notes.push(`${T.toFixed(1)} s: the titan died ${res.inside < 0 ? 'outside' : 'inside'} (space ${cr.space})`);
        break;
      }
      const q = w.antById.get(queenId);
      if ((!q || q.state === AS.Dead) && res.queenDied < 0) {
        res.queenDied = res.inside >= 0 ? T - res.inside : T;
        res.notes.push(`${T.toFixed(1)} s: the queen died`);
        break;
      }
      if (res.inside >= 0 && T - res.inside > after) break;
      if (T > maxSec) {
        res.notes.push(`${T.toFixed(0)} s: gave up waiting (rph ${ph}, rprog ${(cr.data.rprog ?? 0).toFixed(2)})`);
        break;
      }
    }
    if (cr && cr.dead && cueAt < 0) {
      res.diedOutside = true;
      res.notes.push('the titan died before its digInto cue began');
      break;
    }
    if (tick > 20 * 400 && cueAt < 0) {
      res.notes.push('the digInto cue never began');
      break;
    }
    queenId = c.queen;
    step();
  }
  const cr = titan();
  res.hpEnd = cr ? cr.hp / cr.maxHp : 0;
  if (st.log.length) res.notes.push('director: ' + st.log.join('; '));
  return res;
}

/** Put a creature down in a lair (a story's cave by name), on its cavern floor farthest from the tunnel's top. */
export function intoLair(w: World, cr: Creature, name: string): boolean {
  const cave = w.s.caves.find((v) => v.name === name);
  const g = cave ? w.nestOf(cave.space) : undefined;
  if (!cave || !g) return false;
  const top = cave.entrances[0].q;
  let best = -1;
  let bd = -1;
  for (let q = 0; q < g.cols * g.rows; q++) {
    if (!g.isHexDug(q)) continue;
    const d = g.hexDistance(q, top);
    if (d > bd) (bd = d), (best = q);
  }
  const p = g.hexCenter(best);
  cr.space = cave.space;
  cr.x = cr.px = p.x;
  cr.y = cr.py = p.y;
  return true;
}

function nearestHole(w: World, cr: Creature): number {
  const c = w.colony(0)!;
  let bi = 0;
  let bd = Infinity;
  c.entrances.forEach((e, i) => {
    const d = Math.hypot(e.sx - cr.x, e.sy - cr.y);
    if (d < bd) (bd = d), (bi = i);
  });
  return bi;
}
