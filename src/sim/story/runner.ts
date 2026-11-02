import type { World } from '../world';
import { Colony, FloodState, SURFACE } from '../types';
import { FLOOD, STORY } from '../balance';
import { makeFood } from '../factory';
import { genomeOf, isTermant } from '../termants';
import { shapeBox } from '../../world/mapShapes';
import type { GameSetup } from '../mapGen';
import type { MissionGoal, MissionState } from '../missions';
import { StoryState, actorIndex, hasFlag, setFlag, storyOf } from './state';
import { directorTick, forceRaid, levelOf, members, spawnActor, wherePt } from './director';
import { StageBase, stageGoals } from './objectives';
import type { Action, Difficulty, StoryLevelDef, TimedAction } from './types';
import { storyLevel } from '../../story/levels';
import { storyText } from '../../story/text';

/**
 * Story levels on the mission runner (claude/story/02-spec §5–6). `missions.ts` plays a story level like any mission
 * — stage by stage, goals, win when the last stage's goals are met, lose with the queen — and calls in here for what
 * a story level adds: captions and actions on times and flags, the director's scenes, objectives from data, the bonus
 * objective and the medals. Everything is in `w.s.mode.mission.story` (state.ts).
 */

/** The game setup of a story level: its map, colonies, difficulty and the stolen castes brought in. */
export function storySetup(level: StoryLevelDef['id'], diff: Difficulty, loadout: string[], seed: number): GameSetup {
  const L = storyLevel(level);
  const D = STORY.difficulty[diff];
  const rivals = Object.values(L.rivals);
  return {
    seed,
    style: 'meadow',
    width: 1000,
    depth: 1000,
    map: L.map,
    siteSet: 0,
    colonies: [
      { species: 'termant', player: true, ai: false, team: 0, name: L.player.name, startWorkers: L.player.startWorkers, startFood: Math.round(L.player.startFood * D.food), borrowed: L.loadout ? loadout : undefined },
      ...rivals.map((r) => ({ species: r.species, player: false, ai: true, name: r.name, developed: Math.max(0, Math.round(r.developed * D.rival)), startWorkers: Math.max(1, Math.round(r.startWorkers * D.rival)), ...(r.popLimit ? { popLimit: Math.round(r.popLimit * D.rival) } : {}) })),
    ],
    caves: [],
    food: 1.3,
    aphids: L.aphids,
    plants: L.plants,
    settings: { creatures: L.creatures, enemyStatMul: D.enemyStat, aggression: D.aggression },
    mission: level,
    story: { difficulty: diff, loadout: L.loadout ? loadout : [] },
  };
}

/** Set up a story level's state (after the colonies exist; from mapGen.createWorld). */
export function initStory(w: World, m: MissionState, level: StoryLevelDef['id'], diff: Difficulty, loadout: string[]): void {
  const L = storyLevel(level);
  const c = w.colony(m.colony)!;
  const rivals: Record<string, number> = {};
  const others = w.s.colonies.filter((o) => !o.player);
  Object.keys(L.rivals).forEach((k, i) => (rivals[k] = others[i]?.id ?? -1));
  const st: StoryState = {
    level,
    diff,
    loadout: [...loadout],
    flags: [],
    actors: Object.keys(L.actors).map((name) => ({ name, kind: 0, ids: [], n0: 0, mode: 0, spawned: false, released: false, scene: -1, t0: 0, died0: 0, beaten: 0 })),
    scenes: [],
    rivals,
    latched: [],
    firedSay: [],
    firedScene: [],
    firedEvent: [],
    firedLevel: [],
    said: [],
    died0: c.stats.died,
    bonus: 0,
    endT: 0,
    log: [],
  };
  (m as MissionState & { story?: StoryState }).story = st;
  // the stolen castes brought in: raised from the start (Genome tab: stolen)
  if (isTermant(c)) {
    const G = genomeOf(c);
    for (const cs of loadout) if (c.castes.includes(cs) && !G.stolen.includes(cs)) G.stolen.push(cs);
  }
  // a scripted flood: the map's flood zones idle until a stage floods them
  const map = w.terrain.map;
  if (map?.floods.length && !w.s.flood) w.s.flood = map.floods.map((): FloodState => ({ phase: 0, t: 0, next: 1e12, level: -9999 }));
  // the cast that is on the map from the start
  st.actors.forEach((a, i) => {
    if ((L.actors[a.name].spawn ?? 'start') === 'start') spawnActor(w, st, i);
  });
}

function say(w: World, st: StoryState, key: string): void {
  const text = storyText(`${st.level}.${key}`);
  st.said.push(key);
  if (text) w.events.emit({ t: 'message', text, kind: 'narrator', key: `${st.level}.${key}` });
}

/** Do one action of a stage. */
function act(w: World, st: StoryState, a: Action): void {
  switch (a.do) {
    case 'spawn': {
      const i = actorIndex(st, a.actor);
      if (i >= 0) spawnActor(w, st, i);
      return;
    }
    case 'flag':
      setFlag(st, a.flag);
      return;
    case 'flood': {
      const f = w.s.flood?.[a.zone];
      const z = w.terrain.map?.floods[a.zone];
      if (!f || !z || f.phase !== 0) return;
      f.phase = 1; // warning, then the flood system takes it through rise, hold and drain
      f.t = FLOOD.warnS;
      const b = shapeBox(z.shape, 0);
      w.events.emit({ t: 'flood', zone: a.zone, phase: 'warn', x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
      setFlag(st, `flood:${a.zone}`);
      return;
    }
    case 'food': {
      const p = wherePt(w, a.at);
      const n = a.n ?? 1;
      for (let i = 0; i < n; i++) {
        const r = a.spread ?? 0;
        makeFood(w, a.kind, SURFACE, p[0] + (n > 1 ? w.rng.range(-r, r) : 0), p[1] + (n > 1 ? w.rng.range(-r, r) : 0), a.scale, a.from);
      }
      return;
    }
    case 'shot':
      w.events.emit({ t: 'story', what: 'shot', shot: a.shot });
      return;
    case 'music':
      w.events.emit({ t: 'story', what: 'music', mood: a.mood });
      return;
    case 'raid':
      forceRaid(w, st, a.rival);
      return;
    case 'tip': {
      const text = storyText(`tip.${a.key}`);
      if (text) w.events.emit({ t: 'message', text, kind: 'researcher' });
      return;
    }
  }
}

function due(w: World, st: StoryState, e: { at?: number; on?: string }, stageT: number): boolean {
  if (e.on !== undefined) return hasFlag(st, e.on);
  return stageT >= (e.at ?? 0);
}

/** A stage begins (missions.ts, on entering it). */
export function storyEnterStage(w: World, m: MissionState, stage: number): void {
  const st = storyOf(w);
  if (!st) return;
  st.latched = [];
  st.firedSay = [];
  st.firedScene = [];
  st.firedEvent = [];
  setFlag(st, `stage:${stage}`);
  const c = w.colony(m.colony);
  m.food0 = c?.stats.food ?? 0;
  (m as MissionState & { kills0?: number }).kills0 = c?.stats.kills ?? 0;
  storyFire(w, st, m, stage, 0);
}

/** Captions and actions now due (stage time `t`). */
function storyFire(w: World, st: StoryState, m: MissionState, stage: number, t: number): void {
  const S = levelOf(st).stages[stage];
  if (!S) return;
  (S.events ?? []).forEach((e: TimedAction, i) => {
    if (st.firedEvent.includes(i) || !due(w, st, e, t)) return;
    st.firedEvent.push(i);
    for (const a of e.actions) act(w, st, a);
  });
  (S.say ?? []).forEach((cap, i) => {
    if (st.firedSay.includes(i) || !due(w, st, cap, t)) return;
    st.firedSay.push(i);
    if (st.said.includes(cap.key)) return; // each caption once per level
    say(w, st, cap.key);
  });
  void m;
}

/** Level-wide captions and actions (game time or flags), whatever the stage. */
function levelFire(w: World, st: StoryState): void {
  const L = levelOf(st);
  (L.events ?? []).forEach((e, i) => {
    if (st.firedLevel.includes(`event${i}`) || !due(w, st, e, w.s.time)) return;
    st.firedLevel.push(`event${i}`);
    for (const a of e.actions) act(w, st, a);
  });
  (L.say ?? []).forEach((cap, i) => {
    if (st.firedLevel.includes(`say${i}`) || !due(w, st, cap, w.s.time)) return;
    st.firedLevel.push(`say${i}`);
    if (!st.said.includes(cap.key)) say(w, st, cap.key);
  });
}

/** Every tick (a simulation system): the director, and captions and actions on flags as soon as they are set. */
export function storySystem(w: World, dt: number): void {
  const st = storyOf(w);
  const m = w.s.mode.mission as MissionState | undefined;
  if (!st || !m || m.result) return;
  directorTick(w, st, m.stage, m.t, dt);
}

/** Once a second (from missionSystem, after the stage's clock moved on): flags from the world, timed things, the bonus. */
export function storySecond(w: World, c: Colony, m: MissionState): void {
  const st = storyOf(w);
  if (!st) return;
  const L = levelOf(st);
  // flags the world sets
  if (isTermant(c)) for (const cs of genomeOf(c).stolen) setFlag(st, `caste:${cs}`);
  for (const [k, id] of Object.entries(st.rivals)) {
    const r = w.colony(id);
    if (!r) continue;
    if (!r.alive) setFlag(st, `dead:${k}`);
    if (r.aiWar && r.aiWar.target === c.id) setFlag(st, `raid:${k}`);
  }
  storyFire(w, st, m, m.stage, m.t);
  levelFire(w, st);
  // the bonus objective
  const B = L.medals.bonus;
  if (st.bonus === 0) {
    if (B.type === 'stealBefore') {
      if (hasFlag(st, `caste:${B.caste}`) && !st.flags.slice(0, st.flags.indexOf(`caste:${B.caste}`)).includes(B.flag)) st.bonus = 1;
      else if (hasFlag(st, B.flag)) st.bonus = -1;
    } else if (B.type === 'waveLosses') {
      const act = st.actors[actorIndex(st, B.actor)];
      if (act?.spawned) {
        const lost = c.stats.died - act.died0;
        if (lost > B.max) st.bonus = -1;
        else if (act.beaten) st.bonus = 1;
      }
    }
  }
}

/** The stage's goal lines (objectives from data, met goals kept). */
export function storyGoals(w: World, c: Colony, m: MissionState, stage: number): MissionGoal[] {
  const st = storyOf(w);
  if (!st) return [];
  const S = levelOf(st).stages[stage];
  const base: StageBase = { food0: m.food0, kills0: (m as MissionState & { kills0?: number }).kills0 ?? 0, t: m.t };
  return stageGoals(w, c, st, base, S.objectives);
}

/** The level is won: the time for its medal. */
export function storyWon(w: World): void {
  const st = storyOf(w);
  if (!st) return;
  st.endT = w.s.time;
  if (st.bonus === 0) {
    const B = levelOf(st).medals.bonus;
    // a bonus never decided by the end (the wave never came, the caste never stolen) is lost
    st.bonus = B.type === 'stealBefore' && hasFlag(st, `caste:${B.caste}`) ? 1 : -1;
  }
}

export type MedalTier = 'gold' | 'silver' | 'bronze' | 'none';

/** The three medals of a won level: time, losses and the bonus objective. */
export function storyMedals(w: World): { time: MedalTier; losses: MedalTier; bonus: MedalTier; seconds: number; lost: number } | null {
  const st = storyOf(w);
  const c = w.s.colonies.find((o) => o.player);
  if (!st || !c) return null;
  const M = levelOf(st).medals;
  const seconds = st.endT || w.s.time;
  const lost = c.stats.died - st.died0;
  const tier = (v: number, [g, s]: [number, number]): MedalTier => (v <= g ? 'gold' : v <= s ? 'silver' : 'bronze');
  return { time: tier(seconds, M.time), losses: tier(lost, M.losses), bonus: st.bonus > 0 ? 'gold' : 'none', seconds, lost };
}

/** The stolen castes this level gave (stolen in it, not brought in). */
export function storyStolen(w: World, loadout: string[]): string[] {
  const c = w.s.colonies.find((o) => o.player);
  if (!c || !isTermant(c)) return [];
  return genomeOf(c).stolen.filter((cs) => !loadout.includes(cs));
}

/** Wave sizes and what is left of each actor (the dev view). */
export function storyDebug(w: World): string[] {
  const st = storyOf(w);
  if (!st) return [];
  return st.actors.map((a) => {
    const sc = a.scene >= 0 ? st.scenes[a.scene] : null;
    return `${a.name}: ${a.spawned ? `${members(w, a).length}/${a.n0}` : 'not on the map'}${a.released ? ' released' : sc && !sc.done ? ` scene ${sc.stage}.${sc.idx} cue ${sc.cue}` : ''}${a.mode ? (a.mode === 1 ? ' passive' : ' aggressive') : ''}`;
  });
}
