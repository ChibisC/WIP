import { BALANCE, ECITON, NASUTE, SICKLE, TERMANT } from '../sim/balance';
import { isTermant } from '../sim/termants';
import { AntView } from '../render/ants/antRenderer';
import { Ant, AS, Brood, Carry, Food, POSE, SURFACE } from '../sim/types';
import { casteOf } from '../sim/species';
import { AnimState, Carry as TCarry, LUNGE_SEC, LUNGE_SNAP } from '../render/termite/rig';
import { victimStruggle } from '../render/termite/material';
import { bodyHook } from '../sim/slots';
import { LUNGE_TICKS, isSickle, sickleRampFraction } from '../sim/sickleJaws';
import { ATTACK_CONTACT } from '../render/ants/attackPoses';
import { queenBody, rampFraction } from '../sim/termites';
import { World } from '../sim/world';

/** Surface holes of every area (rebuilt once per sim tick) for the scurry-in fade. */
let holeTick = -1;
let holeWorld: World | null = null;
const holes: number[] = [];
function surfaceHoles(w: World): number[] {
  if (holeTick === w.s.tick && holeWorld === w) return holes;
  holeTick = w.s.tick;
  holeWorld = w;
  holes.length = 0;
  for (const space of w.undergroundSpaces()) for (const e of w.entrancesOf(space)) holes.push(e.sx, e.sy);
  return holes;
}

/**
 * Termite glue on targets (render only, derived from sim state once per tick):
 * a nasute's stream coats its target more thickly as its ramp climbs; a
 * major's glue burst coats it fully for the hold.
 */
let glueTick = -1;
let glueWorld: World | null = null;
const glueOnTarget = new Map<number, number>();
function glueOf(w: World, a: Ant): number {
  if (glueTick !== w.s.tick || glueWorld !== w) {
    glueTick = w.s.tick;
    glueWorld = w;
    glueOnTarget.clear();
    for (const o of w.s.ants) {
      if (!(o.fire && o.fire > 0) || o.tk !== 3 || !o.tgt) continue;
      const g = 0.25 + 0.75 * rampFraction(o);
      if (g > (glueOnTarget.get(o.tgt) ?? 0)) glueOnTarget.set(o.tgt, g);
    }
  }
  const rooted = (a.root ?? 0) > w.s.tick ? 1 : 0;
  // a Termant soldier's glue burst: a lighter coat that wears off with the slow
  const tg = (a.glueT ?? 0) > w.s.tick ? 0.75 : 0;
  return Math.max(rooted, tg, glueOnTarget.get(a.id) ?? 0);
}

/**
 * Melee attack animation (render only): the phase of each biting unit's
 * attack cycle, read from its bite cooldown, and which of the three attacks
 * plays this cycle (render/ants/attackPoses.ts). The cooldown is reset to
 * the next gap on the tick the bite lands, so the gap is known from that jump
 * and the jaws close (`ATTACK_CONTACT`) exactly on the damage tick.
 */
interface AtkRec {
  cd: number;
  gap: number;
  q: number;
  n: number;
  v: number;
  seen: number;
}
const atkRecs = new Map<number, AtkRec>();
let atkPrune = 0;
function meleeOf(w: World, a: Ant, L: number): boolean {
  if (a.state === AS.Grapple) return true;
  const cd = casteOf(a.caste);
  // riding a creature: biting it all the while (nasutes fire their glue instead)
  if (a.state === AS.Climb) return a.ridePh === 2 && cd.acid?.kind !== 'ramp';
  if (cd.termite === 'king') return a.pose === POSE.ALARM && a.v === 0;
  if (a.state !== AS.Attack || !a.tgt || cd.acid?.kind === 'ramp') return false;
  const t = a.tk === 3 ? w.antById.get(a.tgt) : a.tk === 4 ? w.creatureById.get(a.tgt) : undefined;
  if (!t) return false;
  const r = 'caste' in t ? casteOf(t.caste).length * 0.45 : t.scale * 0.45;
  return Math.hypot(t.x - a.x, t.y - a.y) <= r + L * 0.6;
}
function meleeAttack(w: World, a: Ant, out: AntView): void {
  const cd = casteOf(a.caste);
  out.atk = undefined;
  if (a.state === AS.Dead || !meleeOf(w, a, cd.length)) return;
  let r = atkRecs.get(a.id);
  if (!r) {
    r = { cd: a.cd, gap: cd.attackInterval, q: 0, n: 0, v: a.id % 3, seen: w.s.tick };
    atkRecs.set(a.id, r);
  }
  if (a.cd > r.cd + 1e-6) r.gap = Math.max(0.15, a.cd); // the bite just landed: the new gap
  r.cd = a.cd;
  r.seen = w.s.tick;
  const p = Math.min(1, Math.max(0, 1 - a.cd / r.gap));
  const q = (p + ATTACK_CONTACT) % 1;
  if (q < r.q - 0.5) {
    // a new cycle: the next of the three attacks (never the same twice running; half the ants go round the other way),
    // and the side clamp switches sides
    r.n++;
    r.v = (r.v + (a.id & 1 ? 1 : 2)) % 3;
  }
  r.q = q;
  out.atk = q;
  out.atkVar = r.v;
  out.atkSide = r.n & 1 ? 1 : -1;
  out.atkGap = r.gap;
  out.atkN = r.n;
  out.atkSeq = true;
  if (++atkPrune > 4000) {
    atkPrune = 0;
    for (const [id, x] of atkRecs) if (w.s.tick - x.seen > 200) atkRecs.delete(id);
  }
}

/**
 * Translate simulation ants (and ant corpses) into render views with
 * behaviour-driven animation hints: antennae low when trail-following,
 * raised and frantic when alarmed, mandibles open to bite/carry, etc.
 */
export function antToView(w: World, a: Ant, out: AntView, space: number, selected: number): AntView {
  const cd = casteOf(a.caste);
  out.id = a.id;
  out.morph = cd.morph;
  out.space = space;
  out.x = a.x;
  out.y = a.y;
  out.px = a.px;
  out.py = a.py;
  out.heading = a.h;
  out.pheading = a.ph;
  out.dead = a.state === AS.Dead;
  out.carrying = a.carry !== Carry.None && a.carry !== Carry.Soil;
  out.crop = a.state === AS.Dead ? 0 : Math.max(0, (a.crop - 0.3) / 0.7);
  out.sizeVar = a.sizeVar;
  out.scale = (cd.scale ?? 1) * BALANCE.levelSize[Math.max(0, Math.min(2, (a.level || 1) - 1))];
  // newly hatched: a brief settle (grows into place with a little overshoot)
  if (a.age < 0.7) {
    const k = a.age / 0.7;
    out.scale *= 0.55 + 0.45 * k + Math.sin(k * Math.PI) * 0.12;
  }
  out.colorVar = a.colorVar;
  out.lift = a.state === AS.Flung ? a.fz : 0;
  // animation pass: a drop in hit points starts a hit reaction; a thrown ant tumbles (not one held in antlers)
  out.hp = a.hp;
  out.cause = a.state === AS.Dead ? (a.lastHit ?? 0) : 0;
  out.dry = 0;
  out.flung = a.state === AS.Flung && !a.gripCr;
  // held in antlers: drawn in the animated jaws (render-only; the sim's position is the fallback)
  out.heldCr = a.state === AS.Flung && a.gripCr ? a.gripCr : 0;
  // Scurry fade at entrances: on the surface an ant shrinks and sinks as it
  // reaches a hole (and grows out of it when it emerges); underground it
  // grows in from the top of the ramp just after coming down.
  if (a.state !== AS.Dead && a.state !== AS.Flung) {
    if (a.space === SURFACE) {
      const hs = surfaceHoles(w);
      const R = 4 + cd.length * 0.5;
      for (let i = 0; i < hs.length; i += 2) {
        const d2 = (hs[i] - a.x) ** 2 + (hs[i + 1] - a.y) ** 2;
        if (d2 > R * R) continue;
        const k = Math.sqrt(d2) / R;
        out.scale *= 0.45 + 0.55 * k;
        out.lift -= (1 - k) * cd.length * 0.35;
        break;
      }
    } else if ((a.entT ?? 9) < 0.45) {
      const k = (a.entT ?? 9) / 0.45;
      out.scale *= 0.5 + 0.5 * k;
    }
  }
  out.roll = a.stun > 0 ? Math.sin(w.time * 18 + a.id) * 0.25 : 0;
  out.pitch = 0;
  out.selected = a.id === selected;
  out.pose = a.pose;
  out.headYaw = a.look * 0.6;
  out.headPitch = 0;
  out.gaster = 0;
  out.mandible = 0;
  out.antennaPitch = 0;
  out.antennaActivity = 0.3;
  switch (a.state) {
    case AS.FollowTrail:
    case AS.Return:
      out.antennaPitch = -0.7; // antennae low, tracking the trail
      out.antennaActivity = 0.55;
      break;
    case AS.Scout:
    case AS.Wander:
      out.antennaPitch = -0.2;
      out.antennaActivity = a.pause > 0 ? 0.95 : 0.6;
      break;
    case AS.Climb:
      // up the leg, on the back, down again: antennae busy, jaws ready
      out.mandible = a.ridePh === 2 ? 0.25 + Math.max(0, Math.sin(w.time * 14 + a.id)) * 0.5 : 0.6;
      out.antennaPitch = a.ridePh === 2 ? 0.6 : 0.2;
      out.antennaActivity = 1;
      out.gaster = cd.sting && a.ridePh === 2 ? -0.4 : 0.2;
      out.headPitch = a.ridePh === 2 ? -0.25 : -0.1;
      break;
    case AS.Attack:
    case AS.Grapple:
      out.mandible = a.state === AS.Grapple ? 0.25 + Math.max(0, Math.sin(w.time * 14 + a.id)) * 0.5 : 0.95;
      out.antennaPitch = 0.6;
      out.antennaActivity = 1;
      out.gaster = cd.sting ? -0.4 : 0.35;
      out.headPitch = -0.15;
      break;
    case AS.Spray:
      sprayPose(out, cd.acid?.kind, a.st, cd.length);
      break;
    case AS.Dig:
      out.mandible = 0.4 + Math.max(0, Math.sin(w.time * 16 + a.id)) * 0.55;
      out.headPitch = -0.4;
      out.antennaPitch = -0.4;
      break;
    case AS.Collect:
    case AS.CutLeaf:
      // (overnight spec 3.1) hind legs anchored on the leaf edge, the body swinging in an arc as the jaws cut a
      // semicircle; a fine vibration in the jaws while cutting
      out.mandible = 0.3 + Math.max(0, Math.sin(w.time * 12 + a.id)) * 0.6 + Math.sin(w.time * 70 + a.id) * 0.05;
      out.headPitch = -0.3;
      out.headYaw = Math.sin(w.time * 0.9 + a.id) * 0.45;
      out.roll = Math.sin(w.time * 0.9 + a.id) * 0.06;
      break;
    case AS.Troph:
      // (overnight spec 3.4) face to face, mouthparts touching: the jaws parted, the head nodding gently as
      // the drop passes, antennae stroking the partner's head
      out.mandible = 0.55;
      out.headPitch = 0.1 + Math.sin(w.time * 3.1 + a.id) * 0.05;
      out.antennaPitch = 0.25;
      out.antennaActivity = 1;
      break;
    case AS.FeedLarva:
      out.mandible = 0.4;
      out.headPitch = -0.35;
      break;
    case AS.TendAphids:
      // (overnight spec 3.4) drumming on the aphid with the antennae (fast: see armyAnt's waveMul), head low
      out.antennaPitch = -0.35;
      out.antennaActivity = 1;
      out.headPitch = -0.2;
      break;
  }
  if (out.carrying) out.mandible = Math.max(out.mandible, 0.35);
  if (a.alarm > 0.5 && a.state !== AS.Grapple && a.state !== AS.Spray) {
    out.mandible = Math.max(out.mandible, 0.8);
    out.antennaPitch = 0.7;
    out.antennaActivity = 1;
    // fire ants flag the gaster high in alarm, the sting out (spec 04 threat display; user rating A11), not mid-attack
    const flag = cd.sting && cd.morph.startsWith('fire_') && a.state !== AS.Attack;
    out.gaster = Math.max(out.gaster, flag ? 1.15 : cd.sting ? 0.2 : 0.45);
    if (out.pose === POSE.NONE) out.pose = POSE.ALARM;
  }
  if (a.pose === POSE.STING) out.gaster = -0.9;
  armyAnt(w, a, out);
  out.glue = a.state === AS.Dead ? 0 : glueOf(w, a);
  // on a creature (climbing.ts): the renderer puts it on the animated leg or back
  const up = a.state === AS.Climb && (a.ridePh ?? 0) >= 1;
  out.rideCr = up ? a.rideId : 0;
  out.ridePh = up ? a.ridePh : 0;
  out.rideRail = a.rideRail ?? 0;
  out.rideSlot = a.rideSlot ?? 0;
  out.rideT = a.rideT ?? 0;
  meleeAttack(w, a, out);
  speciesExtras(w, a, out);
  termantLook(w, a, out);
  return out;
}

/** Termants (render only): ants of a stolen caste carry a faint amber tint (the team ring is drawn as for every unit). */
function termantLook(w: World, a: Ant, out: AntView): void {
  out.tint = 0;
  const c = w.colony(a.colony);
  if (isTermant(c) && casteOf(a.caste).species !== 'termant') out.tint = 1;
}

/**
 * Army ants (render only, from sim state): antennae always sweeping; the queen's physogastric gaster (a fixed
 * `queenSwell`: no phase cycle); a porter's load under the body (porter pose); a Soldier at its trail post rears up
 * with the mandibles open (guard pose); bridge links and pothole plugs.
 */
/**
 * Spraying formic acid (render only, from the sim's state time `st`): the gaster curls forward between the legs.
 * (overnight spec 3.3) It curls through the wind-up (combat.ts sprayUpdate's `wind`, by kind) and kicks back at the
 * shot: the Mortar rears and its legs soak up a big recoil after the lob; the Rapid Sprayer's spurts are quick small
 * pulses. Shared with the animation lab's `spray` clip.
 */
export function sprayPose(out: Pick<AntView, 'gaster' | 'pitch' | 'lift' | 'mandible' | 'antennaPitch'>, kind: string | undefined, st: number, len: number): void {
  const wind = kind === 'rapid' ? 0.05 : kind === 'lob' ? 0.5 : 0.45;
  const c = Math.min(1, st / wind);
  const curl = c * c * (3 - 2 * c);
  const after = st - wind;
  const kick = after > 0 ? Math.exp(-after * (kind === 'rapid' ? 40 : 9)) * Math.min(1, after * 60) : 0;
  out.gaster = -0.9 - 1.2 * curl + kick * (kind === 'lob' ? 0.55 : 0.25);
  out.pitch = -0.12 + (kind === 'lob' ? 0.16 : 0.06) * curl + kick * (kind === 'lob' ? 0.14 : 0.04);
  out.lift = Math.max(out.lift, kick * len * (kind === 'lob' ? 0.03 : 0.01));
  out.mandible = 0.6;
  out.antennaPitch = 0.4;
}

function armyAnt(w: World, a: Ant, out: AntView): void {
  // (overnight spec 3.4: the antennae drum on the aphid — fast)
  out.waveMul = a.state === AS.TendAphids ? 2.6 : undefined;
  out.carryUnder = undefined;
  const cd = casteOf(a.caste);
  if (cd.species !== 'eciton') return;
  out.waveMul = 1.6;
  if (a.state === AS.Dead) return;
  if (cd.role === 'queen') out.crop = ECITON.queenSwell;
  if (out.carrying && cd.porter) {
    out.carryUnder = true;
    if (out.pose === POSE.NONE || out.pose === POSE.CARRY) out.pose = POSE.PORTER;
  }
  if (a.pose === POSE.GUARD) {
    out.headPitch = 0.4;
    out.mandible = 0.9;
    out.antennaPitch = 0.5;
    out.antennaActivity = 1;
  } else if (a.state === AS.Raid) {
    out.antennaPitch = -0.3;
    out.antennaActivity = 0.9;
  }
  // a living bridge lies on the water (the ground under it is the puddle's bed); ants crossing walk on top of it
  const onBridge = a.state === AS.Bridge || (a.xing ?? 0) !== 0;
  if (onBridge && a.space === SURFACE) {
    const t = w.terrain;
    out.lift = Math.max(out.lift, t.waterAt(a.x, a.y) - t.walkHeight(a.x, a.y) + ((a.xing ?? 0) !== 0 ? cd.length * 0.12 : 0));
  }
  if (a.state === AS.Bridge || a.state === AS.Plug) {
    out.antennaActivity = 0.2;
    out.mandible = 0.5;
    out.headPitch = a.state === AS.Plug ? -0.2 : 0;
  }
}

/** Render hints for the new species: termite animation states, the Saiy-Ant gold, prey in a hell ant's jaws. */
function speciesExtras(w: World, a: Ant, out: AntView): void {
  const cd = casteOf(a.caste);
  out.gold = undefined;
  out.tState = undefined;
  out.firing = false;
  out.aimX = out.aimY = undefined;
  if (cd.surge) {
    const S = BALANCE.surge;
    const t = a.surgeT ?? 0;
    const dur = a.level >= 3 ? S.durationL3 : S.duration;
    if (t > 0) {
      // ripple in from the head (with a small overshoot), out from the gaster
      out.gold = t > dur - S.rampIn ? Math.min(1, ((dur - t) / S.rampIn) * 1.08) : t < S.rampOut ? t / S.rampOut : 1;
      out.goldDir = t < S.rampOut ? -1 : 1;
      out.exhausted = 0;
      if (dur - t < 0.25) out.roll += Math.sin(w.time * 40 + a.id) * 0.08; // the shiver as the ripple passes
      out.antennaPitch -= 0.3;
    } else {
      const cdn = a.level >= 2 ? S.cooldownL2 : S.cooldown;
      out.gold = 0;
      out.exhausted = (a.surgeCd ?? 0) > 0 ? Math.min(1, (a.surgeCd ?? 0) / cdn) : 0;
      out.antennaPitch -= out.exhausted * 0.5;
    }
  }
  out.snap = false;
  out.held = 0;
  out.acid = 0;
  out.aimZ = undefined;
  out.holding = false;
  const holder = a.heldBy ? w.antById.get(a.heldBy) : undefined;
  if (holder && isSickle(holder)) {
    // hooked in a sickle-jaw's mandibles: held level, struggling (legs flailing, body twisting), acid building up
    const k = sickleRampFraction(holder);
    out.acid = a.state === AS.Dead ? 0 : 0.1 + 0.9 * k;
    out.held = a.state === AS.Dead ? 0 : 0.35 + 0.65 * Math.max(0, Math.min(1, a.hp / Math.max(1, a.maxHp)));
    if (!cd.termite && a.state !== AS.Dead) {
      const sv = victimStruggle(w.time, (holder.id * 0.37) % 1, out.held);
      out.roll = sv.roll;
      out.pitch = sv.pitch;
      out.headYaw = sv.yaw * 2;
      out.lift = Math.max(out.lift, sv.lift * cd.length * 0.3);
      out.mandible = Math.max(out.mandible, sv.mandible + 0.3);
      out.antennaActivity = 1;
      out.pose = POSE.GRAPPLE;
    }
  } else if (a.heldBy) {
    // pinned in a hell ant's jaws: lifted off the ground at the socket, hanging nose-down, legs flailing
    const h = w.antById.get(a.heldBy);
    out.lift = Math.max(out.lift, (h ? casteOf(h.caste).length : cd.length) * 0.35);
    if (a.state !== AS.Dead) {
      out.roll = Math.sin(w.time * 20 + a.id) * 0.35;
      out.pose = POSE.GRAPPLE;
    }
    out.pitch = -0.6;
  }
  if (cd.snap) hellPosture(a, out, cd.length);
  if (!cd.termite) return;
  // ---- termites (model kit animation states)
  out.variant = a.variant;
  out.tan = 1;
  out.tCarry = a.carry === Carry.Brood ? TCarry.EGG : a.carry !== Carry.None && a.carry !== Carry.Soil ? (w.foodById.get(a.carryId)?.from === 'litterchip' ? TCarry.LEAF : TCarry.WOOD) : TCarry.NONE;
  out.ramp = cd.termite === 'sickle' ? sickleRampFraction(a) : rampFraction(a);
  const climbing = a.state === AS.Climb && (a.ridePh === 1 || a.ridePh === 3);
  const moving = a.v > 0.3 || climbing;
  let st: number = moving ? AnimState.WALK : AnimState.IDLE;
  let sp = -1;
  if (a.state === AS.Dead) {
    st = AnimState.DEATH;
    out.tStateT = Math.min(1, a.deadT / 1.2);
  } else if (cd.termite === 'queen') {
    st = AnimState.QUEEN;
    // the egg slides out of her tip as a worker pulls it (sim/jobs.ts); then the worker carries it away
    out.tStateT = queenPull(w, a.id);
  } else if (cd.termite === 'king' && !moving && out.atk === undefined && a.pose !== POSE.ALARM && attendPoint(w, a, out)) {
    // beside his queen: antennae tapping her, grooming her now and then (kit v2.1 ATTEND)
    st = AnimState.ATTEND;
  } else if (out.held) {
    // a termite hooked by an enemy sickle-jaw: STRUGGLE (fading as it weakens)
    st = AnimState.STRUGGLE;
  } else if (a.age < NASUTE.settleSec && cd.termite !== 'king') {
    // just matured from the brood tile: the settle, soldiers tanning from presoldier-pale
    st = AnimState.SETTLE;
    out.tStateT = a.age / NASUTE.settleSec;
    if (cd.termite === 'nasute' || cd.termite === 'major' || cd.termite === 'sickle') out.tan = out.tStateT;
  } else if (cd.termite === 'sickle' && (sp = sicklePose(w, a, out, moving)) >= 0) {
    // the grab-and-squirt, the alarm, the escort
    st = sp;
  }
  else if (cd.termite === 'nasute' && ((a.state === AS.Attack && a.tgt) || (a.state === AS.Climb && a.ridePh === 2))) {
    st = moving ? AnimState.WALK : AnimState.FIRE;
    out.firing = (a.fire ?? 0) > 0;
    const t = a.tk === 3 ? w.antById.get(a.tgt) : a.tk === 4 ? w.creatureById.get(a.tgt) : undefined;
    if (t) {
      out.aimX = t.x;
      out.aimY = t.y;
    }
  } else if (cd.termite === 'major' && (a.chT ?? 0) > 0) st = AnimState.CHARGE;
  else if (cd.termite === 'major' && (a.alCd ?? 0) > NASUTE.majorAlarm.cooldownSec - 1) st = AnimState.ALARM;
  else if (out.atk !== undefined) st = cd.termite === 'major' ? AnimState.RAM : AnimState.BITE;
  else if (a.state === AS.Collect) st = AnimState.CHEW;
  else if (a.state === AS.Dig) st = AnimState.DIG;
  else if (a.state === AS.Groom || a.state === AS.Troph || a.pose === POSE.GROOM_ANT) st = AnimState.GROOM;
  out.tState = st;
  out.tRate =
    st === AnimState.CHEW
      ? 1 / NASUTE.wood.biteIntervalSec
      : (st === AnimState.RAM || st === AnimState.BITE) && out.atkGap
        ? 1 / out.atkGap
        : st === AnimState.GROOM
          ? 1.2
          : st === AnimState.DIG
            ? 1.5
            : st === AnimState.ALARM
              ? 6
              : st === AnimState.STRUGGLE
                ? 1
                : 0;
  if (st !== AnimState.DEATH && st !== AnimState.QUEEN && st !== AnimState.SETTLE && st !== AnimState.LUNGE) out.tStateT = 0;
}

/**
 * Sickle-Jaw soldier render state (kit v2 wiring, claude/sickle-jaw-termites/kit/README.md):
 *  - lunge (sim Snap): LUNGE, stateT = elapsed / LUNGE_SEC; the sim grabs 6 ticks in (stateT 0.55) and the
 *    render keeps LUNGE until stateT reaches LUNGE_SNAP + 0.16, where its pose equals HOLD;
 *  - hold: HOLD with the ramp and the squirt, the head aimed at the victim's back (aimX/Y/Z);
 *  - a target too big to grab, in range: HOLD (the planted squirt pose) aimed at it; closing in: RUSH;
 *  - alerted and on the way: RUSH; drumming the alarm: ALARM; holding an escort slot: THREAT.
 * Returns the AnimState, or -1 to fall through to the shared termite states.
 */
function sicklePose(w: World, a: Ant, out: AntView, moving: boolean): number {
  const H = BALANCE.tickHz;
  if (a.state === AS.Snap) {
    out.tStateT = Math.min(1, a.st / LUNGE_SEC);
    out.holding = true;
    aimAt(w, a.tk, a.tgt, out);
    return AnimState.LUNGE;
  }
  if (a.state === AS.Hold) {
    const since = LUNGE_TICKS / H + a.st; // seconds since the lunge started
    out.firing = true;
    out.holding = true;
    aimAt(w, a.holdKind ?? 0, a.holdId ?? 0, out);
    if (since / LUNGE_SEC < LUNGE_SNAP + 0.16) {
      out.tStateT = since / LUNGE_SEC;
      return AnimState.LUNGE;
    }
    return AnimState.HOLD;
  }
  if (a.state === AS.Attack && a.tgt) {
    if (moving) return AnimState.RUSH;
    out.firing = (a.fire ?? 0) > 0;
    if (out.firing) {
      aimAt(w, a.tk, a.tgt, out, a);
      return AnimState.HOLD;
    }
    return AnimState.THREAT;
  }
  if ((a.alCd ?? 0) > SICKLE.alarm.cooldownSec - 1 && !moving) return AnimState.ALARM;
  if ((a.alertUntil ?? 0) > w.s.tick && moving) return AnimState.RUSH;
  if (a.state === AS.Rally && !moving) return AnimState.THREAT;
  return -1;
}

/**
 * Aim point for the squirt (plane x/y plus height in mm): a held victim's back; for a free target (`from` = the
 * squirting soldier) the near side of its body, so the jet is a short point-blank squirt, never a long shot to
 * the middle of a big creature.
 */
function aimAt(w: World, kind: number, id: number, out: AntView, from?: Ant): void {
  if (kind === 3) {
    const o = w.antById.get(id);
    if (!o) return;
    const L = casteOf(o.caste).length;
    out.aimX = o.x;
    out.aimY = o.y;
    out.aimZ = L * 0.22;
    if (from) {
      const d = Math.hypot(from.x - o.x, from.y - o.y) || 1;
      const k = Math.min(d * 0.9, L * 0.3) / d;
      out.aimX = o.x + (from.x - o.x) * k;
      out.aimY = o.y + (from.y - o.y) * k;
    }
  } else if (kind === 4) {
    const cr = w.creatureById.get(id);
    if (!cr) return;
    out.aimX = cr.x;
    out.aimY = cr.y;
    out.aimZ = cr.scale * 0.25;
    if (from) {
      // nearest point of its body capsule, a little inside the outline
      const b = bodyHook.body(cr);
      const c = Math.cos(cr.h);
      const sn = Math.sin(cr.h);
      const dx = from.x - cr.x;
      const dy = from.y - cr.y;
      const lx = Math.max(-b.hl, Math.min(b.hl, dx * c + dy * sn));
      const ex = cr.x + c * lx;
      const ey = cr.y + sn * lx;
      const d = Math.hypot(from.x - ex, from.y - ey) || 1;
      const r = Math.min(d * 0.9, b.r * 0.85);
      out.aimX = ex + ((from.x - ex) / d) * r;
      out.aimY = ey + ((from.y - ey) / d) * r;
      out.aimZ = Math.min(out.aimZ, b.r * 0.8);
    }
  }
}

/** Egg-pull progress (0..1) at each queen's tip this tick: the furthest along of the workers pulling from her. */
const pulls = new Map<number, number>();
let pullsTick = -1;
let pullsWorld: World | null = null;

function queenPull(w: World, id: number): number {
  if (pullsTick !== w.s.tick || pullsWorld !== w) {
    pullsTick = w.s.tick;
    pullsWorld = w;
    pulls.clear();
    for (const a of w.s.ants) {
      if (a.state !== AS.TendQueen || a.carry !== Carry.None || a.v > 0) continue;
      const c = w.colony(a.colony);
      if (!c || c.eggs <= 0) continue;
      const k = Math.min(1, a.st / BALANCE.eggPullSec);
      if (k > (pulls.get(c.queen) ?? 0)) pulls.set(c.queen, k);
    }
  }
  return pulls.get(id) ?? 0;
}

/** The termite king's ATTEND target: the nearest point on his queen's abdomen (false when she is not beside him). */
function attendPoint(w: World, a: Ant, out: AntView): boolean {
  const c = w.colony(a.colony);
  const q = c && c.king === a.id ? w.antById.get(c.queen) : undefined;
  if (!q || q.state === AS.Dead || q.space !== a.space) return false;
  queenBody(q, qb);
  const dx = qb.bx - qb.ax;
  const dy = qb.by - qb.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((a.x - qb.ax) * dx + (a.y - qb.ay) * dy) / l2)) : 0;
  const px = qb.ax + dx * t;
  const py = qb.ay + dy * t;
  if (Math.hypot(px - a.x, py - a.y) > qb.r + casteOf(a.caste).length * 1.2) return false;
  out.aimX = px;
  out.aimY = py;
  return true;
}
const qb = { ax: 0, ay: 0, bx: 0, by: 0, r: 0 };

/** Hell ants: the mandibles' posture (hell-ant implementation plan, step 3). */
function hellPosture(a: Ant, out: AntView, L: number): void {
  switch (a.state) {
    case AS.Dead:
      out.mandible = 0.5; // relaxed open
      return;
    case AS.Hunt:
      // stalking: jaws fully cocked, head down, antennae busy, body lowered
      out.mandible = 1;
      out.headPitch = -0.45;
      out.antennaActivity = 1;
      out.pitch = -0.06;
      out.lift -= 0.08 * L;
      return;
    case AS.Snap:
      out.mandible = 0;
      out.snap = true; // an instant close
      out.headPitch = -0.3;
      return;
    case AS.Hold:
      out.mandible = 0;
      out.snap = a.st < 0.15;
      out.headPitch = -0.2;
      return;
  }
  if (out.carrying) {
    out.mandible = 0.05; // food clamped between the jaws and the horn
    return;
  }
  if ((a.state === AS.Attack || a.state === AS.Grapple) && (a.snapCd ?? 0) <= 0) {
    out.mandible = 1;
    return;
  }
  // idle and walking: the loose C below the horn, face down
  out.mandible = Math.max(out.mandible, 0.25);
  out.headPitch -= 0.25;
}

/** Ant corpses lying on the ground (food items made from dead ants). */
export function corpseToView(f: Food, out: AntView, space: number, morph: string): AntView {
  // (the dead ant's own id: its death animation carries on through the hand-over to a corpse — spec 04)
  out.id = f.v > 0 ? f.v : -f.id;
  out.cause = f.cause ?? 0;
  // its gloss fades as it dries, over the time it lies there
  out.dry = Math.min(1, f.age / Math.max(2, f.sinkAt ?? 2));
  out.morph = morph;
  out.space = space;
  out.x = f.x;
  out.y = f.y;
  out.px = f.px;
  out.py = f.py;
  out.heading = f.h;
  out.pheading = f.h;
  out.dead = true;
  out.carrying = false;
  out.hp = undefined;
  out.flung = false;
  out.heldCr = 0;
  out.sizeVar = 0;
  out.scale = 1;
  out.colorVar = -0.3;
  out.lift = f.heldBy ? 1.2 : 0;
  // its time is up: sinking into the ground (then the food item is deleted)
  if (f.sinkAt !== undefined && f.age > f.sinkAt && !f.heldBy) {
    const k = Math.min(1, (f.age - f.sinkAt) / BALANCE.corpse.sink);
    // (deep enough that a corpse on its back, its legs splayed, is gone: user rating A9)
    out.lift = -k * Math.max(2, f.size);
    out.colorVar = -0.3 - k * 0.5;
  }
  out.roll = 0;
  out.pitch = 0;
  out.selected = false;
  out.pose = 0;
  out.headYaw = 0;
  out.headPitch = 0;
  out.gaster = 0;
  out.mandible = 0.2;
  out.antennaPitch = -0.5;
  out.antennaActivity = 0;
  out.tState = undefined;
  out.snap = false;
  out.glue = 0;
  out.atk = undefined;
  out.tStateT = 1;
  out.gold = 0;
  out.exhausted = 0;
  return out;
}

/**
 * Termite brood on its tile, drawn with the model kit (render only): a
 * wriggling larva that grows from 0.27 to 0.66 of its mesh (sickle-jaws 0.3 → 0.85); soldier brood
 * shows as a pale, untanned presoldier for the final part of its growth.
 */
export function termiteBroodToView(b: Brood, out: AntView, space: number): AntView {
  const cd = casteOf(b.caste);
  const soldier = cd.termite === 'nasute' || cd.termite === 'major' || cd.termite === 'sickle';
  const rhy = cd.species === 'rhynchotermes';
  const preFrac = rhy ? SICKLE.presoldierFraction : NASUTE.presoldierFraction;
  const pre = soldier && b.t >= 1 - preFrac;
  out.id = -(2_000_000 + b.id);
  out.morph = pre ? cd.morph : rhy ? 'termite_rhy_larva' : 'termite_larva';
  out.space = space;
  out.x = out.px = b.x;
  out.y = out.py = b.y;
  out.heading = out.pheading = (b.id * 2.399) % (Math.PI * 2);
  out.dead = false;
  out.carrying = false;
  out.crop = 0;
  out.sizeVar = 0;
  out.colorVar = 0;
  out.lift = 0;
  out.roll = 0;
  out.pitch = 0;
  out.selected = false;
  out.pose = 0;
  out.glue = 0;
  out.atk = undefined;
  out.gold = undefined;
  out.variant = 0;
  out.tCarry = TCarry.NONE;
  out.ramp = 0;
  out.firing = false;
  out.aimX = out.aimY = undefined;
  if (pre) {
    out.scale = 0.92;
    out.tan = 0;
    out.tState = AnimState.IDLE;
    out.tRate = 0;
  } else {
    // kit v2.2: the nasute larva is built at 5.5 mm but the worker is now 4.2 mm, so it grows 0.27 → 0.66
    out.scale = (rhy ? 0.3 : 0.27) + (rhy ? 0.55 : 0.39) * Math.min(1, b.t / (soldier ? 1 - preFrac : 1));
    out.tan = 1;
    out.tState = AnimState.WRIGGLE;
    out.tRate = 1.1 + ((b.id * 0.37) % 0.4);
  }
  out.tStateT = 0;
  return out;
}

export function blankView(): AntView {
  return {
    id: 0,
    morph: '',
    space: 0,
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    heading: 0,
    pheading: 0,
    pose: 0,
    mandible: 0,
    antennaPitch: 0,
    antennaActivity: 0,
    gaster: 0,
    headPitch: 0,
    headYaw: 0,
    dead: false,
    carrying: false,
    crop: 0,
    sizeVar: 0,
    colorVar: 0,
    lift: 0,
    roll: 0,
    pitch: 0,
    selected: false,
  };
}

export { SURFACE };
