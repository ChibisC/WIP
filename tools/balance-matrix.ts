/**
 * Balance matrix (user 2026-11-02: "balance all current ant and termite species soldiers and workers and other castes
 * (workers should be similar in strength and stats but not the same like eotu) and buff creatures"):
 *  - equal-food fights: every species' worker against every other (and soldiers, majors), the same food's worth on
 *    each side (build + hatch), on open ground, two seeds; prints a win table and each caste's score;
 *  - creatures against black garden ant workers: how many workers a creature beats and how many it kills.
 *   npx vite-node tools/balance-matrix.ts -- [workers|soldiers|heavies|creatures|all] [food=150]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { AS, SURFACE } from '../src/sim/types';
import { CASTES, SPECIES } from '../src/sim/species';
import { makeAnt } from '../src/sim/factory';
import { placeMarker } from '../src/sim/markers';
import { casteCosts } from '../src/sim/tiles';
import { spawnCreature } from '../src/sim/creatures/creatureAI';

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

/** A creature against n workers of a caste; returns whether it died, ants lost, time. */
export function creatureFight(kind: string, caste: string, n: number, seed = 3, secs = 150): { dead: boolean; lost: number; hp: number; t: number } {
  const ev = new EventBus();
  const w = createWorld({ seed, style: 'formicarium', width: 600, depth: 600, colonies: [{ species: CASTES[caste].species, player: true, ai: false }], food: 0, aphids: 0, plants: 0, puddles: 0, settings: { creatures: 0 } }, ev);
  w.s.settings.foodRespawn = 0;
  w.terrain.clearArea(150, 150, 450, 450);
  const cr = spawnCreature(w, kind, SURFACE, 300, 300);
  const c = w.colony(0)!;
  placeMarker(w, c, 0, SURFACE, 300, 300);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const a = makeAnt(w, 0, caste, SURFACE, 300 + Math.cos(ang) * 45, 300 + Math.sin(ang) * 45, ang + Math.PI);
    a.task = 'marker';
    a.marker = 0;
    ids.push(a.id);
  }
  w.reindex();
  let t = 0;
  for (; t <= secs * 20; t++) {
    w.step(0.05);
    ev.drain();
    for (const id of ids) {
      const x = w.antById.get(id);
      if (x && x.state !== AS.Dead) {
        x.task = 'marker';
        x.marker = 0;
        const p = w.creatureById.get(cr.id);
        if (p && !p.dead && t % 20 === 0) placeMarker(w, c, 0, SURFACE, p.x, p.y);
      }
    }
    const p = w.creatureById.get(cr.id);
    const left = ids.filter((id) => w.antById.get(id)?.state !== AS.Dead && w.antById.get(id)).length;
    if (!p || p.dead || !left) break;
  }
  const p = w.creatureById.get(cr.id);
  const lost = ids.filter((id) => !w.antById.get(id) || w.antById.get(id)!.state === AS.Dead).length;
  return { dead: !p || p.dead, lost, hp: p ? Math.max(0, p.hp) / p.maxHp : 0, t: t / 20 };
}

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
if (what === 'creatures' || what === 'all') {
  console.log('\n== creatures v black garden ant workers: for 5/10/20/40 workers: died? (ants lost, creature hp left)');
  for (const kind of (process.env.KINDS?.split(',') ?? ['pillbug', 'cutworm', 'groundBeetle', 'wolfSpider', 'lithobius', 'rove', 'mantis', 'antlion', 'spiderling', 'stagBeetle', 'tarantula', 'scolopendra', 'giantMantis', 'hogna'])) {
    const ns = ['stagBeetle', 'tarantula', 'scolopendra', 'giantMantis', 'hogna'].includes(kind) ? [20, 40, 80, 120] : [5, 10, 20, 40];
    const cells = ns.map((n) => {
      const r = creatureFight(kind, 'lasius_worker', n);
      return `${n}: ${r.dead ? 'DIED' : 'lives'} (−${r.lost}, ${(r.hp * 100).toFixed(0)}%)`;
    });
    console.log(kind.padEnd(14), cells.join('   '));
  }
}
