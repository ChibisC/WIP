/**
 * The user's notes of 2026-11-01 (evening): ants collide at half the distance, swarm room by the victim's size, trails
 * that wander and carry a little traffic back to the nest, flat ground (obstacles walked round, never climbed; nest
 * walls not walked on), roomier nest tiles, heads that face straight ahead outside head animations.
 *
 *   npx vite-node tests/notes1101.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Ant, AS, SURFACE } from '../src/sim/types';
import { makeAnt } from '../src/sim/factory';
import { assignGroup, placeMarker } from '../src/sim/markers';
import { BALANCE, TRAIL } from '../src/sim/balance';
import { casteOf } from '../src/sim/species';
import { antSlotCount } from '../src/sim/slots';
import { Terrain, mapTerrainParams, defaultTerrainParams } from '../src/world/terrain';
import { PLAYABLE_MAPS } from '../src/maps';
import { hexRadiusFor } from '../src/world/nestGrid';
import { twigLine } from '../src/world/mapScatter';
import { HF_ENTRANCE, HF_SITE } from '../src/world/surfaceLayout';
import { antToView, blankView } from '../src/game/antViews';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const t0 = Date.now();

// ---- swarm room (slots.ts antSlotCount)
{
  const n = (v: string, a: string) => antSlotCount({ caste: v } as Ant, casteOf(a).length, false);
  check('swarm: 6 of its own size round a minim, no more', n('atta_minim', 'atta_minim') === 6 && n('atta_minim', 'fire_minor') <= 6, `${n('atta_minim', 'atta_minim')}, ${n('atta_minim', 'fire_minor')} fire minors`);
  check('swarm: 7 round a 4 mm worker, more round bigger ones', n('lasius_worker', 'lasius_worker') === 7 && n('atta_media', 'atta_media') > 7 && n('atta_major', 'atta_major') > n('atta_media', 'atta_media'), `${n('lasius_worker', 'lasius_worker')}, ${n('atta_media', 'atta_media')}, ${n('atta_major', 'atta_major')}`);
  check('swarm: ants collide with each other at half the distance', BALANCE.separation.antContact === 0.5);
}

// ---- trails: weave and traffic
function trailWorld(n: number, seed = 5): { w: World; mx: number; my: number; ex: number; ey: number } {
  const w = createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } } as never, new EventBus());
  w.s.creatures.length = 0;
  const c = w.colony(0)!;
  const e = c.entrances[0];
  let mx = e.sx + 150;
  let my = e.sy;
  for (let k = 0; k < 24; k++) {
    const ang = (k / 24) * Math.PI * 2;
    const x = e.sx + Math.cos(ang) * 150;
    const y = e.sy + Math.sin(ang) * 150;
    if (x > 90 && y > 90 && x < 610 && y < 610 && w.walkable(SURFACE, x, y)) {
      mx = x;
      my = y;
      break;
    }
  }
  const chamber = c.tiles.find((t) => t.type === 'queen')!;
  for (let i = 0; i < n; i++) {
    const a = makeAnt(w, 0, 'lasius_soldier', SURFACE, e.sx + Math.cos(i * 2.4) * (6 + i * 0.4), e.sy + Math.sin(i * 2.4) * (6 + i * 0.4), 0);
    a.tile = chamber.q;
    a.task = 'marker';
    a.marker = 0;
  }
  placeMarker(w, c, 0, SURFACE, mx, my);
  // fighters that hold the marker (no gathering): the guard crowd
  (c.markers[0] as unknown as Record<string, boolean>).noGather = true;
  assignGroup(w, c, chamber.group, 0);
  w.reindex();
  return { w, mx, my, ex: e.sx, ey: e.sy };
}
{
  const turning = (weave: number) => {
    (TRAIL as unknown as { weave: number }).weave = weave;
    const { w } = trailWorld(16);
    // open ground (no pebbles to skirt): only the weave turns them
    w.terrain.blocked.fill(0);
    w.terrain.version++;
    const prev = new Map<number, number>();
    let turn = 0;
    let dist = 0;
    for (let t = 0; t < 20 * 20; t++) {
      w.step(0.05);
      w.events.drain();
      for (const a of w.s.ants) {
        if (a.colony !== 0 || a.space !== SURFACE || a.caste !== 'lasius_soldier' || a.state === AS.Rally || a.v <= 0) continue;
        const p = prev.get(a.id);
        if (p !== undefined) {
          let d = a.h - p;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          turn += Math.abs(d);
          dist += a.v * 0.05;
        }
        prev.set(a.id, a.h);
      }
    }
    (TRAIL as unknown as { weave: number }).weave = 1;
    return turn / Math.max(1, dist);
  };
  const on = turning(1);
  const off = turning(0);
  check('trails: ants wander along the way instead of walking a ruled line', on > off * 1.25, `${on.toFixed(3)} rad turned per mm walked (${off.toFixed(3)} without the weave)`);
}
{
  const { w } = trailWorld(20);
  const mine = () => w.s.ants.filter((a) => a.colony === 0 && a.caste === 'lasius_soldier' && a.state !== AS.Dead);
  const cap = Math.min(Math.floor(20 * TRAIL.trafficMaxShare), Math.floor(TRAIL.trafficMin + TRAIL.trafficPer * 20));
  let most = 0;
  let trips = 0;
  let standing = 0;
  let samples = 0;
  const was = new Map<number, number>();
  for (let t = 0; t < 20 * 180; t++) {
    w.step(0.05);
    w.events.drain();
    if (t < 20 * 30) continue;
    const m = mine();
    const busy = m.filter((a) => (a.trf ?? 0) !== 0).length;
    most = Math.max(most, busy);
    for (const a of m) {
      if ((was.get(a.id) ?? 0) === 0 && a.trf === 1) trips++;
      was.set(a.id, a.trf ?? 0);
    }
    if (t % 20 === 0) {
      standing += m.filter((a) => a.state === AS.Rally).length / m.length;
      samples++;
    }
  }
  check('trails: now and then a few walk back to the nest and out again (2–3 of 20, never more than the cap)', trips >= 3 && most >= 1 && most <= cap, `${trips} trips in 2.5 min, at most ${most} at once (cap ${cap})`);
  check('trails: the group stays at its marker, ready to fight', standing / samples >= 0.75, `${((standing / samples) * 100).toFixed(0)} % standing on average`);
}

// ---- flat ground: obstacles block, never climbed
{
  const t = new Terrain(defaultTerrainParams(7, 'meadow', 700, 700));
  const solid = t.props.filter((p) => p.kind === 'pebble' || p.kind === 'rock' || p.kind === 'acorn' || p.kind === 'twig' || p.kind === 'log' || p.kind === 'mushroom');
  const open = solid.filter((p) => !t.isBlocked(p.x, p.y));
  check('flat ground (generated map): every rock, pebble, acorn, twig, log and mushroom blocks (ants walk round)', solid.length > 100 && open.length === 0, `${solid.length} obstacles, ${open.length} walkable`);
  // (the overlay is sampled bilinearly: a leaf lifts the ground up to a cell beyond its edge)
  const raised = solid.filter((p) => t.walkHeight(p.x, p.y) - t.heightAt(p.x, p.y) > 1e-6 && !t.props.some((q) => q.kind === 'leaf' && Math.hypot(q.x - p.x, q.y - p.y) < q.scale * 0.45 + t.res * 1.5));
  check('flat ground: nothing lifts the walking height but a flat fallen leaf', raised.length === 0, `${raised.length} raised`);
}
for (const id of PLAYABLE_MAPS) {
  const t = new Terrain(mapTerrainParams(5, id));
  const t2 = new Terrain(mapTerrainParams(9, id));
  const obs = t.mapObs;
  // (a twig's own point is where it was dropped; it bends off it, so test its middle)
  const open = obs.filter((o) => {
    const [x, y] = o.kind === 'twig' ? twigLine(o, 2)[1] : [o.x, o.y];
    return !t.isBlocked(x, y);
  });
  const same = JSON.stringify(obs) === JSON.stringify(t2.mapObs);
  const L = t.layout!;
  const onSite = obs.filter((o) => (L.flagsAt(o.x, o.y) & (HF_SITE | HF_ENTRANCE)) !== 0);
  check(`flat ground (${id}): its pebbles, twigs and fungi block, placed the same every game, none on a site or entrance`, obs.length > 20 && open.length === 0 && same && onSite.length === 0, `${obs.length} obstacles (${obs.filter((o) => o.kind === 'pebble').length} pebbles, ${obs.filter((o) => o.kind === 'twig').length} twigs), ${open.length} walkable, ${onSite.length} on a site`);
}

// ---- nest tiles
check('nest tiles 1.25 × larger (a 4 mm worker: 7.5 mm hexes, was 6)', hexRadiusFor(4) === 7.5 && hexRadiusFor(20) === 13.75 && hexRadiusFor(1) === 6.25);

// ---- heads face straight ahead outside head animations
{
  const { w } = trailWorld(2);
  const a = w.s.ants.find((x) => x.caste === 'lasius_soldier')!;
  a.look = 0.9;
  a.pause = 0;
  const v = blankView();
  antToView(w, a, v, 0, 0);
  const walking = v.headYaw;
  a.pause = 0.5;
  antToView(w, a, v, 0, 0);
  check('heads: straight ahead once a meeting is over (the old head bug: still turned to the nestmate)', walking === 0 && Math.abs(v.headYaw - 0.54) < 1e-9, `walking ${walking}, while antennating ${v.headYaw.toFixed(2)}`);
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all 2026-11-01 note tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
