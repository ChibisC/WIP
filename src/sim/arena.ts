import type { World } from './world';
import { AS, Colony, SURFACE } from './types';
import { ARENA, BALANCE } from './balance';
import { CASTES, canonCaste } from './species';
import { CREATURES } from './creatures/kinds';
import { spawnCreature } from './creatures/creatureAI';
import { makeAnt } from './factory';
import { applyLevel } from './tiles';
import { assignGroup, placeMarker } from './markers';
import { datan2, dcos, dhypot, dsin, sq } from './dmath';
import { ArenaState, ArenaTeam, STANCE, arenaOf } from './arenaState';

/**
 * Battle arena (DESIGN 3.13; after Empires of the Undergrowth's arcade Battle Arena, made for 2–4 teams): any ants
 * and creatures, in up to four teams, fight on an open surface. There is no economy: no food, eggs, building or
 * colony loss. Each team is a colony (its ants belong to it; its creatures carry it as their faction) with a nest
 * the engine needs and nobody uses. Teams charge the nearest enemy, hold their ground, or stand passive (a dummy to
 * test climbing on). Everything a player does here is a command, so the arena is deterministic and replays work.
 */

export const TEAM_NAMES = ['Red', 'Blue', 'Green', 'Gold'];

/** Spawn point and nest point of each team on an arena of `size` mm: two face each other, three in a triangle, four in the corners. */
export function arenaLayout(size: number, n: number): Array<{ x: number; y: number; nx: number; ny: number; h: number }> {
  const c = size / 2;
  const angles = n === 2 ? [Math.PI, 0] : n === 3 ? [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6] : [(5 * Math.PI) / 4, (7 * Math.PI) / 4, Math.PI / 4, (3 * Math.PI) / 4];
  return angles.map((a) => ({
    x: c + dcos(a) * size * ARENA.spawnRadius,
    y: c + dsin(a) * size * ARENA.spawnRadius,
    nx: c + dcos(a) * size * ARENA.nestRadius,
    ny: c + dsin(a) * size * ARENA.nestRadius,
    h: a + Math.PI,
  }));
}

/** Set the arena up on a fresh world whose colonies are the teams (mapGen.createWorld with `setup.arena`). */
export function setupArena(w: World): void {
  const n = w.s.colonies.length;
  const size = Math.min(w.terrain.width, w.terrain.depth);
  const L = arenaLayout(size, n);
  const A: ArenaState = { teams: [], cx: w.terrain.width / 2, cy: w.terrain.depth / 2, t: 0, winner: -1, fought: 0 };
  w.s.colonies.forEach((c, i) => {
    const p = L[i];
    A.teams.push({ colony: c.id, stance: STANCE.CHARGE, x: p.x, y: p.y, tx: p.x, ty: p.y, has: 0, spawned: 0, lost: 0, alive: 0, hp: 0 });
    c.ai = false;
    c.aggressive = true;
    c.food = 0;

    // the team's ants are bound to the royal chamber's group, which follows marker I (moved by arenaSystem)
    placeMarker(w, c, 0, SURFACE, p.x, p.y);
    const chamber = c.tiles.find((t) => t.type === 'queen');
    if (chamber) assignGroup(w, c, chamber.group, 0);
  });
  // the nanitics each colony starts with would follow marker I out: the arena starts empty (gone at once, so the
  // unit count and cap are right before the first tick)
  const royal = new Set<number>();
  for (const c of w.s.colonies) {
    royal.add(c.queen);
    if (c.king) royal.add(c.king);
    for (const t of c.tiles) t.ant = t.ant2 = 0;
  }
  for (const a of w.s.ants) if (!royal.has(a.id)) w.antById.delete(a.id);
  w.s.ants = w.s.ants.filter((a) => royal.has(a.id));
  w.reindex();
  w.s.mode.arena = A;
}

/** Can this unit fight in the arena? `ant:<caste>` (no queens, kings or nanitics) or `cr:<kind>` (not the antlion). */
export function arenaUnitOk(unit: string): boolean {
  if (unit.startsWith('cr:')) {
    const k = unit.slice(3);
    return !!CREATURES[k] && !ARENA.noCreatures.includes(k);
  }
  if (!unit.startsWith('ant:')) return false;
  const cd = CASTES[canonCaste(unit.slice(4))];
  return !!cd && cd.role !== 'queen' && cd.role !== 'king' && cd.termite !== 'king' && cd.termite !== 'queen' && !cd.nanitic;
}

/** Live arena units now (ants on the surface or anywhere but a queen, and team creatures). */
export function arenaUnits(w: World): number {
  const A = arenaOf(w);
  if (!A) return 0;
  let n = 0;
  for (const a of w.s.ants) if (a.state !== AS.Dead && teamIndex(A, a.colony) >= 0 && !isQueen(w, a.colony, a.id)) n++;
  for (const cr of w.s.creatures) if (!cr.dead && teamIndex(A, cr.faction) >= 0) n++;
  return n;
}

function teamIndex(A: ArenaState, colony: number): number {
  for (let i = 0; i < A.teams.length; i++) if (A.teams[i].colony === colony) return i;
  return -1;
}

function isQueen(w: World, colony: number, id: number): boolean {
  const c = w.colony(colony);
  return !!c && (c.queen === id || c.king === id);
}

/**
 * Spawn `n` units of one kind for a team, in a spiral round its spawn point (or round `at`, the place tool),
 * facing the arena centre. Returns why it could not, else null.
 */
export function arenaSpawn(w: World, team: number, unit: string, n: number, level: number, at: { x: number; y: number } | null): string | null {
  const A = arenaOf(w);
  if (!A) return 'arena only';
  const T = A.teams[team];
  if (!T) return 'no such team';
  if (!arenaUnitOk(unit)) return 'that unit cannot fight in the arena';
  n = Math.max(1, Math.min(ARENA.maxPerSpawn, Math.floor(n) || 1));
  const room = ARENA.maxUnits - arenaUnits(w);
  if (room <= 0) return `The arena is full (${ARENA.maxUnits} units).`;
  n = Math.min(n, room);
  const L = Math.max(1, Math.min(3, Math.floor(level) || 1));
  const ox = at ? at.x : T.x;
  const oy = at ? at.y : T.y;
  const h = datan2(A.cy - oy, A.cx - ox);
  const cr = unit.startsWith('cr:');
  const len = cr ? CREATURES[unit.slice(3)].length : CASTES[canonCaste(unit.slice(4))].length;
  const gap = len * ARENA.spacing + (cr ? 4 : 1.5);
  const c = w.colony(T.colony)!;
  const chamber = c.tiles.find((t) => t.type === 'queen');
  let made = 0;
  // a sunflower spiral, skipping water, walls and the map edge
  for (let i = 0; made < n && i < n * 4; i++) {
    const r = i === 0 ? 0 : gap * Math.sqrt(i) * 0.95;
    const a = i * 2.39996;
    const x = ox + dcos(a) * r;
    const y = oy + dsin(a) * r;
    if (!w.terrain.inBounds(x, y, 8) || !w.walkable(SURFACE, x, y)) continue;
    if (cr) {
      const k = CREATURES[unit.slice(3)];
      const o = spawnCreature(w, k.id, SURFACE, x, y);
      o.faction = T.colony;
      o.h = o.ph = h;
      o.homeX = x;
      o.homeY = y;
      o.maxHp *= BALANCE.levelHp[L - 1];
      o.hp = o.maxHp;
      o.data.power = BALANCE.levelDamage[L - 1];
      o.data.level = L;
    } else {
      const a2 = makeAnt(w, T.colony, canonCaste(unit.slice(4)), SURFACE, x, y, h);
      applyLevel(a2, L);
      a2.age = 1;
      if (chamber) a2.tile = chamber.q;
      a2.task = 'marker';
      a2.marker = 0;
    }
    made++;
  }
  if (!made) return 'No room there.';
  T.spawned += made;
  w.reindex();
  return null;
}

/** Set what a team's units do. */
export function arenaStance(w: World, team: number, stance: number): string | null {
  const A = arenaOf(w);
  const T = A?.teams[team];
  if (!A || !T) return 'no such team';
  if (stance !== STANCE.CHARGE && stance !== STANCE.HOLD && stance !== STANCE.PASSIVE) return 'bad stance';
  T.stance = stance;
  moveMarker(w, T, true);
  return null;
}

/** Take a team's units off the field (−1: every team; a new round starts). */
export function arenaClear(w: World, team: number): string | null {
  const A = arenaOf(w);
  if (!A) return 'arena only';
  if (team >= A.teams.length || team < -1) return 'no such team';
  const pick = (i: number) => team < 0 || team === i;
  A.teams.forEach((T, i) => {
    if (!pick(i)) return;
    for (const a of w.s.ants) if (a.colony === T.colony && !isQueen(w, T.colony, a.id)) w.killAntNow(a.id);
    for (const cr of w.s.creatures) {
      if (cr.faction !== T.colony) continue;
      if (cr.data.food) w.removeFoodNow(cr.data.food);
      w.removeCreatureNow(cr.id);
    }
    T.spawned = 0;
    T.lost = 0;
    T.alive = 0;
    T.hp = 0;
  });
  // the dead go too (corpses of every team: a clean field)
  if (team < 0) {
    for (const f of w.s.food) if (f.kind === 'corpse' && f.space === SURFACE) w.removeFoodNow(f.id);
    A.t = 0;
    A.winner = -1;
    A.fought = 0;
  }
  return null;
}

/** A team's marker I: on the enemy it charges, else at its spawn point. */
function moveMarker(w: World, T: ArenaTeam, force: boolean): void {
  const c = w.colony(T.colony);
  if (!c) return;
  const m = c.markers[0];
  const charge = T.stance === STANCE.CHARGE && T.has;
  const x = charge ? T.tx : T.x;
  const y = charge ? T.ty : T.y;
  if (force || !m.placed || m.space !== SURFACE || dhypot(m.x - x, m.y - y) > ARENA.moveMarkerMm) placeMarker(w, c, 0, SURFACE, x, y);
}

/**
 * Every `retargetSec`: count each team's living units and health, find what each charging team heads for (the
 * enemy unit nearest its own centre; wild creatures count as everybody's enemy), move the markers, call the round
 * when one team is left after a fight, and clear old carcasses.
 */
export function arenaSystem(w: World, dt: number): void {
  const A = arenaOf(w);
  if (!A) return;
  if (A.fought && A.winner === -1) A.t += dt;
  if (w.s.tick % Math.max(1, Math.round(ARENA.retargetSec * BALANCE.tickHz)) !== 0) return;
  const N = A.teams.length;
  const sx = new Array<number>(N).fill(0);
  const sy = new Array<number>(N).fill(0);
  for (const T of A.teams) {
    T.alive = 0;
    T.hp = 0;
  }
  // every unit: its team (−1 wild), position
  const units: Array<{ t: number; x: number; y: number }> = [];
  for (const a of w.s.ants) {
    if (a.state === AS.Dead || a.space !== SURFACE) continue;
    const i = teamIndex(A, a.colony);
    if (i < 0 || isQueen(w, a.colony, a.id)) continue;
    const T = A.teams[i];
    T.alive++;
    T.hp += a.hp;
    sx[i] += a.x;
    sy[i] += a.y;
    units.push({ t: i, x: a.x, y: a.y });
  }
  for (const cr of w.s.creatures) {
    if (cr.dead) {
      if (cr.deadT > ARENA.carcassSec && !cr.data.gone) {
        if (cr.data.food) w.removeFoodNow(cr.data.food);
        cr.data.gone = 1;
      }
      continue;
    }
    if (cr.space !== SURFACE) continue;
    const i = teamIndex(A, cr.faction);
    if (i >= 0) {
      const T = A.teams[i];
      T.alive++;
      T.hp += cr.hp;
      sx[i] += cr.x;
      sy[i] += cr.y;
    }
    units.push({ t: i, x: cr.x, y: cr.y });
  }
  for (let i = 0; i < N; i++) {
    const T = A.teams[i];
    T.lost = Math.max(0, T.spawned - T.alive);
    T.has = 0;
    if (!T.alive) continue;
    const mx = sx[i] / T.alive;
    const my = sy[i] / T.alive;
    let best = Infinity;
    for (const u of units) {
      if (u.t === i) continue;
      const d2 = sq(u.x - mx) + sq(u.y - my);
      if (d2 < best) {
        best = d2;
        T.tx = u.x;
        T.ty = u.y;
        T.has = 1;
      }
    }
  }
  for (const T of A.teams) moveMarker(w, T, false);
  // the round: a fight is on once two teams have units; the last team standing wins it
  let teams = 0;
  let last = -1;
  for (let i = 0; i < N; i++)
    if (A.teams[i].alive > 0) {
      teams++;
      last = i;
    }
  if (teams >= 2) {
    A.fought = 1;
    A.winner = -1;
  } else if (A.fought && A.winner === -1) {
    A.winner = teams === 1 ? last : -2;
    const T = teams === 1 ? A.teams[last] : null;
    w.events.emit({ t: 'message', text: T ? `${TEAM_NAMES[last]} wins the battle in ${Math.round(A.t)} s, with ${T.alive} unit${T.alive === 1 ? '' : 's'} left.` : `Nobody is left standing after ${Math.round(A.t)} s.`, kind: 'good' });
  }
}

/** Does this colony's ant belong to a team told to stand passive? */
export function passiveAnt(w: World, colony: number): boolean {
  const A = arenaOf(w);
  if (!A) return false;
  const i = teamIndex(A, colony);
  return i >= 0 && A.teams[i].stance === STANCE.PASSIVE;
}

void (null as unknown as Colony);
