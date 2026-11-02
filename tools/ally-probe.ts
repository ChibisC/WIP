/**
 * The ally brain at work (CHANGE_PLAN §23): tools/allyScenes.ts allyInvasion, printed every 2 s — the invaded ally's
 * danger, the helper's decision, its marker V, how many of its ants are out helping and inside the ally's nest, how many
 * fighters stay home, the invaders left.
 *   npx vite-node tools/ally-probe.ts -- [seconds=120] [band=14] [human=0] [bothInvaded=0] [seed=5] [developed=70]
 */
import { allyInvasion } from './allyScenes';
import { allyDanger, HELP } from '../src/sim/warAI';
import { AS, nestSpace } from '../src/sim/types';
import { CASTES } from '../src/sim/species';

const args = process.argv.slice(2).filter((a) => a !== '--');
const secs = Number(args[0] ?? 120);
const S = allyInvasion({ band: Number(args[1] ?? 14), human: args[2] === '1', bothInvaded: args[3] === '1', seed: Number(args[4] ?? 5), developed: Number(args[5] ?? 70) });
const { w, A, B } = S;
const msgs: string[] = [];
w.events.onAny((e) => {
  if (e.t === 'message') msgs.push(`${w.s.time.toFixed(0)}s → colony ${e.colony}: ${e.text}`);
});
const fighter = (cs: string) => CASTES[cs].role === 'soldier' || CASTES[cs].role === 'major';
for (let t = 0; t <= secs * 20; t++) {
  if (t % 40 === 0) {
    const d = allyDanger(w, B);
    const s = A.aiAlly;
    const helpGroups = new Set(A.groups.filter((g) => g.marker === HELP).map((g) => g.id));
    const groupOf = new Map(A.tiles.map((x) => [x.q, x.group]));
    let out = 0;
    let inB = 0;
    let homeF = 0;
    for (const a of w.s.ants) {
      if (a.colony !== A.id || a.state === AS.Dead) continue;
      const g = groupOf.get(a.tile);
      if (g !== undefined && helpGroups.has(g)) {
        out++;
        if (a.space === nestSpace(B.id)) inB++;
      } else if (fighter(a.caste)) homeF++;
    }
    const left = S.raidB.filter((a) => a.state !== AS.Dead).length;
    const m = A.markers[HELP];
    console.log(`${String(Math.round(w.s.time)).padStart(4)}s danger ${d.score.toFixed(0).padStart(6)} (enemy ${d.enemy.toFixed(0)}, defence ${d.defence.toFixed(0)}${d.inside ? ', inside' : ''}${d.queen ? ', QUEEN' : ''}) helping ${s?.ally ?? -1}${s?.why ? ' (last: ' + s.why + ')' : ''} stage ${s?.stage ?? '-'} flips ${s?.flips ?? 0} marker V ${m.placed ? `space ${m.space} (${m.x.toFixed(0)}, ${m.y.toFixed(0)})` : '-'} out ${out} (in B ${inB}) home fighters ${homeF} invaders left ${left}`);
  }
  w.step(0.05);
  w.events.drain();
}
for (const m of msgs) console.log(m);
