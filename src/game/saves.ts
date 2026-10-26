/**
 * Saved games (Phase 14, single-player).
 *
 * A save is the simulation's canonical snapshot (Phase 10) with a small
 * header saying what it is. Restoring the snapshot gives back the same world,
 * so a loaded game runs on exactly as the saved one would have.
 *
 * File (.udsave): "UDS1" (u32) · flags (u32: bit 0 = gzipped) · json length (u32) · json header · snapshot.
 *
 * Saves are kept in this browser's IndexedDB, one record per slot: three
 * manual slots, a quick-save and an autosave. When IndexedDB is unavailable
 * (a private window, blocked site data), they are kept in memory for this
 * visit, and downloading a file is the way to keep one.
 */

const MAGIC = 0x31534455; // "UDS1"
const GZIP = 1;

/** `import`: a file being loaded in-game (kept until the page reloads into it; never listed) */
export type SaveSlot = 'auto' | 'quick' | '1' | '2' | '3' | 'import';
export const SAVE_SLOTS: SaveSlot[] = ['quick', 'auto', '1', '2', '3'];

export function slotName(s: SaveSlot): string {
  return s === 'auto' ? 'Autosave' : s === 'quick' ? 'Quick save' : s === 'import' ? 'File' : `Slot ${s}`;
}

export interface SaveHeader {
  build: string;
  /** what the game is: "A Meadow Kingdom", "Skirmish", "Sandbox" */
  title: string;
  mode: 'mission' | 'skirmish' | 'sandbox' | 'arena' | 'game';
  mission?: string;
  /** the player's colony */
  local: number;
  species: string;
  colonyName: string;
  ants: number;
  /** game time, seconds */
  time: number;
  tick: number;
  /** ISO date and time it was saved */
  date: string;
}

export interface SaveRecord {
  slot: SaveSlot;
  header: SaveHeader;
  bytes: Uint8Array;
}

// ---------------------------------------------------------------- file format

async function gzip(b: Uint8Array, dir: 'in' | 'out'): Promise<Uint8Array | null> {
  const CS = (globalThis as unknown as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  const DS = (globalThis as unknown as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  const Stream = dir === 'in' ? CS : DS;
  if (!Stream) return null;
  try {
    const s = new Blob([b.slice().buffer]).stream().pipeThrough(new Stream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  } catch {
    return null;
  }
}

/** Header and snapshot into one file (gzipped when the browser can). */
export async function encodeSave(header: SaveHeader, snapshot: Uint8Array): Promise<Uint8Array> {
  const z = await gzip(snapshot, 'in');
  const body = z ?? snapshot;
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(12 + json.length + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, z ? GZIP : 0, true);
  dv.setUint32(8, json.length, true);
  out.set(json, 12);
  out.set(body, 12 + json.length);
  return out;
}

export function readSaveHeader(bytes: Uint8Array): SaveHeader {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || dv.getUint32(0, true) !== MAGIC) throw new Error('Not an Underground Dominion save file.');
  const n = dv.getUint32(8, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + n))) as SaveHeader;
}

export async function decodeSave(bytes: Uint8Array): Promise<{ header: SaveHeader; snapshot: Uint8Array }> {
  const header = readSaveHeader(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = dv.getUint32(4, true);
  const n = dv.getUint32(8, true);
  const body = bytes.slice(12 + n);
  if (!(flags & GZIP)) return { header, snapshot: body };
  const snap = await gzip(body, 'out');
  if (!snap) throw new Error('This browser cannot unpack the save (no DecompressionStream).');
  return { header, snapshot: snap };
}

// ---------------------------------------------------------------- storage

const DB = 'underground-dominion';
const STORE = 'saves';
const memory = new Map<SaveSlot, SaveRecord>();
let dbp: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** Whether saves outlast this visit (IndexedDB works here). */
export async function savesPersist(): Promise<boolean> {
  return !!(await db());
}

export async function putSave(slot: SaveSlot, bytes: Uint8Array): Promise<SaveRecord> {
  const rec: SaveRecord = { slot, header: readSaveHeader(bytes), bytes };
  const d = await db();
  if (d) {
    try {
      await req(d.transaction(STORE, 'readwrite').objectStore(STORE).put(rec, slot));
      return rec;
    } catch {
      // quota or a closed database: fall back to memory
    }
  }
  memory.set(slot, rec);
  return rec;
}

export async function getSave(slot: SaveSlot): Promise<SaveRecord | null> {
  const d = await db();
  if (d) {
    try {
      const r = (await req(d.transaction(STORE, 'readonly').objectStore(STORE).get(slot))) as SaveRecord | undefined;
      if (r) return r;
    } catch {
      // fall through to memory
    }
  }
  return memory.get(slot) ?? null;
}

export async function deleteSave(slot: SaveSlot): Promise<void> {
  memory.delete(slot);
  const d = await db();
  if (!d) return;
  try {
    await req(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(slot));
  } catch {
    // nothing to delete
  }
}

/** Every save there is, newest first. */
export async function listSaves(): Promise<SaveRecord[]> {
  const out = new Map<SaveSlot, SaveRecord>(memory);
  const d = await db();
  if (d) {
    try {
      const all = (await req(d.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as SaveRecord[];
      for (const r of all) if (r && SAVE_SLOTS.includes(r.slot)) out.set(r.slot, r);
    } catch {
      // memory only
    }
  }
  return [...out.values()].sort((a, b) => (a.header.date < b.header.date ? 1 : -1));
}

/** "A Meadow Kingdom · 12 min · 48 ants · 24 Oct 14:05" */
export function describeSave(h: SaveHeader): string {
  const d = new Date(h.date);
  const when = isNaN(d.getTime()) ? '' : ` · ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  return `${h.title} · ${Math.floor(h.time / 60)} min · ${h.ants} ants${when}`;
}

/** Let the browser download bytes as a file. */
export function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** A file name with the date: underground-dominion-2026-10-24-14-05.udsave */
export function stampedName(ext: string): string {
  return `underground-dominion-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`;
}
