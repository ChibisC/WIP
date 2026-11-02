/**
 * Finds the stat scale at which a caste ties a reference caste at equal food (tools/balance-matrix.ts `vsRef`).
 * Equal-food fights snowball, so the survivor margin swings from −0.7 to +0.7 over a few per cent of strength; this
 * searches the scale instead (a secant search on the margin, three or four steps), so each caste's numbers can be set
 * from the tie point rather than by trial and error.
 *
 * The scale multiplies health and every damage source (bite, sting, acid, snap) by `s`, i.e. fighting power by s²;
 * a caste whose damage is a shared ramp (nasute, sickle-jaw) has its health multiplied by s² instead.
 *   npx vite-node tools/balance-tune.ts -- <ref> <food> <caste,caste,...>
 * Prints, for each caste, the margins tried and the tie scale (hp and bite at the tie).
 */
import { CASTES } from '../src/sim/species';
import { fight } from './balance-matrix';
import { casteCosts } from '../src/sim/tiles';
import { NASUTE } from '../src/sim/balance';

const RAMP0 = { ...NASUTE.ramp };

const args = process.argv.slice(2).filter((a) => a !== '--');
const ref = args[0];
const FOOD = Number(args[1]);
const list = (args[2] ?? '').split(',').filter(Boolean);
const cost = (c: string) => casteCosts(c).build + casteCosts(c).hatch;
const nFor = (c: string) => Math.max(1, Math.round(FOOD / cost(c)));

type Snap = { hp: number; bite: number; sting?: number; acid?: number; snapDps?: number; burst?: number };
function snap(id: string): Snap {
  const c = CASTES[id];
  return { hp: c.hp, bite: c.bite, sting: c.sting?.dps, acid: c.acid?.damage, snapDps: c.snap?.dps, burst: c.snap && 'burst' in c.snap ? (c.snap as { burst?: number }).burst : undefined };
}
function apply(id: string, b: Snap, s: number): void {
  const c = CASTES[id] as unknown as Record<string, any>;
  // a nasute's power is its glue stream (pure damage, from range): scale the stream's ramp
  if (c.acid?.kind === 'ramp') {
    const r = NASUTE.ramp as { startDps: number; capDps: number };
    r.startDps = RAMP0.startDps * s * s;
    r.capDps = RAMP0.capDps * s * s;
    return;
  }
  if (c.termite === 'sickle') {
    c.hp = b.hp * s * s;
    return;
  }
  c.hp = b.hp * s;
  c.bite = b.bite * s;
  // NOSTING=1 keeps the venom as it is (a design rule ties it to another caste's)
  if (c.sting && b.sting !== undefined && !process.env.NOSTING) c.sting = { ...c.sting, dps: b.sting * s };
  if (c.acid && b.acid !== undefined) c.acid = { ...c.acid, damage: b.acid * s };
  if (c.snap && b.snapDps !== undefined) c.snap = { ...c.snap, dps: b.snapDps * s, ...(b.burst !== undefined ? { burst: b.burst * s } : {}) };
}
function margin(a: string): number {
  let d = 0;
  for (const seed of [3, 4, 5]) {
    const r = fight(a, nFor(a), ref, nFor(ref), seed);
    const q = fight(ref, nFor(ref), a, nFor(a), seed);
    d += (r.a - r.b + (q.b - q.a)) / 6;
  }
  return d;
}

for (const id of list) {
  const base = snap(id);
  const tried: Array<[number, number]> = [];
  const at = (s: number) => {
    apply(id, base, s);
    const m = margin(id);
    tried.push([s, m]);
    return m;
  };
  let s0 = 1;
  let m0 = at(s0);
  // first step: the margin is steep, a few per cent per 0.1 of margin
  let s1 = m0 > 0 ? 0.88 : 1.12;
  let m1 = at(s1);
  for (let k = 0; k < 3 && Math.abs(m1) > 0.12; k++) {
    let s2: number;
    if (Math.sign(m0) !== Math.sign(m1) || Math.abs(m1 - m0) > 0.05) s2 = s1 - (m1 * (s1 - s0)) / (m1 - m0 || 1e-6);
    else s2 = s1 + (s1 - s0);
    s2 = Math.min(Math.max(s2, 0.6), 1.6);
    s0 = s1;
    m0 = m1;
    s1 = s2;
    m1 = at(s1);
  }
  // the tie: interpolate between the two closest bracketing tries (else the closest one)
  tried.sort((p, q) => p[0] - q[0]);
  let tie = tried.reduce((b, p) => (Math.abs(p[1]) < Math.abs(b[1]) ? p : b))[0];
  for (let i = 0; i + 1 < tried.length; i++) {
    const [sa, ma] = tried[i];
    const [sb, mb] = tried[i + 1];
    if (ma <= 0 && mb >= 0 && mb !== ma) tie = sa + ((0 - ma) * (sb - sa)) / (mb - ma);
  }
  apply(id, base, 1);
  const ramp = CASTES[id].acid?.kind === 'ramp';
  const rampOnly = ramp || CASTES[id].termite === 'sickle';
  const hp = ramp ? base.hp : rampOnly ? base.hp * tie * tie : base.hp * tie;
  const bite = rampOnly ? base.bite : base.bite * tie;
  if (ramp) console.log(`  (nasute stream at the tie: start ${(RAMP0.startDps * tie * tie).toFixed(2)} cap ${(RAMP0.capDps * tie * tie).toFixed(2)} dps)`);
  console.log(`${id.padEnd(20)} tries ${tried.map(([s, m]) => `${s.toFixed(3)}:${m >= 0 ? '+' : ''}${m.toFixed(2)}`).join(' ')}  tie ×${tie.toFixed(3)}  → hp ${hp.toFixed(1)} bite ${bite.toFixed(2)}${base.sting ? ` sting ${(base.sting * (rampOnly ? 1 : tie)).toFixed(2)}` : ''}${base.snapDps ? ` snap ${(base.snapDps * tie).toFixed(2)}` : ''}`);
}
