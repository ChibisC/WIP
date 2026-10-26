/**
 * Title screen (Single-player / Multiplayer), the multiplayer menu (create or
 * join a game) and the lobby screen (multiplayer brief, Part E).
 */
import { BORROWABLE, CASTES, SPECIES } from '../sim/species';
import { Lobby, LOBBY_SPECIES, SLOT_COUNT } from '../net/lobby';
import { LOBBY_TEAMS, TEAM_COLORS, TEAM_NAMES, cleanTeam } from '../net/match';
import { mapPreview } from './mapPreview';
import type { MapStyle } from '../world/terrain';
import { SaveRecord, SaveSlot, describeSave, listSaves, slotName } from '../game/saves';
import { creditsHtml } from './credits';
import { MAPS, PLAYABLE_MAPS } from '../maps';
import type { MapId } from '../maps/types';
import { runNetCheck } from './netCheckView';

const COLORS = ['#d9a441', '#d0554a', '#5b8ed6', '#4fb595', '#b072d6', '#e07a3c', '#8fbf3f', '#e0e0d0'];
/** "Red Wood Mortar": a borrowable caste's species and caste name */
const casteName = (id: string) => `${SPECIES[CASTES[id].species].common.replace(' Ant', '')} ${CASTES[id].name}`;
/** map card thumbnails, drawn once per map */
const thumbs = new Map<MapId, HTMLCanvasElement>();

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

/** The game's own website (GitHub Pages), where multiplayer works. */
export const GAME_SITE = 'https://chibisc.github.io/WIP/';

/** How players connect: the internet (PeerJS invite links), the local network (connection codes) or tabs of this browser. */
export type MpMode = 'online' | 'lan' | 'local';

function savedMode(): MpMode {
  try {
    const m = localStorage.getItem('ud-mp-mode');
    return m === 'lan' || m === 'local' ? m : 'online';
  } catch {
    return 'online';
  }
}

/** Create a game or join one: online by room code, on the LAN with connection codes, or in local tabs. */
export function showMultiplayerMenu(
  parent: HTMLElement,
  cb: {
    create: (name: string, local: boolean) => void;
    join: (name: string, code: string, local: boolean) => void;
    lanHost: (name: string) => void;
    lanJoin: (name: string) => void;
    back: () => void;
  },
  error = '',
  mode: MpMode = savedMode(),
): void {
  const tabs: Array<[MpMode, string, string]> = [
    ['online', 'Online', 'Invite link over the internet'],
    ['lan', 'LAN', 'Same Wi-Fi, connection codes, no internet needed'],
    ['local', 'Local tabs', 'Testing: tabs of this browser'],
  ];
  // Online and LAN play use WebRTC. Some embedding pages (the published artifact's frame) give the game
  // none: say so and point to the game's website instead of failing later.
  const rtc = typeof RTCPeerConnection !== 'undefined';
  const noRtc =
    mode !== 'local' && !rtc
      ? `<p class="mp-error">This page can't make network connections between players (it has no WebRTC here: the page that embeds the game blocks it). Play multiplayer on the game's website, <a href="${GAME_SITE}" target="_blank" rel="noopener">${GAME_SITE.replace('https://', '')}</a>, or use Local tabs to try it on this computer.</p>`
      : '';
  const body =
    mode === 'lan'
      ? `<p class="dim">Play with others on the same Wi-Fi or network, with no servers and no internet once the game has loaded. The host adds each player by showing a code (QR or text); the player's device answers with a reply code for the host.</p>
         <div class="opt-row"><button class="go" data-a="lan-host">Host LAN game</button><button class="go" data-a="lan-join">Join LAN game</button></div>`
      : `<h2>Create</h2>
         <div class="opt-row"><button class="go" data-a="create">Create game</button></div>
         <h2>Join</h2>
         <div class="opt-row"><input class="mp-input code" data-f="code" maxlength="6" placeholder="ROOM CODE"><button class="go" data-a="join">Join game</button></div>
         ${mode === 'local' ? '<p class="dim">Local test: the players are tabs of this browser on this computer (no network).</p>' : ''}`;
  // a route check for online and LAN play: what this device's network allows, in plain words
  const check =
    mode === 'local' || !rtc
      ? ''
      : `<div class="opt-row" style="margin-top:14px"><button class="chip" data-a="check">Check connection</button><span class="dim">${mode === 'lan' ? 'Can other devices on this Wi-Fi find this one?' : 'Can this device reach the other players?'}</span></div><div class="mp-netcheck" hidden></div>`;
  const root = screen(
    parent,
    `<h1>Multiplayer</h1>
     <p class="tag">Up to 8 colonies on one map — players and AI, in teams if you like.</p>
     ${error ? `<p class="mp-error">${esc(error)}</p>` : ''}
     <h2>Your name</h2>
     <input class="mp-input" data-f="name" maxlength="24" placeholder="Queen of the meadow" value="${esc(savedName())}">
     <h2>Connect</h2>
     <div class="mode-tabs mp-modes">${tabs.map(([id, n, d]) => `<button class="mode-tab ${id === mode ? 'on' : ''}" data-mode="${id}"><b>${n}</b><span>${d}</span></button>`).join('')}</div>
     ${noRtc}${body}${check}
     <div class="opt-row" style="margin-top:18px"><button class="chip" data-a="back">← Back</button></div>`,
  );
  const val = (f: string) => root.querySelector(`[data-f="${f}"]`) as HTMLInputElement;
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    const name = val('name').value.trim() || 'Player';
    saveName(name);
    if (b.dataset.mode) {
      try {
        localStorage.setItem('ud-mp-mode', b.dataset.mode);
      } catch {
        // private mode
      }
      root.remove();
      showMultiplayerMenu(parent, cb, '', b.dataset.mode as MpMode);
      return;
    }
    const local = mode === 'local';
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
    } else if (b.dataset.a === 'lan-host') {
      root.remove();
      cb.lanHost(name);
    } else if (b.dataset.a === 'lan-join') {
      root.remove();
      cb.lanJoin(name);
    } else if (b.dataset.a === 'check') {
      const box = root.querySelector('.mp-netcheck') as HTMLElement | null;
      if (box && mode !== 'local') runNetCheck(box, mode);
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
    /** LAN host: open the code dialog for a slot */
    private addPlayer?: (slot: number) => void,
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
    const lan = !!this.lobby.transport.lan;
    const link = lan ? '' : inviteLink(L.room, this.local);
    const host = L.isHost;
    const rows = L.slots
      .map((s, i) => {
        const mine = i === L.you;
        const sp = SPECIES[s.species];
        const filled = s.kind === 'human' || s.kind === 'ai';
        const color = `<span class="lb-col" style="background:${COLORS[s.color % COLORS.length]}"></span>`;
        let who = '';
        if (s.kind === 'human') who = `<b>${esc(s.name)}</b>${i === 0 ? ' <span class="dim">(host)</span>' : ''}${mine ? ' <span class="dim">(you)</span>' : ''}`;
        else if (s.kind === 'ai') who = '<b>AI colony</b>';
        else who = `<span class="dim">${s.kind === 'open' ? 'Open — waiting for a player' : 'Closed'}</span>`;
        const editSpecies = (mine && !L.started) || (host && s.kind === 'ai');
        const species = filled
          ? editSpecies
            ? `<select data-slot="${i}" data-f="species">${LOBBY_SPECIES.map((id) => `<option value="${id}" ${id === s.species ? 'selected' : ''}>${SPECIES[id].common}</option>`).join('')}</select>`
            : esc(sp.common)
          : '';
        // teams: you pick your own; the host can arrange everyone
        const t = cleanTeam(s.team);
        const teamBadge = t ? `<span class="lb-team" style="--tc:${TEAM_COLORS[t - 1]}">${TEAM_NAMES[t - 1]}</span>` : '<span class="dim">No team</span>';
        const team = filled
          ? mine || host
            ? `<select class="lb-team-sel" data-slot="${i}" data-f="team" style="--tc:${t ? TEAM_COLORS[t - 1] : 'transparent'}"><option value="0" ${!t ? 'selected' : ''}>No team</option>${TEAM_NAMES.slice(0, LOBBY_TEAMS).map((n, k) => `<option value="${k + 1}" ${t === k + 1 ? 'selected' : ''}>Team ${n}</option>`).join('')}</select>`
            : teamBadge
          : '';
        const kindSel =
          host && i > 0 && s.kind !== 'human'
            ? `<select data-slot="${i}" data-f="kind">${(['open', 'closed', 'ai'] as const).map((k) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${k === 'ai' ? 'AI' : k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>`
            : '';
        const colorBtn = mine || (host && s.kind === 'ai') ? `<button class="chip" data-slot="${i}" data-a="color">Colour</button>` : '';
        const addBtn = host && this.addPlayer && (s.kind === 'open' || s.kind === 'closed') ? `<button class="chip lan-add" data-slot="${i}" data-a="add-player">Add player</button>` : '';
        const ping = s.kind === 'human' && i !== 0 ? `${s.ping || '—'} ms` : '';
        const ready = s.kind === 'human' ? (s.ready ? '<span class="lb-ready">Ready</span>' : '<span class="dim">Not ready</span>') : s.kind === 'ai' ? '<span class="lb-ready">Ready</span>' : '';
        const row = `<tr class="${mine ? 'mine' : ''}"><td>${i + 1}</td><td>${color}</td><td>${who}</td><td>${species}</td><td>${team}</td><td>${addBtn}${kindSel}${colorBtn}</td><td data-ping="${i}">${ping}</td><td>${ready}</td></tr>`;
        // a Gene Thief raises the castes picked here (its own player, or the host for an AI)
        if (!filled || s.species !== 'plagiaria') return row;
        const got = s.borrowed ?? [];
        const thief = editSpecies
          ? `<div class="lb-steal"><span class="dim">Steals (each needs its own room tile):</span>${BORROWABLE.map((id) => `<button class="chip small ${got.includes(id) ? 'on' : ''}" data-slot="${i}" data-a="borrow" data-caste="${id}">${casteName(id)}</button>`).join('')}</div>`
          : `<div class="lb-steal"><span class="dim">Steals:</span> ${got.length ? got.map((id) => esc(casteName(id))).join(', ') : '<span class="dim">nothing yet</span>'}</div>`;
        return `${row}<tr class="lb-sub ${mine ? 'mine' : ''}"><td></td><td colspan="7">${thief}</td></tr>`;
      })
      .join('');
    const st = L.settings;
    const md = st.map ? MAPS[st.map] : undefined;
    // map cards with a sketch of each map: the host picks, everyone sees the choice
    const mapCards = `<div class="map-grid lb-maps">${PLAYABLE_MAPS.map((id) => {
      const m = MAPS[id]!;
      return `<button class="map-card ${st.map === id ? 'on' : ''}" data-map="${id}" ${host ? '' : 'disabled'}><span class="map-thumb" data-thumb="${id}"></span><b>${m.name}</b><i>${(m.width / 1000).toFixed(1)} × ${(m.depth / 1000).toFixed(1)} m${m.floods.length ? ' · floods' : ''}</i></button>`;
    }).join('')}</div>${md ? `<p class="dim">${esc(md.blurb)}</p>` : ''}`;
    const floods = md?.floods.length
      ? host
        ? `<div class="opt-row"><span class="dim">Floods:</span><button class="chip ${!st.floods ? 'on' : ''}" data-a="floods" data-v="0">Off</button><button class="chip ${st.floods ? 'on' : ''}" data-a="floods" data-v="1">On: storms flood the low ground now and then</button></div>`
        : `<p class="dim">Floods ${st.floods ? 'on' : 'off'}.</p>`
      : '';
    const settings = host
      ? `${mapCards}${floods}<div class="lb-settings">
          <label>Seed <input class="mp-input small" data-f="seed" value="${st.seed}"></label>
          <label>Food <select data-f="food">${[0.6, 1.2, 2].map((f) => `<option value="${f}" ${f === st.food ? 'selected' : ''}>${f === 0.6 ? 'Scarce' : f === 1.2 ? 'Normal' : 'Plenty'}</option>`).join('')}</select></label>
          <label>Population cap <select data-f="pop">${[150, 300, 500].map((p) => `<option value="${p}" ${p === st.popLimit ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        </div>`
      : `${mapCards}${floods}<p class="dim">Seed ${st.seed} · food ${st.food === 0.6 ? 'scarce' : st.food === 1.2 ? 'normal' : 'plenty'} · population cap ${st.popLimit} · no pausing · speed 1×</p>`;
    const me = L.slots[L.you];
    const blocker = host ? L.startBlocker() : '';
    const chat = L.chat
      .slice(-30)
      .map((c) => `<div><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`)
      .join('');
    this.root.innerHTML = `<div class="menu-card lobby">
      <h1>${lan ? 'LAN game' : `Lobby <span class="lb-code">${L.room}</span>`}</h1>
      ${L.error ? `<p class="mp-error">${esc(L.error)}</p>` : ''}
      ${
        lan
          ? host
            ? '<p class="dim">Players on the same Wi-Fi join with connection codes: tap <b>Add player</b> on an open slot and follow the steps. No internet is needed.</p>'
            : ''
          : host
          ? `<div class="lb-invite"><input class="mp-input" readonly value="${esc(link)}"><button class="go" data-a="copy">Copy link</button></div>
             <p class="dim">${this.local ? 'Local test: open the link in other tabs of this browser.' : 'Send this link to your friends. Invite links work on the deployed site, not on a local dev server.'}</p>`
          : L.you < 0
            ? '<p class="dim">Connecting to the host…</p>'
            : ''
      }
      <table class="lb-slots"><tbody>${rows}</tbody></table>
      <p class="dim lb-note">Up to ${SLOT_COUNT} colonies. Colonies on the same team are allies: they never fight each other, and the last team with a living queen wins together. “No team” plays for itself.</p>
      <h2>Map</h2>${settings}
      <h2>Chat</h2>
      <div class="lb-chat">${chat || '<span class="dim">Say hello.</span>'}</div>
      <input class="mp-input" data-f="chat" maxlength="200" placeholder="Type and press Enter" value="${esc(this.chatDraft)}">
      <div class="opt-row" style="margin-top:16px">
        ${me && me.kind === 'human' && !host ? `<button class="go" data-a="ready">${me.ready ? 'Not ready' : 'Ready'}</button>` : ''}
        ${host ? `<button class="go" data-a="start" ${blocker ? 'disabled' : ''}>Start match</button><span class="dim">${esc(blocker)}</span>` : ''}
        <button class="chip" data-a="leave">Leave</button>
      </div>
    </div>`;
    this.root.querySelectorAll<HTMLElement>('[data-thumb]').forEach((el) => {
      const id = el.dataset.thumb as MapId;
      let c = thumbs.get(id);
      if (!c) thumbs.set(id, (c = mapPreview(MAPS[id]!, 110)));
      el.appendChild(c);
    });
    const log = this.root.querySelector('.lb-chat');
    if (log) log.scrollTop = log.scrollHeight;
    if (focus) (this.root.querySelector(`[data-f="${focus}"]`) as HTMLElement | null)?.focus();
  }

  private click(e: Event): void {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b) return;
    const L = this.lobby;
    const a = b.dataset.a;
    if (a === 'add-player') {
      const i = Number(b.dataset.slot);
      // a closed slot opens for the player being added
      if (L.slots[i]?.kind === 'closed') L.setSlot(i, { kind: 'open' });
      this.addPlayer?.(i);
      return;
    }
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
      const n = COLORS.length;
      let c = (L.slots[i].color + 1) % n;
      for (let k = 0; k < n && used.has(c); k++) c = (c + 1) % n;
      if (i === L.you) L.setMine({ color: c });
      else L.setSlot(i, { color: c });
    } else if (a === 'borrow') {
      const i = Number(b.dataset.slot);
      const id = b.dataset.caste ?? '';
      const got = [...(L.slots[i].borrowed ?? [])];
      const k = got.indexOf(id);
      if (k >= 0) got.splice(k, 1);
      else got.push(id);
      // keep at least one stolen caste (with none picked the default pair comes back)
      if (!got.length) return;
      if (i === L.you) L.setMine({ borrowed: got });
      else L.setSlot(i, { borrowed: got });
    } else if (a === 'floods') L.setSettings({ floods: b.dataset.v === '1' });
    else if (b.dataset.map && L.isHost) L.setSettings({ map: b.dataset.map as MapId, style: 'meadow' });
  }

  private change(e: Event): void {
    const t = e.target as HTMLSelectElement | HTMLInputElement;
    const L = this.lobby;
    const f = t.dataset.f;
    const slot = Number(t.dataset.slot ?? -1);
    if (f === 'species') {
      if (slot === L.you) L.setMine({ species: t.value as never });
      else L.setSlot(slot, { species: t.value as never });
    } else if (f === 'team') {
      if (slot === L.you) L.setMine({ team: Number(t.value) });
      else L.setSlot(slot, { team: Number(t.value) });
    } else if (f === 'kind') L.setSlot(slot, { kind: t.value as 'open' | 'closed' | 'ai' });
    else if (f === 'style') {
      if (t.value.startsWith('map:')) L.setSettings({ map: t.value.slice(4) as MapId, style: 'meadow' });
      else L.setSettings({ style: t.value as MapStyle, map: undefined });
    }
    else if (f === 'floods') L.setSettings({ floods: t.value === '1' });
    else if (f === 'seed') L.setSettings({ seed: Math.max(1, Math.floor(Number(t.value) || 1)) });
    else if (f === 'food') L.setSettings({ food: Number(t.value) });
    else if (f === 'pop') L.setSettings({ popLimit: Number(t.value) });
  }
}
