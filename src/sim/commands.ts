/**
 * Player commands (multiplayer brief, Part C).
 *
 * Every player action is a command, and commands are the only way anything
 * outside the simulation changes it. A command is scheduled for a tick and
 * applied at the boundary before that tick's systems run, in (player, seq)
 * order, on every client. Commands are validated when applied, so an illegal
 * or stale one is ignored the same way everywhere.
 *
 * Single-player issues commands with zero input delay; multiplayer schedules
 * them a few ticks ahead and exchanges them in tick packets (net/).
 * The binary encoding is a few bytes per command; floats are quantized to
 * float32 when issued, so the issuing client applies exactly what the others
 * decode.
 */
import { World } from './world';
import { Colony, SURFACE, TileType } from './types';
import { assignGroup, placeMarker, recallAll, removeMarker, MARKER_ORDERS, MarkerOrder, setMarkerOrder } from './markers';
import { designateDig } from './colony';
import { setEntranceShut } from './entrances';
import { markDelete, markUpgrade, placeTile, TILE_INFO } from './tiles';
import { forgetCaste, setCorpsePriority } from './termants';
import { useAbility } from './abilities';
import { killAnt } from './antAI';
import { spawnCreature } from './creatures/creatureAI';
import { CREATURES } from './creatures/kinds';
import { surgeGroup } from './surge';
import { arenaClear, arenaSpawn, arenaStance } from './arena';

export type CommandBody =
  | { type: 'placeMarker'; i: number; space: number; x: number; y: number }
  | { type: 'removeMarker'; i: number }
  | { type: 'assignGroup'; group: number; marker: number }
  | { type: 'dig'; q: number; on: boolean }
  | { type: 'buildTile'; q: number; tile: TileType; caste: string }
  | { type: 'markUpgrade'; q: number }
  | { type: 'markDelete'; q: number }
  | { type: 'setAggression'; on: boolean }
  | { type: 'recall' }
  | { type: 'useAbility' }
  /** concede the match: the queen dies and the colony is out (multiplayer) */
  | { type: 'surrender' }
  /** Saiy-Ants: every ready ant of one control group flashes into the gold surge */
  | { type: 'surgeGroup'; group: number }
  /** Termants: forget a stolen caste (its brood tiles refunded) */
  | { type: 'forgetCaste'; caste: string }
  /** Termants: workers fetch corpses of species with genes still short first (on/off) */
  | { type: 'corpsePriority'; on: boolean }
  /** sandbox games only: spawn a creature or boss */
  | { type: 'sandboxSpawn'; kind: string; space: number; x: number; y: number }
  /** sandbox games only: fill the colony's stores */
  | { type: 'sandboxFood' }
  /** sandbox games only: switch infinite food or wild creatures */
  | { type: 'sandboxSet'; key: 'infiniteFood' | 'creatures'; on: boolean }
  /** battle arena only: spawn `n` units (`ant:<caste>` or `cr:<kind>`) of level 1–3 for a team, round its spawn point or at (x, y) */
  | { type: 'arenaSpawn'; team: number; unit: string; n: number; level: number; at: boolean; x: number; y: number }
  /** battle arena only: a team charges (0), holds (1) or stands passive (2) */
  | { type: 'arenaStance'; team: number; stance: number }
  /** battle arena only: take a team's units off the field (−1 every team: a new round) */
  | { type: 'arenaClear'; team: number }
  /** a marker's order for the groups sent there (i = −1: the Home column): no attacking, gathering, climbing (on/off) */
  | { type: 'markerOrder'; i: number; order: MarkerOrder; on: boolean }
  /** host only: let the AI drive a player's colony (a dropped player) or hand it back */
  | { type: 'setControl'; colony: number; human: boolean }
  /** plug extra entrance i with soil (close) or open it again; asking the opposite mid-way cancels (sim/entrances.ts) */
  | { type: 'entrance'; i: number; close: boolean }
  /** multiplayer game speed: ask for or agree to 2× / 4× (every player must), or go back down at once; the current
   *  speed while a faster one is asked for is a "no" */
  | { type: 'speedVote'; speed: number };

export type CommandType = CommandBody['type'];

export type Command = CommandBody & {
  /** the tick it is applied before (applied at the boundary T−1 → T) */
  tick: number;
  /** player slot = colony id */
  player: number;
  /** per-player sequence number */
  seq: number;
};

const TYPE_IDS: Record<CommandType, number> = {
  placeMarker: 1,
  removeMarker: 2,
  assignGroup: 3,
  dig: 4,
  buildTile: 5,
  markUpgrade: 6,
  markDelete: 7,
  setAggression: 8,
  recall: 9,
  useAbility: 10,
  setControl: 11,
  surrender: 12,
  sandboxSpawn: 13,
  sandboxFood: 14,
  sandboxSet: 15,
  surgeGroup: 16,
  forgetCaste: 17,
  corpsePriority: 18,
  arenaSpawn: 19,
  arenaStance: 20,
  arenaClear: 21,
  markerOrder: 22,
  entrance: 23,
  speedVote: 24,
};
const TYPE_NAMES: CommandType[] = [];
for (const [k, v] of Object.entries(TYPE_IDS)) TYPE_NAMES[v] = k as CommandType;

/** Make float params exactly representable in the wire format (float32). */
export function quantize<T extends CommandBody>(b: T): T {
  if (b.type === 'placeMarker' || b.type === 'sandboxSpawn' || b.type === 'arenaSpawn') {
    b.x = Math.fround(b.x);
    b.y = Math.fround(b.y);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** Who may give orders to colony `c`: its own human player. */
function commandable(c: Colony | undefined): c is Colony {
  return !!c && c.alive && c.player;
}

function hexOk(w: World, c: Colony, q: number): boolean {
  const g = w.nest(c.id);
  return !!g && Number.isInteger(q) && q >= 0 && q < g.cols * g.rows;
}

/**
 * Apply one command. Returns null when it took effect, else the reason it
 * was ignored (for logs and the issuing player's feedback; never used to
 * branch simulation logic).
 */
export function applyCommand(w: World, cmd: Command): string | null {
  if (cmd.type === 'setControl') {
    if (cmd.player !== (w.s.host ?? 0)) return 'only the host can do that';
    const t = w.colony(cmd.colony);
    if (!t || !t.player) return 'not a player colony';
    // The colony stays a human slot (same stats); only who drives it changes.
    t.ai = !cmd.human;
    return null;
  }
  const c = w.colony(cmd.player);
  if (!commandable(c)) return 'not your colony';
  switch (cmd.type) {
    case 'placeMarker': {
      if (!Number.isInteger(cmd.i) || cmd.i < 0 || cmd.i >= c.markers.length) return 'bad marker';
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return 'bad position';
      if (cmd.space === SURFACE) {
        if (!w.terrain.inBounds(cmd.x, cmd.y, 0)) return 'off the map';
      } else {
        const g = w.nestOf(cmd.space);
        if (!g) return 'no such area';
        if (!g.isAirAt(cmd.x, cmd.y)) return 'Markers underground go on dug floor.';
      }
      placeMarker(w, c, cmd.i, cmd.space, cmd.x, cmd.y);
      return null;
    }
    case 'removeMarker':
      if (!Number.isInteger(cmd.i) || cmd.i < 0 || cmd.i >= c.markers.length) return 'bad marker';
      removeMarker(w, c, cmd.i);
      return null;
    case 'assignGroup':
      return assignGroup(w, c, cmd.group, cmd.marker) ? null : 'no such group';
    case 'dig':
      if (!hexOk(w, c, cmd.q)) return 'bad hex';
      if (w.nest(c.id)!.isHexDug(cmd.q)) return 'already dug';
      return designateDig(w, c, cmd.q, cmd.on) ? null : 'cannot dig there';
    case 'buildTile':
      if (!hexOk(w, c, cmd.q)) return 'bad hex';
      if (!(cmd.tile in TILE_INFO)) return 'bad tile';
      if (cmd.caste && !c.castes.includes(cmd.caste)) return 'bad caste';
      return placeTile(w, c, cmd.tile, cmd.q, cmd.caste || undefined) ? null : 'cannot build there';
    case 'markUpgrade':
      if (!hexOk(w, c, cmd.q)) return 'bad hex';
      return markUpgrade(w, c, cmd.q);
    case 'markDelete':
      if (!hexOk(w, c, cmd.q)) return 'bad hex';
      return markDelete(w, c, cmd.q);
    case 'setAggression':
      c.aggressive = !!cmd.on;
      return null;
    case 'recall':
      recallAll(w, c);
      return null;
    case 'useAbility':
      return useAbility(w, c);
    case 'surgeGroup':
      return surgeGroup(w, c, cmd.group) > 0 ? null : 'no ant of that group is ready to surge';
    case 'forgetCaste':
      return forgetCaste(w, c, cmd.caste);
    case 'corpsePriority':
      setCorpsePriority(c, !!cmd.on);
      return null;
    case 'sandboxSpawn': {
      if (!w.s.mode.sandbox) return 'sandbox games only';
      if (!CREATURES[cmd.kind]) return 'no such creature';
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return 'bad position';
      if (cmd.space === SURFACE) {
        if (!w.terrain.inBounds(cmd.x, cmd.y, 0)) return 'off the map';
      } else {
        const g = w.nestOf(cmd.space);
        if (!g || !g.isAirAt(cmd.x, cmd.y)) return 'Creatures go on open ground or dug floor.';
      }
      spawnCreature(w, cmd.kind, cmd.space, cmd.x, cmd.y);
      return null;
    }
    case 'sandboxFood':
      if (!w.s.mode.sandbox) return 'sandbox games only';
      c.food = c.foodCap;
      return null;
    case 'arenaSpawn':
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return 'bad position';
      if (cmd.at && !w.terrain.inBounds(cmd.x, cmd.y, 8)) return 'off the map';
      return arenaSpawn(w, cmd.team, cmd.unit, cmd.n, cmd.level, cmd.at ? { x: cmd.x, y: cmd.y } : null);
    case 'arenaStance':
      return arenaStance(w, cmd.team, cmd.stance);
    case 'arenaClear':
      return arenaClear(w, cmd.team);
    case 'markerOrder':
      // (−1: the Home column)
      if (!Number.isInteger(cmd.i) || cmd.i < -1 || cmd.i >= c.markers.length) return 'bad marker';
      if (!MARKER_ORDERS.includes(cmd.order)) return 'bad order';
      setMarkerOrder(c, cmd.i, cmd.order, !!cmd.on);
      return null;
    case 'sandboxSet':
      if (!w.s.mode.sandbox) return 'sandbox games only';
      if (cmd.key === 'infiniteFood') c.infiniteFood = !!cmd.on;
      else if (cmd.key === 'creatures') w.s.settings.creatures = cmd.on ? 1 : 0;
      else return 'bad setting';
      return null;
    case 'entrance':
      if (!Number.isInteger(cmd.i) || cmd.i < 0 || cmd.i >= c.entrances.length) return 'no such entrance';
      return setEntranceShut(w, c, cmd.i, !!cmd.close);
    case 'speedVote':
      return speedVote(w, c, cmd.speed);
    case 'surrender': {
      const q = w.antById.get(c.queen);
      if (q) killAnt(w, q);
      c.stats.lostQueen = true;
      c.alive = false;
      w.events.emit({ t: 'colonyLost', colony: c.id });
      w.events.emit({ t: 'message', text: `${c.name} surrendered.`, kind: 'info' });
      return null;
    }
  }
  return 'unknown command';
}

/** The speeds a match may run at (multiplayer speed vote). */
export const GAME_SPEEDS = [1, 2, 4] as const;

/**
 * Multiplayer game speed (user request 2026-10-31): a faster speed needs every player to agree — each asks for or
 * agrees to it with a vote, and it takes effect when the last one does; anyone may bring it back down at once (nobody
 * is held to a faster game); voting the current speed while a faster one is asked for says no and clears the votes.
 * Who must agree: the living colonies played by a person (not dropped to the AI).
 */
function speedVote(w: World, c: Colony, speed: number): string | null {
  if (!(GAME_SPEEDS as readonly number[]).includes(speed)) return 'bad speed';
  const st = w.s.settings;
  const cur = st.gameSpeed ?? 1;
  const n = w.s.colonies.reduce((m, o) => Math.max(m, o.id + 1), 0);
  const votes = st.speedVotes && st.speedVotes.length === n ? st.speedVotes : new Array<number>(n).fill(0);
  const pending = votes.find((v) => v > 0) ?? 0;
  if (speed < cur) {
    st.gameSpeed = speed;
    st.speedVotes = new Array<number>(n).fill(0);
    w.events.emit({ t: 'message', text: `${c.name} set the game speed back to ${speed}×.`, kind: 'info' });
    return null;
  }
  if (speed === cur) {
    st.speedVotes = new Array<number>(n).fill(0);
    if (pending) w.events.emit({ t: 'message', text: `${c.name} said no to ${pending}× speed.`, kind: 'info' });
    return null;
  }
  // a request, or agreeing to the one asked for (a different speed replaces it)
  if (pending && pending !== speed) votes.fill(0);
  votes[c.id] = speed;
  st.speedVotes = votes;
  const voters = w.s.colonies.filter((o) => o.alive && o.player && !o.ai);
  if (voters.every((o) => votes[o.id] === speed)) {
    st.gameSpeed = speed;
    st.speedVotes = new Array<number>(n).fill(0);
    w.events.emit({ t: 'message', text: `Every player agreed: the game now runs at ${speed}×.`, kind: 'info' });
  } else if (!pending || pending !== speed) w.events.emit({ t: 'message', text: `${c.name} asks to play at ${speed}×: every player has to agree.`, kind: 'info' });
  return null;
}

/** Canonical application order within a tick: by player, then sequence. */
export function sortCommands(cmds: Command[]): Command[] {
  return cmds.sort((a, b) => a.player - b.player || a.seq - b.seq);
}

/**
 * Apply commands at the boundary before tick s.tick + 1 (before the tick
 * counter advances, after the spatial queries are fresh). Single-player
 * applies its commands here as soon as they are issued; replays, lockstep and
 * tests apply them here from `stepWithCommands`. Both give the same state.
 */
export function applyCommandsNow(w: World, cmds: readonly Command[]): void {
  if (!cmds.length) return;
  w.prepareQueries();
  for (const c of cmds) {
    const why = applyCommand(w, c);
    w.events.emit({ t: 'command', player: c.player, seq: c.seq, type: c.type, ok: why === null, why: why ?? undefined });
  }
}

/** One simulation tick with the commands scheduled for it. */
export function stepWithCommands(w: World, dt: number, schedule: CommandSchedule): void {
  applyCommandsNow(w, schedule.take(w.s.tick + 1));
  w.step(dt);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Commands waiting for their tick, plus the log of applied ones (a replay is
 * the match setup plus this log).
 */
export class CommandSchedule {
  private byTick = new Map<number, Command[]>();
  /** every command handed to the simulation, in application order */
  readonly log: Command[] = [];
  /** keep the log (replays, desync dumps) */
  recording = true;

  add(cmd: Command): void {
    let list = this.byTick.get(cmd.tick);
    if (!list) {
      list = [];
      this.byTick.set(cmd.tick, list);
    }
    list.push(cmd);
  }

  /** Remove and return the commands for a tick, in canonical order. */
  take(tick: number): Command[] {
    const list = this.byTick.get(tick);
    if (!list) return NONE;
    this.byTick.delete(tick);
    sortCommands(list);
    if (this.recording) for (const c of list) this.log.push(c);
    return list;
  }

  /** Commands still waiting (for the pending-feedback overlay). */
  pending(): Command[] {
    const out: Command[] = [];
    for (const list of this.byTick.values()) out.push(...list);
    return out;
  }

  get size(): number {
    let n = 0;
    for (const list of this.byTick.values()) n += list.length;
    return n;
  }
}

const NONE: Command[] = [];

// ---------------------------------------------------------------------------
// Binary encoding
// ---------------------------------------------------------------------------

class Bytes {
  buf = new Uint8Array(256);
  dv = new DataView(this.buf.buffer);
  n = 0;
  need(k: number): void {
    if (this.n + k <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    nb.set(this.buf.subarray(0, this.n));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number): void {
    this.need(1);
    this.buf[this.n++] = v & 0xff;
  }
  u16(v: number): void {
    this.need(2);
    this.dv.setUint16(this.n, v, true);
    this.n += 2;
  }
  i16(v: number): void {
    this.need(2);
    this.dv.setInt16(this.n, v, true);
    this.n += 2;
  }
  u32(v: number): void {
    this.need(4);
    this.dv.setUint32(this.n, v >>> 0, true);
    this.n += 4;
  }
  f32(v: number): void {
    this.need(4);
    this.dv.setFloat32(this.n, v, true);
    this.n += 4;
  }
  str(s: string): void {
    this.u8(s.length);
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  out(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

function writeBody(b: Bytes, c: CommandBody): void {
  b.u8(TYPE_IDS[c.type]);
  switch (c.type) {
    case 'placeMarker':
      b.u8(c.i);
      b.u16(c.space);
      b.f32(c.x);
      b.f32(c.y);
      break;
    case 'removeMarker':
      b.u8(c.i);
      break;
    case 'assignGroup':
      b.u32(c.group);
      b.i16(c.marker);
      break;
    case 'surgeGroup':
      b.u32(c.group);
      break;
    case 'forgetCaste':
      b.str(c.caste);
      break;
    case 'corpsePriority':
      b.u8(c.on ? 1 : 0);
      break;
    case 'dig':
      b.u16(c.q);
      b.u8(c.on ? 1 : 0);
      break;
    case 'buildTile':
      b.u16(c.q);
      b.str(c.tile);
      b.str(c.caste);
      break;
    case 'markUpgrade':
    case 'markDelete':
      b.u16(c.q);
      break;
    case 'setAggression':
      b.u8(c.on ? 1 : 0);
      break;
    case 'setControl':
      b.u8(c.colony);
      b.u8(c.human ? 1 : 0);
      break;
    case 'sandboxSpawn':
      b.str(c.kind);
      b.u16(c.space);
      b.f32(c.x);
      b.f32(c.y);
      break;
    case 'sandboxSet':
      b.u8(c.key === 'infiniteFood' ? 0 : 1);
      b.u8(c.on ? 1 : 0);
      break;
    case 'arenaSpawn':
      b.u8(c.team);
      b.str(c.unit);
      b.u8(c.n);
      b.u8(c.level);
      b.u8(c.at ? 1 : 0);
      b.f32(c.x);
      b.f32(c.y);
      break;
    case 'arenaStance':
      b.u8(c.team);
      b.u8(c.stance);
      break;
    case 'arenaClear':
      b.i16(c.team);
      break;
    case 'markerOrder':
      b.u8(c.i + 1);
      b.u8(MARKER_ORDERS.indexOf(c.order));
      b.u8(c.on ? 1 : 0);
      break;
    case 'entrance':
      b.u8(c.i);
      b.u8(c.close ? 1 : 0);
      break;
    case 'speedVote':
      b.u8(c.speed);
      break;
  }
}

class Cursor {
  dv: DataView;
  n = 0;
  constructor(public buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(): number {
    return this.buf[this.n++];
  }
  u16(): number {
    const v = this.dv.getUint16(this.n, true);
    this.n += 2;
    return v;
  }
  i16(): number {
    const v = this.dv.getInt16(this.n, true);
    this.n += 2;
    return v;
  }
  u32(): number {
    const v = this.dv.getUint32(this.n, true);
    this.n += 4;
    return v;
  }
  f32(): number {
    const v = this.dv.getFloat32(this.n, true);
    this.n += 4;
    return v;
  }
  str(): string {
    const len = this.u8();
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  get done(): boolean {
    return this.n >= this.buf.length;
  }
}

function readBody(r: Cursor): CommandBody {
  const type = TYPE_NAMES[r.u8()];
  switch (type) {
    case 'placeMarker':
      return { type, i: r.u8(), space: r.u16(), x: r.f32(), y: r.f32() };
    case 'removeMarker':
      return { type, i: r.u8() };
    case 'assignGroup':
      return { type, group: r.u32(), marker: r.i16() };
    case 'surgeGroup':
      return { type, group: r.u32() };
    case 'forgetCaste':
      return { type, caste: r.str() };
    case 'corpsePriority':
      return { type, on: r.u8() === 1 };
    case 'dig':
      return { type, q: r.u16(), on: r.u8() === 1 };
    case 'buildTile':
      return { type, q: r.u16(), tile: r.str() as TileType, caste: r.str() };
    case 'markUpgrade':
    case 'markDelete':
      return { type, q: r.u16() };
    case 'setAggression':
      return { type, on: r.u8() === 1 };
    case 'recall':
    case 'useAbility':
    case 'surrender':
    case 'sandboxFood':
      return { type };
    case 'sandboxSpawn':
      return { type, kind: r.str(), space: r.u16(), x: r.f32(), y: r.f32() };
    case 'sandboxSet':
      return { type, key: r.u8() === 0 ? 'infiniteFood' : 'creatures', on: r.u8() === 1 };
    case 'setControl':
      return { type, colony: r.u8(), human: r.u8() === 1 };
    case 'arenaSpawn':
      return { type, team: r.u8(), unit: r.str(), n: r.u8(), level: r.u8(), at: r.u8() === 1, x: r.f32(), y: r.f32() };
    case 'arenaStance':
      return { type, team: r.u8(), stance: r.u8() };
    case 'arenaClear':
      return { type, team: r.i16() };
    case 'markerOrder':
      return { type, i: r.u8() - 1, order: MARKER_ORDERS[r.u8()] ?? 'noAttack', on: r.u8() === 1 };
    case 'entrance':
      return { type, i: r.u8(), close: r.u8() === 1 };
    case 'speedVote':
      return { type, speed: r.u8() };
  }
  throw new Error('commands: unknown command type');
}

/**
 * One player's commands for one tick (the lockstep tick packet; an empty one
 * says "nothing from me this tick"): [tick u32][player u8][count u8] then per
 * command [seq u16][body].
 */
export function encodeTickPacket(tick: number, player: number, cmds: readonly Command[]): Uint8Array {
  const b = new Bytes();
  b.u32(tick);
  b.u8(player);
  b.u8(cmds.length);
  for (const c of cmds) {
    b.u16(c.seq);
    writeBody(b, c);
  }
  return b.out();
}

export function decodeTickPacket(bytes: Uint8Array): { tick: number; player: number; cmds: Command[] } {
  const r = new Cursor(bytes);
  const tick = r.u32();
  const player = r.u8();
  const n = r.u8();
  const cmds: Command[] = [];
  for (let i = 0; i < n; i++) {
    const seq = r.u16();
    cmds.push({ ...readBody(r), tick, player, seq } as Command);
  }
  return { tick, player, cmds };
}

/** A whole command log (replays): [count u32] then per command [tick u32][player u8][seq u16][body]. */
export function encodeCommandLog(cmds: readonly Command[]): Uint8Array {
  const b = new Bytes();
  b.u32(cmds.length);
  for (const c of cmds) {
    b.u32(c.tick);
    b.u8(c.player);
    b.u16(c.seq);
    writeBody(b, c);
  }
  return b.out();
}

export function decodeCommandLog(bytes: Uint8Array): Command[] {
  const r = new Cursor(bytes);
  const n = r.u32();
  const out: Command[] = [];
  for (let i = 0; i < n; i++) {
    const tick = r.u32();
    const player = r.u8();
    const seq = r.u16();
    out.push({ ...readBody(r), tick, player, seq } as Command);
  }
  return out;
}
