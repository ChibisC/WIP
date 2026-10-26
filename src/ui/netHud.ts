/**
 * In-match multiplayer interface (multiplayer brief, Parts D and E):
 * the "Waiting for…" overlay (with Drop for the host),
 * the desync panel with its downloadable report, "host left", the chat
 * (Enter to type, with mute) and the results screen.
 */
import { TEAM_BASE, TEAM_NAMES } from '../net/match';
import type { GameSession } from '../game/session';
import { BUILD_ID } from '../net/messages';
import { WAIT_SHOW_S, DROP_AFTER_S } from '../net/netGame';
import { SPECIES } from '../sim/species';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export class NetHud {
  private root = document.createElement('div');
  private banner = document.createElement('div');
  private bannerText = document.createElement('span');
  private dropBtn = document.createElement('button');
  private chatLog = document.createElement('div');
  private chatInput = document.createElement('input');
  private muteBtn = document.createElement('button');
  private panel: HTMLElement | null = null;
  private panelKey = '';
  /** the local colony is out (shown once) / the match is over */
  private outShown = false;
  private over = false;
  private lines: Array<{ el: HTMLElement; at: number }> = [];
  muted = false;
  private raf = 0;

  /** LAN host: the Players button (reconnect a player with a new code) */
  private playersBtn = document.createElement('button');
  private reconnectBtn = document.createElement('button');

  constructor(
    private s: GameSession,
    parent: HTMLElement,
    private leave: () => void,
    /** LAN play: the host makes a new code for a dropped player; a client goes to the rejoin screen */
    private lan: { reconnect?: (slot: number) => void; rejoin?: () => void } = {},
  ) {
    this.root.className = 'net-hud';
    this.banner.className = 'net-banner pnl';
    this.chatLog.className = 'net-chat';
    this.chatInput.className = 'net-chat-input';
    this.chatInput.maxLength = 200;
    this.chatInput.placeholder = 'Say something to everyone (Enter to send, Esc to close)';
    this.muteBtn.className = 'net-mute';
    this.muteBtn.textContent = 'Mute chat';
    this.muteBtn.onclick = () => {
      this.muted = !this.muted;
      this.muteBtn.textContent = this.muted ? 'Unmute chat' : 'Mute chat';
      this.chatLog.style.display = this.muted ? 'none' : '';
    };
    this.dropBtn.className = 'chip';
    this.dropBtn.dataset.drop = '1';
    this.dropBtn.textContent = 'Drop now';
    this.dropBtn.onclick = () => s.net?.status().waitingFor.forEach((p) => s.net!.dropPlayer(p));
    this.reconnectBtn.className = 'chip';
    this.reconnectBtn.dataset.a = 'reconnect-waiting';
    this.reconnectBtn.textContent = 'Reconnect with a new code';
    this.reconnectBtn.onclick = () => {
      const p = s.net?.status().waitingFor[0];
      if (p !== undefined) this.lan.reconnect?.(p);
    };
    this.banner.append(this.bannerText, this.dropBtn, this.reconnectBtn);
    this.playersBtn.className = 'net-players';
    this.playersBtn.dataset.a = 'players';
    this.playersBtn.textContent = 'Players';
    this.playersBtn.onclick = () => this.playersPanel();
    this.root.append(this.banner, this.chatLog, this.chatInput, this.muteBtn);
    if (s.net?.isHost && s.net.transport.lan && lan.reconnect) this.root.append(this.playersBtn);
    parent.appendChild(this.root);
    s.onChat = (from, text) => this.line(from, text);
    s.input.on('chat', () => this.openChat());
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) s.net?.chat(t);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    s.onGameOver = (winner) => this.results(winner);
    const tick = () => {
      this.update();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private openChat(): void {
    if (!this.s.net) return;
    this.chatInput.classList.add('show');
    this.chatInput.focus();
    this.s.input.enabled = false;
  }

  private closeChat(): void {
    this.chatInput.value = '';
    this.chatInput.classList.remove('show');
    this.chatInput.blur();
    this.s.input.enabled = true;
  }

  private line(from: string, text: string): void {
    if (this.muted) return;
    const el = document.createElement('div');
    el.innerHTML = `<b>${esc(from)}:</b> ${esc(text)}`;
    this.chatLog.appendChild(el);
    this.lines.push({ el, at: performance.now() });
    while (this.lines.length > 8) this.lines.shift()!.el.remove();
  }

  private name(p: number): string {
    return this.s.net?.slots[p]?.name || `Player ${p + 1}`;
  }

  update(): void {
    const net = this.s.net;
    if (!net) return;
    const st = net.status();
    // chat lines fade after 12 s
    const now = performance.now();
    for (const l of this.lines) l.el.style.opacity = String(Math.max(0, Math.min(1, (12000 - (now - l.at)) / 2000)));
    // banner: waiting for a player
    let banner = '';
    let drop = false;
    if (st.waitingFor.length && st.waitingMs > WAIT_SHOW_S * 1000) {
      const left = Math.max(0, DROP_AFTER_S - st.waitingMs / 1000);
      const loading = st.waitingFor.every((p) => st.loading.includes(p));
      banner = `Waiting for ${st.waitingFor.map((p) => this.name(p)).join(', ')}… ${Math.floor(st.waitingMs / 1000)} s${net.isHost ? (loading ? ' · rejoining: loading the match' : ` · the AI takes over in ${Math.ceil(left)} s`) : ''}`;
      drop = net.isHost;
    }
    if (this.bannerText.textContent !== banner) this.bannerText.textContent = banner;
    this.banner.classList.toggle('show', !!banner);
    this.dropBtn.style.display = drop ? '' : 'none';
    this.reconnectBtn.style.display = drop && net.transport.lan && this.lan.reconnect ? '' : 'none';
    // blocking panels
    if (st.desync) this.showPanel('desync', () => this.desyncPanel(st.desync!.tick, st.desync!.hashes));
    else if (st.hostLost && net.transport.lan && !st.hostLeft && this.lan.rejoin)
      this.showPanel(
        'host',
        () =>
          `<h2>Lost the connection to the host</h2><p>If the host is still playing, you can come back in: ask the host to tap <b>Players</b>, then <b>Reconnect</b> next to your name, and enter the new code they show. Your colony keeps going meanwhile (the AI runs it if you are away for long).</p><div class="opt-row"><button class="go" data-a="rejoin">Rejoin with a new code</button><button class="chip" data-a="leave">Back to the menu</button></div>`,
      );
    else if (st.hostLost) this.showPanel('host', () => `<h2>${st.hostLeft ? 'The host ended the match' : 'The host left'}</h2><p>The match cannot continue without the host.</p><div class="opt-row"><button class="go" data-a="leave">Back to the menu</button></div>`);
    else if (!this.s.player.alive && !this.outShown && !this.over) {
      // out of a match that goes on: watch the rest or leave
      this.outShown = true;
      const allies = this.s.world.s.colonies.some((c) => c.alive && c.id !== this.s.player.id && c.team === this.s.player.team);
      this.showPanel('out', () => `<h2>Your queen is gone</h2><p>Your colony is out of the match. ${allies ? 'Your team plays on: if it wins, you win with it.' : 'The others play on'}; you can watch to the end.</p><div class="opt-row"><button class="go" data-a="close">Keep watching</button><button class="chip" data-a="leave">Back to the menu</button></div>`);
    }
  }

  private showPanel(key: string, html: () => string): void {
    if (this.panelKey === key) return;
    this.panelKey = key;
    this.panel?.remove();
    const veil = document.createElement('div');
    veil.className = 'modal-veil';
    veil.innerHTML = `<div class="pnl modal">${html()}</div>`;
    veil.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      if (b.dataset.a === 'leave') this.leave();
      else if (b.dataset.a === 'report') void this.report();
      else if (b.dataset.a === 'rejoin') this.lan.rejoin?.();
      else if (b.dataset.a === 'reconnect') {
        veil.remove();
        this.panel = null;
        this.panelKey = '';
        this.lan.reconnect?.(Number(b.dataset.slot));
      }
      else if (b.dataset.a === 'close') {
        veil.remove();
        this.panel = null;
      }
    });
    this.root.parentElement?.appendChild(veil);
    this.panel = veil;
  }

  /** LAN host: every other player, connected or not, with Reconnect. */
  private playersPanel(): void {
    const net = this.s.net;
    if (!net) return;
    const peers = new Set(net.transport.peers());
    const st = net.status();
    const rows = net.slots
      .map((sl, i) => {
        if (sl.kind !== 'human' || i === net.self) return '';
        const on = peers.has(sl.peer);
        const state = st.dropped.includes(i) ? 'Dropped: the AI runs their colony' : on ? 'Connected' : 'Disconnected';
        return `<tr><td><b>${esc(sl.name)}</b></td><td class="dim">${state}${on ? ` · ${sl.ping || '—'} ms` : ''}</td><td><button class="chip" data-a="reconnect" data-slot="${i}">Reconnect player ${i + 1}</button></td></tr>`;
      })
      .join('');
    this.panelKey = '';
    this.showPanel(
      'players',
      () =>
        `<h2>Players</h2><p class="dim">A player whose connection dropped comes back with a new code: tap Reconnect next to their name, show them the code, then enter their reply.</p><table class="lb-slots"><tbody>${rows || '<tr><td class="dim">No other players.</td></tr>'}</tbody></table><div class="opt-row"><button class="chip" data-a="close">Close</button></div>`,
    );
  }

  private desyncPanel(tick: number, hashes: Record<string, string>): string {
    const rows = Object.entries(hashes)
      .map(([n, h]) => `<div><b>${esc(n)}</b> <code>${h}</code></div>`)
      .join('');
    return `<h2>Desync detected</h2>
      <p>At tick ${tick} the players' games no longer match, so the match has stopped (it never continues out of step).</p>
      ${rows}
      <p class="dim">Download the report and send it to the developer: it holds this game's state, the recent commands and the build id.</p>
      <div class="opt-row"><button class="go" data-a="report">Download report</button><button class="chip" data-a="leave">Leave the match</button></div>`;
  }

  private async report(): Promise<void> {
    const net = this.s.net;
    if (!net) return;
    const r = await net.desyncReport(BUILD_ID);
    const t = net.status().desync?.tick ?? net.status().tick;
    download(`desync-tick${t}-player${net.self}.json`, r.json, 'application/json');
    download(`desync-tick${t}-player${net.self}.udsnap`, r.snapshot.slice().buffer, 'application/octet-stream');
  }

  private results(winner: number): void {
    this.over = true;
    const w = this.s.world;
    const net = this.s.net;
    const rows = w.s.colonies
      .map((c) => {
        const sp = SPECIES[c.species];
        const who = net?.slots[c.id]?.name || c.name;
        const won = c.team === winner;
        return `<tr class="${won ? 'won' : ''}"><td>${won ? '♛' : ''}</td><td><b>${esc(who)}</b><br><span class="dim">${esc(sp.common)}</span></td><td>${c.alive ? 'Alive' : 'Queen lost'}</td><td>${c.stats.peakPop}</td><td>${c.stats.born}</td><td>${c.stats.died}</td><td>${Math.round(c.stats.food)}</td><td>${c.stats.kills}</td></tr>`;
      })
      .join('');
    const me = this.s.player;
    const title = winner === -2 ? 'No queen survived' : me.team === winner ? 'Victory' : 'Defeat';
    // a team wins together (lobby teams are TEAM_BASE + 1…4); a colony with no team is a team of its own
    const winners = w.s.colonies.filter((c) => c.team === winner).map((c) => net?.slots[c.id]?.name || c.name);
    const lobbyTeam = winner - TEAM_BASE;
    const whoWon =
      lobbyTeam >= 1 && lobbyTeam <= TEAM_NAMES.length
        ? `Team ${TEAM_NAMES[lobbyTeam - 1]} wins: ${winners.map(esc).join(', ')}.`
        : `${esc(winners[0] || 'A colony')} is the last queen standing.`;
    this.panelKey = '';
    this.showPanel('results', () => `<h2>${title}</h2>
      <p>${winner === -2 ? 'Every colony lost its queen.' : whoWon} The match lasted ${Math.floor(w.s.time / 60)} min ${Math.floor(w.s.time % 60)} s.</p>
      <table class="lb-slots results"><thead><tr><th></th><th>Colony</th><th></th><th>Peak</th><th>Raised</th><th>Lost</th><th>Food</th><th>Kills</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="opt-row"><button class="go" data-a="leave">Back to the menu</button><button class="chip" data-a="close">Keep watching</button></div>`);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.root.remove();
    this.panel?.remove();
  }
}
