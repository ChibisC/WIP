import { GameSession } from '../game/session';
import { el } from './dom';
import { BALANCE } from '../sim/balance';

/**
 * Small health bars over the large creatures that can be mounted (CHANGE_PLAN
 * §15.2, §16) while they are hurt or carrying ants, with the riders counter
 * (ants on it / its cap) and the mount-bonus mark when enough are on it to
 * make it take more damage. The boss bar shows the same for bosses.
 */
export class CreatureBars {
  readonly root = el('div', 'cr-bars');
  private pool: Array<{ box: HTMLElement; fill: HTMLElement; count: HTMLElement; key: string }> = [];

  constructor(private s: GameSession) {}

  update(): void {
    const bars = this.s.creatureBars();
    while (this.pool.length < bars.length) {
      const box = el('div', 'cr-bar');
      const hp = el('div', 'cr-hp');
      const fill = el('i');
      hp.appendChild(fill);
      const count = el('div', 'cr-riders');
      box.append(hp, count);
      this.root.appendChild(box);
      this.pool.push({ box, fill, count, key: '' });
    }
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      const b = bars[i];
      if (!b) {
        if (p.box.style.display !== 'none') p.box.style.display = 'none';
        continue;
      }
      p.box.style.display = '';
      p.box.style.transform = `translate(${b.x.toFixed(0)}px, ${b.y.toFixed(0)}px) translate(-50%, -100%)`;
      const key = `${(b.hp * 100).toFixed(0)}|${b.riders}|${b.cap}|${b.bonus}`;
      if (key === p.key) continue;
      p.key = key;
      p.fill.style.width = (b.hp * 100).toFixed(0) + '%';
      // ants on it / most that can mount it; the bonus mark: it takes extra damage while that many ride
      p.count.textContent = `${b.riders}/${b.cap}`;
      p.count.classList.toggle('full', b.riders >= b.cap);
      p.count.classList.toggle('bonus', b.bonus);
      p.count.title = b.bonus ? `Mounted: takes ${Math.round((BALANCE.mount.bonusMul - 1) * 100)} % more damage` : '';
    }
  }
}
