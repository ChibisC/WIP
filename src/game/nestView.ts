import * as THREE from 'three';
import { GameView, NestStage } from '../render/view';
import { AntRenderer, AntSpaceAdapter, AntView } from '../render/ants/antRenderer';
import { HitboxOverlay } from './hitboxOverlay';
import { CreatureRenderer } from '../render/creatures/creatureRenderer';
import { FoodRenderer, SpaceMapper } from '../render/game/foodRenderer';
import { BroodRenderer } from '../render/game/broodRenderer';
import { TileDecor } from '../render/nest/tileDecor';
import { ShownMarker, WorldMarkers } from '../render/game/worldMarkers';
import { CombatFx } from '../render/game/combatFx';
import { ProgressRings, RingItem } from '../render/nest/progressRings';
import { jobProgress } from '../sim/jobs';
import { BALANCE } from '../sim/balance';
import { HEX_TYPE, HexVisual } from '../render/nest/nestTerrain';
import { World } from '../sim/world';
import { AS, Colony } from '../sim/types';
import { CASTES, SPECIES, isTermiteSpecies } from '../sim/species';
import { MARKER_COLORS, markerRadius } from '../sim/markers';
import { groupById, raisesAnts } from '../sim/tiles';
import { antToView, blankView, corpseToView, termiteBroodToView } from './antViews';

/** Floor tint of a caste's brood tile: role colour nudged toward the species colour. */
export function casteTint(caste: string): THREE.Color {
  const cd = CASTES[caste];
  const role = cd.role === 'soldier' || cd.role === 'major' ? 0x8a3a24 : cd.role === 'minim' ? 0xc8884a : 0x9a7040;
  return new THREE.Color(role).lerp(new THREE.Color(SPECIES[cd.species].color), 0.3);
}

/**
 * Everything drawn inside one underground area (a colony's nest or a cave):
 * its stage (scene + terrain), the ants, food and brood in it, the owner's
 * tile contents, and the player's markers placed there. Every area has one,
 * so any of them can be shown or previewed.
 */
export class NestView {
  readonly space: number;
  readonly ants: AntRenderer;
  readonly food = new FoodRenderer();
  readonly creatures: CreatureRenderer;
  /** debug overlay: the sim's hitboxes */
  readonly hit: HitboxOverlay;
  readonly brood = new BroodRenderer();
  readonly decor: TileDecor;
  readonly markers = new WorldMarkers();
  readonly fx = new CombatFx();
  readonly rings = new ProgressRings();
  /** show incubation rings on every larva (tile info overlay) */
  overlay = false;
  private ringItems: RingItem[] = [];
  readonly adapter: AntSpaceAdapter;
  readonly map: SpaceMapper;
  private floorHeight: (x: number, z: number) => number;
  private hexKey = '';
  private views: AntView[] = [];

  constructor(
    view: GameView,
    space: number,
    readonly stage: NestStage,
  ) {
    this.space = space;
    const nt = stage.terrain;
    nt.uniforms.uMarkerCols.value.forEach((col, i) => col.set(i === 0 ? '#000000' : i <= 5 ? MARKER_COLORS[i - 1] : '#b89a64'));
    this.ants = new AntRenderer(view.renderer, 'areaAnts' + space);
    this.ants.lodScale = view.preset.lodScale;
    this.ants.space = space;
    this.decor = new TileDecor(nt);
    this.creatures = new CreatureRenderer('areaCreatures' + space);
    this.hit = new HitboxOverlay('areaHitboxes' + space);
    stage.scene.add(this.hit.group, this.ants.group, this.creatures.group, this.food.group, this.brood.group, this.decor.group, this.markers.group, this.fx.group, this.rings.mesh);
    // The nest is a plane: ants walk on the floor heightfield (and up the entrance ramps).
    this.adapter = {
      toWorld: (x, y, out) => out.set(x, nt.heightAt(x, y), y),
      normal: (x, y, out) => nt.normalAt(x, y, out),
      forward: (h, out) => out.set(Math.cos(h), 0, Math.sin(h)),
    };
    this.floorHeight = (x, z) => nt.heightAt(x, z);
    const up = new THREE.Vector3(0, 1, 0);
    this.map = {
      pos: (x, y, lift, out) => out.set(x, nt.heightAt(x, y) + lift, y),
      up: (out) => out.copy(up),
      quat: (h, out) => out.setFromAxisAngle(up, -h),
    };
  }

  /** Push the owner's tiles/groups into the floor shader when they change (caves: entrance ramps only). */
  updateHexes(w: World, owner: Colony | null): void {
    const g = w.nestOf(this.space)!;
    // plugged or fallen-in entrances: a soil cap on the ramp (and no daylight)
    const ents = w.entrancesOf(this.space);
    const shut: number[] = [];
    ents.forEach((e) => {
      if (e.shut || (e.fall ?? 0) > 0.5) shut.push(e.q);
    });
    this.stage.terrain.setShut(shut);
    const spotKey = `${g.spots.map((sp) => sp.join('.')).join('/')}|${shut.join('.')}|${g.tunnels.length}`;
    const key = owner ? `${owner.tileVersion}|${owner.groups.map((gr) => gr.marker).join(',')}|${g.entrances.length}|${spotKey}|${owner.tiles.map((t) => (t.built ? 1 : 0) + t.pend * 2).join('')}` : `cave|${g.entrances.length}|${spotKey}`;
    if (key === this.hexKey) return;
    this.hexKey = key;
    const byQ = new Map((owner?.tiles ?? []).map((t) => [t.q, t]));
    const tints = new Map<string, THREE.Color>();
    const black = new THREE.Color(0, 0, 0);
    // only the nest's owner sees where its extra entrances could go
    const spots = owner?.player ? g.spots : [];
    this.stage.terrain.setHexes((q): HexVisual | null => {
      const ti = g.tunnelIndex(q);
      if (ti >= 0) return { type: HEX_TYPE.entrance, level: Math.max(0, (g.tunnels[ti] ?? [q]).indexOf(q)), edges: 0, outline: shut.includes(g.entrances[ti]) ? 1 : 0, tint: black };
      for (const sp of spots) if (sp.includes(q)) return { type: HEX_TYPE.spot, level: 0, edges: 0, outline: sp[0] === q ? 1 : 0, tint: black };
      const t = byQ.get(q);
      if (!t) return null;
      let edges = 0;
      const nb = g.neighbors(q);
      for (let d = 0; d < 6; d++) {
        const o = nb[d] >= 0 ? byQ.get(nb[d]) : undefined;
        if (!o || o.group !== t.group) edges |= 1 << d;
      }
      const gr = groupById(owner!, t.group);
      // Only the player's groups carry marker outlines; rival groups get a neutral rim.
      const outline = raisesAnts(t) && gr ? (owner!.player && gr.marker >= 0 ? gr.marker + 1 : 6) : 0;
      let tint = new THREE.Color(0.5, 0.4, 0.3);
      if (t.caste && t.type === 'brood') {
        if (!tints.has(t.caste)) tints.set(t.caste, casteTint(t.caste));
        tint = tints.get(t.caste)!;
      }
      return { type: HEX_TYPE[t.type], level: t.level, edges: raisesAnts(t) ? edges : 0, outline, tint, planned: !t.built, pend: t.pend };
    });
  }

  /** Fill all instance buffers for this area as seen from `cam` (owner = the colony whose nest it is; null for caves). */
  update(w: World, owner: Colony | null, player: Colony, cam: THREE.PerspectiveCamera, alpha: number, dt: number, viewportH: number, camDist: number, markerSel: number, time: number, shown: ReadonlyArray<ShownMarker> = player.markers, pendingHexes: ReadonlyArray<{ q: number; kind: string }> = []): void {
    this.updateHexes(w, owner);
    const views = this.views;
    let n = 0;
    const take = () => {
      if (n >= views.length) views.push(blankView());
      return views[n++];
    };
    for (const a of w.s.ants) {
      if (a.space !== this.space) continue;
      if (a.state === AS.Dead && a.deadT > 30) continue;
      antToView(w, a, take(), 0, 0);
    }
    for (const f of w.s.food) if (f.space === this.space && f.kind === 'corpse' && f.from.includes('_')) corpseToView(f, take(), 0, f.from);
    // termite larvae and presoldiers on their tiles: the model kit (eggs stay with the brood renderer)
    if (owner && isTermiteSpecies(owner.species)) for (const b of w.s.brood) if (b.colony === owner.id && b.stage === 1) termiteBroodToView(b, take(), 0);
    const list = n === views.length ? views : views.slice(0, n);
    // creatures first: climbing ants are placed on their animated legs and backs
    this.creatures.update(w.s.creatures, this.space, alpha, dt, this.floorHeight, cam, viewportH);
    this.ants.mount = (v, a, out) => {
      const cr = w.creatureById.get(v.rideCr || v.heldCr || 0);
      return !!cr && this.creatures.mountPose(cr, v, a, out);
    };
    this.ants.update(list, alpha, dt, cam, this.adapter, viewportH);
    this.food.update(w, this.space, alpha, this.map);
    if (owner) {
      this.brood.update(w, owner.id, this.map, alpha);
      this.decor.update(w, owner);
    }
    const nt = this.stage.terrain;
    this.markers.update(shown, this.space, (x, y) => nt.heightAt(x, y), camDist, (i) => markerRadius(w, player, i), markerSel, time);
    if (owner) this.updateRings(w, owner, owner === player ? pendingHexes : [], time);
    else this.rings.set([]);
  }

  private static JOB_COL = new THREE.Color(0xffd27a);
  private static GROW_COL = new THREE.Color(0xf4f0e2);
  private static WAIT_COL = new THREE.Color(0x9ab0c8);
  /** a player's command on this hex is waiting for its tick (multiplayer input delay) */
  private static PEND_COL = new THREE.Color(0xfff4d6);

  /** Rings over hexes being worked; with the overlay, over every incubating larva too. */
  private updateRings(w: World, owner: Colony, pending: ReadonlyArray<{ q: number; kind: string }>, time: number): void {
    const g = w.nestOf(this.space)!;
    const nt = this.stage.terrain;
    const items = this.ringItems;
    let n = 0;
    const push = (x: number, y: number, r: number, p: number, col: THREE.Color) => {
      if (n >= items.length) items.push({ x: 0, y: 0, h: 0, radius: 0, progress: 0, color: col });
      const it = items[n++];
      it.x = x;
      it.y = y;
      it.h = nt.heightAt(x, y);
      it.radius = r;
      it.progress = p;
      it.color = col;
    };
    const ctr = { x: 0, y: 0 };
    for (let q = 0; q < g.cols * g.rows; q++) {
      if (!g.hexDesig[q] || !g.isHexDiggable(q)) continue;
      const p = jobProgress(w, owner, q);
      if (p > 0) {
        g.hexCenter(q, ctr);
        push(ctr.x, ctr.y, g.R * 0.42, p, NestView.JOB_COL);
      }
    }
    for (const t of owner.tiles) {
      const p = jobProgress(w, owner, t.q);
      if (p > 0) {
        g.hexCenter(t.q, ctr);
        push(ctr.x, ctr.y, g.R * 0.42, p, NestView.JOB_COL);
      }
    }
    if (this.overlay) {
      for (const b of w.s.brood) {
        if (b.colony !== owner.id || b.stage !== 1) continue;
        const paused = b.t >= BALANCE.prestage - 1e-3 && b.t < 1 - 1e-3;
        push(b.x, b.y, g.R * 0.3, b.t, paused ? NestView.WAIT_COL : NestView.GROW_COL);
      }
    }
    // Pending commands: a pulsing full ring on the hex until the command's tick runs.
    for (const p of pending) {
      g.hexCenter(p.q, ctr);
      push(ctr.x, ctr.y, g.R * (p.kind === 'build' ? 0.7 : 0.55), 0.75 + 0.25 * Math.sin(time * 14 + p.q), NestView.PEND_COL);
    }
    items.length = Math.max(items.length, n);
    this.rings.set(items.slice(0, n));
  }
}
