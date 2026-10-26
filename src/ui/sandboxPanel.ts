import { GameSession } from '../game/session';
import { CREATURES } from '../sim/creatures/kinds';
import { button, el, esc, shield } from './dom';

/**
 * Sandbox tools (Phase 13), shown only in sandbox games: place any creature
 * or boss where you click, fill the stores, infinite food, wild creatures on
 * or off. Every one is a command (refused outside sandbox games), so the
 * simulation stays deterministic and replays include them.
 */
export class SandboxPanel {
  readonly root = el('div', 'pnl sandbox-panel');
  private place: HTMLButtonElement;
  private inf: HTMLButtonElement;
  private wild: HTMLButtonElement;

  constructor(private s: GameSession) {
    shield(this.root);
    const kinds = Object.keys(CREATURES);
    const sel = document.createElement('select');
    sel.className = 'sb-kind';
    sel.innerHTML = kinds.map((k) => `<option value="${k}" ${k === s.spawnKind ? 'selected' : ''}>${esc(CREATURES[k].name)}${CREATURES[k].boss ? ' (boss)' : ''}</option>`).join('');
    sel.addEventListener('change', () => (s.spawnKind = sel.value));
    sel.addEventListener('keydown', (e) => e.stopPropagation());
    this.place = button('', 'Place', '<b>Place creature</b>Click the ground (or a dug floor in an area) to put the chosen creature there. Click again or Esc to stop.', () => s.setTool(s.tool === 'spawn' ? 'none' : 'spawn'));
    const fill = button('', 'Fill stores', 'Fill your food stores to capacity', () => s.issue({ type: 'sandboxFood' }));
    this.inf = button('', 'Infinite food', 'Brood and building never run short of food', () => s.issue({ type: 'sandboxSet', key: 'infiniteFood', on: !s.player.infiniteFood }));
    this.wild = button('', 'Wild creatures', 'Let wild creatures wander in on their own', () => s.issue({ type: 'sandboxSet', key: 'creatures', on: !((s.world.s.settings.creatures ?? 0) > 0) }));
    const r1 = el('div', 'sb-row');
    r1.append(sel, this.place);
    const r2 = el('div', 'sb-row');
    r2.append(fill, this.inf, this.wild);
    this.root.append(el('div', 'sb-title sc', 'Sandbox'), r1, r2);
  }

  update(): void {
    const s = this.s;
    this.root.style.display = s.sandbox ? '' : 'none';
    if (!s.sandbox) return;
    this.place.classList.toggle('on', s.tool === 'spawn');
    this.inf.classList.toggle('on', !!s.player.infiniteFood);
    this.wild.classList.toggle('on', (s.world.s.settings.creatures ?? 0) > 0);
  }
}
