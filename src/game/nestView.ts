import * as THREE from 'three';
import { GameView, NestStage } from '../render/view';
import { AntRenderer, AntSpaceAdapter, AntView } from '../render/ants/antRenderer';
import { HitboxOverlay } from './hitboxOverlay';
import { CreatureRenderer } from '../render/creatures/creatureRenderer';
import { HealthBars } from '../render/game/healthBars';
import { FoodRenderer, SpaceMapper } from '../render/game/foodRenderer';
import { BroodRenderer } from '../render/game/broodRenderer';
import { TileDecor } from '../render/nest/tileDecor';
import { ShownMarker, WorldMarkers } from '../render/game/worldMarkers';
import { MarkerTrail } from '../render/game/markerTrail';
import { CombatFx } from '../render/game/combatFx';
import { ProgressRings, RingItem } from '../render/nest/progressRings';
import { jobProgress } from '../sim/jobs';
import { BALANCE } from '../sim/balance';
import { HEX_TYPE, HexVisual } from '../render/nest/nestTerrain';
import { World } from '../sim/world';
import { Fog } from './fog';
import { RouteSigns, Sign } from '../render/game/routeSigns';
import { AS, Colony } from '../sim/types';
import { CASTES, isTermiteSpecies } from '../sim/species';
import { MARKER_COLORS, markerRadius } from '../sim/markers';
import { groupById, raisesAnts } from '../sim/tiles';
import { antToView, blankView, corpseToView, termiteBroodToView } from './antViews';
import { casteColour, casteLook } from '../render/casteLook';

/** Colour of a caste's brood tile and UI (render/casteLook: every caste its own colour and texture). */
export function casteTint(caste: string): THREE.Color {
  return casteColour(caste);
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
  /** the selected marker's trail line to the nest's entrance (session sets it) */
  readonly trail = new MarkerTrail();
  readonly fx = new CombatFx();
  readonly rings = new ProgressRings();
  /** tunnel route signs: the warning "!" on a gate, the attacker's hints (render/game/routeSigns.ts, game/fog.ts) */
  readonly signs = new RouteSigns();
  private signList: Sign[] = [];
  /** show incubation rings on every larva (tile info overlay) */
  overlay = false;
  private ringItems: RingItem[] = [];
  readonly adapter: AntSpaceAdapter;
  readonly map: SpaceMapper;
  /** health bars and level chevrons over hurt or inspected units (user 2026-11-01, 21:36) */
  readonly bars: HealthBars;
  private floorHeight: (x: number, z: number) => number;
  private hexKey = '';
  private views: AntView[] = [];
  /** underground fog (game/fog.ts): the viewer's fog for this space this frame, null when everything is shown */
  fog: Fog | null = null;
  private fogTick = -1;

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
    this.bars = new HealthBars('areaHealthBars' + space);
    stage.scene.add(this.signs.group, this.bars.group, this.hit.group, this.ants.group, this.creatures.group, this.food.group, this.brood.group, this.decor.group, this.markers.group, this.trail.group, this.fx.group, this.rings.mesh);
    // The nest is a plane: ants walk flat on the floor (and up the entrance ramps), never up the walls (user 2026-11-01).
    this.adapter = {
      toWorld: (x, y, out) => out.set(x, nt.floorAt(x, y), y),
      normal: (x, y, out) => nt.floorNormalAt(x, y, out),
      forward: (h, out) => out.set(Math.cos(h), 0, Math.sin(h)),
    };
    this.floorHeight = (x, z) => nt.floorAt(x, z);
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
    // a fallen-in entrance (a dead colony's holes caving in): a soil cap over it (and no daylight)
    const ents = w.entrancesOf(this.space);
    const shut: number[] = [];
    ents.forEach((e) => {
      if ((e.fall ?? 0) > 0.5 && !shut.includes(e.q)) shut.push(e.q);
    });
    this.stage.terrain.setShut(shut);
    const entKey = `${g.flowers.map((f) => f.join('.')).join('/')}|${g.tunnels.map((t) => t.join('.')).join('/')}|${shut.join('.')}`;
    const key = owner ? `${owner.tileVersion}|${owner.groups.map((gr) => gr.marker).join(',')}|${g.entrances.length}|${entKey}|${owner.tiles.map((t) => (t.built ? 1 : 0) + t.pend * 2).join('')}` : `cave|${g.entrances.length}|${entKey}`;
    if (key === this.hexKey) return;
    this.hexKey = key;
    const byQ = new Map((owner?.tiles ?? []).map((t) => [t.q, t]));
    const tints = new Map<string, THREE.Color>();
    const black = new THREE.Color(0, 0, 0);
    this.stage.terrain.setHexes((q): HexVisual | null => {
      const ti = g.tunnelIndex(q);
      if (ti >= 0) {
        // a nest's flower: level 0 its top edge (daylight), 1 the middle, 2 its inner edge; a cave's tunnel: top down
        const f = g.flowers[ti];
        let level = Math.max(0, (g.tunnels[ti] ?? [q]).indexOf(q));
        if (f && f.length > 1) {
          const ed = g.flowerEdges(ti);
          level = ed.top.includes(q) ? 0 : ed.inner.includes(q) ? 2 : 1;
        }
        return { type: HEX_TYPE.entrance, level, edges: 0, outline: shut.includes(g.entrances[ti]) ? 1 : 0, tint: black };
      }
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
      let pattern = 0;
      if (t.caste && t.type === 'brood') {
        if (!tints.has(t.caste)) tints.set(t.caste, casteTint(t.caste));
        tint = tints.get(t.caste)!;
        pattern = casteLook(t.caste).patternId;
      }
      return { type: HEX_TYPE[t.type], level: t.level, edges: raisesAnts(t) ? edges : 0, outline, tint, pattern, planned: !t.built, pend: t.pend };
    });
  }

  /** Fill all instance buffers for this area as seen from `cam` (owner = the colony whose nest it is; null for caves). */
  update(w: World, owner: Colony | null, player: Colony, cam: THREE.PerspectiveCamera, alpha: number, dt: number, viewportH: number, camDist: number, markerSel: number, time: number, shown: ReadonlyArray<ShownMarker> = player.markers, pendingHexes: ReadonlyArray<{ q: number; kind: string }> = []): void {
    this.updateHexes(w, owner);
    // the fog: sealed hexes drawn as rock, seen/remembered/dark levels, units hidden out of sight (game/fog.ts)
    const g = w.nestOf(this.space)!;
    const fog = this.fog;
    const nt = this.stage.terrain;
    if (this.fogTick !== w.s.tick) {
      this.fogTick = w.s.tick;
      nt.setSealed(fog?.sealedOf(this.space) ?? null);
      const lv = fog?.levelsOf(this.space);
      nt.setFog(lv ? (q) => lv[q] : null);
    }
    const vis = fog && fog.hasFog(this.space) ? (x: number, y: number) => fog.visible(g, this.space, x, y) : null;
    this.creatures.visible = vis;
    this.food.visible = vis;
    this.brood.visible = vis;
    const views = this.views;
    let n = 0;
    const take = () => {
      if (n >= views.length) views.push(blankView());
      return views[n++];
    };
    for (const a of w.s.ants) {
      if (a.space !== this.space) continue;
      if (a.state === AS.Dead && a.deadT > 30) continue;
      if (vis && !vis(a.x, a.y)) continue;
      antToView(w, a, take(), 0, 0);
    }
    for (const f of w.s.food) if (f.space === this.space && f.kind === 'corpse' && f.from.includes('_') && !(vis && !vis(f.x, f.y))) corpseToView(f, take(), 0, f.from);
    // termite larvae and presoldiers on their tiles: the model kit (eggs stay with the brood renderer)
    if (owner && isTermiteSpecies(owner.species)) for (const b of w.s.brood) if (b.colony === owner.id && b.stage === 1 && !(vis && !vis(b.x, b.y))) termiteBroodToView(b, take(), 0);
    const list = n === views.length ? views : views.slice(0, n);
    // creatures first: climbing ants are placed on their animated legs and backs
    this.creatures.update(w.s.creatures, this.space, alpha, dt, this.floorHeight, cam, viewportH);
    this.ants.mount = (v, a, out) => {
      const cr = w.creatureById.get(v.rideCr || v.heldCr || 0);
      return !!cr && this.creatures.mountPose(cr, v, a, out);
    };
    this.ants.update(list, alpha, dt, cam, this.adapter, viewportH);
    this.food.update(w, this.space, alpha, this.map, (id) => this.ants.holdOf(id));
    if (owner) {
      this.brood.update(w, owner.id, this.map, alpha);
      this.decor.update(w, owner);
    }
    this.markers.update(shown, this.space, (x, y) => nt.heightAt(x, y), camDist, (i) => markerRadius(w, player, i), markerSel, time);
    if (owner) this.updateRings(w, owner, owner === player ? pendingHexes : [], time);
    else this.rings.set([]);
    this.signs.update(fog ? fog.signs(w, player, this.space, this.signList) : [], (x, y) => nt.floorAt(x, y), Math.max(g.R * 0.6, Math.min(g.R * 2.5, camDist * 0.045)), time, cam);
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
