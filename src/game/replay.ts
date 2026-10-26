/**
 * Replays (multiplayer brief, Part F): the match setup plus the log of every
 * command the simulation applied. Because the simulation is deterministic,
 * that reproduces the whole game; the file also stores the final state hash
 * so playback can confirm it ended identically. Replays are also the main
 * tool for investigating a desync.
 *
 * File (.udreplay): "UDR1" (u32) · json length (u32) · json header · [start snapshot] · command log.
 * A game that began from a snapshot (a loaded save) carries that snapshot; its
 * length is `snapshot` in the header.
 */
import type { GameSetup } from '../sim/mapGen';
import { Command, decodeCommandLog, encodeCommandLog } from '../sim/commands';

const MAGIC = 0x31524455; // "UDR1"

export interface ReplayHeader {
  build: string;
  /** the generated game's setup (absent when the game began from a snapshot) */
  setup?: GameSetup;
  /** byte length of the start snapshot that follows the header */
  snapshot?: number;
  /** the colony the recording player controlled */
  local: number;
  /** player names by colony (multiplayer) */
  names?: string[];
  ticks: number;
  finalHash: string;
  date: string;
}

export function encodeReplay(h: ReplayHeader, log: Uint8Array, start?: Uint8Array): Uint8Array {
  const head: ReplayHeader = start ? { ...h, snapshot: start.length } : h;
  const json = new TextEncoder().encode(JSON.stringify(head));
  const sn = start?.length ?? 0;
  const out = new Uint8Array(8 + json.length + sn + log.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, json.length, true);
  out.set(json, 8);
  if (start) out.set(start, 8 + json.length);
  out.set(log, 8 + json.length + sn);
  return out;
}

export function decodeReplay(bytes: Uint8Array): { header: ReplayHeader; commands: Command[]; snapshot?: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || dv.getUint32(0, true) !== MAGIC) throw new Error('Not an Underground Dominion replay file.');
  const n = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n))) as ReplayHeader;
  const sn = header.snapshot ?? 0;
  const snapshot = sn ? bytes.slice(8 + n, 8 + n + sn) : undefined;
  if (!snapshot && !header.setup) throw new Error('This replay has neither a setup nor a start snapshot.');
  const commands = decodeCommandLog(bytes.subarray(8 + n + sn));
  return { header, commands, snapshot };
}

/** Commands grouped by the tick they run at. */
export function commandsByTick(cmds: readonly Command[]): Map<number, Command[]> {
  const m = new Map<number, Command[]>();
  for (const c of cmds) {
    let l = m.get(c.tick);
    if (!l) m.set(c.tick, (l = []));
    l.push(c);
  }
  return m;
}

export { encodeCommandLog };
