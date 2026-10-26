/**
 * Wire format between peers (multiplayer brief, Parts D and E).
 *
 * Byte 0 says what follows:
 *  1  a tick packet (sim/commands.ts `encodeTickPacket`): one player's
 *     commands for one tick, sent every tick even when empty;
 *  2  a control message as UTF-8 JSON (lobby, pings, hashes, chat…);
 *  3  a control message plus a binary blob (a snapshot for a rejoining
 *     player): [u32 json length][json][blob].
 */
import { Command, decodeTickPacket, encodeTickPacket } from '../sim/commands';
import type { GameSetup } from '../sim/mapGen';
import type { SpeciesId } from '../sim/species';
import type { MapId } from '../maps/types';

export const BUILD_ID = 'ud-mp-5';

/** A lobby slot (players 0–3; the slot number is the colony id). */
export interface Slot {
  /** 'open' | 'closed' | 'ai' | 'human' */
  kind: 'open' | 'closed' | 'ai' | 'human';
  name: string;
  species: SpeciesId;
  /** colony colour index */
  color: number;
  ready: boolean;
  /** peer id of the human in this slot */
  peer: string;
  /** round-trip time to the host (ms), measured by the host */
  ping: number;
  /** reconnect token (a rejoining player gets their slot back) */
  token: string;
  /** team 1–4 (colonies on one team are allies and win together); 0 = no team (everyone for themselves) */
  team: number;
  /** Gene Thief (species plagiaria): the castes it raises besides its own workers (sim/species.ts BORROWABLE) */
  borrowed?: string[];
}

export interface LobbySettings {
  style: GameSetup['style'];
  /** an authored map (docs/maps/design.md); replaces the style and size when set */
  map?: MapId;
  /** storms flood the authored map's low ground (off by default) */
  floods?: boolean;
  seed: number;
  /** starting food multiplier on the map */
  food: number;
  popLimit: number;
}

export type Control =
  // lobby
  | { t: 'join'; name: string; token: string; build: string }
  | { t: 'lobby'; slots: Slot[]; settings: LobbySettings; host: string }
  | { t: 'setSlot'; slot: number; patch: Partial<Pick<Slot, 'kind' | 'name' | 'species' | 'color' | 'ready' | 'team' | 'borrowed'>> }
  | { t: 'settings'; patch: Partial<LobbySettings> }
  | { t: 'chat'; from: string; text: string }
  | { t: 'start'; setup: GameSetup; you: number; slots: Slot[]; delay: number }
  | { t: 'refused'; reason: string }
  // in game
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  | { t: 'delay'; d: number; pings?: Record<number, number> }
  | { t: 'hash'; tick: number; hash: string; player: number }
  | { t: 'desync'; tick: number; hashes: Record<string, string> }
  | { t: 'drop'; player: number; fromTick: number }
  | { t: 'rejoin'; player: number; fromTick: number }
  | { t: 'resync'; tick: number; you: number; slots: Slot[]; delay: number; fromTick: number; packets: Array<[number, number, string]>; players: Array<[number, number, number]> }
  | { t: 'over'; winner: number; stats: unknown }
  | { t: 'bye' };

const enc = new TextEncoder();
const dec = new TextDecoder();

export function packTick(tick: number, player: number, cmds: readonly Command[]): Uint8Array {
  const body = encodeTickPacket(tick, player, cmds);
  const out = new Uint8Array(body.length + 1);
  out[0] = 1;
  out.set(body, 1);
  return out;
}

export function packControl(c: Control, blob?: Uint8Array): Uint8Array {
  const json = enc.encode(JSON.stringify(c));
  if (!blob) {
    const out = new Uint8Array(json.length + 1);
    out[0] = 2;
    out.set(json, 1);
    return out;
  }
  const out = new Uint8Array(1 + 4 + json.length + blob.length);
  out[0] = 3;
  new DataView(out.buffer).setUint32(1, json.length, true);
  out.set(json, 5);
  out.set(blob, 5 + json.length);
  return out;
}

export type Incoming =
  | { kind: 'tick'; tick: number; player: number; cmds: Command[]; raw: Uint8Array }
  | { kind: 'control'; msg: Control; blob?: Uint8Array };

export function unpack(data: Uint8Array): Incoming | null {
  if (!data.length) return null;
  if (data[0] === 1) {
    const p = decodeTickPacket(data.subarray(1));
    return { kind: 'tick', tick: p.tick, player: p.player, cmds: p.cmds, raw: data };
  }
  if (data[0] === 2) return { kind: 'control', msg: JSON.parse(dec.decode(data.subarray(1))) as Control };
  if (data[0] === 3) {
    const n = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
    const msg = JSON.parse(dec.decode(data.subarray(5, 5 + n))) as Control;
    return { kind: 'control', msg, blob: data.slice(5 + n) };
  }
  return null;
}

/** base64 helpers for packets carried inside JSON (resync) */
export function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
