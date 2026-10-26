/**
 * Authors the climb rails and riding slots of every climbable creature
 * (CHANGE_PLAN §15.2) and writes them to `src/sim/creatures/climbData.ts`.
 *
 * Rails come from the creature's own model: each builder is run once in its
 * rest pose with a recording rig, and every chosen leg's joints (foot, ankle,
 * knee, hip) become a rail, so a rail runs up the same leg the renderer
 * draws. Riding slots are laid out here per kind over the body parts of the
 * builder (elytra, carapace, abdomen, segments), on the top surface of the
 * part's ellipsoid. How many follows the creature's size: the area of those
 * parts ÷ `BALANCE.climb.roomUnitMm2` (the room one ant takes), at most
 * `maxRiders`, shared among the parts by area and spread evenly over them.
 * Units are fractions of the creature's length; the frame is the builders'
 * local one (+x forward, +y up, +z left).
 *
 *   npx vite-node tools/climb-data.ts
 */
import { writeFileSync } from 'node:fs';
import { PrimitiveBatch } from '../src/render/creatures/primitives';
import { Rig, ClimbRec } from '../src/render/creatures/rig';
import { BUILDERS, CHAINS, CrPose } from '../src/render/creatures/builders';
import { CREATURES } from '../src/sim/creatures/kinds';
import { BALANCE } from '../src/sim/balance';

/** Kinds that can be climbed, the legs used as rails and how the slots are laid out. */
interface Patch {
  /** body frame the slots sit on ('body', or a chain segment 's3') */
  frame: string;
  /** ellipsoid of the body part in that frame (fractions of L): centre and semi-axes */
  cx: number;
  cy: number;
  cz?: number;
  rx: number;
  ry: number;
  rz: number;
  /** relative share of the slots (default: by area); the count itself comes from the size */
  n: number;
  /** how far out on the ellipse the slots may go (0..1) */
  spread?: number;
}

const beetle = (lift: number, parts: Array<[number, number, number, number, number, number]>): Patch[] =>
  parts.map(([cx, dy, rx, ry, rz, n]) => ({ frame: 'body', cx, cy: lift + dy, rx, ry, rz, n }));

const spider = (k: number, nCeph: number, nAbd: number): Patch[] => [
  { frame: 'body', cx: 0.22, cy: 0.17, rx: 0.24, ry: 0.11, rz: 0.18, n: nCeph },
  { frame: 'body', cx: -0.26, cy: 0.17 + 0.03, rx: 0.26 * k, ry: 0.15 * k, rz: 0.17 * k, n: nAbd },
];

const mantis = (heavy: number, n: number): Patch[] => [
  // the folded wings over the abdomen, and the mesothorax
  { frame: 'body', cx: -0.17, cy: 0.12 + 0.055, rx: 0.25, ry: 0.012, rz: 0.06 * heavy, n: n - 1, spread: 0.85 },
  { frame: 'body', cx: 0.03, cy: 0.12, rx: 0.06, ry: 0.035 * heavy, rz: 0.04 * heavy, n: 1 },
];

/** Chain creatures: slots on segments from..to (every `every`), one or two per segment. */
function segs(n: number, from: number, to: number, ry: number, rz: number, perSeg: (i: number) => number): Patch[] {
  const out: Patch[] = [];
  for (let i = from; i <= to; i++) {
    const k = perSeg(i);
    if (k > 0) out.push({ frame: 's' + i, cx: 0, cy: 0, rx: 0.5 / n, ry, rz, n: k, spread: 0.6 });
  }
  return out;
}

const KINDS: Record<string, { legs: (name: string) => boolean; patches: Patch[] }> = {
  groundBeetle: { legs: () => true, patches: beetle(0.13, [[-0.16, 0, 0.285, 0.088, 0.19, 5], [0.17, 0.005, 0.095, 0.07, 0.15, 1]]) },
  rove: {
    legs: () => true,
    patches: [
      ...beetle(0.08, [[0.09, 0.003, 0.075, 0.042, 0.075, 2], [0.22, 0, 0.07, 0.045, 0.068, 1]]),
      // the long abdomen: three slots down its middle
      ...[-0.01, -0.09, -0.17].map((cx) => ({ frame: 'body', cx, cy: 0.08, rx: 0.04, ry: 0.038, rz: 0.06, n: 1, spread: 0 })),
    ],
  },
  stagBeetle: { legs: () => true, patches: beetle(0.14, [[-0.18, 0, 0.28, 0.11, 0.17, 16], [0.1, 0.01, 0.1, 0.08, 0.15, 6], [0.22, -0.01, 0.06, 0.05, 0.13, 2]]) },
  wolfSpider: { legs: () => true, patches: spider(1, 4, 6) },
  tarantula: { legs: () => true, patches: spider(1.08, 9, 15) },
  hogna: { legs: () => true, patches: spider(1.15, 8, 12) },
  mantis: { legs: () => true, patches: mantis(1, 10) },
  giantMantis: { legs: () => true, patches: mantis(1.3, 26) },
  // chains: segment frames, rails up every other leg pair
  lithobius: { legs: (n) => Number(n.slice(1, -1)) % 2 === 0, patches: segs(16, 2, 13, 0.018, 0.05, () => 1) },
  scolopendra: { legs: (n) => Number(n.slice(1, -1)) % 2 === 0, patches: segs(22, 1, 21, 0.022, 0.055, () => 1) },
  cutworm: { legs: () => true, patches: segs(13, 2, 11, 0.085, 0.085, () => 1) },
};

function restPose(kind: string, L: number): CrPose {
  const chain = CHAINS.has(kind);
  return {
    L,
    x: 0,
    z: 0,
    h: 0,
    hx: chain ? L * 0.5 : 0,
    hz: 0,
    phase: 0,
    amp: 0,
    t: 0,
    state: 0,
    st: 0,
    dead: false,
    deadT: 0,
    eaten: 0,
    v2: 0,
    hurt: 0,
    data: {},
    trail: new Float32Array(0),
    trailN: 0,
    trailStep: L / 30,
    ground: () => 0,
  };
}

/** Even spread of n points over the inner part of an ellipse (golden angle), sorted front to back then left to right. */
function spread(p: Patch): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const s = p.spread ?? 0.7;
  for (let i = 0; i < p.n; i++) {
    let u = 0;
    let v = 0;
    if (p.n > 1) {
      const r = Math.sqrt((i + 0.5) / p.n) * s;
      const a = i * 2.39996323;
      u = Math.cos(a) * r;
      v = Math.sin(a) * r;
    }
    const x = p.cx + u * p.rx;
    const z = (p.cz ?? 0) + v * p.rz;
    // on the top of the ellipsoid
    const y = p.cy + p.ry * Math.sqrt(Math.max(0, 1 - u * u - v * v));
    out.push([x, y, z]);
  }
  return out.sort((a, b) => b[0] - a[0] || b[2] - a[2]);
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

const out: string[] = [];
const sizes: string[] = [];
for (const [kind, def] of Object.entries(KINDS)) {
  const L = CREATURES[kind].length;
  const rig = new Rig(new PrimitiveBatch());
  const rec: ClimbRec = { legs: new Map(), frames: new Map(), frame: 0 };
  rig.rec = rec;
  BUILDERS[kind](rig, restPose(kind, L));
  const rails: string[] = [];
  for (const [name, a] of [...rec.legs].sort((x, y) => x[0].localeCompare(y[0], 'en', { numeric: true }))) {
    if (!def.legs(name)) continue;
    // stored hip, knee, ankle, foot; a rail runs foot → ankle → knee → hip
    const pts: number[] = [];
    for (const j of [3, 2, 1, 0]) pts.push(r4(a[j * 3] / L), r4(a[j * 3 + 1] / L), r4(a[j * 3 + 2] / L));
    rails.push(`    { leg: '${name}', pts: [${pts.join(', ')}] },`);
  }
  // how many ride: the back's area ÷ the room one ant takes, shared among the parts by area, spread evenly
  const areas = def.patches.map((p) => Math.PI * p.rx * p.rz * L * L);
  const total = areas.reduce((x, y) => x + y, 0);
  const n = Math.max(1, Math.min(BALANCE.climb.maxRiders, Math.round(total / BALANCE.climb.roomUnitMm2)));
  let cum = 0;
  const slots: string[] = [];
  def.patches.forEach((p, i) => {
    const k = Math.floor(((cum + areas[i]) * n) / total + 1e-9) - Math.floor((cum * n) / total + 1e-9);
    cum += areas[i];
    if (k <= 0) return;
    for (const [x, y, z] of spread({ ...p, n: k })) slots.push(`{ frame: '${p.frame}', x: ${r4(x)}, y: ${r4(y)}, z: ${r4(z)} }`);
  });
  const frames: string[] = [];
  const used = new Set(slots.map((t) => /frame: '([^']+)'/.exec(t)![1]));
  for (const f of [...used].sort()) {
    const m = rec.frames.get(f);
    if (!m) throw new Error(`${kind}: no frame ${f}`);
    const e = m.elements;
    frames.push(`${/^[a-z]\w*$/.test(f) ? f : `'${f}'`}: [${r4(e[12] / L)}, ${r4(e[13] / L)}, ${r4(e[14] / L)}]`);
  }
  sizes.push(`${kind} ${L} mm: back ${total.toFixed(0)} mm² → room ${Math.max(1, Math.round(total / BALANCE.climb.roomUnitMm2))}, ${n} slots`);
  out.push(`  ${kind}: {
    rails: [
${rails.join('\n')}
    ],
    area: ${r4(total / (L * L))},
    frames: { ${frames.join(', ')} },
    slots: [
      ${slots.join(',\n      ')},
    ],
  },`);
}

const file = `// Generated by tools/climb-data.ts from the creature models; edit the tool, not this file.
import type { ClimbDef } from './climb';

/**
 * Climb rails (one per climbable leg: foot → ankle → knee → hip, x y z each)
 * and riding slots, in fractions of the creature's length, in the builders'
 * local frame (+x forward, +y up, +z left). \`frames\` are the rest positions of
 * the body frames the slots sit on.
 */
export const CLIMB_DATA: Record<string, ClimbDef> = {
${out.join('\n')}
};
`;
writeFileSync(new URL('../src/sim/creatures/climbData.ts', import.meta.url), file);
console.log(`climbData.ts: ${Object.keys(KINDS).length} kinds\n  ${sizes.join('\n  ')}`);
