/**
 * Balance matrix (user 2026-11-02: "balance all current ant and termite species soldiers and workers and other castes
 * (workers should be similar in strength and stats but not the same like eotu) and buff creatures"):
 *  - equal-food fights: every species' worker against every other (and soldiers, majors), the same food's worth on
 *    each side (build + hatch), on open ground, two seeds; prints a win table and each caste's score;
 *  - creatures against black garden ant workers: how many workers a creature beats and how many it kills.
 *  - `stags`: each stag beetle male against 4…50 black garden ant workers and 2…16 soldiers, three seeds (`KINDS=…`,
 *    `STAG_NS=workers;soldiers` choose).
 *   npx vite-node tools/balance-matrix.ts -- [workers|soldiers|heavies|creatures|stags|all] [food=150]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { CASTES, SPECIES } from '../src/sim/species';
import { makeAnt } from '../src/sim/factory';
import { placeMarker } from '../src/sim/markers';
import { casteCosts } from '../src/sim/tiles';
import { creatureFight } from './creatureFight';

const args = process.argv.slice(2).filter((a) => a !== '--');
const what = args[0] ?? 'all';
const FOOD = Number(args[1] ?? 150);
const cost = (c: string) => casteCosts(c).build + casteCosts(c).hatch;
const nFor = (c: string) => Math.max(1, Math.round(FOOD / cost(c)));

/** Two groups meet on open ground; returns the share of each side alive at the end. */
export function fight(a: string, na: number, b: string, nb: number, seed = 3, secs = 120, probe?: (w: ReturnType<typeof createWorld>, ids: number[][], t: number) => void): { a: number; b: number; t: number } {
  const ev = new EventBus();
  const w = createWorld({ seed, style: 'formicarium', width: 600, depth: 600, colonies: [{ species: CASTES[a].species, player: true, ai: false }, { species: CASTES[b].species, player: false, ai: false }], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 } }, ev);
  w.s.settings.foodRespawn = 0;
  w.terrain.clearArea(150, 150, 450, 450);
  const ids: number[][] = [[], []];
  const groups: Array<[string, number]> = [[a, na], [b, nb]];
  groups.forEach(([caste, n], ci) => {
    const c = w.colony(ci)!;
    placeMarker(w, c, 0, SURFACE, 300, 300);
    placeMarker(w, c, 1, SURFACE, 300 + (ci === 0 ? -35 : 35), 300);
    // nothing to gather: without the order, sickle-jaw soldiers would guard a trail to their far-away nest (the order
    // changes how the others close in, army ants' raids most of all, so only they get it)
    if (CASTES[caste].termite === 'sickle') {
      c.markers[0].noGather = true;
      c.markers[1].noGather = true;
    }
    const shooter = !!CASTES[caste].acid && (CASTES[caste].acid!.kind === 'lob' || CASTES[caste].acid!.kind === 'rapid');
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 8);
      const col = i % 8;
      const x = 300 + (ci === 0 ? -50 - row * 7 - (shooter ? 18 : 0) : 50 + row * 7 + (shooter ? 18 : 0));
      const y = 300 + (col - 3.5) * 8;
      const ant = makeAnt(w, c.id, caste, SURFACE, x, y, ci === 0 ? 0 : Math.PI);
      ant.task = 'marker';
      ant.marker = shooter ? 1 : 0;
      ids[ci].push(ant.id);
    }
  });
  w.reindex();
  const alive = (ci: number) => ids[ci].filter((id) => {
    const x = w.antById.get(id);
    return x && x.state !== AS.Dead;
  }).length;
  let t = 0;
  for (; t <= secs * 20; t++) {
    w.step(0.05);
    ev.drain();
    for (const list of ids)
      for (const id of list) {
        const x = w.antById.get(id);
        if (x && x.state !== AS.Dead) {
          x.task = 'marker';
          x.marker = x.caste.includes('mortar') || x.caste.includes('rapid') ? 1 : 0;
        }
      }
    // PURSUE=1: each side's marker follows the other side's centre (sickle-jaw soldiers hold a guard line on the trail
    // and would never meet a reference that waits at the marker)
    if (process.env.PURSUE && t % 40 === 0)
      for (const ci of [0, 1]) {
        let sx = 0, sy = 0, n = 0;
        for (const id of ids[1 - ci]) {
          const x = w.antById.get(id);
          if (x && x.state !== AS.Dead) (sx += x.x), (sy += x.y), n++;
        }
        if (n) {
          placeMarker(w, w.colony(ci)!, 0, SURFACE, sx / n, sy / n);
          if (CASTES[groups[ci][0]].termite === 'sickle') w.colony(ci)!.markers[0].noGather = true;
        }
      }
    if (probe && t % 200 === 0) probe(w, ids, t / 20);
    if (!alive(0) || !alive(1)) break;
  }
  return { a: alive(0) / na, b: alive(1) / nb, t: t / 20 };
}

// (creatureFight lives in ./creatureFight.ts, without node globals, so tests can use it)
export { creatureFight };

function roundRobin(castes: string[], title: string): void {
  console.log(`\n== ${title}: equal food (${FOOD}), two seeds; cell = the row's survivors − the column's (−1..1)`);
  const score: Record<string, number> = {};
  const head = castes.map((c) => c.split('_')[0].slice(0, 5).padStart(6)).join('');
  console.log(''.padEnd(20) + head);
  for (const a of castes) {
    let row = a.padEnd(20);
    score[a] ??= 0;
    for (const b of castes) {
      if (a === b) {
        row += '     ·';
        continue;
      }
      let d = 0;
      for (const seed of [3, 4]) {
        const r = fight(a, nFor(a), b, nFor(b), seed);
        d += (r.a - r.b) / 2;
      }
      score[a] += d;
      row += d.toFixed(2).padStart(6);
    }
    console.log(row);
  }
  console.log('scores (mean margin):', castes.map((c) => `${c} ${(score[c] / (castes.length - 1)).toFixed(2)} [n=${nFor(c)}]`).join(', '));
}

/** Each caste against one reference caste, equal food, three seeds: the mean margin (−1..1; > 0 the caste wins). */
function vsRef(castes: string[], ref: string, title: string): void {
  console.log(`\n== ${title} v ${ref} (equal food ${FOOD}, seeds 3–5, both sides)`);
  const only = process.env.ONLY?.split(',');
  for (const a of castes.filter((c) => !only || c === ref || only.includes(c))) {
    let d = 0;
    const ts: number[] = [];
    for (const seed of [3, 4, 5]) {
      // both ways round (the two sides of the harness are not quite alike)
      const r = fight(a, nFor(a), ref, nFor(ref), seed);
      const q = fight(ref, nFor(ref), a, nFor(a), seed);
      d += (r.a - r.b + (q.b - q.a)) / 6;
      ts.push(Math.round((r.t + q.t) / 2));
    }
    console.log(`${a.padEnd(20)} n=${String(nFor(a)).padStart(2)} v ${nFor(ref)}: ${d >= 0 ? '+' : ''}${d.toFixed(2)}  (${ts.join(', ')} s)`);
  }
}

const pick = (role: (r: string, id: string) => boolean) => Object.values(SPECIES).flatMap((s) => s.castes.filter((id) => CASTES[id] && role(CASTES[id].role, id)));
const WORKERS = () => pick((r, id) => r === 'worker' && !CASTES[id].nanitic && !['atta_minim', 'eciton_submajor'].includes(id));
const SOLDIERS = () => pick((r, id) => r === 'soldier' && !id.includes('mortar') && !id.includes('rapid'));
if (what === 'refw') vsRef(WORKERS(), args[2] ?? 'lasius_worker', 'workers');
if (what === 'refs') vsRef(SOLDIERS(), args[2] ?? 'lasius_soldier', 'soldiers');
if (what === 'refm') vsRef(pick((r) => r === 'major'), args[2] ?? 'fire_major', 'majors');
if (what === 'workers' || what === 'all')
  roundRobin(pick((r, id) => r === 'worker' && !CASTES[id].nanitic && !['atta_minim', 'eciton_submajor'].includes(id)), 'workers');
if (what === 'soldiers' || what === 'all') roundRobin(pick((r, id) => r === 'soldier' && !id.includes('mortar') && !id.includes('rapid')), 'soldiers');
if (what === 'heavies' || what === 'all') roundRobin(pick((r) => r === 'major'), 'majors');
/**
 * The stag beetle males (docs/balance/castes.md "Stag beetle males"): against `n` of a caste for each n, over `seeds`:
 * how many fights the beetle lost (died), the ants lost and the beetle's health left (means), and the time.
 */
export function stagRow(kind: string, caste: string, ns: number[], seeds = [3, 4, 5]): Array<{ n: number; died: number; lost: number; hp: number; t: number }> {
  return ns.map((n) => {
    let died = 0;
    let lost = 0;
    let hp = 0;
    let t = 0;
    for (const seed of seeds) {
      const r = creatureFight(kind, caste, n, seed);
      if (r.dead) died++;
      lost += r.lost / seeds.length;
      hp += r.hp / seeds.length;
      t += r.t / seeds.length;
    }
    return { n, died, lost, hp, t };
  });
}
if (what === 'stags') {
  // STAG_NS=w1,w2,…;s1,s2,… (workers; soldiers) to choose the counts
  const [wn, sn] = (process.env.STAG_NS ?? '4,6,8,10,12,15,20,25,30,35,40,45,50;2,3,4,5,6,7,8,10,12,14,16').split(';').map((x) => x.split(',').map(Number));
  for (const kind of process.env.KINDS?.split(',') ?? ['stagMinor', 'stagSmall', 'stagMedium', 'stagLarge']) {
    for (const [caste, ns] of [['lasius_worker', wn], ['lasius_soldier', sn]] as const) {
      if (!ns.length || !ns[0]) continue;
      const row = stagRow(kind, caste, ns);
      console.log(`${kind.padEnd(11)} v ${caste.padEnd(15)} ` + row.map((r) => `${r.n}: ${r.died}/3 died, −${r.lost.toFixed(1)}, ${(r.hp * 100).toFixed(0)}% ${r.t.toFixed(0)}s`).join(' | '));
    }
  }
}
if (what === 'creatures' || what === 'all') {
  console.log('\n== creatures v black garden ant workers: for 5/10/20/40 workers: died? (ants lost, creature hp left)');
  for (const kind of (process.env.KINDS?.split(',') ?? ['pillbug', 'cutworm', 'groundBeetle', 'wolfSpider', 'lithobius', 'rove', 'mantis', 'antlion', 'spiderling', 'stagMinor', 'stagSmall', 'stagMedium', 'stagLarge', 'stagBeetle', 'tarantula', 'scolopendra', 'giantMantis', 'hogna'])) {
    const ns = ['stagBeetle', 'tarantula', 'scolopendra', 'giantMantis', 'hogna'].includes(kind) ? [20, 40, 80, 120] : [5, 10, 20, 40];
    const cells = ns.map((n) => {
      const r = creatureFight(kind, 'lasius_worker', n);
      return `${n}: ${r.dead ? 'DIED' : 'lives'} (−${r.lost}, ${(r.hp * 100).toFixed(0)}%)`;
    });
    console.log(kind.padEnd(14), cells.join('   '));
  }
}
