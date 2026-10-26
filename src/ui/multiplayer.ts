/**
 * Title screen (Single-player / Multiplayer), the multiplayer menu (create or
 * join a game) and the lobby screen (multiplayer brief, Part E).
 */
import { SPECIES } from '../sim/species';
import { Lobby, LOBBY_SPECIES } from '../net/lobby';
import type { MapStyle } from '../world/terrain';
import { SaveRecord, SaveSlot, describeSave, listSaves, slotName } from '../game/saves';
import { creditsHtml } from './credits';

const COLORS = ['#d9a441', '#d0554a', '#5b8ed6', '#4fb595'];
const STYLES: Array<[MapStyle, string]> = [['meadow', 'Meadow'], ['forest', 'Forest floor'], ['riverbank', 'Riverbank'], ['sandy', 'Sandy scrub']];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function screen(parent: HTMLElement, html: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'menu';
  root.innerHTML = `<div class="menu-card">${html}</div>`;
  parent.appendChild(root);
  return root;
}

export interface TitleSaves {
  /** load a stored slot */
  slot: (slot: SaveSlot) => void;
  /** load a .udsave file */
  file: (bytes: Uint8Array) => void;
}

/** The first screen: Continue (the newest save), single-player or multiplayer, load a game, watch a replay. */
export function showTitle(parent: HTMLElement, single: () => void, multi: () => void, replay?: (bytes: Uint8Array) => void, saves?: TitleSaves): void {
  const root = screen(
    parent,
    `<h1>UNDERGROUND DOMINION</h1>
     <p class="tag">An ant colony strategy game rooted in real biology</p>
     <div class="continue-row"></div>
     <div class="title-modes">
       <button class="mode-card" data-m="single"><b>Single-player</b><p>Missions, skirmish against AI colonies, and the sandbox. Your own pace: pause and speed up any time.</p></button>
       <button class="mode-card" data-m="multi"><b>Multiplayer</b><p>2–4 players and AI colonies on one map. Create a game and send the invite link. Last queen standing wins. The match runs at 1× and cannot be paused.</p></button>
     </div>
     <div class="opt-row" style="margin-top:14px">${saves ? '<button class="chip" data-m="load">Load a game…</button>' : ''}<button class="chip" data-m="replay">Watch a replay…</button><button class="chip" data-m="credits">Credits</button><input type="file" data-f="replay" accept=".udreplay" hidden><input type="file" data-f="save" accept=".udsave" hidden></div>
     <div class="load-list"></div>`,
  );
  const file = root.querySelector('input[data-f=replay]') as HTMLInputElement;
  const saveFile = root.querySelector('input[data-f=save]') as HTMLInputElement;
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f || !replay) return;
    void f.arrayBuffer().then((b) => {
      root.remove();
      replay(new Uint8Array(b));
    });
  });
  saveFile.addEventListener('change', () => {
    const f = saveFile.files?.[0];
    if (!f || !saves) return;
    void f.arrayBuffer().then((b) => {
      root.remove();
      saves.file(new Uint8Array(b));
    });
  });
  let list: SaveRecord[] = [];
  if (saves)
    void listSaves().then((all) => {
      list = all;
      const newest = all[0];
      const row = root.querySelector('.continue-row') as HTMLElement;
      if (newest) row.innerHTML = `<button class="mode-card continue" data-m="continue"><b>Continue</b><p>${esc(slotName(newest.slot))}: ${esc(describeSave(newest.header))}</p></button>`;
    });
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.m === 'replay') return file.click();
    if (b.dataset.m === 'load') {
      const box = root.querySelector('.load-list') as HTMLElement;
      if (box.innerHTML) return void (box.innerHTML = '');
      box.innerHTML = `<h2>Saved games</h2>${list.length ? list.map((r) => `<button class="sp-card load-card" data-slot="${r.slot}"><b>${esc(slotName(r.slot))}</b><p>${esc(describeSave(r.header))}</p><i>${esc(r.header.colonyName)}</i></button>`).join('') : '<p class="dim">No saved games in this browser yet.</p>'}<div class="opt-row"><button class="chip" data-m="loadfile">Load from a file…</button></div>`;
      return;
    }
    if (b.dataset.m === 'loadfile') return saveFile.click();
    if (b.dataset.m === 'credits') {
      const box = root.querySelector('.load-list') as HTMLElement;
      box.innerHTML = box.dataset.credits ? '' : `<div class="credits">${creditsHtml()}</div>`;
      box.dataset.credits = box.innerHTML ? '1' : '';
      return;
    }
    if (b.dataset.slot && saves) {
      root.remove();
      return saves.slot(b.dataset.slot as SaveSlot);
    }
    if (b.dataset.m === 'continue' && saves && list[0]) {
      root.remove();
      return saves.slot(list[0].slot);
    }
    if (b.dataset.m !== 'single' && b.dataset.m !== 'multi') return;
    root.remove();
    if (b.dataset.m === 'single') single();
    else multi();
  });
}

export function savedName(): string {
  try {
    return localStorage.getItem('ud-name') || '';
  } catch {
    return '';
  }
}

function saveName(n: string): void {
  try {
    localStorage.setItem('ud-name', n);
  } catch {
    // private mode
  }
}

/** Create a game or join one by code. `local` uses browser tabs on this computer (no network). */
export function showMultiplayerMenu(
  parent: HTMLElement,
  cb: { create: (name: string, local: boolean) => void; join: (name: string, code: string, local: boolean) => void; back: () => void },
  error = '',
): void {
  const root = screen(
    parent,
    `<h1>Multiplayer</h1>
     <p class="tag">Up to 4 players. The host creates a game and shares the invite link.</p>
     ${error ? `<p class="mp-error">${esc(error)}</p>` : ''}
     <h2>Your name</h2>
     <input class="mp-input" data-f="name" maxlength="24" placeholder="Queen of the meadow" value="${esc(savedName())}">
     <h2>Create</h2>
     <div class="opt-row"><button class="go" data-a="create">Create game</button></div>
     <h2>Join</h2>
     <div class="opt-row"><input class="mp-input code" data-f="code" maxlength="6" placeholder="ROOM CODE"><button class="go" data-a="join">Join game</button></div>
     <h2>Testing</h2>
     <label class="mp-check"><input type="checkbox" data-f="local"> Local test: players are browser tabs on this computer (no internet needed)</label>
     <div class="opt-row" style="margin-top:18px"><button class="chip" data-a="back">← Back</button></div>`,
  );
  const val = (f: string) => (root.querySelector(`[data-f="${f}"]`) as HTMLInputElement);
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    const name = val('name').value.trim() || 'Player';
    saveName(name);
    const local = val('local').checked;
    if (b.dataset.a === 'create') {
      root.remove();
      cb.create(name, local);
    } else if (b.dataset.a === 'join') {
      const code = val('code').value.trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(code)) {
        val('code').classList.add('bad');
        return;
      }
      root.remove();
      cb.join(name, code, local);
    } else if (b.dataset.a === 'back') {
      root.remove();
      cb.back();
    }
  });
}

/** The invite link for a room. */
export function inviteLink(room: string, local: boolean): string {
  const u = new URL(location.href);
  u.search = `?room=${room}${local ? '&local=1' : ''}`;
  u.hash = '';
  return u.toString();
}

/** The lobby screen: slots, settings, chat, ready / start. Re-renders on every change. */
export class LobbyView {
  readonly root: HTMLElement;
  private chatDraft = '';
  private timer: ReturnType<typeof setInterval>;
  private key = '';

  constructor(
    parent: HTMLElement,
    private lobby: Lobby,
    private local: boolean,
    private leave: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    parent.appendChild(this.root);
    lobby.onChange = () => this.render();
    this.root.addEventListener('click', (e) => this.click(e));
    this.root.addEventListener('change', (e) => this.change(e));
    this.root.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.f === 'chat' && e.key === 'Enter') {
        lobby.say(t.value);
        this.chatDraft = '';
        t.value = '';
      }
    });
    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.f === 'chat') this.chatDraft = t.value;
    });
    this.timer = setInterval(() => lobby.pingAll(), 1000);
    this.render();
  }

  close(): void {
    clearInterval(this.timer);
    this.root.remove();
  }

  private render(): void {
    const L = this.lobby;
    // Pings change every second: update them in place so open menus and the chat box are not rebuilt.
    const key = JSON.stringify([L.slots.map((s) => ({ ...s, ping: 0 })), L.settings, L.chat.length, L.error, L.you]);
    if (key === this.key) {
      L.slots.forEach((s, i) => {
        const td = this.root.querySelector(`[data-ping="${i}"]`);
        if (td) td.textContent = s.kind === 'human' && i !== 0 ? `${s.ping || '—'} ms` : '';
      });
      return;
    }
    this.key = key;
    const focus = (document.activeElement as HTMLElement | null)?.dataset?.f;
    const link = inviteLink(L.room, this.local);
    const host = L.isHost;
    const rows = L.slots
      .map((s, i) => {
        const mine = i === L.you;
        const sp = SPECIES[s.species];
        const color = `<span class="lb-col" style="background:${COLORS[s.color % 4]}"></span>`;
        let who = '';
        if (s.kind === 'human') who = `<b>${esc(s.name)}</b>${i === 0 ? ' <span class="dim">(host)</span>' : ''}${mine ? ' <span class="dim">(you)</span>' : ''}`;
        else if (s.kind === 'ai') who = '<b>AI colony</b>';
        else who = `<span class="dim">${s.kind === 'open' ? 'Open — waiting for a player' : 'Closed'}</span>`;
        const species =
          s.kind === 'human' || s.kind === 'ai'
            ? (mine && !L.started) || (host && s.kind === 'ai')
              ? `<select data-slot="${i}" data-f="species">${LOBBY_SPECIES.map((id) => `<option value="${id}" ${id === s.species ? 'selected' : ''}>${SPECIES[id].common}</option>`).join('')}</select>`
              : esc(sp.common)
            : '';
        const kindSel =
          host && i > 0 && s.kind !== 'human'
            ? `<select data-slot="${i}" data-f="kind">${(['open', 'closed', 'ai'] as const).map((k) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${k === 'ai' ? 'AI' : k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>`
            : '';
        const colorBtn = mine || (host && s.kind === 'ai') ? `<button class="chip" data-slot="${i}" data-a="color">Colour</button>` : '';
        const ping = s.kind === 'human' && i !== 0 ? `${s.ping || '—'} ms` : '';
        const ready = s.kind === 'human' ? (s.ready ? '<span class="lb-ready">Ready</span>' : '<span class="dim">Not ready</span>') : s.kind === 'ai' ? '<span class="lb-ready">Ready</span>' : '';
        return `<tr class="${mine ? 'mine' : ''}"><td>${i + 1}</td><td>${color}</td><td>${who}</td><td>${species}</td><td>${kindSel}${colorBtn}</td><td data-ping="${i}">${ping}</td><td>${ready}</td></tr>`;
      })
      .join('');
    const st = L.settings;
    const settings = host
      ? `<div class="lb-settings">
          <label>Map <select data-f="style">${STYLES.map(([id, n]) => `<option value="${id}" ${id === st.style ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Seed <input class="mp-input small" data-f="seed" value="${st.seed}"></label>
          <label>Food <select data-f="food">${[0.6, 1.2, 2].map((f) => `<option value="${f}" ${f === st.food ? 'selected' : ''}>${f === 0.6 ? 'Scarce' : f === 1.2 ? 'Normal' : 'Plenty'}</option>`).join('')}</select></label>
          <label>Population cap <select data-f="pop">${[150, 300, 500].map((p) => `<option value="${p}" ${p === st.popLimit ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        </div>`
      : `<p class="dim">Map ${STYLES.find((x) => x[0] === st.style)?.[1]} · seed ${st.seed} · food ${st.food === 0.6 ? 'scarce' : st.food === 1.2 ? 'normal' : 'plenty'} · population cap ${st.popLimit} · no pausing · speed 1×</p>`;
    const me = L.slots[L.you];
    const blocker = host ? L.startBlocker() : '';
    const chat = L.chat
      .slice(-30)
      .map((c) => `<div><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`)
      .join('');
    this.root.innerHTML = `<div class="menu-card lobby">
      <h1>Lobby <span class="lb-code">${L.room}</span></h1>
      ${L.error ? `<p class="mp-error">${esc(L.error)}</p>` : ''}
      ${
        host
          ? `<div class="lb-invite"><input class="mp-input" readonly value="${esc(link)}"><button class="go" data-a="copy">Copy link</button></div>
             <p class="dim">${this.local ? 'Local test: open the link in other tabs of this browser.' : 'Send this link to your friends. Invite links work on the deployed site, not on a local dev server.'}</p>`
          : L.you < 0
            ? '<p class="dim">Connecting to the host…</p>'
            : ''
      }
      <table class="lb-slots"><tbody>${rows}</tbody></table>
      <h2>Settings</h2>${settings}
      <h2>Chat</h2>
      <div class="lb-chat">${chat || '<span class="dim">Say hello.</span>'}</div>
      <input class="mp-input" data-f="chat" maxlength="200" placeholder="Type and press Enter" value="${esc(this.chatDraft)}">
      <div class="opt-row" style="margin-top:16px">
        ${me && me.kind === 'human' && !host ? `<button class="go" data-a="ready">${me.ready ? 'Not ready' : 'Ready'}</button>` : ''}
        ${host ? `<button class="go" data-a="start" ${blocker ? 'disabled' : ''}>Start match</button><span class="dim">${esc(blocker)}</span>` : ''}
        <button class="chip" data-a="leave">Leave</button>
      </div>
    </div>`;
    const log = this.root.querySelector('.lb-chat');
    if (log) log.scrollTop = log.scrollHeight;
    if (focus) (this.root.querySelector(`[data-f="${focus}"]`) as HTMLElement | null)?.focus();
  }

  private click(e: Event): void {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    const L = this.lobby;
    const a = b.dataset.a;
    if (a === 'copy') {
      void navigator.clipboard?.writeText(inviteLink(L.room, this.local)).catch(() => undefined);
      b.textContent = 'Copied!';
      setTimeout(() => (b.textContent = 'Copy link'), 1500);
    } else if (a === 'ready') L.setMine({ ready: !L.slots[L.you].ready });
    else if (a === 'start') L.start();
    else if (a === 'leave') this.leave();
    else if (a === 'color') {
      const i = Number(b.dataset.slot);
      const used = new Set(L.slots.map((s) => s.color));
      let c = (L.slots[i].color + 1) % 4;
      for (let k = 0; k < 4 && used.has(c); k++) c = (c + 1) % 4;
      if (i === L.you) L.setMine({ color: c });
      else L.setSlot(i, { color: c });
    }
  }

  private change(e: Event): void {
    const t = e.target as HTMLSelectElement | HTMLInputElement;
    const L = this.lobby;
    const f = t.dataset.f;
    const slot = Number(t.dataset.slot ?? -1);
    if (f === 'species') {
      if (slot === L.you) L.setMine({ species: t.value as never });
      else L.setSlot(slot, { species: t.value as never });
    } else if (f === 'kind') L.setSlot(slot, { kind: t.value as 'open' | 'closed' | 'ai' });
    else if (f === 'style') L.setSettings({ style: t.value as MapStyle });
    else if (f === 'seed') L.setSettings({ seed: Math.max(1, Math.floor(Number(t.value) || 1)) });
    else if (f === 'food') L.setSettings({ food: Number(t.value) });
    else if (f === 'pop') L.setSettings({ popLimit: Number(t.value) });
  }
}
