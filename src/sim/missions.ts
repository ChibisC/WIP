import { World } from './world';
import { AS, Colony, SURFACE } from './types';
import type { SpeciesId } from './species';
import { SPECIES, isSoldierCaste } from './species';
import { spawnCreature } from './creatures/creatureAI';
import { CREATURES } from './creatures/kinds';
import { dcos, dhypot, dsin } from './dmath';

/**
 * Outdoor missions (Phase 13). A mission is a short script of stages, each
 * with goals, narrator captions and spawns, run as a simulation system so it
 * is deterministic: replays and saves include it, and it changes the world
 * only from inside the simulation. Its state lives in `w.s.mode.mission`
 * (the goals there are what the Missions panel shows).
 *
 * Lose when the player's queen dies; win when the last stage's goals are met.
 */

export type MissionId = 'meadow' | 'forest';

export interface MissionGoal {
  text: string;
  done: boolean;
  progress: string;
}

export interface MissionState {
  id: MissionId;
  colony: number;
  stage: number;
  entered: boolean;
  /** seconds in the stage */
  t: number;
  /** captions of this stage already said */
  said: number;
  goals: MissionGoal[];
  /** '' while it goes on */
  result: '' | 'won' | 'lost';
  /** the creature this stage is about (−1 none) */
  target: number;
  /** total food gathered when the stage began */
  food0: number;
}

interface Stage {
  name: string;
  /** captions: [seconds into the stage, text] */
  captions: Array<[number, string]>;
  enter?(w: World, c: Colony, m: MissionState): void;
  goals(w: World, c: Colony, m: MissionState): MissionGoal[];
  /** from this stage on the rival colony may raid the player (before it only defends its own nest) */
  rivalRaids?: boolean;
}

export interface MissionDef {
  id: MissionId;
  title: string;
  /** the species the mission is written for (the menu default) */
  species: SpeciesId;
  style: 'meadow' | 'forest';
  /** an AI rival colony */
  rival?: SpeciesId;
  brief: string;
  stages: Stage[];
}

const goal = (text: string, have: number, need: number): MissionGoal => ({ text, done: have >= need, progress: `${Math.min(have, need)}/${need}` });

function fighters(w: World, c: Colony): number {
  let n = 0;
  for (const a of w.s.ants) if (a.colony === c.id && a.state !== AS.Dead && isSoldierCaste(a.caste)) n++;
  return n;
}

function hasFighters(c: Colony): boolean {
  return c.castes.some((cs) => isSoldierCaste(cs));
}

/** Raise N ants, and M fighters when the colony has a fighting caste. */
function army(w: World, c: Colony, ants: number, fight: number): MissionGoal[] {
  const out = [goal(`Raise ${ants} ants`, c.living, ants)];
  if (hasFighters(c)) out.push(goal(`Raise ${fight} fighters`, fighters(w, c), fight));
  return out;
}

/** Mission bosses come at a fraction of their sandbox strength, sized for a mid-game colony. */
const MISSION_BOSS_HP = 0.5;

function spawnBoss(w: World, c: Colony, m: MissionState, kind: string, dist: number): void {
  const p = spotFrom(w, c, dist);
  const cr = spawnCreature(w, kind, SURFACE, p.x, p.y);
  cr.hp = cr.maxHp = cr.maxHp * MISSION_BOSS_HP;
  const e = c.entrances[0];
  if (e) {
    cr.data.gx = e.sx;
    cr.data.gy = e.sy;
  }
  m.target = cr.id;
}

function built(c: Colony, type: string): number {
  return c.tiles.filter((t) => t.type === type && t.built).length;
}

/** A spot on open ground `dist` mm from the player's entrance (as far as the map allows). */
function spotFrom(w: World, c: Colony, dist: number): { x: number; y: number } {
  const e = c.entrances[0] ?? { sx: c.nx, sy: c.ny };
  const t = w.terrain;
  let best = { x: e.sx, y: e.sy };
  let bd = -1;
  for (let i = 0; i < 24; i++) {
    const a = w.rng.range(0, Math.PI * 2);
    const x = Math.min(t.width - 30, Math.max(30, e.sx + dcos(a) * dist));
    const y = Math.min(t.depth - 30, Math.max(30, e.sy + dsin(a) * dist));
    if (!t.passable(x, y)) continue;
    const d = dhypot(x - e.sx, y - e.sy);
    if (d > bd) {
      bd = d;
      best = { x, y };
    }
  }
  return best;
}

function creatureGone(w: World, id: number): boolean {
  const cr = w.creatureById.get(id);
  return !cr || cr.dead;
}

function antName(c: Colony): string {
  return SPECIES[c.species].common.toLowerCase();
}

const facts = (kind: string) => CREATURES[kind]?.facts ?? [];

// ---------------------------------------------------------------- the missions

const MEADOW: MissionDef = {
  id: 'meadow',
  title: 'A Meadow Kingdom',
  species: 'lasius',
  style: 'meadow',
  brief: 'A young queen has sealed herself under a meadow. Raise her first workers, fill the stores, and hold the ground against the hunters that live in the grass.',
  stages: [
    {
      name: 'Founding',
      captions: [
        [2, 'A newly mated queen breaks off her wings, digs a chamber and seals herself in. She raises her first brood alone, on the fat stored in her body.'],
        [45, 'Her first daughters are nanitics: small workers, because she could only feed them so much. They open the nest and start to forage.'],
        [110, 'A forager that finds food lays a scent trail home. Every ant that follows it and finds food too adds to the trail, so good sources draw a crowd.'],
      ],
      goals: (w, c) => [goal('Raise 15 ants', c.living, 15)],
    },
    {
      name: 'Stores',
      captions: [
        [2, 'Black garden ants tend aphids for their honeydew, a sugary waste the aphids give up when stroked by the ants’ antennae.'],
        [60, 'Food is shared mouth to mouth (trophallaxis), so a few foragers can feed the whole nest. Build stores to hold what they bring in.'],
      ],
      enter: (w, c, m) => {
        m.food0 = c.stats.food;
      },
      goals: (w, c, m) => [goal('Gather 250 food', Math.floor(c.stats.food - m.food0), 250), goal('Build 2 food stores', built(c, 'food'), 2)],
    },
    {
      name: 'The hunter',
      captions: [
        [1, 'Something is hunting along your trails: a wolf spider. It does not spin a web; it runs its prey down by sight.'],
        [20, facts('wolfSpider')[0] ?? ''],
        [50, 'Ants win by numbers. Send a group to it with a marker and let them pin its legs.'],
      ],
      enter: (w, c, m) => {
        const p = spotFrom(w, c, 120);
        const cr = spawnCreature(w, 'wolfSpider', SURFACE, p.x, p.y);
        const e = c.entrances[0];
        if (e) {
          cr.homeX = e.sx;
          cr.homeY = e.sy;
        }
        m.target = cr.id;
      },
      goals: (w, c, m) => [goal('Kill the wolf spider', creatureGone(w, m.target) ? 1 : 0, 1)],
    },
    {
      name: 'Muster',
      captions: [
        [2, 'Beetle tracks in the soft ground: something heavy is feeding on the sap of the old oak at the meadow’s edge. Grow the colony while you can.'],
        [60, 'Soldiers are larger workers with bigger heads and jaws. A colony raises more of them when it is threatened.'],
      ],
      goals: (w, c) => army(w, c, 50, 8),
    },
    {
      name: 'Finale: the stag beetle',
      captions: [
        [1, 'The ground shakes. A male stag beetle, a hundred times your workers’ weight, is crashing through the grass toward the nest.'],
        [25, facts('stagBeetle')[0] ?? ''],
        [55, 'Watch the ground: when he rears, the red ring shows where his jaws will slam. Pull your ants out of it, then swarm him again.'],
        [100, facts('stagBeetle')[1] ?? ''],
      ],
      enter: (w, c, m) => spawnBoss(w, c, m, 'stagBeetle', 420),
      goals: (w, c, m) => [goal('Bring down the stag beetle', creatureGone(w, m.target) ? 1 : 0, 1)],
    },
  ],
};

const FOREST: MissionDef = {
  id: 'forest',
  title: 'The Forest Floor',
  species: 'formica',
  style: 'forest',
  rival: 'lasius',
  brief: 'Under the pines, a red wood ant colony must grow an army. A colony of black garden ants holds the clearing nearby, and something larger hunts the leaf litter.',
  stages: [
    {
      name: 'The mound',
      captions: [
        [2, 'Red wood ants build mounds of pine needles over their nests. The thatch traps the sun’s warmth, and the brood grows faster in it.'],
        [50, 'They have no sting: they spray formic acid from the tip of the gaster, and bite to let it into the wound.'],
      ],
      goals: (w, c) => army(w, c, 25, 5),
    },
    {
      name: 'Warm the brood',
      captions: [[2, 'Workers sun themselves on the mound in spring and carry the warmth down into the nest with their bodies.']],
      goals: (w, c) =>
        c.species === 'formica' ? [goal('Build 2 thatch stores', built(c, 'thatch'), 2), goal('Raise 40 ants', c.living, 40)] : army(w, c, 40, 10),
    },
    {
      name: 'The rival colony',
      rivalRaids: true,
      captions: [
        [2, 'Wood ants defend a territory and raid weaker neighbours, carrying off their brood as food.'],
        [40, 'Place a marker on the rival nest’s entrance to send your groups down into it, then on the queen.'],
      ],
      goals: (w) => {
        const rivals = w.s.colonies.filter((o) => !o.player);
        const down = rivals.filter((o) => !o.alive).length;
        return [goal('Destroy the rival colony', down, Math.max(1, rivals.length))];
      },
    },
    {
      name: 'Recover',
      rivalRaids: true,
      captions: [[2, 'The clearing is yours. Something has been eating the beetles in the litter: rebuild before it finds you.']],
      goals: (w, c) => army(w, c, 45, 8),
    },
    {
      name: 'Finale: the wolf spider mother',
      rivalRaids: true,
      captions: [
        [1, 'A huge wolf spider is coming through the litter with her whole brood riding on her back.'],
        [20, facts('hogna')[0] ?? ''],
        [50, 'Each hard hit may shake spiderlings loose. Keep a group back to deal with them.'],
      ],
      enter: (w, c, m) => spawnBoss(w, c, m, 'hogna', 380),
      goals: (w, c, m) => [goal('Kill the wolf spider mother', creatureGone(w, m.target) ? 1 : 0, 1)],
    },
  ],
};

export const MISSIONS: Record<MissionId, MissionDef> = { meadow: MEADOW, forest: FOREST };

export function missionOf(w: World): MissionState | null {
  return (w.s.mode.mission as MissionState | undefined) ?? null;
}

/**
 * May the mission's rival colony raid the player now? Not before the stage that sets the war going (Phase 15
 * playtest: the developed black garden ant rival raided a three-worker colony at minute 8 and ended the mission
 * before it began). Always true outside missions.
 */
export function rivalsMayRaid(w: World): boolean {
  const m = missionOf(w);
  if (!m) return true;
  return !!MISSIONS[m.id]?.stages[m.stage]?.rivalRaids || !!m.result;
}

export function startMission(w: World, id: MissionId, colony: number): void {
  const m: MissionState = { id, colony, stage: 0, entered: false, t: 0, said: 0, goals: [], result: '', target: -1, food0: 0 };
  w.s.mode.mission = m;
}

function say(w: World, text: string): void {
  if (text) w.events.emit({ t: 'message', text, kind: 'narrator' });
}

/** Runs once a second (registered with `every: 20`). */
export function missionSystem(w: World, dt: number): void {
  const m = missionOf(w);
  if (!m || m.result) return;
  const def = MISSIONS[m.id];
  const c = w.colony(m.colony);
  if (!def || !c) return;
  if (!c.alive) {
    m.result = 'lost';
    say(w, 'The queen is dead, and with her the colony. The meadow will be quiet by winter.');
    return;
  }
  const st = def.stages[m.stage];
  if (!st) return;
  if (!m.entered) {
    m.entered = true;
    m.t = 0;
    m.said = 0;
    w.events.emit({ t: 'message', text: `${def.title}: ${st.name}`, kind: 'good' });
    st.enter?.(w, c, m);
  }
  m.t += dt;
  while (m.said < st.captions.length && m.t >= st.captions[m.said][0]) say(w, st.captions[m.said++][1]);
  m.goals = st.goals(w, c, m);
  if (m.goals.every((g) => g.done)) {
    m.stage++;
    m.entered = false;
    if (m.stage >= def.stages.length) {
      m.result = 'won';
      say(w, `Mission complete. Your ${antName(c)} colony holds its ground.`);
    }
  }
}
