import { GameSession } from '../game/session';
import { SimEvent } from '../core/events';
import { CREATURES } from '../sim/creatures/kinds';
import { climbCap } from '../sim/creatures/climb';
import { mountBonus } from '../sim/combat';
import { BALANCE } from '../sim/balance';
import { el } from './dom';

/**
 * The boss health bar (Phase 11): top centre while a boss is alive in the
 * space you are looking at — its name, Latin name, health and the phase it
 * has reached (the phase names come from the simulation's bossPhase events).
 */
export class BossBar {
  readonly root = el('div', 'pnl boss-bar');
  private name = el('div', 'boss-name sc');
  private sci = el('div', 'boss-sci');
  private fill = el('i');
  private phase = el('div', 'boss-phase');
  private riders = el('div', 'boss-riders');
  private phaseNames = new Map<number, string>();
  private shown = -1;

  constructor(private s: GameSession) {
    const hp = el('div', 'boss-hp');
    hp.appendChild(this.fill);
    const head = el('div', 'boss-head');
    head.append(this.name, this.sci, this.riders);
    this.root.append(head, hp, this.phase);
  }

  event(e: SimEvent): void {
    if (e.t === 'bossPhase') this.phaseNames.set(e.creature, e.name);
  }

  update(): void {
    const s = this.s;
    const space = s.activeSpace();
    let boss = null;
    for (const cr of s.world.s.creatures) {
      if (cr.dead || cr.space !== space || !CREATURES[cr.kind]?.boss) continue;
      boss = cr;
      break;
    }
    this.root.classList.toggle('show', !!boss);
    if (!boss) {
      this.shown = -1;
      return;
    }
    const k = CREATURES[boss.kind];
    if (this.shown !== boss.id) {
      this.shown = boss.id;
      this.name.textContent = k.name;
      this.sci.textContent = k.sci;
    }
    const f = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
    const w = (f * 100).toFixed(1) + '%';
    if (this.fill.style.width !== w) this.fill.style.width = w;
    // ants on it / its mount cap, and the mount bonus (CHANGE_PLAN §16): enough riders and it takes more damage
    const cap = climbCap(boss);
    const bonus = mountBonus(boss);
    const r = cap > 0 ? `${boss.climbers ?? 0}/${cap} riding${bonus ? ` · +${Math.round((BALANCE.mount.bonusMul - 1) * 100)} % damage` : ''}` : '';
    if (this.riders.textContent !== r) this.riders.textContent = r;
    this.riders.classList.toggle('bonus', bonus);
    const ph = this.phaseNames.get(boss.id) ?? '';
    if (this.phase.textContent !== ph) this.phase.textContent = ph;
    this.root.classList.toggle('enraged', boss.phase > 0);
  }
}
