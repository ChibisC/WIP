import { GameSession, casteTint } from '../game/session';
import { CASTES, basicCaste, resourceName } from '../sim/species';
import { ICONS, antSilhouette } from './icons';
import { TERMANT } from '../sim/balance';
import { button, el, esc, shield } from './dom';

/**
 * Top bar. Left: the Missions button with a row of view toggles (food view,
 * pheromone trails, creature info, hex grid, tile info overlay, help).
 * Right: food (current / max), workers and soldiers (active / max), Menu.
 */
export class TopBar {
  root = el('div');
  private left = el('div', 'tb-left');
  private right = el('div', 'tb-right');
  private food = el('div', 'res');
  private workers = el('div', 'res');
  private soldiers = el('div', 'res');
  /** Termants: stored wood (kept apart from food; digests slowly into food) */
  private wood = el('div', 'res');
  private toggles: Array<{ b: HTMLButtonElement; on: () => boolean }> = [];

  constructor(private s: GameSession, onMissions: () => void, onMenu: () => void, onHelp: () => void) {
    const big = el('div', 'tb-big');
    big.append(button('sc', 'Missions', '<b>Missions</b>Your objectives and progress.', onMissions));
    const tg = el('div', 'tb-toggles');
    const add = (icon: string, tip: string, on: () => boolean, flip: () => void) => {
      const b = button('sm', icon, tip, flip);
      tg.appendChild(b);
      this.toggles.push({ b, on });
    };
    add(ICONS.food, '<b>Food view</b>Highlight the food your colony can gather on the surface, and the stores in the nest.', () => s.foodView, () => (s.foodView = !s.foodView));
    add(ICONS.trail, '<b>Pheromone trails</b>Show your colony’s trails (cyan), alarm scent (red) and rival trails (amber). <span class="k">T</span>', () => s.pheroOn, () => s.setPhero(!s.pheroOn));
    add(ICONS.info, '<b>Creature info</b>Click any ant or creature to see what it is and what it is doing.', () => s.infoOn, () => (s.infoOn = !s.infoOn));
    add(ICONS.grid, '<b>Hex grid</b>Show the nest’s hex grid.', () => s.gridOn, () => s.setGrid(!s.gridOn));
    add(ICONS.tiles, '<b>Tile info</b>Show every tile’s level, upgrade points (have / need) and incubation progress.', () => s.tileOverlay, () => (s.tileOverlay = !s.tileOverlay));
    add(ICONS.help, '<b>Help</b>Controls and how to play.', () => false, onHelp);
    this.left.append(big, tg);
    this.food.dataset.tip =
      resourceName(s.player.species) === 'wood'
        ? '<b>Wood</b>Stored / storage capacity. Termites eat only wood: workers chew deadwood (twigs, branches, bamboo, palm fronds, logs, stumps) into fragments and carry them home. Wood pays for building, upgrading and growing larvae.'
        : '<b>Food</b>Stored / storage capacity. Queen tiles hold 10 each; food storage tiles 10 / 40 / 100 by level. Food pays for building, upgrading and growing larvae.';
    this.workers.dataset.tip = '<b>Workers</b>Active / maximum. The maximum is the capacity of your worker brood tiles (queen tiles raise nanitics). Workers dig, build and carry eggs, and gather food.';
    this.soldiers.dataset.tip = '<b>Soldiers</b>Active / maximum, from soldier and major brood tiles. Soldiers fight and guard but never do nest jobs.';
    this.wood.dataset.tip = `<b>Wood</b>Stored / most the colony can hold. Termant workers chew dead wood like termites; it is stored apart from food and digests slowly into food (half of it). Carton walls are built from wood.`;
    this.right.append(this.food, this.wood, this.workers, this.soldiers, button('sc', 'Menu', '<b>Menu</b>Pause, settings and controls. <span class="k">Esc</span>', onMenu));
    this.root.append(this.left, this.right);
    shield(this.left);
  }

  update(): void {
    const c = this.s.player;
    for (const t of this.toggles) t.b.classList.toggle('on', t.on());
    // the battle arena has no economy: no stores or head counts (its scoreboard shows the teams)
    if (this.s.arena) {
      for (const e of [this.food, this.wood, this.workers, this.soldiers]) e.style.display = 'none';
      return;
    }
    const fd = `${ICONS.food}<span class="cur">${Math.floor(c.food)}</span><span class="cap">/ ${c.foodCap}</span>`;
    if (this.food.innerHTML !== fd) this.food.innerHTML = fd;
    this.food.classList.toggle('full', c.food >= c.foodCap - 0.5);
    this.food.classList.toggle('low', c.food < 10);
    const termant = c.species === 'termant';
    this.wood.style.display = termant ? '' : 'none';
    if (termant) {
      const wd = `${ICONS.wood}<span class="cur">${Math.floor(c.wood ?? 0)}</span><span class="cap">/ ${TERMANT.wood.cap}</span>`;
      if (this.wood.innerHTML !== wd) this.wood.innerHTML = wd;
      this.wood.classList.toggle('full', (c.wood ?? 0) >= TERMANT.wood.cap - 0.5);
    }
    const wcol = '#' + casteTint(basicCaste(c.species)).multiplyScalar(1.35).getHexString();
    const wk = `${antSilhouette('worker', wcol)}<span class="cur">${c.workers}</span><span class="cap">/ ${c.workersMax}</span>`;
    if (this.workers.innerHTML !== wk) this.workers.innerHTML = wk;
    const sold = c.castes.find((cs) => CASTES[cs].role === 'soldier' || CASTES[cs].role === 'major');
    const so = `${antSilhouette('soldier', sold ? '#' + casteTint(sold).multiplyScalar(1.35).getHexString() : '#b0503a')}<span class="cur">${c.soldiers}</span><span class="cap">/ ${c.soldiersMax}</span>`;
    if (this.soldiers.innerHTML !== so) this.soldiers.innerHTML = so;
    this.soldiers.style.display = c.soldiersMax > 0 || c.soldiers > 0 ? '' : 'none';
    void esc;
  }
}
