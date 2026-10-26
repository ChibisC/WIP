import { AreaTab, GameSession } from '../game/session';
import { SPECIES } from '../sim/species';
import { MAX_AREAS } from '../sim/areas';
import { el, esc } from './dom';
import { ICONS } from './icons';

const KIND_ICON = { home: ICONS.home, enemy: ICONS.attack, allied: ICONS.ally, neutral: ICONS.cave };

/**
 * Underground-area tabs (DESIGN 5): a horizontal row of numbered tabs along
 * the top of the bottom-left minimaps, one per area of the level in its area
 * colour (1 = home). Clicking a tab shows that area in the main view (from
 * the surface it dives in through the area's entrance); Shift + 1–6 do the same.
 * A tab works only while your ants (or allies) are inside that area —
 * otherwise it is greyed with "No ants in this area" — and pulses when it
 * opens. Alert badges flag attacks and a hurt queen even while you look
 * elsewhere.
 */
export class AreaTabs {
  root = el('div', 'at');
  private tabs: HTMLButtonElement[] = [];
  private wasOpen: boolean[] = [];

  constructor(private s: GameSession) {
    for (let i = 0; i < MAX_AREAS; i++) {
      const b = el('button', 'at-tab', `<span class="at-n">${i + 1}</span><span class="at-k"></span><span class="at-badge">!</span>`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = s.areaTabs()[i];
        if (t) s.showArea(t.space);
      });
      this.root.appendChild(b);
      this.tabs.push(b);
    }
  }

  private tip(t: AreaTab): string {
    const w = this.s.world;
    const oc = t.owner >= 0 ? w.colony(t.owner) : undefined;
    const sp = oc ? SPECIES[oc.species] : undefined;
    const who = sp ? `${esc(sp.common)} — <i>${esc(sp.scientific)}</i><br>` : '';
    const key = `<span class="k">F${t.number}</span>`;
    if (t.kind === 'home') return `<b>Area 1 · Your nest</b>${who}Always open. Click to look underground ${key}.`;
    const state = t.open ? `${t.ants} of your ants${t.kind === 'allied' ? ' and allies' : ''} inside. Click to look ${key}.` : 'No ants in this area.<br>Place a marker on its entrance on the surface to send a group in.';
    return `<b>Area ${t.number} · ${esc(t.name)}</b>${who}${t.alive ? '' : 'Fallen. '}${state}`;
  }

  update(): void {
    const s = this.s;
    const tabs = s.areaTabs();
    this.tabs.forEach((b, i) => {
      const t = tabs[i];
      b.style.display = t ? '' : 'none';
      if (!t) return;
      b.style.setProperty('--ac', t.color);
      const k = b.querySelector('.at-k') as HTMLElement;
      if (k.dataset.kind !== t.kind) {
        k.dataset.kind = t.kind;
        k.innerHTML = KIND_ICON[t.kind];
      }
      b.classList.toggle('on', s.view.space === 'nest' && s.viewedArea === t.space);
      b.classList.toggle('shut', !t.open);
      b.classList.toggle('dead', !t.alive);
      b.classList.toggle('alert', t.alertAge < 8);
      // pulse when an area newly opens
      if (this.wasOpen[i] === false && t.open) {
        b.classList.remove('pulse');
        void b.offsetWidth;
        b.classList.add('pulse');
      }
      this.wasOpen[i] = t.open;
      const tip = this.tip(t);
      if (b.dataset.tip !== tip) b.dataset.tip = tip;
    });
  }
}
