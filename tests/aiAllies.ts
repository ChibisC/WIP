/**
 * AI colonies (CHANGE_PLAN §23, user spec claude/ai/01-spec-ai-allies-chambers.md): allies start close, EotU-style
 * chambers with highways and upgrades, allies help each other unless invaded themselves, joint raids.
 *
 *   npx vite-node tests/aiAllies.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { MAPS, PLAYABLE_MAPS } from '../src/maps';
import { BALANCE } from '../src/sim/balance';
import { AS, nestSpace, SURFACE } from '../src/sim/types';
import { CASTES, SpeciesId } from '../src/sim/species';
import { hashState } from '../src/sim/snapshot';
import { allyDanger, HELP } from '../src/sim/warAI';
import { applyCommand } from '../src/sim/commands';
import { makeAnt } from '../src/sim/factory';
import { surfaceLayout } from '../src/world/surfaceLayout';
import { pickTeamSites, siteRoutes, teamGroups } from '../src/world/teamSites';
import { allyInvasion } from '../tools/allyScenes';

const t0 = Date.now();
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? '  ok ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const fighter = (cs: string) => CASTES[cs].role === 'soldier' || CASTES[cs].role === 'major';

// ---------------------------------------------------------------- 1. placement: allies close, enemies apart, fair
{
  const S = BALANCE.aiAllies.sites;
  const shapes: Array<[string, Array<number | undefined>]> = [
    ['2v2', [0, 0, 1, 1]],
    ['2v1', [0, 0, 1]],
    ['3v1', [0, 0, 0, 1]],
    ['2v2v2', [0, 0, 1, 1, 2, 2]],
    ['you + an AI ally v two AIs', [0, 0, undefined, undefined]],
  ];
  // the maps whose shape cannot keep every pair close in a 2v2v2 (docs/maps/team-sites.md): reported, not failed
  const known = new Set(['meadowPond 2v2v2', 'rainforest 2v2v2']);
  const bad: string[] = [];
  const unfair: string[] = [];
  let worstFood = 0;
  for (const id of PLAYABLE_MAPS) {
    const def = MAPS[id]!;
    const L = surfaceLayout(def);
    for (const [name, teams] of shapes) {
      const p = pickTeamSites(L, teams)!;
      if (p.violations.length && !known.has(`${id} ${name}`)) bad.push(`${id} ${name}: ${p.violations.join('; ')}`);
      // fairness: each team's mean route to food within a fifth of the map's width of the others'
      const spread = (Math.max(...p.groupFood) - Math.min(...p.groupFood)) / def.width;
      // (Rainforest's 2v2v2: the one fair pairing puts enemies next door, so one pair is far from food — reported)
      if (spread > 0.2 && !known.has(`${id} ${name}`)) unfair.push(`${id} ${name} ${(spread * 100).toFixed(0)} %`);
      else if (spread <= 0.2) worstFood = Math.max(worstFood, spread);
    }
  }
  check(`placement: on the five maps allies are within ${S.allyMaxRoute * 100} % of the width by land and enemies at least ${S.enemyMinRoute * 100} % (2v2v2 on Meadow Pond and Rainforest reported)`, !bad.length, bad.join(' | ') || 'every shape');
  check('placement: the teams are fairly placed (each team’s mean route to food within 20 % of the width of the others’; Rainforest 2v2v2 reported)', !unfair.length, unfair.join(', ') || `worst spread ${(worstFood * 100).toFixed(0)} % of the width`);
  // the same setup gives the same sites on every client (any seed: the placement does not use it), and the world uses them
  const setup = (seed: number) =>
    createWorld(
      {
        seed,
        style: 'meadow',
        width: 1600,
        depth: 1600,
        map: 'riverbank',
        food: 0.2,
        colonies: [
          { species: 'lasius', player: true, ai: false, team: 0 },
          { species: 'formica', player: false, ai: true, team: 0 },
          { species: 'atta', player: false, ai: true },
          { species: 'solenopsis', player: false, ai: true },
        ],
        settings: { creatures: 0 },
      },
      new EventBus(),
    );
  const a = setup(3).s.colonies.map((c) => c.site);
  const b = setup(11).s.colonies.map((c) => c.site);
  const want = pickTeamSites(surfaceLayout(MAPS.riverbank!), [0, 0, undefined, undefined])!.sites;
  check('placement: the same line-up gets the same sites whatever the seed, and the world uses them (you + an AI ally on Riverbank)', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(want), `${a.join(',')} / ${b.join(',')} / ${want.join(',')}`);
  // authored team sets are used where the map lists the shape
  const groups = teamGroups([0, 0, 1, 1]);
  const auth = MAPS.meadowPond!.teamSets!['2v2'];
  const p = pickTeamSites(surfaceLayout(MAPS.meadowPond!), [0, 0, 1, 1])!;
  check('placement: a map’s authored team set is used for its shape', p.source === 'authored' && groups.every((g, gi) => g.every((i, k) => p.sites[i] === auth[gi][k])), `${p.sites.join(',')} from ${p.source}`);
}
{
  // layered ground (world/layers.ts): a bank between levels blocks the land route; the ramps are the way up
  const T = MAPS.testTerrace!;
  const withRamps = siteRoutes(surfaceLayout(T)).d[1];
  const noRamps = siteRoutes(surfaceLayout({ ...T, ramps: [] })).d[1];
  const G = MAPS.gardenBelow!;
  const garden = siteRoutes(surfaceLayout(G)).d[1];
  const gardenFlat = siteRoutes(surfaceLayout({ ...G, layers: [], ramps: [] })).d[1];
  check('placement on layered ground: routes between levels go up the ramps (none without one; longer than over flat ground on Garden Below)', Number.isFinite(withRamps) && !Number.isFinite(noRamps) && Number.isFinite(garden) && garden > gardenFlat, `Test Terrace ${withRamps.toFixed(0)} mm, without its ramps ${noRamps}; Garden Below ${garden.toFixed(0)} mm (${gardenFlat.toFixed(0)} flat)`);
}

// ---------------------------------------------------------------- 2. chambers, highways, upgrades
function grow(species: SpeciesId, minutes: number, seed = 7) {
  const w = createWorld({ seed, style: 'meadow', width: 900, depth: 900, colonies: [{ species, player: true, ai: true, popLimit: 300 }], food: 1, settings: { creatures: 0 } }, new EventBus());
  const c = w.s.colonies[0];
  for (let i = 0; i < minutes * 1200; i++) w.step(0.05);
  return { w, c, g: w.nest(c.id)! };
}
for (const [species, mins] of [
  ['lasius', 45],
  ['atta', 45],
] as Array<[SpeciesId, number]>) {
  const { c, g } = grow(species, mins);
  const b = c.aiBuild!;
  const disc = (q: number, r: number) => {
    const hs = [q];
    let ring = [q];
    for (let k = 0; k < r; k++) {
      const nx: number[] = [];
      for (const h of ring) for (const n of g.neighbors(h)) if (n >= 0 && !hs.includes(n)) (hs.push(n), nx.push(n));
      ring = nx;
    }
    return hs;
  };
  const chambers = b.chambers ?? [];
  const sizes = chambers.map((ch) => disc(ch.q, ch.r ?? 1).length);
  const tileAt = new Map(c.tiles.map((t) => [t.q, t]));
  const mixed = chambers.filter((ch) =>
    disc(ch.q, ch.r ?? 1).some((h) => {
      const t = tileAt.get(h);
      return t && (t.type !== ch.type || (ch.caste !== undefined && t.caste !== ch.caste));
    }),
  ).length;
  const ents: number[] = [];
  for (let q = 0; q < g.cols * g.rows; q++) if (g.isEntrance(q)) ents.push(q);
  const stores = chambers.filter((ch) => ch.type === 'food');
  const storeDist = stores.map((ch) => Math.min(...ents.map((e) => g.hexDistance(ch.q, e))) - (ch.r ?? 1));
  check(`${species}: the nest is 7- and 19-hex chambers, each holding one tile type (one caste for brood)`, sizes.every((n) => n === 7 || n === 19) && sizes.includes(7) && sizes.includes(19) && mixed === 0, `${sizes.filter((n) => n === 7).length} × 7, ${sizes.filter((n) => n === 19).length} × 19, ${mixed} mixed`);
  check(`${species}: at most 2 food store chambers, both within ${BALANCE.aiBuild.storeNearEntrance} hexes of the entrance`, stores.length <= 2 && stores.length >= 1 && storeDist.every((d) => d <= BALANCE.aiBuild.storeNearEntrance), `${stores.length} store chambers, rims ${storeDist.join('/')} hexes away`);
  const tunnels = new Set(b.tunnels ?? []);
  const hw = c.tiles.filter((t) => t.type === 'highway');
  const roomHex = new Set<number>();
  for (const ch of chambers) for (const h of disc(ch.q, ch.r ?? 1)) roomHex.add(h);
  const queen = c.tiles.find((t) => t.type === 'queen' && g.neighbors(t.q).every((n) => tileAt.get(n)?.type === 'queen'))!;
  for (const h of disc(queen.q, 1)) roomHex.add(h);
  check(`${species}: highways on the paths to the chambers, none in a chamber, the queen's chamber or the entrance`, hw.length > 0 && hw.filter((t) => tunnels.has(t.q)).length > 0 && hw.every((t) => !roomHex.has(t.q) && !g.isEntrance(t.q)), `${hw.length} highways, ${hw.filter((t) => tunnels.has(t.q)).length} on tunnels`);
  check(`${species}: nothing built on the entrance; the queen's chamber holds only the queen's tiles`, c.tiles.every((t) => !g.isEntrance(t.q)) && disc(queen.q, 1).every((h) => tileAt.get(h)?.type === 'queen'));
  const lv = [0, 0, 0];
  for (const t of c.tiles) if (t.type !== 'queen' && t.type !== 'highway') lv[t.level - 1]++;
  const hwUp = hw.filter((t) => t.level >= 2).length;
  check(`${species}: by ${mins} min, tiles at level 2 and 3, upgraded highways, and still growing`, lv[1] > 0 && lv[2] > 0 && hwUp > 0 && c.living >= 100, `tiles by level ${lv.join('/')}, highways at 2+ ${hwUp}/${hw.length}, ${c.living} ants, food ${c.food.toFixed(0)}/${c.foodCap}`);
}

// ---------------------------------------------------------------- 3. allies help each other
const helpGroupsOut = (S: ReturnType<typeof allyInvasion>) => S.A.groups.filter((g) => g.marker === HELP).length;
const antsOf = (S: ReturnType<typeof allyInvasion>, filter: (a: (typeof S.w.s.ants)[number]) => boolean) => S.w.s.ants.filter((a) => a.colony === S.A.id && a.state !== AS.Dead && filter(a)).length;
{
  // (14 Red wood soldiers: since the 2026-11-02 caste balance 20 overrun the ally's nest before the help can finish it)
  const S = allyInvasion({ band: 14, developed: 70 });
  const { w, A, B } = S;
  let committed = -1;
  let inside = 0;
  let guard = Infinity;
  let markerChanges = 0;
  let wasHelping = false;
  let stopped = -1;
  for (let t = 0; t < 20 * 150; t++) {
    w.step(0.05);
    w.events.drain();
    const helping = (A.aiAlly?.ally ?? -1) === B.id;
    if (helping !== wasHelping) markerChanges++;
    wasHelping = helping;
    if (helping && committed < 0) committed = w.s.time;
    if (helping) {
      inside = Math.max(inside, antsOf(S, (a) => a.space === nestSpace(B.id)));
      guard = Math.min(guard, antsOf(S, (a) => fighter(a.caste) && a.space === nestSpace(A.id)));
    }
    if (committed >= 0 && !helping && stopped < 0) stopped = w.s.time;
  }
  const left = S.raidB.filter((a) => a.state !== AS.Dead).length;
  check('help: an ally invaded by a strong rival gets help within a few seconds (marker V, a share of the fighters)', committed >= 0 && committed < 40, `committed at ${committed.toFixed(0)} s`);
  check('help: the helper keeps a home guard of fighters', guard >= BALANCE.aiAllies.homeGuardMin && guard < Infinity, `at least ${guard} fighters at home while helping`);
  check("help: the helpers go down into the ally's nest", inside > 0, `${inside} inside at most`);
  check('help: the threat is cleared and the helpers go home (marker lifted, groups home)', left === 0 && stopped > 0 && !A.markers[HELP].placed && helpGroupsOut(S) === 0 && A.aiAlly?.why === 'done', `${left} invaders left, stopped at ${stopped.toFixed(0)} s (${A.aiAlly?.why})`);
  check('help: no flip-flopping (helping starts once and stops once for the threat)', markerChanges <= 2, `${markerChanges} changes`);
}
{
  const S = allyInvasion({ band: 20, developed: 70, bothInvaded: true });
  let helped = false;
  for (let t = 0; t < 20 * 60; t++) {
    S.w.step(0.05);
    S.w.events.drain();
    if ((S.A.aiAlly?.ally ?? -1) >= 0 || helpGroupsOut(S) > 0) helped = true;
  }
  check('help: a helper invaded at the same time sends nothing', !helped);
}
{
  // already helping when its own nest is invaded: the help is recalled at once
  const S = allyInvasion({ band: 20, developed: 70 });
  let t = 0;
  for (; t < 20 * 60 && (S.A.aiAlly?.ally ?? -1) < 0; t++) S.w.step(0.05);
  const q = S.w.antById.get(S.A.queen)!;
  // a band in the helper's own nest
  for (let i = 0; i < 10; i++) {
    const a = makeAnt(S.w, S.R.id, 'formica_soldier', nestSpace(S.A.id), q.x + (i % 4) * 3, q.y + 14, 0);
    a.task = 'guard';
    a.alarm = 1;
  }
  S.w.reindex();
  const was = S.A.aiAlly?.ally ?? -1;
  for (let k = 0; k < 20 * 3; k++) S.w.step(0.05);
  check('help: when the helper is invaded while helping, it recalls the help at once', was === S.B.id && (S.A.aiAlly?.ally ?? -1) < 0 && S.A.aiAlly?.why === 'home' && helpGroupsOut(S) === 0, `helping ${was} → ${S.A.aiAlly?.ally} (${S.A.aiAlly?.why})`);
}
{
  const S = allyInvasion({ band: 2, developed: 70, at: 'entrance', caste: 'formica_worker' });
  let helped = false;
  for (let t = 0; t < 20 * 40; t++) {
    S.w.step(0.05);
    if ((S.A.aiAlly?.ally ?? -1) >= 0) helped = true;
  }
  check('help: no help for an ally clearly winning on its own (two workers at its entrance)', !helped);
}
{
  // too far for a minor threat, but not when the queen is in danger
  const saved = BALANCE.aiAllies.assistMaxTravel;
  BALANCE.aiAllies.assistMaxTravel = 1;
  const far = allyInvasion({ band: 8, developed: 70, at: 'entrance' });
  let helpedFar = false;
  for (let t = 0; t < 20 * 40; t++) {
    far.w.step(0.05);
    if ((far.A.aiAlly?.ally ?? -1) >= 0) helpedFar = true;
  }
  const queen = allyInvasion({ band: 20, developed: 70 });
  let helpedQueen = false;
  for (let t = 0; t < 20 * 40; t++) {
    queen.w.step(0.05);
    if ((queen.A.aiAlly?.ally ?? -1) >= 0) helpedQueen = true;
  }
  BALANCE.aiAllies.assistMaxTravel = saved;
  check('help: an ally too far away gets no help for a threat at its entrance, but does when its queen is in danger', !helpedFar && helpedQueen);
}
{
  const S = allyInvasion({ band: 32, developed: 70, human: true });
  const msgs: string[] = [];
  S.w.events.onAny((e) => {
    if (e.t === 'message' && e.colony === S.B.id) msgs.push(e.text);
  });
  let helped = false;
  for (let t = 0; t < 20 * 60; t++) {
    S.w.step(0.05);
    S.w.events.drain();
    if ((S.A.aiAlly?.ally ?? -1) === S.B.id) helped = true;
  }
  check("help: an AI ally helps the human player's nest the same way, and says so", helped && msgs.some((m) => m.includes('coming to help')), msgs.filter((m) => m.includes('ally')).join(' | '));
}
{
  // a lost cause: a huge band in a human ally's nest, more than the helper could ever match; the human calls for help
  const S = allyInvasion({ band: 90, developed: 70, human: true });
  const msgs: string[] = [];
  S.w.events.onAny((e) => {
    if (e.t === 'message' && e.colony === S.B.id) msgs.push(e.text);
  });
  applyCommand(S.w, { type: 'callHelp', tick: S.w.s.tick, player: S.B.id, seq: 0 } as never);
  let helped = false;
  for (let t = 0; t < 20 * 30; t++) {
    S.w.step(0.05);
    S.w.events.drain();
    if ((S.A.aiAlly?.ally ?? -1) >= 0 || helpGroupsOut(S) > 0) helped = true;
  }
  const d = allyDanger(S.w, S.B);
  check("help: a lost cause gets no help (the helper keeps its fighters), and a human caller is told why", !helped && msgs.filter((m) => m.includes("can't spare")).length === 1, `danger ${d.score.toFixed(0)}, enemy ${d.enemy.toFixed(0)} v defence ${d.defence.toFixed(0)}; ${msgs.join(' | ')}`);
}
{
  // help under way when the enemy grows far beyond it: the helpers fall back instead of dying with the ally
  const S = allyInvasion({ band: 20, developed: 70 });
  let t = 0;
  for (; t < 20 * 60 && (S.A.aiAlly?.ally ?? -1) < 0; t++) S.w.step(0.05);
  const helping = S.A.aiAlly?.ally ?? -1;
  const q = S.w.antById.get(S.B.queen)!;
  for (let i = 0; i < 90; i++) {
    const a = makeAnt(S.w, S.R.id, 'formica_soldier', nestSpace(S.B.id), q.x + ((i % 6) - 2.5) * 3, q.y + 20 + Math.floor(i / 6) * 3, -Math.PI / 2);
    a.task = 'guard';
    a.alarm = 1;
  }
  S.w.reindex();
  for (let k = 0; k < 20 * 4; k++) S.w.step(0.05);
  check('help: when the attack grows far beyond what help can hold, the helpers fall back', helping === S.B.id && (S.A.aiAlly?.ally ?? -1) < 0 && S.A.aiAlly?.why === 'outmatched' && helpGroupsOut(S) === 0, `helping ${helping} → ${S.A.aiAlly?.ally} (${S.A.aiAlly?.why})`);
}
{
  // the call for help: a command, raises the danger for allies while it lasts
  const S = allyInvasion({ band: 2, developed: 70, at: 'entrance', caste: 'formica_worker', human: true });
  const before = allyDanger(S.w, S.B).score;
  const why = applyCommand(S.w, { type: 'callHelp', tick: S.w.s.tick, player: S.B.id, seq: 0 } as never);
  const after = allyDanger(S.w, S.B).score;
  check('call for help: the command raises the nest’s danger for its allies while it lasts', why === null && after > before && after >= BALANCE.aiAllies.callMin, `${before.toFixed(0)} → ${after.toFixed(0)}`);
}

// ---------------------------------------------------------------- 4. joint raids
{
  const saved = BALANCE.aiWar.firstRaid;
  BALANCE.aiWar.firstRaid = 30;
  const w = createWorld(
    {
      seed: 5,
      style: 'meadow',
      width: 1600,
      depth: 1600,
      map: 'meadowPond',
      food: 1,
      colonies: [
        { species: 'lasius', player: true, ai: true, team: 0, developed: 70, startWorkers: 14, name: 'A' },
        { species: 'lasius', player: false, ai: true, team: 0, developed: 70, startWorkers: 14, name: 'B' },
        { species: 'formica', player: false, ai: false, team: 1, developed: 4, startWorkers: 4, name: 'R' },
      ],
      settings: { creatures: 0 },
    },
    new EventBus(),
  );
  const [A, B, R] = w.s.colonies;
  const first: Record<number, number> = {};
  let joined = false;
  let gatheredBeforeLimit = false;
  for (let t = 0; t < 20 * 200; t++) {
    w.step(0.05);
    w.events.drain();
    const lead = A.aiWar?.joined === A.id ? A : B.aiWar?.joined === B.id ? B : null;
    const other = lead === A ? B : A;
    if (lead && other.aiWar?.joined === lead.id && other.aiWar.target === lead.aiWar!.target) joined = true;
    const g = lead?.aiWar?.gather;
    if (g?.go && w.s.time < g.until) gatheredBeforeLimit = true;
    for (const c of [A, B]) {
      if (first[c.id] !== undefined) continue;
      if (w.s.ants.some((a) => a.colony === c.id && a.state !== AS.Dead && (a.space === nestSpace(R.id) || (a.space === SURFACE && R.entrances.some((e) => (a.x - e.sx) * (a.x - e.sx) + (a.y - e.sy) * (a.y - e.sy) < 50 * 50))))) first[c.id] = w.s.time;
    }
  }
  BALANCE.aiWar.firstRaid = saved;
  const gap = Math.abs((first[A.id] ?? 1e9) - (first[B.id] ?? -1e9));
  check('joint raid: an AI ally joins a raid on the same target, they gather and arrive together', joined && gatheredBeforeLimit && gap <= 15, `joined ${joined}, everyone gathered ${gatheredBeforeLimit}, first arrivals ${first[A.id]?.toFixed(0)} s and ${first[B.id]?.toFixed(0)} s`);
}

// ---------------------------------------------------------------- 5. determinism
{
  const run = () => {
    const S = allyInvasion({ band: 20, developed: 70, settle: 10 });
    for (let t = 0; t < 20 * 40; t++) S.w.step(0.05);
    return hashState(S.w);
  };
  const a = run();
  const b = run();
  check('determinism: the help scene twice gives the same state', a === b, a.slice(0, 16));
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all AI-ally tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
