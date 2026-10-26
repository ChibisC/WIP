/**
 * Messages between the main thread and the simulation worker
 * (performance brief, Part A; docs/multiplayer.md §3).
 *
 * The worker owns the authoritative World and advances it only when asked
 * (`step`), so the main thread's clock — or, in multiplayer, the lockstep
 * scheduler — decides when ticks run. After each batch it posts a `frame`:
 * - entity lists as structure-of-arrays column packets (transferred, not copied);
 * - the slow state (colonies, caves, plants, aphids, settings) by structured clone;
 * - nest grid changes (new air cells, hex arrays) only for grids that changed;
 * - the events of those ticks;
 * - the pheromone overlay when the player has it on.
 * The main thread applies a frame to its replica World (game/replica.ts),
 * which the renderers and UI read exactly as before.
 */
import type { SimEvent } from '../core/events';
import type { ColumnPacket } from '../sim/columns';
import type { AphidCluster, CaveDef, Colony, LeafPlant, SimState } from '../sim/types';

export interface GridDelta {
  space: number;
  /** cells dug since the last frame */
  air: Int32Array;
  /** hex arrays and lists, sent when anything in the grid changed */
  hexSoil?: Uint8Array;
  hexWork?: Float32Array;
  hexTotal?: Float32Array;
  hexDesig?: Uint8Array;
  hexEntry?: Int8Array;
  designated?: Uint8Array;
  designatedCount?: number;
  entrances?: number[];
  shafts?: number[];
  tunnels?: number[][];
  spots?: number[][];
  desigVersion?: number;
}

export interface SlowState {
  tick: number;
  time: number;
  night: number;
  nextId: number;
  rng: number;
  host?: number;
  mode: SimState['mode'];
  settings: SimState['settings'];
  colonies: Colony[];
  caves: CaveDef[];
  aphids: AphidCluster[];
  plants: LeafPlant[];
  /** storms on authored maps (the replica raises its own water to match) */
  flood?: SimState['flood'];
}

export interface FrameMsg {
  t: 'frame';
  /** frame number (the main thread acknowledges it in the shared control array) */
  frame: number;
  /** ticks run for this frame (0 = commands applied while paused) */
  ran: number;
  slow: SlowState;
  ants: ColumnPacket;
  food: ColumnPacket;
  brood: ColumnPacket;
  creatures: ColumnPacket;
  projectiles: ColumnPacket;
  grids: GridDelta[];
  events: SimEvent[];
  /** packed overlay (RGBA per pheromone cell) for the colony that asked */
  phero?: { colony: number; data: Uint8Array };
  /** worker time per tick for this batch (ms) */
  tickMs: number;
}

export type ToWorker =
  /** `ctrl`: shared control array (cross-origin isolated pages): ctrl[0] = last frame the main thread applied */
  | { t: 'init'; snapshot: Uint8Array; ctrl?: Int32Array }
  /** encoded command log (sim/commands.ts); single-player commands for the next tick are applied at once */
  | { t: 'cmds'; bytes: Uint8Array }
  /** run n ticks; `cmds` (an encoded command log) are scheduled first — lockstep sends each tick's commands with it */
  | { t: 'step'; n: number; cmds?: Uint8Array }
  | { t: 'overlay'; colony: number }
  | { t: 'snapshot'; id: number }
  | { t: 'hash'; id: number }
  /** the log of every command applied so far (replays) */
  | { t: 'log'; id: number };

export type FromWorker =
  | FrameMsg
  | { t: 'ready' }
  | { t: 'snapshot'; id: number; bytes: Uint8Array }
  | { t: 'log'; id: number; bytes: Uint8Array }
  | { t: 'hash'; id: number; hash: string; tick: number }
  | { t: 'error'; message: string };
