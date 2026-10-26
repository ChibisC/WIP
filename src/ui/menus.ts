import { TOUCH } from '../core/device';
import { GameSession } from '../game/session';
import { Action, ACTION_LABELS, DEFAULT_BINDINGS } from '../core/input';
import { Volumes, bindingChanges, keyLabel, profile, rebind, settings, updateSettings } from '../game/profile';
import { SAVE_SLOTS, SaveSlot, describeSave, download, listSaves, putSave, readSaveHeader, savesPersist, slotName, stampedName } from '../game/saves';
import { MISSIONS, missionOf } from '../sim/missions';
import { SPECIES } from '../sim/species';
import { creditsHtml } from './credits';
import { BUILD_ID } from '../net/messages';
import { Quality } from '../render/view';
import { button, el, esc, shield } from './dom';
import { ICONS } from './icons';

type PauseTab = 'game' | 'graphics' | 'sound' | 'controls';

/** Modal dialogs: Missions, the pause menu (saves, settings, controls), the mission briefing, the end screen and help. */
export class Menus {
  root = el('div');
  private veil: HTMLElement | null = null;
  private wasPaused = false;
  onScale: ((k: number) => void) | null = null;
  private lastTab: PauseTab = 'game';

  constructor(private s: GameSession) {}

  get open(): boolean {
    return !!this.veil;
  }

  close(): void {
    if (!this.veil) return;
    this.veil.remove();
    this.veil = null;
    this.s.input.rebindTarget = null;
    if (!this.s.net) this.s.loop.paused = this.wasPaused; // a multiplayer match never pauses for a menu
    this.s.input.enabled = true;
  }

  private modal(title: string, build: (m: HTMLElement) => void, pause = true): void {
    this.close();
    this.wasPaused = this.s.loop.paused;
    if (pause && !this.s.net) this.s.loop.paused = true;
    this.s.input.enabled = false;
    const veil = el('div', 'modal-veil');
    const m = el('div', 'pnl modal');
    m.append(button('sm x', ICONS.close, 'Close (Esc)', () => this.close()), el('h2', '', esc(title)));
    build(m);
    veil.appendChild(m);
    veil.addEventListener('pointerdown', (e) => {
      if (e.target === veil) this.close();
    });
    shield(veil);
    this.root.appendChild(veil);
    this.veil = veil;
  }

  /** End of a mission or skirmish: the outcome, every colony's record, and keep watching or leave. */
  result(title: string, text: string, extra = ''): void {
    this.modal(title, (m) => {
      m.appendChild(el('p', '', esc(text)));
      if (extra) m.appendChild(el('p', 'medal-line', extra));
      const w = this.s.world;
      const rows = w.s.colonies
        .map((c) => {
          const you = c.id === this.s.player.id;
          const side = you ? 'You' : c.team === this.s.player.team ? 'Ally' : 'Rival';
          return `<tr class="${you ? 'won' : ''}"><td><b>${esc(c.name)}</b><br><span class="dim">${side}</span></td><td>${c.alive ? 'Alive' : 'Queen lost'}</td><td>${c.stats.peakPop}</td><td>${c.stats.born}</td><td>${c.stats.died}</td><td>${Math.round(c.stats.food)}</td><td>${c.stats.kills}</td></tr>`;
        })
        .join('');
      const t = el('table', 'lb-slots results');
      t.innerHTML = `<thead><tr><th>Colony</th><th></th><th>Peak</th><th>Raised</th><th>Lost</th><th>Food</th><th>Kills</th></tr></thead><tbody>${rows}</tbody>`;
      m.appendChild(t);
      m.appendChild(el('p', 'dim', `Game time ${Math.floor(w.s.time / 60)} min ${Math.floor(w.s.time % 60)} s.`));
      const r = el('div', 'row');
      r.append(button('', 'Keep playing', 'Close this and carry on in the same world', () => this.close()), button('', 'Back to the title', 'Leave this game', () => (location.href = location.pathname)));
      m.appendChild(r);
    });
  }

  missions(): void {
    const info = this.s.missionInfo();
    this.modal(info.title, (m) => {
      m.appendChild(el('p', '', esc(info.brief)));
      m.appendChild(el('h3', '', esc(info.stage || 'Objectives')));
      const ul = el('ul');
      for (const g of info.goals) ul.appendChild(el('li', '', `${g.done ? '✓' : '○'} ${esc(g.text)} <span style="float:right">${esc(g.progress)}</span>`));
      m.appendChild(ul);
    });
  }

  /** The pause menu (in a match: the game menu, which does not pause). Tabs: Game, Graphics, Sound, Controls. */
  pause(tab: PauseTab = this.lastTab): void {
    this.lastTab = tab;
    this.modal(this.s.net ? 'Menu' : 'Paused', (m) => {
      const tabs = el('div', 'mtabs');
      const body = el('div', 'mtab-body');
      const names: Array<[PauseTab, string]> = [
        ['game', 'Game'],
        ['graphics', 'Graphics'],
        ['sound', 'Sound'],
        ['controls', 'Controls'],
      ];
      const show = (t: PauseTab) => {
        this.lastTab = t;
        this.s.input.rebindTarget = null;
        for (const b of Array.from(tabs.children) as HTMLElement[]) b.classList.toggle('on', b.dataset.tab === t);
        body.innerHTML = '';
        if (t === 'game') this.gameTab(body);
        else if (t === 'graphics') this.graphicsTab(body);
        else if (t === 'sound') this.soundTab(body);
        else this.controlsTab(body);
      };
      for (const [id, n] of names) {
        const b = button('', n, '', () => show(id));
        b.dataset.tab = id;
        tabs.appendChild(b);
      }
      m.append(tabs, body);
      show(tab);
    });
  }

  private toast(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    this.s.onEvent?.({ t: 'message', text, kind });
  }

  private gameTab(m: HTMLElement): void {
    const r1 = el('div', 'row');
    r1.append(button('', 'Resume', 'Back to the colony (Esc)', () => this.close()));
    m.appendChild(r1);
    if (this.s.canSave) {
      m.appendChild(el('h3', '', 'Saved games'));
      const list = el('div', 'save-list');
      m.appendChild(list);
      void this.fillSaves(list);
      const r = el('div', 'row');
      const file = el('input');
      file.type = 'file';
      file.accept = '.udsave';
      file.hidden = true;
      file.addEventListener('change', () => {
        const f = file.files?.[0];
        if (f) void f.arrayBuffer().then((b) => this.loadBytes(new Uint8Array(b)));
      });
      r.append(
        button('', 'Download this game', 'Save this moment to a file (.udsave) you can keep, move to another computer, or load from the title screen', () => {
          void this.s.saveBytes(BUILD_ID).then((bytes) => bytes && download(bytes, stampedName('udsave')));
        }),
        button('', 'Load from a file…', 'Open a .udsave file', () => file.click()),
        file,
      );
      m.appendChild(r);
      void savesPersist().then((ok) => {
        if (!ok) m.insertBefore(el('p', 'dim', 'This browser is not keeping site data, so saves last only until the page closes. Download the game to keep it.'), list);
      });
    }
    m.appendChild(el('h3', '', 'Replay'));
    const r4 = el('div', 'row');
    const save = button('', 'Save replay', 'Download a replay of this game so far: where it began plus every order. It plays back exactly.', () => {
      void this.s.saveReplay(BUILD_ID).then((bytes) => {
        if (!bytes) return this.toast('This game cannot be saved as a replay (a test scene edited it).', 'warn');
        download(bytes, stampedName('udreplay'));
      });
    });
    r4.append(save);
    m.appendChild(r4);
    // Sandbox options would show other players' nests: single-player only.
    if (!this.s.net) {
      m.appendChild(el('h3', '', 'Sandbox'));
      const r6 = el('div', 'row');
      const reveal = button(this.s.revealAreas ? 'on' : '', 'Reveal all underground areas', 'Open every area tab even when none of your ants are inside (normally a tab opens only while your ants or allies are in that area)', () => {
        this.s.revealAreas = !this.s.revealAreas;
        reveal.classList.toggle('on', this.s.revealAreas);
      });
      r6.append(reveal);
      m.appendChild(r6);
    }
    const r5 = el('div', 'row');
    r5.style.marginTop = 'calc(14 * var(--u))';
    if (this.s.net && this.s.player.alive) {
      // two clicks, so a stray one does not end your match
      const give = button('', 'Surrender', 'Concede the match: your queen dies and the others play on', () => {
        if (give.dataset.armed) {
          this.s.surrender();
          this.close();
          return;
        }
        give.dataset.armed = '1';
        give.textContent = 'Click again to surrender';
        setTimeout(() => {
          delete give.dataset.armed;
          give.textContent = 'Surrender';
        }, 4000);
      });
      give.dataset.surrender = '1';
      r5.append(give);
    }
    r5.append(button('', 'Credits', 'Who made what, and the licences of the sounds', () => this.credits()));
    r5.append(button('', 'Quit to title', 'Leave this game and return to the title screen', () => (location.href = location.pathname)));
    m.appendChild(r5);
  }

  /** Every slot: what is in it, and Save here / Load / Download. */
  private async fillSaves(list: HTMLElement): Promise<void> {
    const saves = await listSaves();
    list.innerHTML = '';
    for (const slot of SAVE_SLOTS) {
      const rec = saves.find((r) => r.slot === slot);
      const row = el('div', 'save-row');
      row.dataset.slot = slot;
      row.appendChild(el('b', '', esc(slotName(slot))));
      row.appendChild(el('span', 'dim', rec ? esc(describeSave(rec.header)) : 'Empty'));
      const btns = el('span', 'save-btns');
      if (slot !== 'auto')
        btns.appendChild(
          button('sm', 'Save', rec ? 'Save over this slot' : 'Save the game here', () => {
            void this.s.saveGame(slot, BUILD_ID).then((r) => {
              if (r) this.toast(`Saved: ${slotName(slot)}.`, 'good');
              void this.fillSaves(list);
            });
          }),
        );
      if (rec) {
        btns.appendChild(button('sm', 'Load', 'Load this save (this game ends; save it first if you want to keep it)', () => this.loadSlot(slot)));
        btns.appendChild(button('sm', '⇩', 'Download this save as a file', () => download(rec.bytes, `underground-dominion-${slot}.udsave`)));
      }
      row.appendChild(btns);
      list.appendChild(row);
    }
  }

  /** Load a slot: the page restarts into it (a fresh renderer and worker). */
  loadSlot(slot: SaveSlot): void {
    location.href = `${location.pathname}?load=${slot}`;
  }

  private loadBytes(bytes: Uint8Array): void {
    try {
      readSaveHeader(bytes);
    } catch (e) {
      return this.toast(e instanceof Error ? e.message : String(e), 'warn');
    }
    void putSave('import', bytes).then(() => this.loadSlot('import'));
  }

  private graphicsTab(m: HTMLElement): void {
    m.appendChild(el('h3', '', 'Quality'));
    const r2 = el('div', 'row');
    const aq = this.s.autoQuality;
    for (const q of ['auto', 'low', 'medium', 'high'] as Array<Quality | 'auto'>) {
      const on = q === 'auto' ? aq.enabled : !aq.enabled && this.s.view.quality === q;
      const tip = q === 'auto' ? `Graphics quality follows the frame rate (now ${this.s.view.quality})` : `Graphics quality: ${q}`;
      const b = button(on ? 'on' : '', q[0].toUpperCase() + q.slice(1), tip, () => {
        aq.enabled = q === 'auto';
        if (q === 'auto') aq.ceiling = 'high';
        else this.s.view.setQuality(q);
        updateSettings({ quality: q });
        for (const x of Array.from(r2.children)) x.classList.remove('on');
        b.classList.add('on');
      });
      r2.appendChild(b);
    }
    m.appendChild(r2);
    m.appendChild(el('h3', '', 'Interface size'));
    const r3 = el('div', 'row');
    for (const k of [0.7, 0.85, 1, 1.15, 1.3]) {
      const b = button(Math.abs(settings().uiScale - k) < 0.01 ? 'on' : '', `${Math.round(k * 100)}%`, 'Scale the interface. It always fits the window: on a 16:9 screen 100 % already fills the width, so larger sizes only grow where there is room.', () => {
        updateSettings({ uiScale: k });
        this.onScale?.(k);
        for (const x of Array.from(r3.children)) x.classList.remove('on');
        b.classList.add('on');
      });
      r3.appendChild(b);
    }
    m.appendChild(r3);
    m.appendChild(el('h3', '', 'Camera'));
    const r5 = el('div', 'row');
    const edge = button(this.s.input.edgeScroll ? 'on' : '', 'Edge scrolling', 'Pan the camera when the pointer touches a screen edge', () => {
      this.s.input.edgeScroll = !this.s.input.edgeScroll;
      updateSettings({ edgeScroll: this.s.input.edgeScroll });
      edge.classList.toggle('on', this.s.input.edgeScroll);
    });
    r5.append(edge);
    m.appendChild(r5);
  }

  private soundTab(m: HTMLElement): void {
    const st = settings();
    const r = el('div', 'row');
    const mute = button(st.muted ? 'on' : '', 'Mute all', 'Silence every sound (M is not bound; this is the only switch)', () => {
      const on = !settings().muted;
      updateSettings({ muted: on });
      mute.classList.toggle('on', on);
    });
    mute.dataset.mute = '1';
    r.append(mute);
    m.appendChild(r);
    const rows: Array<[keyof Volumes, string, string]> = [
      ['master', 'Master', 'Everything'],
      ['ambience', 'Ambience', 'Wind, birds, insects and water on the surface; the hush, trickles and rumble of the nest'],
      ['creatures', 'Creatures', 'Footsteps, the rustle of the swarm, digging and carrying, spiders, beetles, centipedes and bosses'],
      ['combat', 'Combat', 'Bites, stings, acid, and the noise of a battle'],
      ['ui', 'Interface', 'Marker chirps, tool taps and alerts'],
      ['music', 'Music', 'Quiet acoustic music that turns tense when your colony fights'],
      ['narration', 'Narration', 'The cue before each narrator caption (and recorded narration, if added)'],
    ];
    const grid = el('div', 'vol-grid');
    for (const [k, name, tip] of rows) {
      const lab = el('span', 'k', esc(name));
      lab.dataset.tip = tip;
      const sl = el('input', 'vol');
      sl.type = 'range';
      sl.min = '0';
      sl.max = '100';
      sl.value = String(Math.round(st.volume[k] * 100));
      sl.dataset.vol = k;
      const val = el('span', 'dim', `${sl.value}%`);
      sl.addEventListener('input', () => {
        val.textContent = `${sl.value}%`;
        updateSettings({ volume: { [k]: Number(sl.value) / 100 } as unknown as Volumes });
      });
      grid.append(lab, sl, val);
    }
    m.appendChild(grid);
    m.appendChild(el('p', 'dim', 'Sounds are placed where they happen: zoom in and they come close; you hear only the place you are watching, and important events elsewhere arrive muffled. Until recordings are added (docs/audio/sound-list.md), each sound plays a stand-in built from the physics of the real one.'));
  }

  private controlsTab(m: HTMLElement): void {
    const inp = this.s.input;
    m.appendChild(el('p', 'dim', 'Click a key to change it, then press the new key (Esc keeps the old one). A key already in use swaps with it.'));
    const groups: Array<[string, Action[]]> = [
      ['Camera', ['panUp', 'panDown', 'panLeft', 'panRight', 'rotateLeft', 'rotateRight', 'zoomIn', 'zoomOut', 'resetCam', 'observe', 'photo']],
      ['Markers and tools', ['marker1', 'marker2', 'marker3', 'marker4', 'marker5', 'jumpMarker', 'dig', 'upgradeTool', 'deleteTool', 'recall']],
      ['Areas', ['toggleView', 'nextArea', 'area1', 'area2', 'area3', 'area4', 'area5', 'area6', 'area7', 'area8']],
      ['Game', ['pause', 'speedUp', 'speedDown', 'overlay', 'quickSave', 'quickLoad', 'debug', 'chat']],
    ];
    for (const [title, actions] of groups) {
      m.appendChild(el('h3', '', esc(title)));
      const k = el('div', 'keys bind');
      for (const a of actions) {
        const b = button('sm keycap', esc(keyLabel(inp.bindings[a])), `Change the key for: ${ACTION_LABELS[a]}`, () => {
          for (const x of Array.from(m.querySelectorAll('.keycap.wait'))) x.classList.remove('wait');
          b.classList.add('wait');
          b.textContent = 'Press a key…';
          inp.rebindTarget = (code) => {
            b.classList.remove('wait');
            if (code !== 'Escape' && code !== inp.bindings.cancel) {
              inp.bindings = rebind(inp.bindings, a, code);
              updateSettings({ bindings: bindingChanges(inp.bindings) });
            }
            this.controlsRefresh(m);
          };
        });
        b.dataset.action = a;
        k.append(el('span', '', esc(ACTION_LABELS[a])), b);
      }
      m.appendChild(k);
    }
    const r = el('div', 'row');
    r.style.marginTop = 'calc(12 * var(--u))';
    r.append(
      button('', 'Reset to defaults', 'Put every key back as it was', () => {
        inp.bindings = { ...DEFAULT_BINDINGS };
        updateSettings({ bindings: {} });
        this.controlsRefresh(m);
      }),
    );
    m.appendChild(r);
    m.appendChild(el('h3', '', 'Mouse'));
    m.appendChild(mouseList());
  }

  private controlsRefresh(m: HTMLElement): void {
    for (const b of Array.from(m.querySelectorAll<HTMLElement>('.keycap'))) b.textContent = keyLabel(this.s.input.bindings[b.dataset.action as Action]);
  }

  credits(): void {
    this.modal('Credits', (m) => {
      const box = el('div', 'credits', creditsHtml());
      m.appendChild(box);
      const r = el('div', 'row');
      r.append(button('', 'Back', 'Back to the menu', () => this.pause('game')));
      m.appendChild(r);
    });
  }

  /** A mission's opening card: the story, the stages ahead, a tip for the species, and the medal times. */
  briefing(): void {
    const m = missionOf(this.s.world);
    if (!m) return;
    const def = MISSIONS[m.id];
    const sp = SPECIES[this.s.player.species];
    const best = profile().medals[m.id];
    this.modal(def.title, (box) => {
      box.classList.add('briefing');
      box.appendChild(el('p', '', esc(def.brief)));
      box.appendChild(el('h3', '', 'The stages'));
      const ol = el('ol', 'stages');
      for (const st of def.stages) ol.appendChild(el('li', '', esc(st.name)));
      box.appendChild(ol);
      box.appendChild(el('h3', '', `Your colony: ${esc(sp.common)}`));
      box.appendChild(el('p', '', `<i>${esc(sp.scientific)}</i>. ${esc(sp.blurb)}${sp.id !== def.species ? ` (The mission was written for the ${esc(SPECIES[def.species].common.toLowerCase())}; any colony can play it.)` : ''}`));
      box.appendChild(el('h3', '', 'Medals'));
      box.appendChild(el('p', '', `Finish within 25 minutes of game time for <b class="medal gold">gold</b>, 40 for <b class="medal silver">silver</b>; any finish earns <b class="medal bronze">bronze</b>.${best ? ` Your best: <b class="medal ${best.medal}">${best.medal}</b> in ${fmtTime(best.time)}.` : ''}`));
      const r = el('div', 'row');
      r.append(button('go-btn', 'Begin', 'Start the mission', () => this.close()));
      box.appendChild(r);
    });
  }

  help(): void {
    this.modal('How to play', (m) => {
      m.appendChild(el('h3', '', 'The nest'));
      m.appendChild(
        el(
          'p',
          '',
          'Your queen sits in her seven-tile chamber. Each chamber tile stores 10 food and raises one small <b>nanitic</b> worker; you start with three. The queen lays eggs and your <b>home workers</b> carry them to empty brood tiles, where each larva grows while there is food. Use <b>Dig</b> to mark soil, place <b>brood tiles</b>, <b>food stores</b> and <b>highways</b> on dug floor — a worker builds each one and the food is paid when it is done — and use <b>Upgrade</b> and <b>Delete</b> on finished tiles. Touching tiles of one kind form a <b>chamber</b>: one group card in the marker panel.',
        ),
      );
      m.appendChild(el('h3', '', 'Food and markers'));
      m.appendChild(
        el(
          'p',
          '',
          'Home workers stay inside and do the nest jobs. To gather food, place a marker <b>I–V</b> (click a column header or press 1–5, then click the ground) on food and drag a group card onto that marker’s column — the queen’s own group too, early on. Workers collect food around their marker and carry it home; soldiers hold the spot and fight. Drag cards back to the home column to call groups in.',
        ),
      );
      m.appendChild(el('h3', '', 'Underground areas'));
      m.appendChild(
        el(
          'p',
          '',
          'The numbered tabs on the left are the level’s underground areas: <b>1</b> is your nest; others are enemy and allied nests and neutral caves. A tab opens only while your ants (or allies) are inside. To go in, place a marker on the area’s <b>entrance on the surface</b> (marked with its number on the surface map); once your ants are inside you can open its tab and place markers within it. Ants cut off from their queen weaken and die.',
        ),
      );
      m.appendChild(el('h3', '', 'Controls'));
      m.appendChild(controlsList(this.s.input.bindings));
    });
  }
}

function fmtTime(t: number): string {
  return `${Math.floor(t / 60)} min ${String(Math.floor(t % 60)).padStart(2, '0')} s`;
}

function mouseList(): HTMLElement {
  const k = el('div', 'keys');
  const rows: Array<[string, string]> = TOUCH
    ? [
        ['Drag one finger', 'Pan the camera (Dig and Build tools: paint hexes)'],
        ['Pinch · twist two fingers', 'Zoom · rotate (two fingers also pan)'],
        ['Three fingers up / down', 'Tilt the camera'],
        ['Tap', 'Place the selected marker or tile; inspect an ant'],
        ['Long press', 'Lift a marker; cancel the tool. On a button: its tooltip'],
        ['✕ (top centre)', 'Cancel the tool / stop following'],
        ['Marker panel toggles', 'No attacking · no gathering · no climbing, per marker'],
      ]
    : [
    ['Left-drag · middle-drag', 'Pan the camera'],
    ['Wheel', 'Zoom (tilts lower up close)'],
    ['Right-drag', 'Rotate and tilt'],
    ['Click', 'Place the selected marker or tile; inspect an ant'],
    ['Right-click a marker', 'Lift it'],
    ['Screen edges', 'Pan (edge scrolling, in Graphics)'],
    ['Marker panel toggles', 'No attacking · no gathering · no climbing, per marker'],
  ];
  for (const [a, b] of rows) k.append(el('span', 'k', esc(a)), el('span', '', esc(b)));
  return k;
}

/** The controls, with the player's current keys. */
function controlsList(b: Record<Action, string>): HTMLElement {
  const k = el('div', 'keys');
  const key = (a: Action) => keyLabel(b[a]);
  const rows: Array<[string, string]> = [
    [`${key('panUp')}${key('panLeft')}${key('panDown')}${key('panRight')} / arrows / edges`, 'Pan the camera (left- or middle-drag too)'],
    [`Wheel · ${key('zoomIn')} / ${key('zoomOut')}`, 'Zoom (tilts lower up close)'],
    [`Right-drag · ${key('rotateLeft')} / ${key('rotateRight')}`, 'Rotate and tilt'],
    [key('resetCam'), 'Reset the camera'],
    [key('toggleView'), 'Surface ⇄ last underground area'],
    ['Shift + 1 – 8 · area tabs', 'Go to underground area 1–8'],
    [key('debug'), 'Debug overlay: frame rate, simulation tick time, network'],
    [key('nextArea'), 'Next open underground area'],
    [`${key('marker1')} – ${key('marker5')}`, 'Select marker I–V to place'],
    [key('jumpMarker'), 'Jump to the selected marker'],
    ['Right-click a marker', 'Lift it'],
    [`${key('dig')} · ${key('upgradeTool')} · ${key('deleteTool')}`, 'Dig · Upgrade · Delete tools'],
    [key('pause'), 'Pause'],
    [`${key('speedDown')} / ${key('speedUp')}`, 'Slower / faster'],
    [key('overlay'), 'Pheromone trails'],
    [key('recall'), 'Recall every group home'],
    [key('observe'), 'Follow the inspected ant'],
    [`${key('quickSave')} · ${key('quickLoad')}`, 'Quick save · quick load'],
    [`${key('photo')} · Shift+${key('photo')}`, 'Photo mode · free camera'],
    ['Esc', 'Cancel tool / stop following / menu'],
  ];
  for (const [a, d] of rows) k.append(el('span', 'k', esc(a)), el('span', '', esc(d)));
  return k;
}
