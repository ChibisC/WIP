import type { World } from '../world';
import { AS, Colony, SURFACE, nestSpace } from '../types';
import { CASTES, SPECIES, isSoldierCaste } from '../species';
import { TILE_INFO } from '../tiles';
import { corpseSource, genomeOf, stolenName, stolenOf, threshold } from '../termants';
import { dhypot } from '../dmath';
import type { MissionGoal } from '../missions';
import { StoryState, actorIndex, hasFlag } from './state';
import { members, wherePt, levelOf } from './director';
import type { Objective } from './types';

/**
 * The data-driven objective types (claude/story/02-spec §6): each gives a goal line for the HUD — its text, whether it
 * is met and its progress. Chapter 1 uses raise, build, collect food, store wood, steal caste, raise caste, survive a
 * wave, kill queen, reach and enter nest; the others (survive time, kill creature, escort, protect, kill ants, dig,
 * fighters) are built and tested for later chapters.
 */

/** What the runner keeps per stage for the objectives that count from the stage's start. */
export interface StageBase {
  food0: number;
  kills0: number;
  t: number;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function count(have: number, need: number): { done: boolean; progress: string } {
  return { done: have >= need, progress: `${Math.min(Math.floor(have), need)}/${need}` };
}

/** Default goal text of an objective. */
export function objectiveText(w: World, st: StoryState, o: Objective): string {
  if (o.text) return o.text;
  const L = levelOf(st);
  const label = (a: string) => L.actors[a]?.label ?? a;
  const rival = (r: string) => L.rivals[r]?.name ?? r;
  switch (o.type) {
    case 'raise':
      return `Raise ${o.n} ants`;
    case 'fighters':
      return `Raise ${o.n} fighters`;
    case 'build':
      return `Build ${o.n} ${TILE_INFO[o.tile]?.name.toLowerCase() ?? o.tile} tile${o.n > 1 ? 's' : ''}`;
    case 'dig':
      return `Dig out ${o.hexes} hexes of nest`;
    case 'collectFood':
      return `Gather ${o.amount} food`;
    case 'storeWood':
      return `Store ${o.amount} wood`;
    case 'killAnts':
      return `Kill ${o.n} of the ${rival(o.rival).toLowerCase()}`;
    case 'stealCaste':
      return `Steal the ${stolenName(o.caste)}`;
    case 'raiseCaste':
      return `Raise ${o.n} ${stolenOf(o.caste) ? stolenName(o.caste) : CASTES[o.caste]?.name ?? o.caste}${o.n > 1 ? 's' : ''}`;
    case 'killQueen':
      return `Kill the ${rival(o.rival).toLowerCase()} queen`;
    case 'surviveTime':
      return `Hold out for ${mmss(o.s)}`;
    case 'surviveWave':
      return `Survive ${label(o.actor)}`;
    case 'killCreature':
      return `Kill ${label(o.actor)}`;
    case 'escort':
      return `Bring ${label(o.actor)} through`;
    case 'protect':
      return `Protect ${label(o.actor)} for ${mmss(o.s)}`;
    case 'reach':
      return `Take ${typeof o.at === 'string' ? o.at : 'the ground'} with ${o.n} ants`;
    case 'enterNest':
      return `Send ${o.n} ants into the ${rival(o.rival).toLowerCase()} nest`;
  }
}

/** No living colony of the caste's species, and none of its dead left on the surface to carry home. */
function sourceGone(w: World, caste: string): boolean {
  const sp = CASTES[caste]?.species;
  if (!sp) return true;
  if (w.s.colonies.some((o) => o.alive && o.species === sp && !o.player)) return false;
  for (const f of w.s.food) if (f.kind === 'corpse' && f.space === SURFACE && corpseSource(f.from) === sp) return false;
  return true;
}

/** Evaluate one objective now (not latched: the runner keeps a met goal met). */
export function evalObjective(w: World, c: Colony, st: StoryState, base: StageBase, o: Objective): { done: boolean; progress: string } {
  switch (o.type) {
    case 'raise':
      return count(c.living, o.n);
    case 'fighters': {
      let n = 0;
      for (const a of w.s.ants) if (a.colony === c.id && a.state !== AS.Dead && isSoldierCaste(a.caste)) n++;
      return count(n, o.n);
    }
    case 'build':
      return count(c.tiles.filter((t) => t.type === o.tile && t.built).length, o.n);
    case 'dig':
      return count(w.nest(c.id)?.dugHexCount() ?? 0, o.hexes);
    case 'collectFood':
      return count(c.stats.food - base.food0, o.amount);
    case 'storeWood':
      return count(c.wood ?? 0, o.amount);
    case 'killAnts':
      return count(c.stats.kills - base.kills0, o.n);
    case 'stealCaste': {
      if (c.castes.includes(o.caste)) return { done: true, progress: 'stolen' };
      // the species is gone from the map before its caste was stolen: the level goes on without it (replay to steal it)
      if (sourceGone(w, o.caste)) return { done: true, progress: 'missed' };
      const e = stolenOf(o.caste);
      const have = e ? (genomeOf(c).samples[e.source] ?? 0) : 0;
      return { done: false, progress: `${Math.floor(have)}/${threshold(e ?? null)} genes` };
    }
    case 'raiseCaste':
      if (!c.castes.includes(o.caste) && sourceGone(w, o.caste)) return { done: true, progress: 'missed' };
      return count(c.counts[o.caste] ?? 0, o.n);
    case 'killQueen': {
      const r = w.colony(st.rivals[o.rival] ?? -1);
      const dead = !r || !r.alive;
      return { done: dead, progress: dead ? 'dead' : 'alive' };
    }
    case 'surviveTime':
      return { done: base.t >= o.s, progress: `${mmss(Math.min(base.t, o.s))}/${mmss(o.s)}` };
    case 'surviveWave': {
      const ai = actorIndex(st, o.actor);
      const act = st.actors[ai];
      if (!act?.spawned) return { done: false, progress: 'coming' };
      const left = members(w, act).length;
      return { done: hasFlag(st, `beaten:${o.actor}`), progress: `${left} left` };
    }
    case 'killCreature': {
      const act = st.actors[actorIndex(st, o.actor)];
      if (!act?.spawned) return { done: false, progress: 'not seen' };
      const alive = members(w, act).length;
      const killed = act.kind === 0 && act.ids.every((id) => {
        const cr = w.creatureById.get(id);
        return !cr || (cr.dead && !cr.data.gone);
      });
      return { done: alive === 0 && killed, progress: alive ? 'alive' : 'dead' };
    }
    case 'escort': {
      const act = st.actors[actorIndex(st, o.actor)];
      const p = wherePt(w, o.to);
      const m = act ? members(w, act) : [];
      const d = m.length ? Math.min(...m.map((e) => dhypot(e.x - p[0], e.y - p[1]))) : Infinity;
      return { done: d <= (o.r ?? 20), progress: m.length ? `${Math.round(d)} mm to go` : 'lost' };
    }
    case 'protect': {
      const act = st.actors[actorIndex(st, o.actor)];
      const alive = act ? members(w, act).length > 0 : false;
      return { done: alive && base.t >= o.s, progress: alive ? `${mmss(Math.min(base.t, o.s))}/${mmss(o.s)}` : 'lost' };
    }
    case 'reach': {
      const p = wherePt(w, o.at);
      let n = 0;
      w.antsNear(SURFACE, p[0], p[1], o.r, (a) => {
        if (a.colony === c.id && a.state !== AS.Dead) n++;
        return false;
      });
      return count(n, o.n);
    }
    case 'enterNest': {
      const space = nestSpace(st.rivals[o.rival] ?? -1);
      let n = 0;
      for (const a of w.s.ants) if (a.colony === c.id && a.space === space && a.state !== AS.Dead) n++;
      return count(n, o.n);
    }
  }
}

/** The goal lines of a stage, keeping met goals met (`st.latched`). */
export function stageGoals(w: World, c: Colony, st: StoryState, base: StageBase, objectives: Objective[]): MissionGoal[] {
  return objectives.map((o, i) => {
    const text = objectiveText(w, st, o) + (o.optional ? ' (optional)' : '');
    if (st.latched[i]) return { text, done: true, progress: '✓', ...(o.optional ? { optional: true } : {}) };
    const r = evalObjective(w, c, st, base, o);
    if (r.done) st.latched[i] = 1;
    return { text, done: r.done, progress: r.progress, ...(o.optional ? { optional: true } : {}) };
  });
}

export const _speciesName = (id: keyof typeof SPECIES) => SPECIES[id].common;
