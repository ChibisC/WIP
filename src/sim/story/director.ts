import { RAID, endTitanRaid, startTitanRaid } from '../creatures/titanDig';
import type { World } from '../world';
import { AS, Ant, Colony, Creature, POSE, SURFACE } from '../types';
import { creatureKind } from '../creatures/kinds';
import { spawnCreature, CS } from '../creatures/creatureAI';
import { makeAnt } from '../factory';
import { setTask } from '../colony';
import { approachSurface, moveForward, turnToward, angleDiff, antSpeed } from '../movement';
import { nearestWalkable, placeMarker } from '../markers';
import { warBrain } from '../warAI';
import { casteOf } from '../species';
import { datan2, dcos, dhypot, dsin } from '../dmath';
import { STORY } from '../balance';
import { shapeBox, shapeDist } from '../../world/mapShapes';
import type { Pt, Shape } from '../../maps/types';
import { StoryActor, StoryScene, StoryState, actorIndex, setFlag, storyOf } from './state';
import type { ActorDef, Anim, Cue, StoryLevelDef, Where } from './types';
import { storyLevel } from '../../story/levels';
import { visitorColony } from './surprises';

/**
 * The story director (claude/story/02-spec §6, "Story direction"): the level's cast — creatures, groups of a rival
 * colony's ants, a whole colony — act out scenes written as data (`Scene`: a list of cues per actor). It runs inside
 * the simulation, on ticks and the seeded RNG, in id order, so replays (and a later co-op) see the same scenes.
 *
 * Directed actors still obey the world: they walk the flow fields round banks and walls and up the ramps (no sliding
 * through anything), react when attacked unless `passive`, and a cue that cannot finish (blocked, the actor dead)
 * times out after `STORY.cueTimeout` s and the scene moves on (logged in `story.log`, shown by the dev view). Player
 * units are never directed.
 *
 *  - `directorSystem` (every tick): starts scenes, moves each scene on when its cue is done, spawns actors.
 *  - `directAnt` / `directCreature` (from the ant and creature systems, every tick, for directed entities): the
 *    movement and poses of the current cue.
 */

const tmp = { x: 0, y: 0 }; // det-ok: scratch, overwritten before every read

export function levelOf(st: StoryState): StoryLevelDef {
  return storyLevel(st.level);
}

/** A story point, or a point given in mm. */
export function wherePt(w: World, at: Where): Pt {
  if (typeof at !== 'string') return at;
  const p = w.terrain.map?.story?.points[at];
  if (!p) throw new Error(`Unknown story point: ${at}`);
  return p;
}

export function pathPts(w: World, name: string): readonly Pt[] {
  const p = w.terrain.map?.story?.paths[name];
  if (!p) throw new Error(`Unknown story path: ${name}`);
  return p;
}

function zoneShape(w: World, name: string): Shape {
  const z = w.terrain.map?.story?.zones[name];
  if (!z) throw new Error(`Unknown story zone: ${name}`);
  return z;
}

/** Is a point by the map's edge (a party walking off the map there is gone once near it: a crowd never all reaches one point)? */
function atEdge(w: World, p: Pt): boolean {
  return p[0] < 40 || p[1] < 40 || p[0] > w.terrain.width - 40 || p[1] > w.terrain.depth - 40;
}

/** A member's place in a loose cluster round a point (member 0 at the point). */
function spreadOf(i: number): { x: number; y: number } {
  if (i === 0) return { x: 0, y: 0 };
  const a = i * 2.39996;
  const r = STORY.spread * Math.sqrt(i);
  return { x: dcos(a) * r, y: dsin(a) * r };
}

// ---------------------------------------------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------------------------------------------

/** Living entities of an actor (ants alive, creatures alive), in id order. */
export function members(w: World, act: StoryActor): Array<Ant | Creature> {
  const out: Array<Ant | Creature> = [];
  if (act.kind === 2) return out;
  for (const id of act.ids) {
    if (act.kind === 0) {
      const cr = w.creatureById.get(id);
      if (cr && !cr.dead) out.push(cr);
    } else {
      const a = w.antById.get(id);
      if (a && a.state !== AS.Dead) out.push(a);
    }
  }
  return out;
}

/** Bring an actor onto the map (its def's place and facing). */
export function spawnActor(w: World, st: StoryState, i: number): void {
  const act = st.actors[i];
  if (act.spawned) return;
  const def = levelOf(st).actors[act.name];
  act.spawned = true;
  act.t0 = w.s.time;
  const player = w.s.colonies.find((c) => c.player);
  act.died0 = player?.stats.died ?? 0;
  if (def.rival) {
    act.kind = 2;
    act.ids = [st.rivals[def.rival] ?? -1];
    act.n0 = 1;
    return;
  }
  const at = def.at ? wherePt(w, def.at) : ([w.terrain.width / 2, w.terrain.depth / 2] as Pt);
  const face = def.face ? wherePt(w, def.face) : null;
  const h = face ? datan2(face[1] - at[1], face[0] - at[0]) : 0;
  const directed = def.directed !== false;
  if (def.creature || def.creatures) {
    act.kind = 0;
    const group: Array<[string, number]> = def.creature ? [[def.creature, 1]] : def.creatures!;
    const mul = def.wave ? STORY.difficulty[st.diff].wave : 1;
    const from = def.from?.length ? def.from.map((f) => wherePt(w, f)) : [at];
    let k = 0;
    for (const [kind, n0] of group) {
      const n = def.creature ? 1 : Math.max(1, Math.round(n0 * mul));
      for (let j = 0; j < n; j++, k++) {
        // a group comes out of its lairs in turn, loosely clustered at each
        const src = from[k % from.length];
        const o = spreadOf(Math.floor(k / from.length));
        const p = nearestWalkable(w, src[0] + o.x * 2, src[1] + o.y * 2) ?? { x: src[0], y: src[1] };
        const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
        // a level's own scale on its health; a boss (spawned at its kind's health) also takes the difficulty's `boss`
        const hpMul = (def.hp ?? 1) * (creatureKind(kind)?.boss ? STORY.difficulty[st.diff].boss : 1);
        if (hpMul !== 1) cr.hp = cr.maxHp = cr.maxHp * hpMul;
        if (def.bossCuts) {
          cr.data.cut1 = def.bossCuts[0];
          cr.data.cut2 = def.bossCuts[1];
        }
        if (def.floor && !st.flags.includes(def.floor.until)) cr.data.hpFloor = cr.maxHp * def.floor.hp;
        cr.h = cr.ph = face ? datan2(face[1] - p.y, face[0] - p.x) : h;
        cr.homeX = p.x;
        cr.homeY = p.y;
        if (def.goal) {
          const g = wherePt(w, def.goal);
          cr.data.gx = g[0];
          cr.data.gy = g[1];
        }
        if (directed) cr.data.dirA = i + 1;
        act.ids.push(cr.id);
      }
    }
    if (def.wave) setFlag(st, `wave:${act.name}`);
  } else if (def.ants) {
    act.kind = 1;
    const L = levelOf(st);
    const colony = def.colony === 'player' ? (player?.id ?? 0) : (st.rivals[def.colony ?? ''] ?? (L.visitors?.[def.colony ?? ''] ? visitorColony(w, st, L, def.colony!) : -1));
    const mul = def.wave ? STORY.difficulty[st.diff].wave : 1;
    let k = 0;
    for (const [caste, n0] of def.ants) {
      const n = Math.max(1, Math.round(n0 * mul));
      for (let j = 0; j < n; j++, k++) {
        const o = spreadOf(k);
        const p = nearestWalkable(w, at[0] + o.x * 1.5, at[1] + o.y * 1.5) ?? { x: at[0], y: at[1] };
        const a = makeAnt(w, colony, caste, SURFACE, p.x, p.y, h);
        if (directed) a.dirA = i;
        act.ids.push(a.id);
      }
    }
    if (def.wave) setFlag(st, `wave:${act.name}`);
  }
  act.n0 = act.ids.length;
  act.mode = def.passive ? 1 : 0;
}

/** Hand an actor back to the normal AI. */
export function releaseActor(w: World, st: StoryState, i: number): void {
  const act = st.actors[i];
  act.released = true;
  for (const e of members(w, act)) {
    if ('caste' in e) {
      const a = e as Ant;
      delete a.dirA;
      delete a.dirW;
      delete a.dirL;
      delete a.dirX;
      delete a.dirY;
      const c = w.colony(a.colony);
      if (c && !c.player) setTask(w, a, 'idle');
    } else {
      const cr = e as Creature;
      delete cr.data.dirA;
      delete cr.data.dirW;
      delete cr.data.dirX;
      delete cr.data.dirY;
      cr.state = CS.Wander;
      cr.st = 0;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------------------------

/** A scene's definition: a stage's (stage ≥ 0) or a level-wide one (stage −1). */
function sceneDef(st: StoryState, stage: number, idx: number) {
  const L = levelOf(st);
  return stage < 0 ? L.scenes?.[idx] : L.stages[stage]?.scenes?.[idx];
}

function cueOf(st: StoryState, sc: StoryScene): Cue | undefined {
  return sceneDef(st, sc.stage, sc.idx)?.cues[sc.cue];
}

/** Start a scene of a stage on its actor (spawning the actor if it is not on the map yet; it replaces a running one). */
export function startScene(w: World, st: StoryState, stage: number, idx: number): void {
  const def = sceneDef(st, stage, idx)!;
  const ai = actorIndex(st, def.actor);
  if (ai < 0) {
    st.log.push(`scene ${stage}.${idx}: no actor "${def.actor}"`);
    return;
  }
  const act = st.actors[ai];
  if (!act.spawned) spawnActor(w, st, ai);
  if (act.released) {
    // directed again: its living members follow the director
    act.released = false;
    for (const e of members(w, act)) {
      if ('caste' in e) (e as Ant).dirA = ai;
      else (e as Creature).data.dirA = ai + 1;
    }
  }
  if (act.scene >= 0 && !st.scenes[act.scene].done) st.scenes[act.scene].done = true;
  st.scenes.push({ actor: ai, stage, idx, cue: 0, t: 0, done: false });
  act.scene = st.scenes.length - 1;
  for (const e of members(w, act)) resetMember(e);
  enterCue(w, st, st.scenes[act.scene]);
}

function resetMember(e: Ant | Creature): void {
  if ('caste' in e) {
    const a = e as Ant;
    a.dirW = 0;
    a.dirL = 0;
    delete a.dirX;
    delete a.dirY;
  } else {
    const cr = e as Creature;
    cr.data.dirW = 0;
    delete cr.data.dirX;
    delete cr.data.dirY;
  }
}

/** Instant cues happen as they start; the rest set up their members. */
function enterCue(w: World, st: StoryState, sc: StoryScene): void {
  for (let guard = 0; guard < 32; guard++) {
    const cue = cueOf(st, sc);
    if (!cue) {
      sc.done = true;
      return;
    }
    const act = st.actors[sc.actor];
    sc.t = 0;
    for (const e of members(w, act)) resetMember(e);
    if ('goto' in cue) {
      // a loop (a hunter's rounds): back to an earlier cue
      sc.cue = Math.max(0, cue.goto);
      continue;
    }
    if ('mode' in cue) act.mode = cue.mode === 'passive' ? 1 : cue.mode === 'aggressive' ? 2 : 0;
    else if ('flag' in cue && Object.keys(cue).length === 1) setFlag(st, cue.flag!);
    else if ('release' in cue) {
      releaseActor(w, st, sc.actor);
      sc.done = true;
      return;
    } else if ('charge' in cue) {
      // (these two set the actor's behaviour and then take time — walking — like any other: 2026-11-02, they were
      // skipped at once, so a wave went straight to its next cue and fleeing creatures straight to theirs)
      act.mode = 2;
      return;
    } else if ('flee' in cue) {
      act.mode = 1;
      return;
    } else if ('digInto' in cue) {
      // titans dig into the nest (they never give up: a story script); the cue waits until they are in
      const col = cue.digInto === 'player' ? (w.s.colonies.find((c) => c.player)?.id ?? 0) : (st.rivals[cue.digInto] ?? -1);
      for (const e of members(w, act)) if (!('caste' in e)) startTitanRaid(w, e as Creature, col, cue.hole ?? -1, true);
      return;
    } else return; // a cue that takes time
    sc.cue++;
  }
}

/** A cue whose members walk somewhere and are done on arrival. */
function walking(cue: Cue): boolean {
  return ('walkTo' in cue && cue.walkTo !== undefined) || ('path' in cue && cue.path !== undefined) || 'charge' in cue || 'flee' in cue || ('patrol' in cue && cue.loops !== undefined);
}

/** Does this member count as done with its cue (walking cues: arrived)? */
function memberDone(w: World, st: StoryState, sc: StoryScene, cue: Cue, e: Ant | Creature, k: number): boolean {
  const wa = e as Ant & { data?: Record<string, number> };
  const dirW = 'caste' in e ? ((e as Ant).dirW ?? 0) : ((e as Creature).data.dirW ?? 0);
  if ('walkTo' in cue && cue.walkTo !== undefined) {
    const p = wherePt(w, cue.walkTo);
    const o = spreadOf(k);
    return dhypot(p[0] + o.x - e.x, p[1] + o.y - e.y) < STORY.arriveMm + (k ? STORY.spread : 0);
  }
  if ('path' in cue && cue.path !== undefined) return dirW >= pathPts(w, cue.path).length;
  if ('patrol' in cue) return cue.loops !== undefined && ('caste' in e ? ((e as Ant).dirL ?? 0) : (e as Creature).data.dirL ?? 0) >= cue.loops;
  if ('charge' in cue) {
    const p = wherePt(w, cue.charge);
    return dhypot(p[0] - e.x, p[1] - e.y) < 20;
  }
  if ('flee' in cue) {
    const p = wherePt(w, cue.flee);
    return dhypot(p[0] - e.x, p[1] - e.y) < 12;
  }
  void wa;
  void st;
  void sc;
  return true;
}

/** Every tick: start the scenes the stage says, move each running scene on, mark waves beaten. */
export function directorTick(w: World, st: StoryState, stage: number, stageT: number, dt: number): void {
  const L = levelOf(st);
  const S = L.stages[stage];
  // scenes of this stage that start now
  S?.scenes?.forEach((sd, i) => {
    if (st.firedScene.includes(i)) return;
    const go = sd.on ? st.flags.includes(sd.on) : stageT >= (sd.at ?? 0);
    if (!go) return;
    st.firedScene.push(i);
    startScene(w, st, stage, i);
  });
  // level-wide scenes: on game time or a flag
  L.scenes?.forEach((sd, i) => {
    if (st.firedLevel.includes(`scene${i}`)) return;
    const go = sd.on ? st.flags.includes(sd.on) : w.s.time >= (sd.at ?? 0);
    if (!go) return;
    st.firedLevel.push(`scene${i}`);
    startScene(w, st, -1, i);
  });
  for (const sc of st.scenes) {
    if (sc.done) continue;
    const act = st.actors[sc.actor];
    const cue = cueOf(st, sc);
    if (!cue) {
      sc.done = true;
      continue;
    }
    sc.t += dt;
    const alive = members(w, act);
    let done = false;
    const timeout = ('timeout' in cue && cue.timeout) || STORY.cueTimeout;
    if ('wait' in cue) done = sc.t >= cue.wait;
    else if ('waitFlag' in cue) done = st.flags.includes(cue.waitFlag) || sc.t >= (cue.timeout ?? 1e9);
    else if ('leave' in cue && act.kind !== 2) done = alive.length === 0;
    else if (act.kind !== 2 && !alive.length) {
      // the actor is dead or gone: the scene ends
      sc.done = true;
      if (act.spawned) setFlag(st, `gone:${act.name}`);
      continue;
    } else if (act.kind === 2) done = true;
    else if ('digInto' in cue) done = alive.every((e) => 'caste' in e || ((e as Creature).data.rph ?? 0) >= RAID.Inside || !((e as Creature).data.raid ?? 0));
    else if ('guard' in cue) done = cue.s !== undefined && sc.t >= cue.s;
    else if ('patrol' in cue && cue.loops === undefined) done = sc.t >= (cue.s ?? 1e9);
    else if (!walking(cue) && ('holdAt' in cue || 'anim' in cue || 'wander' in cue || 'follow' in cue || 'rest' in cue)) done = sc.t >= (cue as { s: number }).s;
    else if (!walking(cue) && 'face' in cue) done = sc.t >= 1;
    else {
      let n = 0;
      alive.forEach((e, k) => {
        if (memberDone(w, st, sc, cue, e, k)) n++;
      });
      done = n >= Math.ceil(alive.length * STORY.groupDone) || ('charge' in cue && alive.length <= act.n0 * (1 - STORY.waveBeaten));
    }
    if (!done && sc.t >= timeout && (walking(cue) || 'leave' in cue)) {
      st.log.push(`${w.s.time.toFixed(0)} s: ${act.name} cue ${sc.cue} of scene ${sc.stage}.${sc.idx} timed out`);
      done = true;
    }
    if (!done) continue;
    const f = (cue as { flag?: string }).flag;
    if (f) setFlag(st, f);
    sc.cue++;
    enterCue(w, st, sc);
  }
  // waves: beaten once most of it is dead or gone
  const lv = levelOf(st);
  st.actors.forEach((act) => {
    const def = lv.actors[act.name];
    if (!def?.wave || !act.spawned || act.beaten) return;
    const alive = members(w, act).filter((e) => e.space === SURFACE || !('caste' in e)).length;
    if (alive <= act.n0 * (1 - STORY.waveBeaten)) {
      act.beaten = 1;
      setFlag(st, `beaten:${act.name}`);
    }
  });
}

/** Force a rival colony's war AI to march on the player now (an action). */
/** A titan actor raiding a nest walks back out and leaves (story action `endRaid`, e.g. at dawn). */
export function endActorRaid(w: World, st: StoryState, actor: string): void {
  const ai = actorIndex(st, actor);
  if (ai < 0) return;
  for (const e of members(w, st.actors[ai])) if (!('caste' in e)) endTitanRaid(w, e as Creature);
}

export function forceRaid(w: World, st: StoryState, rival: string): void {
  const c = w.colony(st.rivals[rival] ?? -1);
  const p = w.s.colonies.find((o) => o.player);
  if (!c || !p || !c.alive || !p.alive) return;
  const q = w.antById.get(p.queen);
  if (!q) return;
  const b = warBrain(c);
  let n = 0;
  for (const a of w.s.ants) if (a.colony === c.id && a.state !== AS.Dead && (casteOf(a.caste).role === 'soldier' || casteOf(a.caste).role === 'major')) n++;
  b.target = p.id;
  b.start = Math.max(1, n);
  b.age = 0;
  b.defending = false;
  placeMarker(w, c, 2, q.space, q.x, q.y);
  b.t = 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Movement and poses of directed entities (every tick)
// ---------------------------------------------------------------------------------------------------------------

/** The actor and cue a directed ant follows, or null (then its director link is dropped). */
function cueFor(w: World, ai: number): { st: StoryState; act: StoryActor; sc: StoryScene | null; cue: Cue | null } | null {
  const st = storyOf(w);
  const act = st?.actors[ai];
  if (!st || !act || act.released) return null;
  const sc = act.scene >= 0 ? st.scenes[act.scene] : null;
  const cue = sc && !sc.done ? (cueOf(st, sc) ?? null) : null;
  return { st, act, sc, cue };
}

/**
 * How a directed ant behaves this tick: 0 not directed (any stale link is dropped), 1 passive (the director moves
 * it, it never fights), 2 the director moves it but it fights first what it meets (normal and aggressive).
 */
export function directMode(w: World, a: Ant): number {
  if (a.dirA === undefined) return 0;
  const r = cueFor(w, a.dirA);
  if (!r) {
    delete a.dirA;
    const c = w.colony(a.colony);
    if (c && !c.player) setTask(w, a, 'idle');
    return 0;
  }
  return r.act.mode === 1 || (r.cue && 'flee' in r.cue) ? 1 : 2;
}

const POSES: Record<Anim, number> = {
  idle: POSE.NONE,
  threat: POSE.ALARM,
  groom: POSE.GROOM_LEGS,
  antennate: POSE.GROOM_ANT,
  drum: POSE.GROOM_ANT,
  troph: POSE.TROPH,
  dig: POSE.DIG,
  carry: POSE.CARRY,
  feed: POSE.TROPH,
};

function memberIndex(act: StoryActor, id: number): number {
  let k = 0;
  for (const x of act.ids) {
    if (x === id) return k;
    k++;
  }
  return 0;
}

function faceAngle(w: World, st: StoryState, from: { x: number; y: number }, f: Where | { actor: string }): number | null {
  if (typeof f === 'object' && !Array.isArray(f) && 'actor' in f) {
    const ai = actorIndex(st, f.actor);
    const e = ai >= 0 ? members(w, st.actors[ai])[0] : undefined;
    return e ? datan2(e.y - from.y, e.x - from.x) : null;
  }
  const p = wherePt(w, f as Where);
  return datan2(p[1] - from.y, p[0] - from.x);
}

/** A point inside a zone (seeded), for wandering. */
function zonePoint(w: World, z: Shape): { x: number; y: number } {
  const b = shapeBox(z, 0);
  for (let i = 0; i < 16; i++) {
    const x = w.rng.range(b.x0, b.x1);
    const y = w.rng.range(b.y0, b.y1);
    if (shapeDist(z, x, y) < 0 && w.walkable(SURFACE, x, y)) return { x, y };
  }
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

/** Walk an ant to (x, y) the natural way (round banks, up ramps); `key` shares one route field per goal. */
function antWalk(w: World, a: Ant, x: number, y: number, rx: number, ry: number, key: string, speed: number, dt: number): number {
  if (a.space !== SURFACE) return 0;
  return approachSurface(w, a, x, y, dt, key, rx, ry, speed);
}

/** The director moves a directed ant this tick (true: done for the tick). */
export function directAnt(w: World, a: Ant, c: Colony, dt: number): boolean {
  const r = cueFor(w, a.dirA ?? -1);
  if (!r) return false;
  const { st, act, sc, cue } = r;
  void c;
  if (a.space !== SURFACE) return false;
  const k = memberIndex(act, a.id);
  const o = spreadOf(k);
  const key = `story:${act.scene}:${sc?.cue ?? 0}`;
  if (!cue) {
    a.v = 0;
    return true;
  }
  const speed = (cue as { speed?: number }).speed ?? 1;
  const pose = (cue as { anim?: Anim }).anim;
  if ('walkTo' in cue && cue.walkTo !== undefined) {
    const p = wherePt(w, cue.walkTo);
    const d = antWalk(w, a, p[0] + o.x, p[1] + o.y, p[0], p[1], key, speed, dt);
    if (d < STORY.arriveMm) a.v = 0;
    if (pose) a.pose = POSES[pose];
    return true;
  }
  if ('path' in cue && cue.path !== undefined) {
    const P = pathPts(w, cue.path);
    const i = a.dirW ?? 0;
    if (i >= P.length) {
      a.v = 0;
      return true;
    }
    const q = P[cue.reverse ? P.length - 1 - i : i];
    const d = antWalk(w, a, q[0] + o.x * 0.5, q[1] + o.y * 0.5, q[0], q[1], `${key}:${i}`, speed, dt);
    if (d < STORY.arriveMm + 2) a.dirW = i + 1;
    if (pose) a.pose = POSES[pose];
    return true;
  }
  if ('patrol' in cue) {
    const P = pathPts(w, cue.patrol);
    const i = (a.dirW ?? 0) % P.length;
    const q = P[i];
    const d = antWalk(w, a, q[0] + o.x * 0.5, q[1] + o.y * 0.5, q[0], q[1], `${key}:${i}`, speed, dt);
    if (d < STORY.arriveMm + 2) {
      a.dirW = (a.dirW ?? 0) + 1;
      if (a.dirW % P.length === 0) a.dirL = (a.dirL ?? 0) + 1;
    }
    return true;
  }
  if ('holdAt' in cue || 'anim' in cue || 'face' in cue || 'rest' in cue) {
    const at = 'holdAt' in cue && cue.holdAt !== undefined ? wherePt(w, cue.holdAt) : 'rest' in cue ? wherePt(w, cue.rest) : null;
    if (at && dhypot(at[0] + o.x - a.x, at[1] + o.y - a.y) > STORY.arriveMm + 1) {
      antWalk(w, a, at[0] + o.x, at[1] + o.y, at[0], at[1], key, speed, dt);
      return true;
    }
    a.v = 0;
    const f = 'face' in cue ? cue.face : undefined;
    const ang = f ? faceAngle(w, st, a, f) : null;
    if (ang !== null) turnToward(a, ang, dt, 4);
    if (pose) a.pose = POSES[pose];
    else if ('anim' in cue && cue.anim) a.pose = POSES[cue.anim];
    return true;
  }
  if ('guard' in cue) {
    const p = wherePt(w, cue.guard);
    // (fighting what came near is the combat code's, before this; here it walks back to its post)
    if (dhypot(p[0] + o.x - a.x, p[1] + o.y - a.y) > STORY.arriveMm + 2) antWalk(w, a, p[0] + o.x, p[1] + o.y, p[0], p[1], key, speed, dt);
    else {
      a.v = 0;
      if ((w.s.tick + a.id) % 160 < 40) a.pose = POSE.GUARD;
    }
    return true;
  }
  if ('wander' in cue) {
    if (a.dirX === undefined || dhypot((a.dirX ?? 0) - a.x, (a.dirY ?? 0) - a.y) < STORY.arriveMm) {
      const z = zonePoint(w, zoneShape(w, cue.wander));
      a.dirX = z.x;
      a.dirY = z.y;
    }
    antWalk(w, a, a.dirX!, a.dirY!, a.dirX!, a.dirY!, `${key}:w${a.id}`, (cue.speed ?? 0.6), dt);
    return true;
  }
  if ('follow' in cue) {
    const ai = actorIndex(st, cue.follow);
    const lead = ai >= 0 ? members(w, st.actors[ai])[0] : undefined;
    if (!lead) {
      a.v = 0;
      return true;
    }
    const dist = cue.dist ?? 10;
    const tx = lead.x - dcos(lead.h) * dist + o.x;
    const ty = lead.y - dsin(lead.h) * dist + o.y;
    if (dhypot(tx - a.x, ty - a.y) > 3) antWalk(w, a, tx, ty, lead.x, lead.y, `${key}:f`, 1.1, dt);
    else a.v = 0;
    return true;
  }
  if ('leave' in cue) {
    let p: Pt;
    if (cue.leave === 'nest') {
      // home by the nearest of the anthill's three holes
      const col = w.colony(a.colony);
      let e = col?.entrances[0];
      for (const x of col?.entrances ?? []) if (e && dhypot(x.sx - a.x, x.sy - a.y) < dhypot(e.sx - a.x, e.sy - a.y)) e = x;
      p = e ? [e.sx, e.sy] : [a.x, a.y];
    } else p = wherePt(w, cue.leave);
    const d = antWalk(w, a, p[0], p[1], p[0], p[1], key, speed, dt);
    if (d < 4 || (cue.leave !== 'nest' && d < STORY.edgeLeave && atEdge(w, p))) w.killAntNow(a.id);
    return true;
  }
  if ('charge' in cue) {
    const p = wherePt(w, cue.charge);
    antWalk(w, a, p[0] + o.x * 2, p[1] + o.y * 2, p[0], p[1], key, speed, dt);
    return true;
  }
  if ('flee' in cue) {
    const p = wherePt(w, cue.flee);
    antWalk(w, a, p[0] + o.x, p[1] + o.y, p[0], p[1], key, Math.max(1.2, speed), dt);
    return true;
  }
  // waits, flags: stand where it is
  a.v = 0;
  return true;
}

/**
 * The director moves a directed creature this tick (true: done for the tick; false: its own program runs — when it
 * is not directed, or, unless passive, while it has just been hurt or is fighting).
 */
export function directCreature(w: World, cr: Creature, dt: number): boolean {
  const ai = (cr.data.dirA ?? 0) - 1;
  if (ai < 0) return false;
  const r = cueFor(w, ai);
  if (!r) {
    delete cr.data.dirA;
    return false;
  }
  const { st, act, sc, cue } = r;
  const k = creatureKind(cr.kind);
  if (!k) return false;
  // reacting: hurt (or a wave on the attack with ants in reach) — its own program for now, unless passive
  if (act.mode !== 1 && (cr.data.hitT ?? 0) > 0) return false;
  if (!cue) {
    cr.v = 0;
    return true;
  }
  const speed = ((cue as { speed?: number }).speed ?? 0.7) * k.speed;
  const key = `story:cr:${act.scene}:${sc?.cue ?? 0}`;
  const walk = (x: number, y: number, sp = speed) => crWalk(w, cr, x, y, sp, dt, key);
  if ('walkTo' in cue && cue.walkTo !== undefined) {
    const p = wherePt(w, cue.walkTo);
    if (walk(p[0], p[1]) < STORY.arriveMm) cr.v = 0;
    return true;
  }
  if ('path' in cue && cue.path !== undefined) {
    const P = pathPts(w, cue.path);
    const i = cr.data.dirW ?? 0;
    if (i >= P.length) {
      cr.v = 0;
      return true;
    }
    const q = P[cue.reverse ? P.length - 1 - i : i];
    if (crWalk(w, cr, q[0], q[1], speed, dt, `${key}:${i}`) < STORY.arriveMm + 3) cr.data.dirW = i + 1;
    return true;
  }
  if ('patrol' in cue) {
    const P = pathPts(w, cue.patrol);
    const i = (cr.data.dirW ?? 0) % P.length;
    if (crWalk(w, cr, P[i][0], P[i][1], speed, dt, `${key}:${i}`) < STORY.arriveMm + 3) {
      cr.data.dirW = (cr.data.dirW ?? 0) + 1;
      if (cr.data.dirW % P.length === 0) cr.data.dirL = (cr.data.dirL ?? 0) + 1;
    }
    return true;
  }
  if ('rest' in cue) {
    // back to its den (or a resting place) and still there, getting its strength back
    const p = wherePt(w, cue.rest);
    if (dhypot(p[0] - cr.x, p[1] - cr.y) > STORY.arriveMm + 3) {
      walk(p[0], p[1], k.speed);
      return true;
    }
    cr.v = 0;
    if (cue.heal && !cr.dead) cr.hp = Math.min(cr.maxHp, cr.hp + cr.maxHp * cue.heal * dt);
    return true;
  }
  if ('holdAt' in cue || 'anim' in cue || 'face' in cue) {
    const at = 'holdAt' in cue && cue.holdAt !== undefined ? wherePt(w, cue.holdAt) : null;
    if (at && dhypot(at[0] - cr.x, at[1] - cr.y) > STORY.arriveMm + 2) {
      walk(at[0], at[1]);
      return true;
    }
    cr.v = 0;
    const f = 'face' in cue ? cue.face : undefined;
    const ang = f ? faceAngle(w, st, cr, f) : null;
    if (ang !== null) {
      const d = angleDiff(cr.h, ang);
      cr.h += Math.max(-2 * dt, Math.min(2 * dt, d));
    }
    return true;
  }
  if ('guard' in cue) {
    const p = wherePt(w, cue.guard);
    // anything of another kind within the radius: its own program (it attacks), on a leash
    let near = false;
    w.antsNear(SURFACE, p[0], p[1], cue.r, (a) => {
      if (a.state !== AS.Dead) near = true;
      return near;
    });
    if (near && dhypot(p[0] - cr.x, p[1] - cr.y) < cue.r + STORY.guardLeash) return false;
    if (dhypot(p[0] - cr.x, p[1] - cr.y) > STORY.arriveMm + 3) walk(p[0], p[1]);
    else cr.v = 0;
    return true;
  }
  if ('wander' in cue) {
    if (cr.data.dirX === undefined || dhypot((cr.data.dirX ?? 0) - cr.x, (cr.data.dirY ?? 0) - cr.y) < STORY.arriveMm + 2) {
      const z = zonePoint(w, zoneShape(w, cue.wander));
      cr.data.dirX = z.x;
      cr.data.dirY = z.y;
    }
    crWalk(w, cr, cr.data.dirX!, cr.data.dirY!, (cue.speed ?? 0.5) * k.speed, dt, `${key}:w${cr.id}`);
    return true;
  }
  if ('follow' in cue) {
    const fi = actorIndex(st, cue.follow);
    const lead = fi >= 0 ? members(w, st.actors[fi])[0] : undefined;
    if (!lead) {
      cr.v = 0;
      return true;
    }
    const dist = cue.dist ?? 20;
    walk(lead.x - dcos(lead.h) * dist, lead.y - dsin(lead.h) * dist, k.speed);
    return true;
  }
  if ('leave' in cue) {
    const p = cue.leave === 'nest' ? ([cr.homeX, cr.homeY] as Pt) : wherePt(w, cue.leave);
    const d = walk(p[0], p[1]);
    if (d < 6 || (cue.leave !== 'nest' && d < STORY.edgeLeave && atEdge(w, p))) {
      cr.data.gone = 1;
      w.removeCreatureNow(cr.id);
    }
    return true;
  }
  if ('charge' in cue) {
    const p = wherePt(w, cue.charge);
    let near = false;
    w.antsNear(SURFACE, cr.x, cr.y, k.length * 1.2, (a) => {
      if (a.state !== AS.Dead) near = true;
      return near;
    });
    if (near) return false;
    walk(p[0], p[1], k.speed);
    return true;
  }
  if ('flee' in cue) {
    const p = wherePt(w, cue.flee);
    walk(p[0], p[1], k.speed * Math.max(1.2, (cue.speed ?? 1)));
    return true;
  }
  cr.v = 0;
  return true;
}

/** Walk a creature toward (x, y) along the surface flow field (round banks and walls, up ramps). Returns the distance left. */
function crWalk(w: World, cr: Creature, x: number, y: number, speed: number, dt: number, key: string): number {
  const d = dhypot(x - cr.x, y - cr.y);
  if (d < 0.5) {
    cr.v = 0;
    return d;
  }
  let want = datan2(y - cr.y, x - cr.x);
  if (d > 20) {
    const c = w.surfFlow.cell;
    const f = w.surfFlow.field(key, Math.round(x / c) * 10007 + Math.round(y / c), [{ x, y }]);
    if (w.surfFlow.dir(f, cr.x, cr.y, tmp)) want = datan2(tmp.y, tmp.x);
  }
  const diff = angleDiff(cr.h, want);
  cr.h += Math.max(-4 * dt, Math.min(4 * dt, diff));
  const step = Math.min(speed * Math.max(0.25, dcos(diff)) * dt, d);
  const free = (x: number, y: number) => w.terrain.inBounds(x, y, 4) && w.terrain.passable(x, y);
  const nx = cr.x + dcos(cr.h) * step;
  const ny = cr.y + dsin(cr.h) * step;
  if (free(nx, ny)) {
    cr.x = nx;
    cr.y = ny;
    cr.v = step / Math.max(dt, 1e-3);
    return d;
  }
  // blocked (a pebble, a rock's edge): slide round it — the first free heading either side of the one it wants (2026-11-02:
  // it only turned on the spot, and re-aimed into the same pebble the next tick)
  const side = dsin(cr.id) > 0 ? 1 : -1;
  for (const off of [0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
    const hh = cr.h + off * side;
    const sx = cr.x + dcos(hh) * step;
    const sy = cr.y + dsin(hh) * step;
    if (!free(sx, sy)) continue;
    cr.x = sx;
    cr.y = sy;
    cr.h += Math.max(-4 * dt, Math.min(4 * dt, angleDiff(cr.h, hh)));
    cr.v = step / Math.max(dt, 1e-3);
    return d;
  }
  cr.h += side * 4 * dt;
  cr.v = 0;
  return d;
}

/** Ants walk with the ant system's own movement (moveForward keeps them off obstacles); a sanity export for tests. */
export const _antMove = { moveForward, antSpeed };
export type { ActorDef };
