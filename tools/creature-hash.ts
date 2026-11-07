/**
 * Geometry fingerprint of every creature model: each builder is run in a rest, a walking and a dead pose, and every
 * primitive and sculpted part it emits (name, placement matrix, colour, surface) is hashed together with the vertex
 * data of the sculpted parts it uses. Used to prove a model change leaves the other creatures untouched: save a
 * baseline, patch, compare. (The ant morphs have tools/morph-hash.ts.)
 *
 *   npx vite-node tools/creature-hash.ts -- save <file>      write the hashes
 *   npx vite-node tools/creature-hash.ts -- check <file>     compare (exit 1 on any difference)
 *   npx vite-node tools/creature-hash.ts -- dump <file> <kind> write every drawn part of one kind, for a diff
 */
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BUILDERS, CHAINS, CrPose } from '../src/render/creatures/builders';
import { CREATURES } from '../src/sim/creatures/kinds';
import { Rig } from '../src/render/creatures/rig';
import { partGeometry, PrimitiveBatch } from '../src/render/creatures/primitives';

const args = process.argv.slice(2).filter((a) => a !== '--');
const [mode, file] = args;

/** A rig output that records what is drawn instead of drawing it. */
class Recorder {
  readonly lines: string[] = [];
  readonly partsUsed = new Set<string>();
  add(prim: string, m: THREE.Matrix4, color: THREE.Color, surf: { rough: number; gloss: number; pattern: number; scale: number }): void {
    this.lines.push(`${prim} ${m.elements.map((v) => v.toFixed(4)).join(',')} ${color.getHexString()} ${surf.rough},${surf.gloss},${surf.pattern},${surf.scale}`);
  }
  addPart(name: string, m: THREE.Matrix4, color: THREE.Color, surf: { rough: number; gloss: number; pattern: number; scale: number }): void {
    this.partsUsed.add(name);
    this.add('part:' + name, m, color, surf);
  }
}

function pose(kind: string, L: number, phase: number, amp: number, dead: boolean, msize: number): CrPose {
  const chain = CHAINS.has(kind);
  return {
    L,
    x: 0,
    z: 0,
    h: 0,
    hx: chain ? L * 0.5 : 0,
    hz: 0,
    phase,
    amp,
    t: 0.5,
    state: 0,
    st: 0,
    dead,
    deadT: dead ? 2 : 0,
    eaten: 0,
    v2: 0.3,
    hurt: 0,
    data: { msize },
    trail: new Float32Array(0),
    trailN: 0,
    trailStep: L / 30,
    ground: () => 0,
  };
}

const geoHash = new Map<string, string>();
function hashPart(name: string): string {
  let h = geoHash.get(name);
  if (h) return h;
  const g = partGeometry(name);
  const sha = createHash('sha1');
  for (const k of Object.keys(g.attributes).sort()) {
    const a = g.getAttribute(k) as THREE.BufferAttribute;
    sha.update(k);
    sha.update(Buffer.from(new Float32Array(a.array as ArrayLike<number>).map((v) => Math.round(v * 1e4) / 1e4).buffer));
  }
  if (g.index) sha.update(Buffer.from(new Uint32Array(g.index.array as ArrayLike<number>).buffer));
  h = sha.digest('hex').slice(0, 16);
  geoHash.set(name, h);
  return h;
}

function hashKind(kind: string, msize: number, dump?: string[]): string {
  const L = CREATURES[kind]?.length ?? 10;
  const rec = new Recorder();
  const rig = new Rig(rec as unknown as PrimitiveBatch);
  const b = BUILDERS[kind];
  for (const [phase, amp, dead] of [
    [0, 0, false],
    [0.3, 1, false],
    [0, 0, true],
  ] as Array<[number, number, boolean]>) {
    rig.setBase(0, 0, 0, 0, 0, 0);
    b(rig, pose(kind, L, phase, amp, dead, msize));
    rec.lines.push('--');
  }
  const sha = createHash('sha1');
  for (const l of rec.lines) sha.update(l + '\n');
  for (const p of [...rec.partsUsed].sort()) sha.update(`${p}=${hashPart(p)}\n`);
  if (dump) dump.push(...rec.lines, ...[...rec.partsUsed].sort().map((p) => `${p}=${hashPart(p)}`));
  return sha.digest('hex').slice(0, 20);
}

if (mode === 'dump') {
  const lines: string[] = [];
  hashKind(args[2], 1, lines);
  writeFileSync(file, lines.join('\n') + '\n');
  console.log(`wrote ${lines.length} lines to ${file}`);
  process.exit(0);
}
const now: Record<string, string> = {};
for (const kind of Object.keys(BUILDERS).sort()) {
  if (kind === 'stagBeetle') for (let q = 0; q <= 4; q++) now[`stagBeetle@${q}`] = hashKind(kind, q / 4);
  else now[kind] = hashKind(kind, 1);
}
if (mode === 'save') {
  writeFileSync(file, JSON.stringify(now, null, 1));
  console.log(`saved ${Object.keys(now).length} creature hashes to ${file}`);
} else if (mode === 'check') {
  const base = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  let bad = 0;
  let same = 0;
  for (const [k, v] of Object.entries(base)) {
    if (!(k in now)) {
      console.log(`  gone     ${k}`);
      continue;
    }
    if (now[k] !== v) {
      bad++;
      console.log(`  CHANGED  ${k}: ${v} -> ${now[k]}`);
    } else same++;
  }
  for (const k of Object.keys(now)) if (!(k in base)) console.log(`  new      ${k} (${now[k]})`);
  console.log(`${same} unchanged, ${bad} changed`);
  if (bad) process.exit(1);
} else {
  for (const [k, v] of Object.entries(now)) console.log(`${v}  ${k}`);
}
