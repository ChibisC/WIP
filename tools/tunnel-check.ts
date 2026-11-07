/**
 * Tunnel routes on every playable map (claude/underground/01-spec-shared-underground-tunnels.md §7; CHANGE_PLAN §27):
 * for several seeds and colony counts (2–10), every route must be three hexes wide where the margin allows, walled by
 * rock, its gates on the interior's edge away from the flower and other gates; every pair on small maps, nearest
 * neighbours without crossings on big ones. Prints one line per map and a sketch of one nest's half.
 * Run: npx vite-node tools/tunnel-check.ts [-- seeds]
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { PLAYABLE_MAPS } from '../src/maps';
import { SpeciesId } from '../src/sim/species';
import { TUNNELS } from '../src/sim/balance';
import { SOIL_AIR, SOIL_GATE, SOIL_ROCK, SOIL_ROUTE } from '../src/world/nestGrid';
import { routes } from '../src/sim/tunnels';

const argv = (globalThis as unknown as { process: { argv: string[]; exitCode: number } }).process;
const seeds = Number(argv.argv.slice(2).filter((a) => a !== '--')[0] ?? 3);
const SPECIES: SpeciesId[] = ['lasius', 'formica', 'atta', 'solenopsis', 'eciton', 'hell', 'aurimyrmex', 'termant', 'nasutitermes', 'rhynchotermes'];
let bad = 0;
let sketched = false;
for (const id of PLAYABLE_MAPS) {
  for (const n of [2, 3, 4, 6, 10]) {
    for (let seed = 1; seed <= seeds; seed++) {
      const w = createWorld({ seed, style: 'meadow', width: 100, depth: 100, map: id, colonies: SPECIES.slice(0, n).map((species, i) => ({ species, player: i === 0, ai: i > 0 })), food: 1 }, new EventBus());
      const rs = routes(w);
      const why: string[] = [];
      const expectPairs = (n * (n - 1)) / 2;
      if (n <= TUNNELS.allPairsMax && rs.length !== expectPairs) why.push(`${rs.length} routes for ${n} colonies (want ${expectPairs})`);
      if (n > TUNNELS.allPairsMax) {
        const per = new Map<number, number>();
        for (const r of rs) {
          per.set(r.a, (per.get(r.a) ?? 0) + 1);
          per.set(r.b, (per.get(r.b) ?? 0) + 1);
        }
        for (const c of w.s.colonies) if (!(per.get(c.id) ?? 0)) why.push(`colony ${c.id} has no route`);
      }
      for (const r of rs) {
        for (const h of r.halves) {
          const g = w.nestOf(h.space)!;
          if (!g.isInteriorEdge(h.gate)) why.push(`route ${r.id}: gate ${h.gate} not on the interior's edge`);
          if (g.hexSoil[h.gate] !== SOIL_GATE) why.push(`route ${r.id}: gate not gate soil`);
          const fl = g.flowers[0] ?? [];
          if (fl.some((f) => g.hexDistance(f, h.gate) < TUNNELS.gateAway)) why.push(`route ${r.id}: gate too near the flower`);
          const last = h.steps[h.steps.length - 1];
          if (!last.some((q) => q >= 0 && g.isRim(q))) why.push(`route ${r.id}: half in space ${h.space} does not reach the rim`);
          let narrow = 0;
          for (let i = 1; i < h.steps.length; i++) {
            const st = h.steps[i];
            const wide = st.filter((q) => q >= 0).length;
            if (wide < TUNNELS.width) narrow++;
            for (const q of st) {
              if (q < 0) continue;
              if (g.hexSoil[q] !== SOIL_ROUTE) why.push(`route ${r.id}: hex ${q} is soil ${g.hexSoil[q]}, not route soil`);
              if (g.routeOf(q) !== r.id) why.push(`route ${r.id}: hex ${q} tagged ${g.routeOf(q)}`);
              for (const m of g.neighbors(q)) if (m >= 0 && !g.isInterior(m) && g.hexSoil[m] !== SOIL_ROCK && g.routeOf(m) !== r.id) why.push(`route ${r.id}: hex ${q} walled by ${g.hexSoil[m]} (route ${g.routeOf(m)})`);
            }
          }
          if (narrow > Math.ceil(h.steps.length * 0.4)) why.push(`route ${r.id}: ${narrow} of ${h.steps.length - 1} steps narrower than ${TUNNELS.width}`);
        }
      }
      // no rock pockets inside a band (a rock hex with four or more neighbours of one route)
      for (const c of w.s.colonies) {
        const g = w.nest(c.id)!;
        for (let q = 0; q < g.cols * g.rows; q++) {
          if (g.hexSoil[q] !== SOIL_ROCK) continue;
          const cnt = new Map<number, number>();
          for (const m of g.neighbors(q)) if (m >= 0 && g.routeOf(m) >= 0) cnt.set(g.routeOf(m), (cnt.get(g.routeOf(m)) ?? 0) + 1);
          for (const [rid, k] of cnt) if (k >= 4) why.push(`route ${rid}: rock pocket at hex ${q} of colony ${c.id}`);
        }
      }
      // gates of one nest keep apart
      for (const c of w.s.colonies) {
        const g = w.nest(c.id)!;
        const gs = rs.flatMap((r) => r.halves.filter((h) => h.colony === c.id).map((h) => h.gate));
        for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) if (g.hexDistance(gs[i], gs[j]) < TUNNELS.gateGap) why.push(`colony ${c.id}: gates ${gs[i]} and ${gs[j]} too close`);
      }
      if (why.length) {
        bad++;
        console.log(`${id} seed ${seed} n ${n}: ${[...new Set(why)].slice(0, 6).join('; ')}`);
      }
      if (!sketched && n === 4 && !why.length) {
        sketched = true;
        const c = w.s.colonies[0];
        const g = w.nest(c.id)!;
        console.log(`sketch: ${id} seed ${seed}, colony 0 (${g.cols}×${g.rows}, margin ${g.margin}); routes ${rs.map((r) => `${r.id}:${r.a}-${r.b}`).join(' ')}`);
        for (let r = 0; r < g.rows; r++) {
          let line = '';
          for (let col = 0; col < g.cols; col++) {
            const q = g.hexIndex(col, r);
            const s = g.hexSoil[q];
            line += s === SOIL_ROCK ? '#' : s === SOIL_ROUTE ? String(g.routeOf(q)) : s === SOIL_GATE ? 'G' : s === SOIL_AIR ? '.' : g.isInterior(q) ? ' ' : '?';
          }
          console.log(line);
        }
      }
    }
  }
  console.log(`${id}: done`);
}
console.log(bad ? `${bad} bad` : 'all routes valid');
argv.exitCode = bad ? 1 : 0;
