import { World } from './world';
import { AS, Colony, snapping } from './types';
import { casteOf } from './species';
import { isEnemyAnt } from './combat';

/**
 * Species abilities (the marker panel's third button). Each is a real
 * behaviour of the species, on a cooldown:
 *  - Black garden ant: mass recruitment — foragers lay much stronger trails and the colony pours out to forage.
 *  - Red wood ant: acid barrage — every acid-bearing ant reloads and sprays from further away.
 *  - Leafcutter: stridulation — ants rasp an alarm signal; the whole colony rushes to fight.
 *  - Fire ant: stinging frenzy — attacks and stings come much faster.
 *  - Termants: alarm drumming — soldiers drum like termites; the colony is alarmed like ants and every glue burst is
 *    ready at once.
 *  - Gene Thief: propaganda substance — like slave-making Formica, raiders spray Dufour's-gland
 *    secretions that throw defenders into confusion.
 */
export interface AbilityDef {
  name: string;
  desc: string;
  /** seconds active (0 = instant) */
  duration: number;
  cooldown: number;
}

export const ABILITIES: Record<string, AbilityDef> = {
  lasius: { name: 'Mass Recruitment', desc: 'For 25 s foragers lay triple-strength trails and idle home workers pour out to forage around the nest.', duration: 25, cooldown: 90 },
  formica: { name: 'Acid Barrage', desc: 'Every acid sprayer reloads at once; for 12 s they spray from 40 % further and twice as often.', duration: 12, cooldown: 75 },
  atta: { name: 'Stridulation', desc: 'Ants rasp an alarm call: for 15 s every ant in the colony is alarmed and rushes to fight.', duration: 15, cooldown: 60 },
  solenopsis: { name: 'Stinging Frenzy', desc: 'For 15 s your ants bite and sting 70 % faster.', duration: 15, cooldown: 70 },
  plagiaria: { name: 'Propaganda Substance', desc: 'Enemy ants near your fighting ants are thrown into confusion (stunned 3 s, slowed 8 s), as slave-maker raiders do with Dufour’s gland secretions.', duration: 0, cooldown: 80 },
  eciton: { name: 'Swarm Raid', desc: 'For 20 s the colony is alarmed and moves 20 % faster.', duration: 20, cooldown: 80 },
  nasutitermes: { name: 'Drumming Alarm', desc: 'Soldiers bang their heads on the walls: every termite is alerted for 12 s — soldiers rush to the fighting, workers fall back into the nest.', duration: 12, cooldown: 70 },
  rhynchotermes: { name: 'Drumming Alarm', desc: 'Soldiers drum their heads on the ground: every termite is alerted for 12 s — sickle-jaws rush to the fighting with their mandibles open, workers fall back into the nest.', duration: 12, cooldown: 70 },
  hell: { name: 'Ambush', desc: 'Every hell ant’s snap is ready at once, and for 15 s it recharges instantly after each catch.', duration: 15, cooldown: 80 },
  termant: { name: 'Alarm Drumming', desc: 'Soldiers drum their heads on the ground like termites: every ant in the colony is alarmed and rushes to fight, and every soldier’s glue burst is ready at once.', duration: 15, cooldown: 70 },
  aurimyrmex: { name: 'Second Wind', desc: 'Every exhausted ant recovers at once: its gold surge is ready again.', duration: 0, cooldown: 75 },
};

export function abilityOf(c: Colony): AbilityDef {
  return ABILITIES[c.species] ?? ABILITIES.plagiaria;
}

export function abilityActive(c: Colony): boolean {
  return (c.abilityT ?? 0) > 0;
}

/** Multipliers the rest of the sim reads while an ability is running. */
export function abilityMods(c: Colony): { trail: number; acidRange: number; acidCd: number; attackRate: number; speed: number } {
  const on = abilityActive(c);
  return {
    trail: on && c.species === 'lasius' ? 3 : 1,
    acidRange: on && c.species === 'formica' ? 1.4 : 1,
    acidCd: on && c.species === 'formica' ? 0.5 : 1,
    attackRate: on && c.species === 'solenopsis' ? 1.7 : 1,
    speed: on && c.species === 'eciton' ? 1.2 : 1,
  };
}

/** Trigger the colony's ability. Returns a reason when it cannot be used. */
export function useAbility(w: World, c: Colony): string | null {
  if ((c.abilityCd ?? 0) > 0) return `${abilityOf(c).name} is ready in ${Math.ceil(c.abilityCd)} s`;
  const def = abilityOf(c);
  c.abilityCd = def.cooldown;
  c.abilityT = def.duration;
  const mine = w.s.ants.filter((a) => a.colony === c.id && a.state !== AS.Dead && a.id !== c.queen);
  switch (c.species) {
    case 'formica':
      for (const a of mine) if (casteOf(a.caste).acid) a.cd2 = 0;
      break;
    case 'atta':
    case 'eciton':
      for (const a of mine) a.alarm = 1;
      break;
    case 'lasius':
      break;
    case 'solenopsis':
      break;
    case 'nasutitermes':
    case 'rhynchotermes': {
      const until = w.s.tick + 12 * 20;
      const q = w.antById.get(c.queen);
      for (const a of mine) {
        a.alertUntil = until;
        // soldiers converge on the nearest fighting nestmate, else the queen
        let best: { x: number; y: number } | null = null;
        let bd = Infinity;
        for (const o of mine) if (o.space === a.space && (o.state === AS.Attack || o.state === AS.Grapple || snapping(o.state))) {
          const d = (o.x - a.x) * (o.x - a.x) + (o.y - a.y) * (o.y - a.y);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        const p = best ?? (q && q.space === a.space ? q : null);
        if (p) {
          a.alX = p.x;
          a.alY = p.y;
        }
      }
      if (q) w.events.emit({ t: 'headbang', x: q.x, y: q.y, space: q.space });
      break;
    }
    case 'termant': {
      for (const a of mine) {
        a.alarm = 1;
        if (casteOf(a.caste).glue) a.cd2 = 0;
      }
      const q = w.antById.get(c.queen);
      if (q) w.events.emit({ t: 'headbang', x: q.x, y: q.y, space: q.space });
      break;
    }
    case 'hell':
      for (const a of mine) if (a.snapCd !== undefined) a.snapCd = 0;
      break;
    case 'aurimyrmex':
      for (const a of mine) if (a.surgeCd !== undefined) a.surgeCd = 0;
      break;
    default: {
      // propaganda: confuse enemies close to our fighters
      for (const a of mine) {
        if (a.state !== AS.Attack && a.state !== AS.Grapple && !snapping(a.state) && a.task !== 'marker') continue;
        w.antsNear(a.space, a.x, a.y, 30, (o) => {
          if (!isEnemyAnt(a, o)) return false;
          o.stun = Math.max(o.stun, 3);
          o.slowT = Math.max(o.slowT, 8);
          o.alarm = 0;
          return false;
        });
      }
    }
  }
  if (c.player) w.events.emit({ t: 'message', text: `${def.name}!`, kind: 'good', colony: c.id });
  return null;
}

/** Tick ability timers (called by the colony system). */
export function abilityTick(c: Colony, dt: number): void {
  if (c.abilityCd > 0) c.abilityCd = Math.max(0, c.abilityCd - dt);
  if (c.abilityT > 0) c.abilityT = Math.max(0, c.abilityT - dt);
}
