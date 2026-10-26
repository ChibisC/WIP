/**
 * Headless tests for the termite royals (model kit v2.1, claude/termite-royals/00-ROYALS-UPDATE.md):
 * sizes and the egg-lay point come from the kit; the queen fits the royal chamber with the king
 * beside her and nobody walking through her abdomen; eggs are pulled from her tip; the king's
 * ATTEND render hint; determinism. One queen per colony (the user's call, 2026-10-25).
 *   npx vite-node tests/royals.ts
 */
import { EventBus, SimEvent } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Ant, AS, Colony, nestSpace } from '../src/sim/types';
import { CASTES, casteOf } from '../src/sim/species';
import { tileAt } from '../src/sim/tiles';
import { hashState } from '../src/sim/snapshot';
import { abdomenTipBack, distToQueenBody, kingSpot } from '../src/sim/termites';
import { TERMITE_ROYALS } from '../src/sim/termiteRoyalData';
import { antToView, blankView } from '../src/game/antViews';
import { AnimState } from '../src/render/termite/rig';
import { royalData } from '../tools/termiteRoyalSource';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const t0 = Date.now();
/** events since the last call (the bus delivers them on drain) */
function events(w: World): SimEvent[] {
  const box = w as unknown as { _ev?: SimEvent[] };
  if (!box._ev) {
    box._ev = [];
    w.events.onAny((e) => box._ev!.push(e));
  }
  w.events.drain();
  const out = box._ev;
  box._ev = [];
  return out;
}

function nasuteWorld(seed = 4, ai = false): World {
  return createWorld({ seed, style: 'meadow', width: 640, depth: 640, food: 1, colonies: [{ species: 'nasutitermes', player: true, ai }, { species: 'lasius', player: false, ai: false }], settings: { creatures: 0 } }, new EventBus());
}
const inChamber = (w: World, c: Colony, x: number, y: number) => tileAt(c, w.nest(c.id)!.hexAt(x, y))?.type === 'queen' && w.walkable(nestSpace(c.id), x, y);
/** points on the queen's body outline: head and thorax narrow, the abdomen at its half-width */
function bodyPoints(q: Ant): [number, number][] {
  const R = TERMITE_ROYALS.queen;
  const pts: [number, number][] = [];
  const c = Math.cos(q.h);
  const s = Math.sin(q.h);
  for (let x = R.front; x >= -R.back; x -= 0.5) {
    const hw = x > R.abdFront ? 0.8 : R.abdHalfWidth * 0.95;
    for (const l of [-hw, 0, hw]) pts.push([q.x + c * x - s * l, q.y + s * x + c * l]);
  }
  return pts;
}

// ---------------------------------------------------------------- sizes from the model kit
check('royal data: src/sim/termiteRoyalData.ts matches the model kit (re-run tools/termite-royal-data.ts after kit changes)', JSON.stringify(royalData()) === JSON.stringify(TERMITE_ROYALS), JSON.stringify(royalData()));
check('royal sizes: queen and king lengths are the kit v2.1 models (25.4 / 8.4 mm)', CASTES.nasute_queen.length === TERMITE_ROYALS.queen.length && CASTES.nasute_king.length === TERMITE_ROYALS.king.length && TERMITE_ROYALS.queen.length > 24 && TERMITE_ROYALS.king.length > 8, `${CASTES.nasute_queen.length} / ${CASTES.nasute_king.length} mm`);
{
  const w = nasuteWorld();
  const q = w.antById.get(w.colony(0)!.queen)!;
  check('egg-lay point: behind the queen at the kit\'s Bone.EGG_LAY pivot plus the egg sliding out', Math.abs(abdomenTipBack(q) - (-TERMITE_ROYALS.queen.eggLay[0] + 0.75)) < 1e-9, `${abdomenTipBack(q).toFixed(2)} mm behind her thorax`);
}

// ---------------------------------------------------------------- the royal chamber fits the queen, the king and attendants
for (const seed of [4, 9, 13]) {
  const w = nasuteWorld(seed, seed !== 4);
  const c = w.colony(0)!;
  const q = w.antById.get(c.queen)!;
  check(`seed ${seed}: one queen per termite colony`, w.s.ants.filter((a) => a.colony === 0 && casteOf(a.caste).role === 'queen').length === 1);
  let outside = 0;
  for (const [x, y] of bodyPoints(q)) if (!inChamber(w, c, x, y)) outside++;
  check(`seed ${seed}: the queen's whole 25 mm body lies inside the royal chamber`, outside === 0, `${outside} outline points outside`);
  // a few minutes of colony life: the king settles beside her; nobody walks through her abdomen
  let inside = 0;
  let worst = 0;
  let kingIn = true;
  for (let t = 0; t < 180 * 20; t++) {
    w.step(0.05);
    events(w);
    if (t % 5 || t < 100) continue;
    for (const a of w.s.ants) {
      if (a.state === AS.Dead || a.colony !== 0 || a === q || a.space !== q.space) continue;
      const d = distToQueenBody(q, a.x, a.y);
      worst = Math.min(worst, d);
      if (d < -1) inside++;
    }
    const k = w.antById.get(c.king!)!;
    if (!inChamber(w, c, k.x, k.y)) kingIn = false;
  }
  check(`seed ${seed}: nobody walks through the queen's abdomen (a solid body: paths go round, separation pushes out)`, inside === 0, `deepest ${(-worst).toFixed(2)} mm in`);
  const k = w.antById.get(c.king!)!;
  const kp = { x: 0, y: 0, h: 0 };
  kingSpot(w, q, k.caste, kp);
  const side = distToQueenBody(q, k.x, k.y);
  check(`seed ${seed}: the king stands at his place beside her, clear of her body, close enough for his antennae, inside the chamber`, Math.hypot(k.x - kp.x, k.y - kp.y) < 1.5 && side > 1.2 && side < 4 && kingIn, `${Math.hypot(k.x - kp.x, k.y - kp.y).toFixed(2)} mm from his spot, ${side.toFixed(2)} mm from her side`);
  const v = antToView(w, k, blankView(), k.space, -1);
  check(`seed ${seed}: render: the king plays ATTEND (kit v2.1), head aimed at her abdomen`, v.tState === AnimState.ATTEND && v.aimX !== undefined && distToQueenBody(q, v.aimX, v.aimY!) < 0, `state ${v.tState}`);
}

// ---------------------------------------------------------------- eggs from her tip
{
  const w = nasuteWorld(6);
  const c = w.colony(0)!;
  const q = w.antById.get(c.queen)!;
  const tb = abdomenTipBack(q);
  const tipX = q.x - Math.cos(q.h) * tb;
  const tipY = q.y - Math.sin(q.h) * tb;
  let eggs = 0;
  let far = 0;
  let maxPull = 0;
  const seen = new Set(w.s.brood.map((b) => b.id));
  for (let t = 0; t < 240 * 20; t++) {
    w.step(0.05);
    for (const e of events(w)) if (e.t === 'egg' && e.colony === 0) eggs++;
    maxPull = Math.max(maxPull, antToView(w, q, blankView(), q.space, -1).tStateT ?? 0);
    for (const b of w.s.brood) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      if (b.colony !== 0 || b.stage !== 0 || !b.carrier) continue;
      // made at her egg point and handed straight to the puller's mandibles (a worker's head away)
      if (Math.hypot(b.x - tipX, b.y - tipY) > casteOf(w.antById.get(b.carrier)!.caste).length * 0.6) far++;
    }
  }
  check('eggs: pulled out at the queen\'s egg-lay point (her kit Bone.EGG_LAY), into the puller\'s mandibles', far === 0 && eggs > 5, `${eggs} eggs in 4 min, ${far} elsewhere`);
  check('eggs: render: the egg slides out of her tip while a worker pulls it (QUEEN stateT)', maxPull > 0.9, `max ${maxPull.toFixed(2)}`);
}

// ---------------------------------------------------------------- determinism
{
  const h = (seed: number) => {
    const w = nasuteWorld(seed, true);
    for (let t = 0; t < 60 * 20; t++) w.step(0.05);
    return hashState(w);
  };
  check('determinism: two runs of a termite AI colony give the same state hash', h(11) === h(11));
}

console.log(`\n${failed ? failed + ' FAILED' : 'all royals tests passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
