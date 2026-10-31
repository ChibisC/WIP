import type { World } from './world';
import { AS, Ant, Creature } from './types';
import { casteOf } from './species';
import { BALANCE } from './balance';
import { isEnemyAnt, friendlyCreature } from './combat';
import { distToCreatureBody } from './slots';

/**
 * Caste abilities (user 2026-10-31, after Empires of the Undergrowth; automatic, like EotU's):
 *
 *  - **Taunt** (leafcutter majors only, `CasteDef.taunt`): when the major bites and has more than `minHpFrac` of its
 *    health, there is a `chance` the taunt goes off (cooldown `cooldownSec`): every enemy ant within `radiusL` of its
 *    lengths drops what it was fighting and comes for the major, and every creature there turns on it, for `durSec`.
 *    (Atta majors rear up and stridulate when the nest is threatened — the render's taunt pose.)
 *  - **Rage** (army-ant soldiers only, `CasteDef.rage`): each kill adds a stack (up to `maxStacks`); each stack adds
 *    `dmgPerStack` to the bite damage of the soldier and of every nestmate within `radiusL` of its lengths (the
 *    strongest raging soldier nearby counts); a stack fades `decaySec` after the last kill. At the cap the ants glow
 *    red (render), as EotU's do at +45 %.
 *
 * All deterministic: the chance draws from the world's RNG, ants are visited in id order.
 */

/** Seconds the render shows the taunt pose / the rage pulse after it fires. */
export const CASTE_FX = { tauntPose: 1.6, ragePulse: 0.9 } as const;

/** After one of the ant's bites landed (combat.ts, both the ant and the creature path). */
export function casteOnBite(w: World, a: Ant): void {
  const cd = casteOf(a.caste);
  if (!cd.taunt) return;
  const T = BALANCE.casteAbility.taunt;
  if ((a.tauntCd ?? 0) > 0 || a.hp <= a.maxHp * T.minHpFrac) return;
  if (w.rng.next() >= T.chance) return;
  a.tauntCd = T.cooldownSec;
  a.tauntFx = CASTE_FX.tauntPose;
  const r = cd.length * T.radiusL;
  const pulled: Ant[] = [];
  w.antsNear(a.space, a.x, a.y, r, (o) => {
    if (!isEnemyAnt(a, o)) return false;
    pulled.push(o);
    return false;
  });
  pulled.sort((p, q) => p.id - q.id);
  for (const o of pulled) taunted(w, a, o, T.durSec);
  for (const cr of w.s.creatures) {
    if (cr.dead || cr.space !== a.space || friendlyCreature(w, w.teamOf(a.colony), cr) || distToCreatureBody(cr, a.x, a.y) > r) continue;
    cr.tauntBy = a.id;
    cr.tauntT = T.durSec;
  }
  w.events.emit({ t: 'taunt', x: a.x, y: a.y, space: a.space, radius: r, by: a.caste });
}

/** An enemy ant made to fight the taunting major. */
function taunted(w: World, by: Ant, o: Ant, dur: number): void {
  const oc = w.colony(o.colony);
  if (oc && o.id === oc.queen) return;
  const cd = casteOf(o.caste);
  if (cd.role === 'king') return;
  // busy in ways that can't be broken off (riding a creature, in flight, a living bridge or plug, snapping)
  if (o.state === AS.Climb || o.state === AS.Flung || o.state === AS.Bridge || o.state === AS.Plug || o.state === AS.Snap || o.state === AS.Hold) return;
  o.tauntBy = by.id;
  o.tauntT = dur;
  if (o.state === AS.Grapple && o.gId === by.id) return;
  if (o.state === AS.Grapple) {
    o.gId = 0;
    o.gKind = 0;
  }
  o.anc = 0;
  o.stp = 0;
  o.tgt = by.id;
  o.tk = 3;
  if (o.state !== AS.Attack) {
    o.state = AS.Attack;
    o.st = 0;
  }
  void w;
}

/** The ant taunting this one, if the taunt still holds (the taunter alive, in the same space). */
export function tauntOf(w: World, o: { tauntBy?: number; tauntT?: number; space: number }): Ant | null {
  if (!((o.tauntT ?? 0) > 0) || !o.tauntBy) return null;
  const a = w.antById.get(o.tauntBy);
  if (!a || a.state === AS.Dead || a.space !== o.space) {
    o.tauntT = 0;
    return null;
  }
  return a;
}

/** A kill by this ant (combat.ts damageAnt / damageCreature). */
export function casteOnKill(w: World, a: Ant): void {
  const cd = casteOf(a.caste);
  if (!cd.rage || a.state === AS.Dead) return;
  const R = BALANCE.casteAbility.rage;
  a.rage = Math.min(R.maxStacks, (a.rage ?? 0) + 1);
  a.rageT = 0;
  a.rageFx = CASTE_FX.ragePulse;
  w.events.emit({ t: 'rage', x: a.x, y: a.y, space: a.space, stacks: a.rage, by: a.caste });
}

/** The bite multiplier from rage (the soldier's own or a raging soldier's nearby, this tick). */
export function rageMul(w: World, a: Ant): number {
  return w.s.tick - (a.rageTick ?? -9) <= 1 ? 1 + (a.rageAura ?? 0) : 1;
}

/** Per tick: timers, rage fading and the rage aura. */
export function casteAbilitySystem(w: World, dt: number): void {
  const R = BALANCE.casteAbility.rage;
  const tick = w.s.tick;
  for (const a of w.s.ants) {
    if (a.state === AS.Dead) continue;
    if (a.tauntCd) a.tauntCd = Math.max(0, a.tauntCd - dt);
    if (a.tauntFx) a.tauntFx = Math.max(0, a.tauntFx - dt);
    if (a.tauntT) {
      a.tauntT = Math.max(0, a.tauntT - dt);
      if (a.tauntT > 0) tauntOf(w, a);
    }
    if (a.rageFx) a.rageFx = Math.max(0, a.rageFx - dt);
    if (!a.rage) continue;
    a.rageT = (a.rageT ?? 0) + dt;
    if (a.rageT >= R.decaySec) {
      a.rage = Math.max(0, a.rage - 1);
      a.rageT = 0;
      if (!a.rage) continue;
    }
    // the aura: this soldier and its nestmates within reach fight harder
    const k = a.rage * R.dmgPerStack;
    const r = casteOf(a.caste).length * R.radiusL;
    // (the strongest raging soldier nearby counts: within one tick the auras take the maximum)
    const lift = (o: Ant) => {
      o.rageAura = o.rageTick === tick ? Math.max(o.rageAura ?? 0, k) : k;
      o.rageTick = tick;
    };
    lift(a);
    w.antsNear(a.space, a.x, a.y, r, (o) => {
      if (o !== a && o.colony === a.colony && o.state !== AS.Dead) lift(o);
      return false;
    });
  }
  for (const cr of w.s.creatures) {
    if (cr.tauntT) {
      cr.tauntT = Math.max(0, cr.tauntT - dt);
      if (cr.tauntT > 0) tauntOf(w, cr as Creature & { space: number });
    }
  }
}
