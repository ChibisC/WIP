import { GameSession } from '../game/session';
import { CASTES, SPECIES } from '../sim/species';
import { AS, SURFACE } from '../sim/types';
import { JOB_NAMES } from '../sim/jobs';
import { BALANCE } from '../sim/balance';
import { button, el, esc, shield } from './dom';
import { ICONS } from './icons';
import { isTermant, stolenName, stolenOf } from '../sim/termants';
import { arenaOf } from '../sim/arenaState';
import { TEAM_NAMES } from '../sim/arena';
import { TEAM_COLORS } from '../render/game/teamRings';
import { CREATURES, stagMaleGeom } from '../sim/creatures/kinds';
import { CS } from '../sim/creatures/creatureAI';
import { STAG_MALE } from '../sim/balance';
import type { Creature } from '../sim/types';

/** What a creature is doing, in plain words (its state). */
function creatureActivity(cr: Creature): string {
  if ((cr.data.raid ?? 0) > 0) return 'Raiding a nest';
  switch (cr.state) {
    case CS.Chase:
      return 'Closing in';
    case CS.Attack:
    case CS.WindUp:
    case CS.Strike:
    case CS.Pounce:
    case CS.Leap:
    case CS.Coil:
    case CS.Whip:
    case CS.Flick:
      return 'Attacking';
    case CS.Lift:
      return 'Lifting ants in its antlers';
    case CS.Rear:
      return 'Rearing up';
    case CS.Eat:
      return 'Eating its catch';
    case CS.Flee:
      return 'Fleeing';
    case CS.Hide:
      return 'Hiding';
    case CS.Rolled:
      return 'Rolled into a ball';
    case CS.Curled:
      return 'Curled up';
    case CS.Freeze:
    case CS.Lurk:
      return 'Lying in wait';
    case CS.Display:
      return 'Displaying';
    case CS.Dig:
      return 'Digging into a nest';
    case CS.Spar:
      return 'Squaring up to a rival male';
    case CS.Lock:
      return 'Wrestling a rival, antlers locked';
    case CS.Heave:
      return 'Throwing its rival';
    case CS.Thrown:
      return 'Thrown by a rival';
  }
  return 'Wandering';
}

const MALE_SIZE = ['Minor', 'Small', 'Medium', 'Large', 'Major'];

/**
 * Card for an inspected creature: its kind, team, health, what it is doing and its facts (the stag beetles' male size
 * and antler length, which vary hugely with how well each fed as a larva).
 */
function creatureCard(s: GameSession, cr: Creature): string {
  const k = CREATURES[cr.kind];
  const arenaI = cr.faction >= 0 ? (arenaOf(s.world)?.teams.findIndex((t) => t.colony === cr.faction) ?? -1) : -1;
  const own = cr.faction >= 0 ? s.world.colony(cr.faction) : undefined;
  const who = arenaI >= 0 ? `<i class="ic-team" style="background:${TEAM_COLORS[arenaI]}"></i>${TEAM_NAMES[arenaI]}` : own ? esc(own.name) : k.boss ? 'Boss' : 'Wild';
  const hp = Math.max(0, cr.hp / cr.maxHp);
  const where = cr.space === SURFACE ? 'Surface' : 'Underground';
  // a stag beetle: its male size and how long its antlers are for its body
  const g = stagMaleGeom(cr.kind);
  const msize = g ? g.msize : k.ai === 'stag' ? 1 : -1;
  const share = g ? g.share : STAG_MALE.model.share0 + STAG_MALE.model.shareK;
  const male = msize >= 0 ? `<div class="ic-row"><span>Male size</span><b>${MALE_SIZE[Math.round(msize * 4)]}${k.boss ? ' (boss)' : ''} · antlers ${Math.round(share * 100)} % of its length</b></div>` : '';
  return `<div class="ic-name">${esc(k.name)}</div><div class="ic-sci">${esc(k.sci)}</div>
      <div class="ic-row"><span>${arenaI >= 0 ? 'Team' : 'Creature'}</span><b>${who}</b></div>
      <div class="ic-row"><span>Where</span><b>${where}</b></div>
      <div class="ic-row"><span>Size</span><b>${k.length} mm · armour ${k.armor} · bite ${k.bite}</b></div>${male}
      <div class="ic-row"><span>Doing</span><b>${esc(creatureActivity(cr))}</b></div>
      <div class="ic-row"><span>Health</span><b>${Math.ceil(cr.hp)} / ${Math.round(cr.maxHp)}</b></div>
      <div class="hpbar"><i style="width:${(hp * 100).toFixed(0)}%"></i></div>
      <div class="ic-fact">${esc(k.role)}</div>${k.facts.map((f) => `<div class="ic-fact">${esc(f)}</div>`).join('')}`;
}

/** What an ant is doing, in plain words. */
function activity(task: string, state: AS, carrying: boolean, jobK = 0, held = false, impaler = false): string {
  if (held) return 'Caught in a trap-jaw';
  if (task === 'job' && jobK && JOB_NAMES[jobK]) return JOB_NAMES[jobK];
  switch (state) {
    case AS.Hunt:
      return 'Stalking prey';
    case AS.Snap:
      return 'Snapping!';
    case AS.Hold:
      return impaler ? 'Impaling prey' : 'Pinning prey';
    case AS.Attack:
    case AS.Grapple:
      return 'Fighting';
    case AS.Spray:
      return 'Spraying formic acid';
    case AS.Dig:
      return 'Digging';
    case AS.HaulSpoil:
      return 'Carrying soil out';
    case AS.FeedLarva:
      return 'Feeding a larva';
    case AS.CarryBrood:
      return 'Carrying brood to its tile';
    case AS.TendQueen:
      return 'Tending the queen';
    case AS.Troph:
      return 'Sharing food mouth-to-mouth (trophallaxis)';
    case AS.Groom:
      return 'Grooming';
    case AS.FollowTrail:
      return 'Following a pheromone trail';
    case AS.Scout:
      return 'Scouting for food';
    case AS.Climb:
      return 'Climbing an enemy';
    case AS.Necro:
      return 'Carrying a dead nestmate out';
    case AS.Flung:
      return 'Thrown!';
    // (a flooding nest: sim/nestFlood.ts — climbing ahead of the water, fetching brood up)
    case AS.Flee:
      return 'Escaping the rising water';
  }
  if (carrying) return 'Carrying food home';
  const t: Record<string, string> = { forage: 'Foraging', dig: 'Digging', nurse: 'Nursing brood', haul: 'Hauling', garden: 'Tending the fungus garden', guard: 'Guarding the nest', marker: 'At a marker', idle: 'Resting' };
  return t[task] ?? 'Resting';
}

/** Card for the inspected ant (species, caste, colony, health, activity and a real fact) or creature (creatureCard). */
export class InfoCard {
  root = el('div', 'pnl icard');
  private body = el('div');
  private followBtn: HTMLButtonElement;

  constructor(private s: GameSession) {
    const x = button('sm ic-x', ICONS.close, 'Close', () => (s.inspect = null));
    this.followBtn = button('ic-follow', `${ICONS.eye}<span>Follow</span>`, '<b>Observe</b>Follow this ant with a close-up camera. <span class="k">O</span> · <span class="k">Esc</span> to stop.', () => {
      if (s.inspect?.kind === 'ant') s.follow(s.inspect.id);
    });
    this.root.append(x, this.body, this.followBtn);
    shield(this.root);
  }

  update(): void {
    const s = this.s;
    const ins = s.inspect;
    // a creature: its own card (no follow camera)
    const cr = ins?.kind === 'creature' ? s.world.creatureById.get(ins.id) : undefined;
    if (cr && !cr.dead && CREATURES[cr.kind]) {
      this.root.classList.add('show');
      const html = creatureCard(s, cr);
      if (this.body.innerHTML !== html) this.body.innerHTML = html;
      this.followBtn.style.display = 'none';
      return;
    }
    this.followBtn.style.display = '';
    const a = ins?.kind === 'ant' ? s.world.antById.get(ins.id) : undefined;
    if (!a || a.state === AS.Dead) {
      if (ins) s.inspect = null;
      this.root.classList.remove('show');
      return;
    }
    this.root.classList.add('show');
    const cd = CASTES[a.caste];
    const sp = SPECIES[cd.species];
    const col = s.world.colony(a.colony)!;
    const mine = col.id === s.player.id;
    const hp = Math.max(0, a.hp / a.maxHp);
    const level = Math.max(1, Math.min(3, a.level || 1));
    const pips = '●'.repeat(level) + '○'.repeat(3 - level);
    const ally = !mine && col.team === s.player.team;
    const tab = a.space === SURFACE ? null : s.areaTab(a.space);
    const where = a.space === SURFACE ? 'Surface' : tab ? `Area ${tab.number} · ${tab.kind === 'home' ? 'your nest' : tab.name}` : 'Underground';
    const lost = (a.lostT ?? 0) > 0 ? `<div class="ic-row ic-warn"><span>Cut off</span><b>No route to its queen · ${Math.max(0, Math.ceil(BALANCE.lostDeathTime - a.lostT))} s</b></div>` : '';
    // Termants: a stolen caste is the source species' own ant, raised by the Termant queen
    // battle arena: the unit's team
    const arenaI = arenaOf(s.world)?.teams.findIndex((t) => t.colony === col.id) ?? -1;
    const stolen = isTermant(col) && cd.species !== 'termant' ? stolenOf(a.caste) : undefined;
    const title = stolen ? `${esc(stolenName(stolen))}` : `${esc(sp.common)} — ${esc(cd.name)}`;
    const extra =
      (stolen ? `<div class="ic-row"><span>Stolen caste</span><b>Raised by ${esc(SPECIES.termant.common)} from ${esc(sp.common)} genes</b></div>` : '') +
      ((a.glueT ?? 0) > s.world.s.tick ? `<div class="ic-row ic-warn"><span>Glued</span><b>Slowed · formic acid hurts double</b></div>` : '');
    const html = `<div class="ic-name">${title} <span class="ic-pips" title="Tile level ${level}">${pips}</span></div><div class="ic-sci">${esc(sp.scientific)}${sp.fictional ? ' (fictional)' : ''}</div>
      <div class="ic-row"><span>${arenaI >= 0 ? 'Team' : 'Colony'}</span><b>${arenaI >= 0 ? `<i class="ic-team" style="background:${TEAM_COLORS[arenaI]}"></i>${TEAM_NAMES[arenaI]}` : mine ? 'Yours' : ally ? `Allied · ${esc(col.name)}` : esc(col.name)}</b></div>
      <div class="ic-row"><span>Where</span><b>${esc(where)}</b></div>${extra}
      <div class="ic-row"><span>Doing</span><b>${esc(activity(a.task, a.state, a.carry !== 0, a.jobK, !!a.heldBy, CASTES[a.caste]?.snap?.kind === 'impale'))}</b></div>${lost}
      <div class="ic-row"><span>Health</span><b>${Math.ceil(a.hp)} / ${Math.round(a.maxHp)}</b></div>
      <div class="hpbar"><i style="width:${(hp * 100).toFixed(0)}%"></i></div>
      <div class="ic-fact">${esc(cd.fact)}</div>`;
    if (this.body.innerHTML !== html) this.body.innerHTML = html;
    this.followBtn.classList.toggle('on', s.followId === a.id);
  }
}
