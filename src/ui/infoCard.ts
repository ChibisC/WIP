import { GameSession } from '../game/session';
import { CASTES, SPECIES } from '../sim/species';
import { AS, SURFACE } from '../sim/types';
import { JOB_NAMES } from '../sim/jobs';
import { BALANCE } from '../sim/balance';
import { button, el, esc, shield } from './dom';
import { ICONS } from './icons';
import { isTermant, stolenOf } from '../sim/termants';
import { arenaOf } from '../sim/arenaState';
import { TEAM_NAMES } from '../sim/arena';
import { TEAM_COLORS } from '../render/game/teamRings';

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
  }
  if (carrying) return 'Carrying food home';
  const t: Record<string, string> = { forage: 'Foraging', dig: 'Digging', nurse: 'Nursing brood', haul: 'Hauling', garden: 'Tending the fungus garden', guard: 'Guarding the nest', marker: 'At a marker', idle: 'Resting' };
  return t[task] ?? 'Resting';
}

/** Card for the inspected ant: species, caste, colony, health, activity and a real fact. */
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
    const title = stolen ? `${esc(stolen.name)} — ${esc(sp.common)} ${esc(cd.name.toLowerCase())}` : `${esc(sp.common)} — ${esc(cd.name)}`;
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
