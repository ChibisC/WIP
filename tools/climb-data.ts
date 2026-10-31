/**
 * Authors the climbing data of every climbable creature (combat v2, CHANGE_PLAN §16 step 9; first version §15.2) and
 * writes it to `src/sim/creatures/climbData.ts`:
 *
 *  - **Climbing points and rails** come from the creature's own model: each builder is run once in its rest pose
 *    with a recording rig, and every chosen leg's joints (foot, ankle, knee, hip) become a rail, so a rail runs up
 *    the same leg the renderer draws. The foot is the climbing point.
 *  - **Weak points** (EotU: titans' cart rails lead to weak points) are authored here per body plan: the neck (head–
 *    thorax joint), the thorax–abdomen joint (a spider's pedicel), the top of the abdomen, the carapace or pronotum,
 *    the leg bases (each rail's hip), and on centipedes and caterpillars the segment joints.
 *  - **Mount slots** sit on the body surface round the weak points (on the top of each body part's ellipsoid, or on
 *    a femur just outside the body for a leg base), each with its surface normal (a rider's belly goes against it)
 *    and the weak point it faces. They are picked greedily — first the one nearest each weak point, then always the
 *    candidate farthest from those taken — and never closer than `mount.slotGap` × `mount.refRiderMm`, so riders
 *    never overlap; at most the creature's class cap (`mount.capLarge`, `mount.capHuge` for bosses). A small creature
 *    may get fewer (its cap in the game is then the slots it has).
 *
 * Units are fractions of the creature's length; the frame is the builders' local one (+x forward, +y up, +z left).
 *
 *   npx vite-node tools/climb-data.ts
 */
import { writeFileSync } from 'node:fs';
import { PrimitiveBatch } from '../src/render/creatures/primitives';
import { Rig, ClimbRec } from '../src/render/creatures/rig';
import { BUILDERS, CHAINS, CrPose } from '../src/render/creatures/builders';
import { CREATURES } from '../src/sim/creatures/kinds';
import { BALANCE } from '../src/sim/balance';

/** A body part as an ellipsoid in a body frame (fractions of L): centre and semi-axes. */
interface Part {
  frame: string;
  cx: number;
  cy: number;
  cz?: number;
  rx: number;
  ry: number;
  rz: number;
}
/** A weak point: on top of the parts at (x, z) of its frame. */
interface WeakSpec {
  name: string;
  frame: string;
  x: number;
  z?: number;
}

const part = (frame: string, cx: number, cy: number, rx: number, ry: number, rz: number, cz = 0): Part => ({ frame, cx, cy, cz, rx, ry, rz });

const spiderParts = (k: number): Part[] => [part('body', 0.22, 0.17, 0.24, 0.11, 0.18), part('body', -0.26, 0.2, 0.26 * k, 0.15 * k, 0.17 * k)];
const spiderWeak: WeakSpec[] = [
  { name: 'pedicel', frame: 'body', x: -0.01 },
  { name: 'abdomen', frame: 'body', x: -0.27 },
  { name: 'carapace', frame: 'body', x: 0.24 },
];
const mantisParts = (h: number): Part[] => [
  // folded wings over the abdomen, mesothorax, the long prothorax rising forward
  part('body', -0.17, 0.175, 0.25, 0.012, 0.06 * h),
  part('body', 0.03, 0.12, 0.06, 0.035 * h, 0.04 * h),
  part('body', 0.17, 0.15, 0.12, 0.025, 0.03 * h),
];
const mantisWeak: WeakSpec[] = [
  { name: 'thorax–abdomen', frame: 'body', x: -0.03 },
  { name: 'abdomen', frame: 'body', x: -0.22 },
  { name: 'pro–mesothorax', frame: 'body', x: 0.08 },
  { name: 'neck', frame: 'body', x: 0.27 },
];
/** Chain bodies: one part per segment from..to, weak points at the neck and every third segment joint. */
function chainParts(n: number, from: number, to: number, ry: number, rz: number): Part[] {
  const out: Part[] = [];
  for (let i = from; i <= to; i++) out.push(part('s' + i, 0, 0, 0.5 / n, ry, rz));
  return out;
}
function chainWeak(n: number, from: number, to: number): WeakSpec[] {
  const out: WeakSpec[] = [{ name: 'neck', frame: 's' + from, x: 0.25 / n }];
  for (let i = from + 2; i <= to; i += 3) out.push({ name: `joint ${i}`, frame: 's' + i, x: 0.25 / n });
  return out;
}

const KINDS: Record<string, { legs: (name: string) => boolean; parts: Part[]; weak: WeakSpec[]; legBases: boolean }> = {
  groundBeetle: {
    legs: () => true,
    parts: [part('body', -0.16, 0.13, 0.285, 0.088, 0.19), part('body', 0.17, 0.135, 0.095, 0.07, 0.15)],
    weak: [{ name: 'thorax–abdomen', frame: 'body', x: 0.1 }, { name: 'abdomen', frame: 'body', x: -0.18 }, { name: 'neck', frame: 'body', x: 0.25 }],
    legBases: true,
  },
  rove: {
    legs: () => true,
    parts: [part('body', 0.09, 0.083, 0.075, 0.042, 0.075), part('body', 0.22, 0.08, 0.07, 0.045, 0.068), ...[-0.01, -0.09, -0.17].map((cx) => part('body', cx, 0.08, 0.04, 0.038, 0.06))],
    weak: [{ name: 'thorax–abdomen', frame: 'body', x: 0.03 }, { name: 'abdomen', frame: 'body', x: -0.1 }, { name: 'neck', frame: 'body', x: 0.16 }],
    legBases: true,
  },
  stagBeetle: {
    legs: () => true,
    parts: [part('body', -0.18, 0.14, 0.28, 0.11, 0.17), part('body', 0.1, 0.15, 0.1, 0.08, 0.15), part('body', 0.22, 0.13, 0.06, 0.05, 0.13)],
    weak: [{ name: 'thorax–abdomen', frame: 'body', x: 0.0 }, { name: 'abdomen', frame: 'body', x: -0.2 }, { name: 'neck', frame: 'body', x: 0.17 }, { name: 'pronotum', frame: 'body', x: 0.1 }],
    legBases: true,
  },
  wolfSpider: { legs: () => true, parts: spiderParts(1), weak: spiderWeak, legBases: true },
  tarantula: { legs: () => true, parts: spiderParts(1.08), weak: spiderWeak, legBases: true },
  hogna: { legs: () => true, parts: spiderParts(1.15), weak: spiderWeak, legBases: true },
  mantis: { legs: () => true, parts: mantisParts(1), weak: mantisWeak, legBases: true },
  giantMantis: { legs: () => true, parts: mantisParts(1.3), weak: mantisWeak, legBases: true },
  // chains: segment frames, rails up every other leg pair
  lithobius: { legs: (n) => Number(n.slice(1, -1)) % 2 === 0, parts: chainParts(16, 2, 13, 0.018, 0.05), weak: chainWeak(16, 1, 13), legBases: false },
  scolopendra: { legs: (n) => Number(n.slice(1, -1)) % 2 === 0, parts: chainParts(22, 1, 21, 0.022, 0.055), weak: chainWeak(22, 1, 21), legBases: false },
  cutworm: { legs: () => true, parts: chainParts(13, 2, 11, 0.085, 0.085), weak: chainWeak(13, 1, 11), legBases: false },
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

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
type P3 = [number, number, number];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: P3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: P3): P3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Height of the top of the parts of `frame` at (x, z), or −1 if none covers it; and that part. */
function topAt(parts: Part[], frame: string, x: number, z: number): { y: number; p: Part | null } {
  let best = -1;
  let bp: Part | null = null;
  for (const p of parts) {
    if (p.frame !== frame) continue;
    const u = (x - p.cx) / p.rx;
    const v = (z - (p.cz ?? 0)) / p.rz;
    const q = 1 - u * u - v * v;
    if (q < 0) continue;
    const y = p.cy + p.ry * Math.sqrt(q);
    if (y > best) {
      best = y;
      bp = p;
    }
  }
  return { y: best, p: bp };
}

function normalOf(p: Part, x: number, y: number, z: number): P3 {
  return norm([(x - p.cx) / (p.rx * p.rx), (y - p.cy) / (p.ry * p.ry), (z - (p.cz ?? 0)) / (p.rz * p.rz)]);
}

interface Cand {
  frame: string;
  pos: P3; // in its frame
  world: P3; // rest pose, root frame (for spacing)
  n: P3;
  w: number;
}

const out: string[] = [];
const sizes: string[] = [];
const M = BALANCE.mount;
for (const [kind, def] of Object.entries(KINDS)) {
  const k = CREATURES[kind];
  const L = k.length;
  const cap = k.boss ? M.capHuge : M.capLarge;
  const gap = (M.slotGap * M.refRiderMm) / L;
  const rig = new Rig(new PrimitiveBatch());
  const rec: ClimbRec = { legs: new Map(), frames: new Map(), frame: 0 };
  rig.rec = rec;
  BUILDERS[kind](rig, restPose(kind, L));
  const frameAt = (f: string): P3 => {
    const m = rec.frames.get(f);
    if (!m) throw new Error(`${kind}: no frame ${f}`);
    const e = m.elements;
    return [e[12] / L, e[13] / L, e[14] / L];
  };
  // rails (foot → ankle → knee → hip) of the chosen legs
  const rails: Array<{ leg: string; pts: number[] }> = [];
  for (const [name, a] of [...rec.legs].sort((x, y) => x[0].localeCompare(y[0], 'en', { numeric: true }))) {
    if (!def.legs(name)) continue;
    const pts: number[] = [];
    for (const j of [3, 2, 1, 0]) pts.push(r4(a[j * 3] / L), r4(a[j * 3 + 1] / L), r4(a[j * 3 + 2] / L));
    rails.push({ leg: name, pts });
  }
  // weak points: authored ones on the body, then the leg bases (hips)
  const weak: Array<{ name: string; frame: string; pos: P3; world: P3 }> = [];
  for (const s of def.weak) {
    const z = s.z ?? 0;
    const t = topAt(def.parts, s.frame, s.x, z);
    if (t.y < 0) throw new Error(`${kind}: weak point ${s.name} is off the body`);
    const pos: P3 = [s.x, t.y, z];
    const f = frameAt(s.frame);
    weak.push({ name: s.name, frame: s.frame, pos, world: [pos[0] + f[0], pos[1] + f[1], pos[2] + f[2]] });
  }
  const legW: number[] = [];
  if (def.legBases)
    for (const r of rails) {
      const hip: P3 = [r.pts[9], r.pts[10], r.pts[11]];
      const bf = frameAt('body');
      legW.push(weak.length);
      weak.push({ name: `${r.leg} base`, frame: 'body', pos: sub(hip, bf), world: hip });
    }
  // candidate places: the top of every part (a cap of rings round its crown), and the femur of each leg just
  // outside the body (leg bases)
  const cands: Cand[] = [];
  const nearestWeak = (world: P3): number => {
    let bi = 0;
    let bd = Infinity;
    weak.forEach((wk, i) => {
      const d = len(sub(world, wk.world));
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  };
  for (const p of def.parts) {
    const f = frameAt(p.frame);
    for (const th of [0, 0.35, 0.7, 1.0]) {
      const steps = th === 0 ? 1 : 12;
      for (let i = 0; i < steps; i++) {
        const ph = (i / steps) * Math.PI * 2;
        const x = p.cx + Math.sin(th) * Math.cos(ph) * p.rx;
        const z = (p.cz ?? 0) + Math.sin(th) * Math.sin(ph) * p.rz;
        const t = topAt(def.parts, p.frame, x, z);
        if (t.y < 0 || t.p !== p) continue; // covered by another part
        const n = normalOf(p, x, t.y, z);
        if (n[1] < 0.35) continue; // too steep: riders sit on the top and upper sides
        const pos: P3 = [x, t.y, z];
        const world: P3 = [x + f[0], t.y + f[1], z + f[2]];
        cands.push({ frame: p.frame, pos, world, n, w: nearestWeak(world) });
      }
    }
  }
  if (def.legBases)
    rails.forEach((r, i) => {
      const hip: P3 = [r.pts[9], r.pts[10], r.pts[11]];
      const knee: P3 = [r.pts[6], r.pts[7], r.pts[8]];
      const world: P3 = [hip[0] + (knee[0] - hip[0]) * 0.6, hip[1] + (knee[1] - hip[1]) * 0.6, hip[2] + (knee[2] - hip[2]) * 0.6];
      const bf = frameAt('body');
      const side = Math.sign(knee[2] - hip[2]) || 1;
      cands.push({ frame: 'body', pos: sub(world, bf), world, n: norm([0, 1, 0.6 * side]), w: legW[i] });
    });
  // pick: nearest to each weak point first (authored order, then leg bases), then always the farthest from those taken
  const chosen: Cand[] = [];
  const ok = (c: Cand) => chosen.every((o) => len(sub(o.world, c.world)) >= gap - 1e-9);
  for (let wi = 0; wi < weak.length && chosen.length < cap; wi++) {
    let best: Cand | null = null;
    let bd = Infinity;
    for (const c of cands) {
      if (c.w !== wi || chosen.includes(c) || !ok(c)) continue;
      const d = len(sub(c.world, weak[wi].world));
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) chosen.push(best);
  }
  while (chosen.length < cap) {
    let best: Cand | null = null;
    let bd = -1;
    for (const c of cands) {
      if (chosen.includes(c) || !ok(c)) continue;
      const d = Math.min(...chosen.map((o) => len(sub(o.world, c.world))));
      if (d > bd) {
        bd = d;
        best = c;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  const frames = new Set<string>(['body', ...chosen.map((c) => c.frame), ...weak.map((wk) => wk.frame)]);
  const frameStr = [...frames]
    .filter((f) => rec.frames.has(f))
    .sort()
    .map((f) => {
      const p = frameAt(f);
      return `${/^[a-z]\w*$/.test(f) ? f : `'${f}'`}: [${r4(p[0])}, ${r4(p[1])}, ${r4(p[2])}]`;
    });
  sizes.push(`${kind.padEnd(12)} ${String(L).padStart(3)} mm ${k.boss ? 'huge ' : 'large'}: ${rails.length} climbing points, ${weak.length} weak points, ${chosen.length} mount slots (cap ${Math.min(cap, chosen.length)}), ${(gap * L).toFixed(1)} mm apart`);
  out.push(`  ${kind}: {
    rails: [
${rails.map((r) => `      { leg: '${r.leg}', pts: [${r.pts.join(', ')}] },`).join('\n')}
    ],
    frames: { ${frameStr.join(', ')} },
    weak: [
${weak.map((wk) => `      { name: '${wk.name}', frame: '${wk.frame}', x: ${r4(wk.pos[0])}, y: ${r4(wk.pos[1])}, z: ${r4(wk.pos[2])} },`).join('\n')}
    ],
    slots: [
${chosen.map((c) => `      { frame: '${c.frame}', x: ${r4(c.pos[0])}, y: ${r4(c.pos[1])}, z: ${r4(c.pos[2])}, nx: ${r4(c.n[0])}, ny: ${r4(c.n[1])}, nz: ${r4(c.n[2])}, w: ${c.w} },`).join('\n')}
    ],
  },`);
}

const file = `// Generated by tools/climb-data.ts from the creature models; edit the tool, not this file.
import type { ClimbDef } from './climb';

/**
 * Climbing data (combat v2, CHANGE_PLAN §16): rails up the legs (one per climbable leg: foot → ankle → knee → hip,
 * x y z each; the foot is the climbing point), weak points (neck, thorax–abdomen joint, abdomen, leg bases, segment
 * joints) and mount slots round them on the body surface (position, surface normal, the weak point it faces), in
 * fractions of the creature's length, in the builders' local frame (+x forward, +y up, +z left). \`frames\` are the
 * rest positions of the body frames the weak points and slots sit on.
 */
export const CLIMB_DATA: Record<string, ClimbDef> = {
${out.join('\n')}
};
`;
writeFileSync(new URL('../src/sim/creatures/climbData.ts', import.meta.url), file);
console.log(`climbData.ts: ${Object.keys(KINDS).length} kinds\n  ${sizes.join('\n  ')}`);
