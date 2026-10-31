import { GameSession, casteTint } from '../game/session';
import { CASTES, SPECIES, resourceName } from '../sim/species';
import { TILE_INFO, buildableTiles, groupById, groupCounts, growTime, hatchCost, tileAt, tileCost, upgradeNeed, upgradePoints } from '../sim/tiles';
import { BALANCE } from '../sim/balance';
import { tierOf } from '../sim/species';
import { TileType } from '../sim/types';
import { ICONS, antSilhouette } from './icons';
import { button, el, esc, shield } from './dom';
import { TERMANT } from '../sim/balance';
import { STOLEN_CASTES, genomeOf, isTermant, stolenOf, threshold } from '../sim/termants';
import { CLICK, TOUCH } from '../core/device';
import { casteMount } from '../sim/creatures/climb';

/** Caste card line: which creatures this caste can mount (combat v2, BALANCE.mount). */
function mountText(caste: string): string {
  const m = casteMount(caste);
  return m === 'small' ? 'Mounts large and huge creatures' : m === 'large' ? 'Mounts huge creatures only' : 'Cannot mount creatures';
}

const TILE_COL: Record<string, string> = { food: '#6f8a34', fungus: '#d8d2c0', aphid: '#9a8a62', thatch: '#8a6436', mound: '#b4864e', queen: '#8fa2b8', highway: '#9a7a52', carton: '#a07848' };
const ROMAN = ['', 'I', 'II', 'III'];

/** Small hex swatch in a tile's floor colour. */
function hexSwatch(color: string): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(16 + Math.cos(a) * 14).toFixed(1)},${(16 + Math.sin(a) * 14).toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 32 32" class="hexsw"><polygon points="${pts}" fill="${color}" stroke="#e0c28a" stroke-width="1.2"/></svg>`;
}

/**
 * Build panel (bottom right, Revision 2). Tiles tab: Dig, one brood tile per
 * caste, food storage, highway and species tiles, then the Upgrade and Delete
 * tools; tooltips give build cost, hatch cost, grow time and capacity. Castes
 * tab: what each caste is. Action buttons: food view and game speed. The line
 * at the bottom explains the hovered hex or the selected tile.
 */
export class BuildPanel {
  root = el('div', 'pnl bp');
  private tabs = el('div', 'bp-tabs');
  private grid = el('div', 'bp-grid');
  private sel = el('div', 'bp-sel');
  private tab: 'tiles' | 'castes' | 'genome' = 'tiles';
  private tabGenome: HTMLElement;
  /** what the Genome tab last showed (rebuilt when it changes) */
  private genomeSig = '';
  private castesSig = '';
  private tileBtns: Array<{ b: HTMLElement; type: TileType | 'dig' | 'remove' | 'upgrade'; caste?: string }> = [];
  private foodBtn: HTMLButtonElement;
  private speedBtn: HTMLButtonElement;
  private tabTiles: HTMLElement;
  private tabCastes: HTMLElement;

  constructor(private s: GameSession) {
    this.tabTiles = el('div', 'bp-tab on', ICONS.hammer);
    this.tabTiles.dataset.tip = '<b>Tiles</b>Dig, and place, upgrade or delete hex tiles in the nest. Workers do all of it.';
    this.tabCastes = el('div', 'bp-tab', ICONS.ant);
    this.tabCastes.dataset.tip = '<b>Castes</b>The ants your colony can raise.';
    this.tabTiles.addEventListener('click', () => this.setTab('tiles'));
    this.tabCastes.addEventListener('click', () => this.setTab('castes'));
    this.tabGenome = el('div', 'bp-tab', ICONS.gene);
    this.tabGenome.dataset.tip = `<b>Genome</b>Termants raise the castes of the species they eat. Corpses of enemy ants carried into the store give gene samples; enough samples and that species' caste can be raised here (at most ${TERMANT.maxStolen} at once).`;
    this.tabGenome.addEventListener('click', () => this.setTab('genome'));
    this.tabs.append(this.tabTiles, this.tabCastes);
    if (isTermant(s.player)) this.tabs.append(this.tabGenome);
    const acts = el('div', 'bp-acts');
    this.foodBtn = button('', ICONS.eye, '<b>Food view</b>Highlight the food your colony can gather on the surface, and the stores in the nest.', () => (s.foodView = !s.foodView));
    this.speedBtn = button('', ICONS.fast + '<span class="spd">1×</span>', `<b>Game speed</b>${CLICK} to cycle 1×, 2×, 4×. <span class="k">−</span>/<span class="k">=</span> also change speed, <span class="k">P</span> pauses.`, () => {
      const order = [1, 2, 4];
      if (s.net) {
        // multiplayer: ask for the next speed (every player has to agree; back to 1× at once)
        const cur = s.gameSpeed();
        return s.setSpeed(order[(order.indexOf(cur) + 1) % order.length]);
      }
      const i = order.indexOf(s.loop.speed);
      s.setSpeed(order[(i + 1) % order.length]);
      s.loop.paused = false;
    });
    acts.append(this.foodBtn, this.speedBtn);
    if (TOUCH) {
      // compact layout (GameUI): the tiles fold into this button
      const open = button('bp-open', ICONS.hammer + '<span>Build</span>', '<b>Build</b>Show or hide the tiles and tools.', () => this.setOpen(!this.root.classList.contains('open')));
      acts.append(open);
    }
    this.root.append(this.tabs, acts, this.grid, this.sel);
    shield(this.root);
    this.buildGrid();
  }

  /** compact layout: the tiles shown or folded to the action row (the full layout always shows them) */
  setOpen(on: boolean): void {
    this.root.classList.toggle('open', on);
  }

  private setTab(t: 'tiles' | 'castes' | 'genome'): void {
    this.tab = t;
    this.tabTiles.classList.toggle('on', t === 'tiles');
    this.tabCastes.classList.toggle('on', t === 'castes');
    this.tabGenome.classList.toggle('on', t === 'genome');
    this.buildGrid();
  }

  /** A short signature of what the Genome tab shows: rebuilt only when it changes. */
  private genomeKey(): string {
    const c = this.s.player;
    const G = genomeOf(c);
    return `${G.stolen.join()}|${G.pending}|${G.corpsePriority}|${G.bonuses.join()}|${STOLEN_CASTES.map((e) => Math.floor(G.samples[e.source] ?? 0)).join()}|${c.castes.length}`;
  }

  /**
   * Genome tab (Termants): one row per stealable caste — its species, progress of gene samples to the threshold, and
   * whether it is locked, waiting for room, or raised (with a Forget button); the corpse-priority toggle; creature
   * bonuses at the bottom.
   */
  private buildGenome(): void {
    const s = this.s;
    const c = s.player;
    const G = genomeOf(c);
    this.genomeSig = this.genomeKey();
    const inMatch = new Set(s.world.s.colonies.filter((o) => o.id !== c.id).map((o) => o.species));
    const head = el('div', 'gn-head', `<div><b>Stolen castes ${G.stolen.length} / ${TERMANT.maxStolen}</b><br><span>Carry enemy corpses into the store; each species' caste unlocks at its sample threshold.</span></div>`);
    const pri = button('gn-pri' + (G.corpsePriority ? ' on' : ''), ICONS.gene + '<span>Corpses first</span>', '<b>Corpse priority</b>When on, workers fetch the corpses of species whose genes the colony still lacks before other food.', () => s.issue({ type: 'corpsePriority', on: !G.corpsePriority }));
    head.appendChild(pri);
    this.grid.appendChild(head);
    if (G.pending) {
      const e = stolenOf(G.pending);
      this.grid.appendChild(el('div', 'gn-note', `<b>${esc(e?.name ?? G.pending)}</b> is ready, but the colony already raises ${TERMANT.maxStolen} stolen castes. Forget one to make room.`));
    }
    const rows = [...STOLEN_CASTES].sort((a, b) => Number(inMatch.has(b.source)) - Number(inMatch.has(a.source)));
    for (const e of rows) {
      const cd = CASTES[e.caste];
      const sp = SPECIES[e.source];
      const have = G.samples[e.source] ?? 0;
      const need = threshold(e);
      const active = G.stolen.includes(e.caste);
      const waiting = G.pending === e.caste;
      const pct = Math.min(100, (have / need) * 100);
      const state = active ? 'raised' : waiting ? 'ready — no room' : have >= need ? 'ready' : `${Math.floor(have)} / ${need}`;
      const row = el(
        'div',
        'gn-row' + (active ? ' on' : '') + (inMatch.has(e.source) || active ? '' : ' away'),
        `${antSilhouette(cd.role, '#' + casteTint(e.caste).multiplyScalar(1.35).getHexString())}<div class="gn-mid"><div class="gn-t">${esc(e.name)}<span class="gn-st">${esc(state)}</span></div>
        <div class="gn-s">${esc(sp.common)} ${esc(cd.name.toLowerCase())}${e.heavy ? ' · heavy' : ''}${inMatch.has(e.source) ? '' : ' · not in this match'}</div><div class="gn-bar"><i style="width:${pct.toFixed(0)}%"></i></div></div>`,
      );
      row.dataset.tip = `<b>${esc(e.name)}</b> — the ${esc(sp.common)}' ${esc(cd.name.toLowerCase())}, raised by the Termant queen with that species' own body, weapons and habits.<br>${cd.length} mm · health ${cd.hp} · bite ${cd.bite}${cd.acid ? ' · formic acid' : ''}${cd.sting ? ' · venom sting' : ''}<br>Unlocks at <b>${need}</b> gene samples (small ants 1, workers 2, soldiers 4, majors 7). Its brood tile costs ×${TERMANT.stolenCostMul}.`;
      if (active)
        row.appendChild(
          button('gn-forget', 'Forget', `<b>Forget ${esc(e.name)}</b>Stop raising this caste: its brood tiles are removed with the usual refund. Living ants of the caste stay until they die. The genes fade to half.`, () => s.issue({ type: 'forgetCaste', caste: e.caste })),
        );
      this.grid.appendChild(row);
    }
    if (G.bonuses.length) {
      const txt = G.bonuses.map((b) => (b === 'armor' ? 'beetle genes: +5 % armour' : 'spider genes: +5 % speed')).join(' · ');
      this.grid.appendChild(el('div', 'gn-note', `<b>Creature genes</b> ${esc(txt)}`));
    }
  }

  private buildGrid(): void {
    const s = this.s;
    const c = s.player;
    const res = resourceName(c.species);
    this.grid.innerHTML = '';
    this.tileBtns = [];
    this.grid.classList.toggle('genome', this.tab === 'genome');
    if (this.tab === 'genome') return this.buildGenome();
    if (this.tab === 'castes') {
      for (const cs of c.castes) {
        const cd = CASTES[cs];
        if (cd.role === 'queen') continue;
        const sp = SPECIES[cd.species];
        const card = el(
          'div',
          'caste-card',
          `${antSilhouette(cd.role, '#' + casteTint(cs).multiplyScalar(1.35).getHexString())}<div><div class="cc-t">${esc(cd.species === c.species ? cd.name : isTermant(c) && stolenOf(cs) ? `${stolenOf(cs)!.name} (stolen from ${sp.common})` : `${sp.common.replace(' Ant', '')} ${cd.name}`)}</div>
          <div class="cc-s"><i>${esc(sp.scientific)}</i> · ${cd.length} mm · health ${cd.hp} · bite ${cd.bite}${cd.acid ? ' · formic acid' : ''}${cd.sting ? ' · venom sting' : ''}<br><span class="cc-mount">${mountText(cs)}</span><br>${esc(cd.fact)}</div></div>`,
        );
        this.grid.appendChild(card);
      }
      return;
    }
    const add = (type: TileType | 'dig' | 'remove' | 'upgrade', caste: string | undefined, icon: string, name: string, tip: string) => {
      const b = el('div', 'tbtn', `${icon}<div class="t-name">${esc(name)}</div><div class="t-cost"></div>`);
      b.dataset.tip = tip;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (type === 'dig' || type === 'remove' || type === 'upgrade') s.setTool(s.tool === type ? 'none' : type);
        else {
          const same = s.tool === 'tile' && s.buildType === type && (s.buildCaste || undefined) === caste;
          s.setTool(same ? 'none' : 'tile', type, caste ?? '');
        }
      });
      this.grid.appendChild(b);
      this.tileBtns.push({ b, type, caste });
    };
    const labour = '<br><i>Workers in the home column do all nest jobs — more workers build, upgrade and respawn faster.</i>';
    add('dig', undefined, ICONS.dig, 'Dig', `<b>Dig</b>Mark soil for workers to excavate (6 points per hex; up to 2 workers each). Drag to paint; click a marked hex again to cancel. Click a marked <b>entrance spot</b> (dashed rim, pale ring) to dig out a new entrance (up to 2); click a closed entrance to open it again. <span class="k">G</span>${labour}`);
    for (const bt of buildableTiles(c)) {
      if (bt.type === 'brood' && bt.caste) {
        const cd = CASTES[bt.caste];
        const sp = SPECIES[cd.species];
        const nm = cd.species === c.species ? cd.name : isTermant(c) && stolenOf(bt.caste) ? stolenOf(bt.caste)!.name : `${sp.common.replace(' Ant', '')} ${cd.name}`;
        const tier = tierOf(bt.caste);
        const cap = BALANCE.capacity[bt.caste] ?? BALANCE.capacity.default;
        add(
          'brood',
          bt.caste,
          antSilhouette(cd.role, '#' + casteTint(bt.caste).multiplyScalar(1.35).getHexString()),
          nm,
          `<b>${esc(nm)} brood tile</b> (${tier})${esc(TILE_INFO.brood.desc)}<br>Build <b>${tileCost(c, 'brood', bt.caste)}</b> ${res} · hatch <b>${hatchCost(bt.caste)}</b> ${res} · grows in ${growTime(bt.caste)} s<br>Holds ${cap.join(' / ')} ant${cap[2] > 1 ? 's' : ''} at levels I / II / III. Adjacent ${esc(nm.toLowerCase())} tiles form one chamber = one control group.${labour}`,
        );
      } else {
        const info = TILE_INFO[bt.type];
        const paid = bt.type === 'carton' ? 'wood' : res;
        add(bt.type, undefined, hexSwatch(TILE_COL[bt.type] ?? '#888'), info.name.replace("Queen's ", ''), `<b>${esc(info.name)}</b>${esc(info.desc)}<br>Build <b>${tileCost(c, bt.type)}</b> ${paid} (paid when a worker finishes it).`);
      }
    }
    add('upgrade', undefined, ICONS.upgrade, 'Upgrade', `<b>Upgrade tool</b>Click tiles to mark upgrade jobs (cost = build cost; max level III). A tile needs <b>6</b> upgrade points for level II and <b>12</b> for level III, from its neighbours: each same-type tile gives its level, each soil wall 1, each highway its level. Big compact chambers upgrade best — a 19-tile hexagon can reach level III everywhere. Upgraded ants are healed and stronger. <span class="k">U</span>`);
    add('remove', undefined, ICONS.trash, 'Delete', `<b>Delete tool</b>Click tiles to downgrade them one level at a time; at level I the tile is removed and its ant dies. Two-thirds of the build cost is dropped as seeds that workers carry back to storage. Also clears dig marks, cancels planned tiles and plugs an extra entrance with soil (the main one stays open). <span class="k">Del</span>`);
  }

  update(): void {
    const s = this.s;
    const c = s.player;
    // the stolen castes change mid-match: refresh the Genome tab, and the tile list when a caste comes or goes
    if (this.tab === 'genome' && this.genomeKey() !== this.genomeSig) this.buildGrid();
    if (this.tab === 'tiles' && isTermant(c) && this.tileBtns.length && this.castesSig !== c.castes.join()) this.buildGrid();
    this.castesSig = c.castes.join();
    for (const t of this.tileBtns) {
      const on = s.tool === t.type || (s.tool === 'tile' && s.buildType === t.type && (s.buildCaste || undefined) === t.caste);
      t.b.classList.toggle('on', on);
      const costEl = t.b.querySelector('.t-cost') as HTMLElement;
      if (t.type !== 'dig' && t.type !== 'remove' && t.type !== 'upgrade') {
        const cost = tileCost(c, t.type, t.caste);
        const txt = String(cost);
        if (costEl.textContent !== txt) costEl.textContent = txt;
        t.b.classList.toggle('cant', (t.type === 'carton' ? (c.wood ?? 0) : c.food) < cost && !c.infiniteFood);
      }
    }
    this.foodBtn.classList.toggle('on', s.foodView);
    const spd = this.speedBtn.querySelector('.spd')!;
    const gs = s.gameSpeed();
    const asked = s.net ? (s.world.s.settings.speedVotes ?? []).find((v) => v > 0) : 0;
    const txt = s.loop.paused ? '❚❚' : asked ? `${gs}→${asked}×` : `${gs}×`;
    if (spd.textContent !== txt) spd.textContent = txt;
    this.speedBtn.classList.toggle('on', gs > 1);
    // the hovered hex (tools) or the selected tile
    let html = '';
    if (s.tool !== 'none' && s.tool !== 'marker') html = esc(s.ghostInfo || s.hoverMsg || (s.tool === 'dig' ? 'Drag over soil to mark it for digging.' : s.tool === 'tile' ? `${CLICK} or drag on dug floor to plan tiles; workers build them.` : s.tool === 'upgrade' ? `${CLICK} a tile to mark it for upgrading.` : `${CLICK} a tile to downgrade or delete it.`));
    else {
      const t = s.selectedTile >= 0 ? tileAt(c, s.selectedTile) : undefined;
      if (t) {
        const info = TILE_INFO[t.type];
        const gr = groupById(c, t.group);
        const n = gr ? groupCounts(s.world, c, gr.id) : null;
        const name = t.type === 'brood' && t.caste ? `${CASTES[t.caste].name} brood tile` : info.name;
        const b = t.brood ? s.world.broodById.get(t.brood) : undefined;
        const inc = b ? (b.stage === 0 ? 'egg on its way' : b.t >= BALANCE.prestage - 0.01 && n && n.living >= n.max ? `larva waiting at ${Math.round(b.t * 100)} %` : `larva ${Math.round(b.t * 100)} %`) : t.caste ? 'waiting for an egg' : '';
        const pts = t.built && t.level < 3 && t.type !== 'queen' ? ` · points ${upgradePoints(s.world, c, t)}/${upgradeNeed(t)}` : '';
        html = `<b>${esc(name)}</b> · level ${ROMAN[t.level]}${t.built ? '' : ' (planned)'}${pts}${n && n.max ? ` · group ${n.living}/${n.max}` : ''}${inc ? ` · ${inc}` : ''}`;
      } else html = `Pick a tile or tool. ${CLICK} a tile in the nest to inspect it.`;
    }
    if (this.sel.innerHTML !== html) this.sel.innerHTML = html;
  }
}
