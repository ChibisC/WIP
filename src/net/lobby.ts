/**
 * The multiplayer lobby (multiplayer brief, Part E).
 *
 * The host creates a room: a six-letter code that becomes the invite link
 * `?room=CODE`. Guests open the link and join; the host gives each a free
 * slot. There are eight slots, each open, closed, AI or a player (name,
 * species, colour, team, a Gene Thief's borrowed castes, ping, ready). The
 * host picks the map, seed, food and population cap and can arrange teams;
 * everyone readies up and the host starts the match. Chat works here and in
 * the match.
 *
 * At the start the lobby hands its transport (and any messages that arrived
 * since) to the match. A player who comes back to a match in progress is
 * answered with a `resync` instead of the lobby.
 */
import { Control, BUILD_ID, LobbySettings, Slot, packControl, unpack } from './messages';
import { DEFAULT_LOBBY, GENE_THIEF_DEFAULT, cleanBorrowed, cleanTeam, matchPlayers, matchSetup, pickBorrowed, teamsBlocker } from './match';
import type { Transport } from './transport';
import type { SpeciesId } from '../sim/species';

export const SLOT_COUNT = 8;
export const LOBBY_SPECIES: SpeciesId[] = ['lasius', 'formica', 'solenopsis', 'atta', 'eciton', 'nasutitermes', 'rhynchotermes', 'hell', 'aurimyrmex', 'termant', 'plagiaria'];

/** A six-letter room code without look-alike letters. */
export function roomCode(rand: () => number = Math.random): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}

export function newToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const emptySlot = (i: number): Slot => ({ kind: i < 3 ? 'open' : 'closed', name: '', species: LOBBY_SPECIES[i % 4], color: i, ready: false, peer: '', ping: 0, token: '', team: 0 });

/** A slot change from a guest or the host's own UI, made safe: a known species, a team 0–4, real borrowable castes. */
function cleanPatch<T extends Partial<Slot>>(patch: T): T {
  const p = { ...patch };
  if ('species' in p && !LOBBY_SPECIES.includes(p.species as SpeciesId)) delete p.species;
  if ('team' in p) p.team = cleanTeam(p.team);
  if ('borrowed' in p) p.borrowed = cleanBorrowed(p.borrowed);
  if ('name' in p) p.name = String(p.name ?? '').slice(0, 24);
  if ('color' in p) p.color = Math.max(0, Math.floor(Number(p.color) || 0)) % SLOT_COUNT;
  return p;
}

export type StartInfo =
  | { kind: 'start'; msg: Extract<Control, { t: 'start' }> }
  | { kind: 'resync'; msg: Extract<Control, { t: 'resync' }>; snapshot: Uint8Array };

export class Lobby {
  slots: Slot[] = [];
  settings: LobbySettings;
  chat: Array<{ from: string; text: string }> = [];
  /** this client's slot (−1 until the host has seated it) */
  you = -1;
  started = false;
  error = '';
  /** messages that arrived after the start, for the match to replay */
  private buffered: Array<[string, Uint8Array]> = [];
  onChange: (() => void) | null = null;
  onStart: ((info: StartInfo) => void) | null = null;
  muted = false;

  constructor(
    readonly transport: Transport,
    readonly room: string,
    private name: string,
    private token: string,
  ) {
    this.settings = { ...DEFAULT_LOBBY, seed: Math.floor(Math.random() * 1e6) };
    transport.onMessage = (from, data) => this.receive(from, data);
    transport.onPeerLeave = (id) => this.left(id);
    transport.onError = (m) => {
      this.error = m;
      this.onChange?.();
    };
    if (transport.isHost) {
      for (let i = 0; i < SLOT_COUNT; i++) this.slots.push(emptySlot(i));
      this.slots[0] = { ...this.slots[0], kind: 'human', name, peer: transport.id, token, ready: true };
      this.you = 0;
    } else {
      transport.onPeerJoin = (id) => {
        if (id === transport.hostId) this.hello();
      };
      if (transport.hostId && transport.peers().includes(transport.hostId)) this.hello();
    }
  }

  get isHost(): boolean {
    return this.transport.isHost;
  }

  private hello(): void {
    this.send({ t: 'join', name: this.name, token: this.token, build: BUILD_ID });
  }

  private send(c: Control, to?: string): void {
    const d = packControl(c);
    if (to) this.transport.send(to, d);
    else if (this.isHost) this.transport.broadcast(d);
    else this.transport.send(this.transport.hostId, d);
  }

  private publish(): void {
    if (!this.isHost) return;
    this.send({ t: 'lobby', slots: this.slots, settings: this.settings, host: this.transport.id });
    this.onChange?.();
  }

  private receive(from: string, data: Uint8Array): void {
    if (this.started) {
      this.buffered.push([from, data]);
      return;
    }
    const m = unpack(data);
    if (!m || m.kind !== 'control') return;
    const c = m.msg;
    switch (c.t) {
      case 'join': {
        if (!this.isHost) return;
        if (c.build !== BUILD_ID) return this.send({ t: 'refused', reason: 'Different game version: reload the page.' }, from);
        let i = this.slots.findIndex((s) => s.kind === 'human' && s.token === c.token);
        // LAN: the slot the host made this player's code for, if it is still open
        const want = this.transport.preferredSlot?.(from) ?? -1;
        if (i < 0 && want > 0 && this.slots[want]?.kind === 'open') i = want;
        if (i < 0) i = this.slots.findIndex((s) => s.kind === 'open');
        if (i < 0) return this.send({ t: 'refused', reason: 'The lobby is full.' }, from);
        this.slots[i] = { ...this.slots[i], kind: 'human', name: c.name.slice(0, 24) || `Player ${i + 1}`, peer: from, token: c.token, ready: false };
        this.publish();
        break;
      }
      case 'lobby':
        if (this.isHost) return;
        this.slots = c.slots;
        this.settings = c.settings;
        this.you = this.slots.findIndex((s) => s.peer === this.transport.id);
        this.onChange?.();
        break;
      case 'setSlot': {
        if (!this.isHost) return;
        const s = this.slots[c.slot];
        // guests may only change their own slot (not its kind)
        if (!s || s.peer !== from) return;
        const { kind: _k, ...patch } = c.patch;
        void _k;
        Object.assign(s, cleanPatch(patch));
        // a Gene Thief always raises something: the default pair until its player picks
        if (s.species === 'plagiaria' && !s.borrowed?.length) s.borrowed = [...GENE_THIEF_DEFAULT];
        this.publish();
        break;
      }
      case 'chat':
        this.chat.push({ from: c.from, text: c.text });
        if (this.isHost) for (const p of this.transport.peers()) if (p !== from) this.send(c, p);
        this.onChange?.();
        break;
      case 'refused':
        this.error = c.reason;
        this.onChange?.();
        break;
      case 'start':
        if (this.isHost) return;
        this.started = true;
        this.onStart?.({ kind: 'start', msg: c });
        break;
      case 'resync':
        if (this.isHost || !m.blob) return;
        this.started = true;
        this.onStart?.({ kind: 'resync', msg: c, snapshot: m.blob });
        break;
      case 'ping':
        this.send({ t: 'pong', at: c.at }, from);
        break;
      case 'pong': {
        const s = this.slots.find((x) => x.peer === from);
        if (s) s.ping = Math.round(Math.min(9999, performance.now() - c.at));
        break;
      }
      default:
        break;
    }
  }

  private left(peer: string): void {
    if (this.started) return;
    if (!this.isHost) {
      if (peer === this.transport.hostId) {
        this.error = this.transport.hostLostMessage ?? 'The host closed the game.';
        this.onChange?.();
      }
      return;
    }
    const i = this.slots.findIndex((s) => s.peer === peer);
    if (i >= 0) {
      this.slots[i] = { ...emptySlot(i), kind: 'open' };
      this.publish();
    }
  }

  /** Host: ping every guest (call about once a second while the lobby is open). */
  pingAll(): void {
    if (!this.isHost) return;
    const at = performance.now();
    for (const p of this.transport.peers()) this.send({ t: 'ping', at }, p);
    this.publish();
  }

  // ------------------------------------------------------------------ actions

  /** Change your own slot (name, species, colour, team, a Gene Thief's castes, ready). */
  setMine(patch: Partial<Pick<Slot, 'name' | 'species' | 'color' | 'ready' | 'team' | 'borrowed'>>): void {
    if (this.you < 0) return;
    if (this.isHost) {
      const s = this.slots[this.you];
      Object.assign(s, cleanPatch(patch));
      if (s.species === 'plagiaria' && !s.borrowed?.length) s.borrowed = [...GENE_THIEF_DEFAULT];
      this.publish();
    } else this.send({ t: 'setSlot', slot: this.you, patch });
  }

  /**
   * Host: open, close or fill an empty slot with an AI colony; set an AI's species, colour and stolen
   * castes; put any colony (players too) on a team.
   */
  setSlot(i: number, patch: Partial<Pick<Slot, 'kind' | 'species' | 'color' | 'team' | 'borrowed'>>): void {
    if (!this.isHost) return;
    const s = this.slots[i];
    if (!s) return;
    // the host's own slot and players' slots: only their team here (players pick the rest themselves)
    if (i === 0 || s.kind === 'human') {
      if ('team' in patch) {
        s.team = cleanTeam(patch.team);
        this.publish();
      }
      return;
    }
    const p = cleanPatch(patch);
    if (p.kind && p.kind !== 'open' && p.kind !== 'closed' && p.kind !== 'ai') delete p.kind; // only a player who joins fills a slot
    Object.assign(s, p);
    if (s.kind === 'ai') {
      s.name = 'AI colony';
      s.ready = true;
      // a Gene Thief AI steals two or three castes, picked here so every player gets the same ones
      if (s.species === 'plagiaria' && !s.borrowed?.length) s.borrowed = pickBorrowed();
    } else {
      s.name = '';
      s.ready = false;
    }
    this.publish();
  }

  setSettings(patch: Partial<LobbySettings>): void {
    if (!this.isHost) return;
    Object.assign(this.settings, patch);
    this.publish();
  }

  say(text: string): void {
    const t = text.trim().slice(0, 200);
    if (!t) return;
    const c: Control = { t: 'chat', from: this.name, text: t };
    this.chat.push({ from: this.name, text: t });
    this.send(c);
    this.onChange?.();
  }

  /** Why the host cannot start yet ('' when it can). */
  startBlocker(): string {
    const players = matchPlayers(this.slots);
    if (players.length < 2) return 'Add a player or an AI colony.';
    const teams = teamsBlocker(players);
    if (teams) return teams;
    const waiting = this.slots.filter((s) => s.kind === 'human' && !s.ready);
    if (waiting.length) return `Waiting for ${waiting.map((s) => s.name).join(', ')} to be ready.`;
    return '';
  }

  /** Host: start the match for everyone. */
  start(): boolean {
    if (!this.isHost || this.startBlocker()) return false;
    const players = matchPlayers(this.slots).map((s) => ({ ...s }));
    const setup = matchSetup(players, this.settings);
    players.forEach((p, colony) => {
      if (p.kind === 'human' && colony !== 0) this.send({ t: 'start', setup, you: colony, slots: players, delay: 3 }, p.peer);
    });
    this.started = true;
    this.onStart?.({ kind: 'start', msg: { t: 'start', setup, you: 0, slots: players, delay: 3 } });
    return true;
  }

  /** Messages that arrived after the start (the match replays them). */
  takeBuffered(): Array<[string, Uint8Array]> {
    return this.buffered.splice(0);
  }
}
