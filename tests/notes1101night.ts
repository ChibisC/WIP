/**
 * The user's notes of 2026-11-01 (21:36, 21:48): health bars and level chevrons over every unit, no outline through a
 * unit for the ants under it, riders on the stag beetle sitting on its shell at joints and edges, carried food drawn in
 * the jaws, dropped food picked up again.
 *
 *   npx vite-node tests/notes1101night.ts
 */
import * as THREE from 'three';
import { existsSync } from 'node:fs';
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { AS, Carry, SURFACE } from '../src/sim/types';
import { makeAnt, makeFood } from '../src/sim/factory';
import { placeMarker, assignGroup } from '../src/sim/markers';
import { dropCarried } from '../src/sim/colony';
import { CLIMB_DATA } from '../src/sim/creatures/climbData';
import { HealthBars } from '../src/render/game/healthBars';
import { partGeometry } from '../src/render/creatures/primitives';
import { STAG_REF, registerStagParts } from '../src/render/creatures/stagBeetle';
import { spawnCreature } from '../src/sim/creatures/creatureAI';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const t0 = Date.now();

function world(seed = 5): World {
  const w = createWorld({ seed, style: 'meadow', width: 700, depth: 700, food: 0, colonies: [{ species: 'lasius', player: true, ai: false }, { species: 'formica', player: false, ai: false }], settings: { creatures: 0 } } as never, new EventBus());
  w.s.creatures.length = 0;
  w.s.food.length = 0;
  w.terrain.blocked.fill(0);
  w.terrain.version++;
  w.reindex();
  return w;
}

// ---- health bars and level chevrons (render)
{
  const w = world();
  const c = w.colony(0)!;
  const e = c.entrances[0];
  const hurt = makeAnt(w, 0, 'lasius_soldier', SURFACE, e.sx + 40, e.sy, 0);
  hurt.hp = hurt.maxHp * 0.5;
  hurt.level = 3;
  const whole = makeAnt(w, 0, 'lasius_worker', SURFACE, e.sx + 50, e.sy, 0);
  const foe = makeAnt(w, 1, 'formica_worker', SURFACE, e.sx + 60, e.sy, 0);
  foe.hp = foe.maxHp * 0.2;
  foe.level = 2;
  const cr = spawnCreature(w, 'groundBeetle', SURFACE, e.sx + 80, e.sy)!;
  cr.hp = cr.maxHp * 0.7;
  w.reindex();
  const bars = new HealthBars();
  const cam = new THREE.PerspectiveCamera(45, 1.5, 1, 5000);
  cam.position.set(e.sx + 50, 120, e.sy + 60);
  cam.lookAt(e.sx + 50, 0, e.sy);
  cam.updateMatrixWorld();
  const pos = (x: number, y: number, l: number, o: THREE.Vector3) => o.set(x, l, y);
  bars.update(w, SURFACE, 1, cam, 640, pos, c, null);
  const meshes = bars.group.children as THREE.InstancedMesh[];
  const counts = meshes.map((m) => m.count);
  check('health bars: over every hurt unit — ant, foe, creature — none over a unit at full health', counts[0] === 3 && counts[1] === 3, `${counts[0]} bars (3 hurt units, 1 whole)`);
  check('level marks: one chevron for level II, two for level III, none for level I', counts[2] === 3 && counts[3] === 3, `${counts[2]} chevrons`);
  bars.update(w, SURFACE, 1, cam, 640, pos, c, { kind: 'ant', id: whole.id });
  check('health bars: … and over the unit being inspected', (bars.group.children[0] as THREE.InstancedMesh).count === 4);
}

// ---- the outline drawn through a unit for the ants under it is gone
check('no outline through a unit for the ants under it', !existsSync(new URL('../src/render/game/underOutline.ts', import.meta.url)));

// ---- riders on the stag beetle: on its shell, at joints and edges
{
  registerStagParts();
  const mesh = (n: string) => {
    const m = new THREE.Mesh(partGeometry(n), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.updateMatrixWorld();
    return m;
  };
  const body = ['stag_elytra', 'stag_pronotum', 'stag_under'].map(mesh);
  const head = [mesh('stag_head4')];
  const rc = new THREE.Raycaster();
  const d = CLIMB_DATA.stagBeetle;
  let off = 0;
  let air = 0;
  let mirrored = 0;
  for (const s of d.slots) {
    rc.set(new THREE.Vector3(s.x * STAG_REF, 100, s.z * STAG_REF), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObjects(s.frame === 'head' ? head : body, false)[0];
    if (!hit) air++;
    else off = Math.max(off, Math.abs(hit.point.y / STAG_REF - s.y));
    if (d.slots.some((o) => o !== s && Math.abs(o.x - s.x) < 1e-4 && Math.abs(o.z + s.z) < 1e-4)) mirrored++;
  }
  // (a 100 mm beetle: 0.001 of its length is 0.1 mm)
  check('stag beetle riders: every slot on the shell (none floating over it or hanging beside it)', air === 0 && off < 0.001, `${air} over nothing, at most ${(off * 100).toFixed(2)} mm off the surface`);
  check('stag beetle riders: in pairs, left and right', mirrored === d.slots.length && d.slots.length === 12, `${mirrored} of ${d.slots.length} mirrored`);
  check('stag beetle riders: head riders on the head (they ride its pitch), each facing a joint or an edge', d.slots.filter((s) => s.frame === 'head').length === 2 && d.slots.every((s) => d.weak[s.w]) && d.weak.some((wk) => wk.name === 'neck') && d.weak.some((wk) => wk.name.includes('margin')));
}

// ---- dropped food is picked up again
{
  const w = world();
  const c = w.colony(0)!;
  const e = c.entrances[0];
  const chamber = c.tiles.find((t) => t.type === 'queen')!;
  // a forager of a marker 150 mm out, walking there; it drops its load (a fight, an order) on the way
  const a = makeAnt(w, 0, 'lasius_worker', SURFACE, e.sx + 30, e.sy, 0);
  a.tile = chamber.q;
  placeMarker(w, c, 0, SURFACE, e.sx + 180, e.sy);
  assignGroup(w, c, chamber.group, 0);
  const load = makeFood(w, 'crumb', SURFACE, a.x, a.y, 1, 'fly');
  load.heldBy = a.id;
  a.carry = Carry.Food;
  a.carryId = load.id;
  dropCarried(w, a);
  a.state = AS.Idle;
  w.reindex();
  let picked = -1;
  for (let t = 0; t < 20 * 15 && picked < 0; t++) {
    w.step(0.05);
    w.events.drain();
    const f = w.foodById.get(load.id);
    if (!f || f.heldBy) picked = t / 20;
  }
  check('dropped food: picked up again by a forager passing by, off its marker\'s area too', picked >= 0 && picked < 5, picked >= 0 ? `after ${picked.toFixed(1)} s` : 'still lying there after 15 s');
  // dropped on a pebble: at the ant's feet instead
  const w2 = world();
  const T = w2.terrain;
  // (the ant on a cell's centre, the cell 1.5 mm ahead of it a pebble)
  const bx = Math.round((e.sx + 30) / T.res) * T.res;
  const by = Math.round(e.sy / T.res) * T.res;
  const b = makeAnt(w2, 0, 'lasius_worker', SURFACE, bx, by, 0);
  const f2 = makeFood(w2, 'crumb', SURFACE, b.x, b.y, 1, 'fly');
  f2.heldBy = b.id;
  b.carry = Carry.Food;
  b.carryId = f2.id;
  T.blocked[Math.round(by / T.res) * T.nx + Math.round((bx + 1.5) / T.res)] = 1;
  dropCarried(w2, b);
  check('dropped food: never onto a pebble or a twig (out of reach)', !T.isBlocked(bx + 1.5, by) || (w2.walkable(SURFACE, f2.x, f2.y) && f2.loose === 1 && f2.x === b.x), `res ${T.res} mm, dropped ${(f2.x - b.x).toFixed(1)} mm ahead`);
}

console.log(failed ? `${failed} FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s` : `all 2026-11-01 night note tests passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
