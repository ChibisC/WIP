import { SURFACE } from '../sim/types';
import { GameSession, casteTint } from '../game/session';
import { CASTES, SPECIES } from '../sim/species';
import { MARKER_COLORS, MARKER_NAMES, MARKER_ORDERS, MarkerOrder, homeCounts, markerCounts, orderOn } from '../sim/markers';
import { groupCounts, groupTiles, raisesAnts } from '../sim/tiles';
import { surgeReady } from '../sim/surge';
import { BALANCE } from '../sim/balance';
import { NestGroup } from '../sim/types';
import { ABILITIES, abilityOf } from '../sim/abilities';
import { ICONS, abilityIcon, antSilhouette } from './icons';
import { button, el, esc, shield } from './dom';
import { CLICK } from '../core/device';

function surgeTip(ready: number, total: number): string {
  const S = BALANCE.surge;
  return `<b>Gold Surge</b>Every ready ant of this group flashes gold for ${S.duration} s: +${Math.round((S.speedMul - 1) * 100)} % speed, +${Math.round((S.damageMul - 1) * 100)} % damage, +${Math.round((S.attackRateMul - 1) * 100)} % attack rate; then ${S.cooldown} s of recovery. They also surge by themselves when they enter a fight.<br><b>${ready}</b> of ${total} ready.`;
}

interface DragState {
  gid: number;
  card: HTMLElement;
  sx: number;
  sy: number;
  ghost: HTMLElement | null;
  over: number | null;
}

const ROMAN = ['', 'I', 'II', 'III'];

/** The three marker orders: icon (struck through when on) and tooltip. */
const ORDER_ICON: Record<MarkerOrder, string> = { noAttack: ICONS.attack, noGather: ICONS.food, noClimb: ICONS.climb };
const ORDER_TIP: Record<MarkerOrder, string> = {
  noAttack: `<b>No attacking</b>Groups at this marker go after no enemy: they get on with their work and bite back only when bitten. ${CLICK} again to let them fight.`,
  noGather: `<b>No gathering</b>Groups at this marker pick up no food: they hold the marker in a guard line instead. ${CLICK} again to let them gather.`,
  noClimb: `<b>No climbing</b>Groups at this marker fight big creatures from the ground and never climb on. ${CLICK} again to let them climb.`,
};
const HOME_ORDER_TIP: Record<MarkerOrder, string> = {
  noAttack: `<b>No attacking (home)</b>The home groups go after no enemy, even intruders in the nest: they keep to their nest jobs and bite back only when bitten. ${CLICK} again to let them defend the nest.`,
  noGather: `<b>No gathering (home)</b>The home groups carry no food to the stores (seeds from deleted tiles, dropped loads) and never go out for it. ${CLICK} again to let them.`,
  noClimb: `<b>No climbing (home)</b>The home groups fight creatures in the nest from the ground. ${CLICK} again to let them climb.`,
};

/**
 * The command panel: a home column and the five marker columns I–V. Each
 * column lists nest-group cards; dragging a card to another column assigns
 * that group (its ants respond at once). Click a header to place that marker,
 * double-click to jump to it.
 */
export class MarkerPanel {
  root = el('div', 'mp');
  private body = el('div', 'pnl mp-body');
  private cols = new Map<number, { col: HTMLElement; head: HTMLElement; count: HTMLElement; cards: HTMLElement; orders: Map<MarkerOrder, HTMLElement>; summary: Map<MarkerOrder, HTMLElement> }>();
  private cardEls = new Map<number, HTMLElement>();
  private structKey = '';
  private drag: DragState | null = null;
  private collapseBtn: HTMLButtonElement;
  private aggroBtn: HTMLButtonElement;
  private abilityBtn: HTMLButtonElement;
  private arrived: { gid: number; from: DOMRect } | null = null;

  constructor(private s: GameSession) {
    const side = el('div', 'mp-side');
    this.collapseBtn = button('sq', ICONS.chevDown, '<b>Collapse</b>Hide or show the group cards.', () => {
      this.root.classList.toggle('collapsed');
      this.closeOrders();
    });
    side.append(this.collapseBtn, button('sq', ICONS.cancel, '<b>Cancel</b>Clear the selected marker (<span class="k">Esc</span>).', () => s.setTool('none')));
    const acts = el('div', 'mp-actions');
    const ab = abilityOf(s.player);
    acts.append(
      button('sq', ICONS.recall, '<b>Recall all</b>Bring every group back to the home column to defend the nest (<span class="k">R</span>).', () => s.recall()),
      (this.aggroBtn = button('sq', ICONS.attack, '', () => s.toggleAggression())),
      (this.abilityBtn = button('sq', abilityIcon(s.player.species), `<b>${esc(ab.name)}</b>${esc(ab.desc)}<br>Cooldown ${ab.cooldown} s.`, () => {
        const why = s.useAbility();
        if (why) s.onEvent?.({ t: 'message', text: why, kind: 'warn' });
      })),
    );
    for (const i of [-1, 0, 1, 2, 3, 4]) {
      const col = el('div', 'mp-col');
      col.dataset.col = String(i);
      if (i >= 0) col.style.setProperty('--mc', MARKER_COLORS[i]);
      const head = el('div', 'mp-head sc', i < 0 ? ICONS.home : MARKER_NAMES[i]);
      head.dataset.tip =
        i < 0
          ? '<b>Home</b>Groups here stay in the nest. Workers dig, build and carry eggs to the brood tiles; soldiers guard the tunnels. Home workers do not go out for food: send a group to a marker for that.'
          : `<b>Marker ${MARKER_NAMES[i]}</b>Click, then click the ground in the nest or on the surface to place it (<span class="k">${i + 1}</span>). On an area's entrance it sends the group down into that area. Double-click or press <span class="k">Space</span> to jump to it. Right-click a placed marker to lift it.<br>Drag group cards here to send them.`;
      if (i >= 0) {
        head.addEventListener('click', (e) => {
          e.stopPropagation();
          s.selectMarker(i);
        });
        head.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          s.setTool('none');
          s.jumpToMarker(i);
        });
      }
      const count = el('div', 'mp-count', '0/0');
      const cards = el('div', 'mp-cards');
      // the marker's orders for its groups (EotU-style toggles; command markerOrder): no attacking, gathering, climbing
      const orders = new Map<MarkerOrder, HTMLElement>();
      const row = el('div', 'mp-orders');
      for (const o of MARKER_ORDERS) {
        const b = button('mp-ord', ORDER_ICON[o], i < 0 ? HOME_ORDER_TIP[o] : ORDER_TIP[o], () => s.issue({ type: 'markerOrder', i, order: o, on: !orderOn(s.player, i, o) }));
        b.dataset.order = o;
        orders.set(o, b);
        row.appendChild(b);
      }
      // compact layout (phones): the column is too narrow for three finger-sized toggles, so one button shows the
      // three orders as small icons and opens the toggles at full size over the cards (CSS hides it elsewhere)
      const summary = new Map<MarkerOrder, HTMLElement>();
      const ordBtn = button('mp-ordbtn', '', `<b>Orders</b>No attacking, no gathering, no climbing for ${i < 0 ? 'the home groups' : `the groups at marker ${MARKER_NAMES[i]}`}. ${CLICK} to show the switches.`, () => {
        const open = !col.classList.contains('ord-open');
        this.closeOrders();
        col.classList.toggle('ord-open', open);
      });
      for (const o of MARKER_ORDERS) {
        const sp = el('span', 'os', ORDER_ICON[o]);
        summary.set(o, sp);
        ordBtn.appendChild(sp);
      }
      const wrap = el('div', 'mp-ordwrap');
      wrap.append(ordBtn, row);
      col.append(head, count, wrap, cards);
      this.body.appendChild(col);
      this.cols.set(i, { col, head, count, cards, orders, summary });
    }
    this.root.append(side, this.body, acts);
    shield(this.root);
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    // an open set of order switches closes on a press anywhere outside it (capture: before buttons stop the event)
    window.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as HTMLElement | null;
        if (!t?.closest?.('.mp-col.ord-open .mp-ordwrap')) this.closeOrders();
      },
      true,
    );
  }

  /** Close the compact layout's order switches. */
  private closeOrders(): void {
    for (const o of this.cols.values()) o.col.classList.remove('ord-open');
  }

  private groupKey(): string {
    return this.s.player.groups
      .filter((g) => raisesAnts(g))
      .map((g) => `${g.id}:${this.s.shownGroupMarker(g.id, g.marker)}:${g.caste}:${this.s.groupPending(g.id) ? 1 : 0}`)
      .join('|');
  }

  /** Rebuild cards when groups or assignments change; refresh counts every call. */
  update(): void {
    const s = this.s;
    const c = s.player;
    const key = this.groupKey();
    if (key !== this.structKey) {
      this.structKey = key;
      this.rebuild();
    }
    // headers: placed / selected state, counts
    for (const [i, o] of this.cols) {
      if (i >= 0) {
        const m = c.markers[i];
        o.col.classList.toggle('unplaced', !m.placed);
        o.col.classList.toggle('sel', s.tool === 'marker' && s.markerSel === i);
        const n = markerCounts(s.world, c, i);
        // a marker in another underground area shows that area's number in its colour
        const tab = m.placed && m.space !== SURFACE ? s.areaTab(m.space) : undefined;
        const badge = tab && tab.kind !== 'home' ? ` <span class="mp-area" style="color:${tab.color}" title="In area ${tab.number}">⬇${tab.number}</span>` : '';
        const txt = `${n.current}/${n.max}${badge}`;
        if (o.count.innerHTML !== txt) o.count.innerHTML = txt;
        for (const [k, b] of o.orders) b.classList.toggle('on', !!m[k]);
        for (const [k, b] of o.summary) b.classList.toggle('on', !!m[k]);
      } else {
        for (const [k, b] of o.orders) b.classList.toggle('on', orderOn(c, -1, k));
        for (const [k, b] of o.summary) b.classList.toggle('on', orderOn(c, -1, k));
        const n = homeCounts(s.world, c);
        o.count.textContent = `${n.current}/${n.max}`;
      }
    }
    for (const [gid, card] of this.cardEls) {
      const n = groupCounts(s.world, c, gid);
      const t = card.querySelector('.gc-n') as HTMLElement;
      const txt = `${n.living}/${n.max}`;
      if (t.textContent !== txt) {
        t.textContent = txt;
        t.classList.toggle('hurt', n.living < n.max);
      }
      // Saiy-Ants: the group's Gold Surge button shows how many are ready
      const sb = card.querySelector('.gc-surge') as HTMLElement | null;
      if (sb) {
        const r = surgeReady(s.world, c, gid);
        const tip = surgeTip(r.ready, r.total);
        if (sb.dataset.tip !== tip) sb.dataset.tip = tip;
        sb.classList.toggle('dim', r.ready === 0);
      }
    }
    const aggressive = s.shownAggression();
    this.aggroBtn.innerHTML = aggressive ? ICONS.attack : ICONS.defend;
    this.aggroBtn.classList.toggle('on', aggressive);
    this.aggroBtn.dataset.tip = aggressive
      ? '<b>Stance: attack</b>Ants attack any enemy they find. Click to switch to <i>defend only</i>.'
      : '<b>Stance: defend only</b>Away from the nest, ants fight only when attacked or alarmed. Click to switch to <i>attack</i>.';
    const ab = abilityOf(c);
    const ready = c.abilityCd <= 0;
    this.abilityBtn.classList.toggle('dim', !ready);
    this.abilityBtn.classList.toggle('on', c.abilityT > 0);
    this.abilityBtn.dataset.tip = `<b>${esc(ab.name)}</b>${esc(ab.desc)}<br>${ready ? 'Ready.' : `Ready in ${Math.ceil(c.abilityCd)} s.`}`;
    void ABILITIES;
  }

  private rebuild(): void {
    const s = this.s;
    const c = s.player;
    for (const o of this.cols.values()) o.cards.innerHTML = '';
    this.cardEls.clear();
    for (const g of c.groups) {
      if (!raisesAnts(g)) continue;
      const card = this.makeCard(g);
      card.classList.toggle('pending', s.groupPending(g.id));
      this.cols.get(s.shownGroupMarker(g.id, g.marker))!.cards.appendChild(card);
      this.cardEls.set(g.id, card);
    }
    if (this.arrived) {
      const card = this.cardEls.get(this.arrived.gid);
      if (card) {
        // FLIP: start where the ghost was dropped and settle into place.
        const to = card.getBoundingClientRect();
        const from = this.arrived.from;
        card.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(1.1)` }, { transform: 'translate(0,0) scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.1)' });
      }
      this.arrived = null;
    }
  }

  private makeCard(g: NestGroup): HTMLElement {
    const s = this.s;
    const c = s.player;
    const cd = CASTES[g.caste!];
    const queen = g.type === 'queen';
    const card = el('div', 'gcard' + (queen ? ' queen' : ''));
    card.dataset.gid = String(g.id);
    const tiles = groupTiles(c, g.id);
    const lvl = Math.round(tiles.reduce((a, t) => a + t.level, 0) / Math.max(1, tiles.length));
    const color = queen ? '#c9d6e6' : '#' + casteTint(g.caste!).multiplyScalar(1.35).getHexString();
    const role = cd.role;
    const badge = queen ? ICONS.queen : role === 'soldier' || role === 'major' ? ICONS.attack : role === 'minim' ? ICONS.leaf : ICONS.food;
    card.innerHTML = `${antSilhouette(role, color)}<div class="gc-n">0/0</div><div class="gc-badge">${badge}</div><div class="gc-lvl">${'<i></i>'.repeat(Math.max(0, lvl - 1))}</div>`;
    const sp = SPECIES[cd.species];
    const who = cd.species === c.species ? `${cd.name}s` : `${sp.common.replace(' Ant', '')} ${cd.name.toLowerCase()}s`;
    card.dataset.tip = `<b>${queen ? "Queen's chamber workers" : esc(who)}</b>${tiles.length} ${queen ? 'chamber tiles' : 'brood tiles'} · level ${ROMAN[lvl] ?? lvl}<br>Drag to a marker column to send this group out; drag to the home column to keep it in the nest. Click to find its tiles.`;
    if (cd.surge) {
      // Gold Surge for the whole group (a command, so it works in multiplayer)
      const sb = button('gc-surge', ICONS.surge, surgeTip(0, 0), () => {
        const r = surgeReady(s.world, c, g.id);
        if (!r.ready) {
          s.onEvent?.({ t: 'message', text: r.total ? 'None of this group can surge yet: they are still recovering.' : 'No ants of this group have hatched yet.', kind: 'warn' });
          return;
        }
        s.issue({ type: 'surgeGroup', group: g.id });
      });
      sb.addEventListener('pointerdown', (e) => e.stopPropagation());
      card.appendChild(sb);
    }
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.drag = { gid: g.id, card, sx: e.clientX, sy: e.clientY, ghost: null, over: null };
    });
    return card;
  }

  private colAt(x: number, y: number): number | null {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const col = hit?.closest('.mp-col') as HTMLElement | null;
    return col ? Number(col.dataset.col) : null;
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      d.ghost = d.card.cloneNode(true) as HTMLElement;
      d.ghost.classList.add('drag-ghost');
      d.ghost.removeAttribute('data-tip');
      document.body.appendChild(d.ghost);
      d.card.style.opacity = '0.35';
      for (const o of this.cols.values()) o.col.classList.add('drop-ok');
    }
    d.ghost.style.left = e.clientX + 'px';
    d.ghost.style.top = e.clientY + 'px';
    const over = this.colAt(e.clientX, e.clientY);
    if (over !== d.over) {
      if (d.over !== null) this.cols.get(d.over)?.col.classList.remove('drop-hover');
      if (over !== null) this.cols.get(over)?.col.classList.add('drop-hover');
      d.over = over;
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    for (const o of this.cols.values()) o.col.classList.remove('drop-ok', 'drop-hover');
    if (!d.ghost) {
      // plain click: show the group's tiles in the nest
      this.focusGroup(d.gid);
      return;
    }
    const from = d.ghost.getBoundingClientRect();
    d.ghost.remove();
    d.card.style.opacity = '';
    const over = this.colAt(e.clientX, e.clientY);
    if (over === null) return;
    const g = this.s.player.groups.find((x) => x.id === d.gid);
    if (!g || this.s.shownGroupMarker(g.id, g.marker) === over) return;
    this.arrived = { gid: d.gid, from };
    this.s.assignGroup(d.gid, over);
    this.update();
    if (over >= 0 && !this.s.player.markers[over].placed) this.s.onEvent?.({ t: 'message', text: `Marker ${MARKER_NAMES[over]} is not placed yet — click its header and then the ground.`, kind: 'info' });
  }

  private focusGroup(gid: number): void {
    const s = this.s;
    const tiles = groupTiles(s.player, gid);
    if (!tiles.length) return;
    const g = s.world.nest(s.player.id)!;
    let x = 0;
    let y = 0;
    for (const t of tiles) {
      const p = g.hexCenter(t.q);
      x += p.x;
      y += p.y;
    }
    s.jumpTo('nest', x / tiles.length, y / tiles.length, s.player.id);
  }
}
