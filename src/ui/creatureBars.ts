import { GameSession } from '../game/session';
import { el } from './dom';

/**
 * Small health bars over the large creatures that can be climbed (CHANGE_PLAN
 * §15.2) while they are hurt or carrying ants, with the riders counter: room
 * taken on its back / room there is (riders take room by size class). The
 * boss bar shows the same counter for bosses.
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
      const key = `${(b.hp * 100).toFixed(0)}|${b.riders}|${b.used}|${b.cap}`;
      if (key === p.key) continue;
      p.key = key;
      p.fill.style.width = (b.hp * 100).toFixed(0) + '%';
      // room taken on its back / room there is (bigger ants take more: a small worker 1, a soldier 2–3, an Atta major 4)
      p.count.textContent = `${b.used}/${b.cap}`;
      p.count.classList.toggle('full', b.used >= b.cap);
    }
  }
}
