import * as THREE from 'three';
import { CLICK } from '../core/device';
import { EventBus, SimEvent } from '../core/events';
import { GameLoop } from '../core/loop';
import { Input, PointerInfo } from '../core/input';
import { GameView, Quality } from '../render/view';
import { AntRenderer, AntSpaceAdapter, AntView } from '../render/ants/antRenderer';
import { edible } from '../sim/diet';
import { HitboxOverlay } from './hitboxOverlay';
import { CreatureRenderer } from '../render/creatures/creatureRenderer';
import { climbRoom } from '../sim/creatures/climb';
import { CREATURES } from '../sim/creatures/kinds';
import { SurfaceMounds } from '../render/game/mounds';
import { FoodRenderer, SpaceMapper } from '../render/game/foodRenderer';
import { SurfaceDecor } from '../render/game/surfaceDecor';
import { CombatFx } from '../render/game/combatFx';
import { WorldMarkers } from '../render/game/worldMarkers';
import { World } from '../sim/world';
import { createWorld, GameSetup } from '../sim/mapGen';
import { AS, Colony, FloodState, SURFACE, TileType, colonyOfSpace, nestSpace } from '../sim/types';
import { AreaInfo, areaOpen, areasFor, teamPresence } from '../sim/areas';
import { CASTES, SPECIES, canonCaste, isTermiteSpecies } from '../sim/species';
import { canPlaceTile, canUpgrade, groupWouldJoin, hatchCost, neighbourPoints, tileAt, tileCost, TILE_INFO, upgradeNeed, upgradePoints } from '../sim/tiles';
import { BALANCE, ENTRANCE, FLOOD } from '../sim/balance';
import { spotBlocked } from '../sim/entrances';
import { entranceAt, markerRadius } from '../sim/markers';
import { abilityOf } from '../sim/abilities';
import { Command, CommandBody } from '../sim/commands';
import { LocalCommands } from './localCommands';
import { LocalSim, SimHost, WorkerSim } from './simHost';
import { AutoQuality } from './autoQuality';
import type { NetGame } from '../net/netGame';
import { matchWinner } from '../net/match';
import { MISSIONS, missionOf } from '../sim/missions';
import { restoreWorld } from '../sim/snapshot';
import { commandsByTick, encodeReplay } from './replay';
import { SaveHeader, SaveRecord, SaveSlot, encodeSave, putSave } from './saves';
import { bindingsOf, settings } from './profile';
import { antToView, blankView, corpseToView } from './antViews';
import { NestView, casteTint } from './nestView';
import { TeamRings } from '../render/game/teamRings';
import { arenaOf } from '../sim/arenaState';
import { TEAM_NAMES } from '../sim/arena';

export { casteTint };

export type Tool = 'none' | 'dig' | 'tile' | 'upgrade' | 'remove' | 'marker' | 'spawn' | 'arena';

/** What the player clicked to inspect. */
export interface Inspect {
  kind: 'ant' | 'creature';
  id: number;
}

/** An area tab as the UI shows it. */
export interface AreaTab extends AreaInfo {
  /** clickable now (your or allied ants inside, home, or sandbox reveal) */
  open: boolean;
  /** your ants and allies inside */
  ants: number;
  /** seconds since the last alert in this area (Infinity = none) */
  alertAge: number;
}

/**
 * A running game: the simulation World, the fixed-step loop, and every
 * renderer that turns sim state into the surface scene and one scene per
 * underground area (home nest, rival and allied nests, caves). The area tabs
 * show an area only while the player's ants are in it (DESIGN 3.12).
 * Player commands (digging, tiles, markers) go through here.
 */
export class GameSession {
  events = new EventBus();
  world: World;
  input: Input;
  view: GameView;
  loop: GameLoop;
  player: Colony;
  tool: Tool = 'none';
  buildType: TileType = 'brood';
  buildCaste = '';
  markerSel = -1;
  selectedTile = -1;
  pheroOn = false;
  gridOn = false;
  foodView = false;
  infoOn = true;
  inspect: Inspect | null = null;
  /** space id of the underground area shown in the nest view (area tabs 1–6) */
  viewedArea: number;
  /** viewer setting (sandbox): every area tab open. Client-side only, never simulation state. */
  revealAreas = false;
  /** every player action goes through here (multiplayer brief, Part C) */
  commands!: LocalCommands;
  /** where the simulation runs: this thread or a worker (then `world` is a replica) */
  sim!: SimHost;
  /** graphics preset follows the frame time when enabled ("Auto" quality) */
  readonly autoQuality = new AutoQuality();
  /** multiplayer: the match (lockstep) driving the simulation; null in single-player */
  net: NetGame | null = null;
  /** multiplayer: a chat line arrived */
  onChat: ((from: string, text: string) => void) | null = null;
  /** the match is over: winning team (−2 = nobody) */
  onGameOver: ((winner: number) => void) | null = null;
  /** the setup this game was generated from (replays); null when it started from a snapshot */
  readonly setup: GameSetup | null;
  /** false when a dev scene edited the world after generation (a replay could not reproduce it) */
  replayable = true;
  /** the snapshot this game started from (a loaded save or a rejoin): replays start there */
  readonly startSnapshot: Uint8Array | null;
  /** game time of the next autosave (single-player) */
  private nextAutosave = 0;
  private saving = false;
  /** the build id saves and replays are stamped with (set by main) */
  build = '';
  /** watching a replay: the recorded commands drive the simulation */
  private replay: { byTick: Map<number, Command[]>; next: number; end: number; finalHash: string; done: boolean } | null = null;
  /** a replay finished: whether it reproduced the recorded game exactly */
  onReplayEnd: ((identical: boolean) => void) | null = null;
  private overSent = false;
  /** ant followed by the observe camera (0 = none) */
  followId = 0;
  hoverHex = -1;
  hoverMsg = '';
  /** hover info for the ghost: cost and group it would join */
  ghostInfo = '';
  /** the entrance under the cursor on the surface (cursor tip) */
  entranceTip = '';
  /** the current Dig stroke started on an extra-entrance spot (only then does it mark spots) */
  private paintSpot = false;
  /** tile info overlay: levels, upgrade points, incubation rings */
  tileOverlay = false;
  /** with the Upgrade tool: points each neighbour of the hovered tile gives */
  hoverNeighbours: Array<{ q: number; pts: number }> = [];
  onEvent: ((e: SimEvent) => void) | null = null;
  onFrame: (() => void) | null = null;

  /** one view per underground area, keyed by space id */
  readonly nests = new Map<number, NestView>();
  /** debug overlay: the climb rails and riding slots of climbable creatures (F3, or ?climbdebug=1) */
  climbDebug = false;
  /** game time of the last alert in each area (attacks, the queen hurt) */
  private alertAt = new Map<number, number>();
  private tabsCache: AreaTab[] = [];
  private tabsFrame = -1;
  private frameNo = 0;
  private trailT = 0;
  private surfAnts: AntRenderer;
  private surfFood = new FoodRenderer();
  private surfCreatures = new CreatureRenderer('surfaceCreatures');
  /** battle arena: a ring in the team colour under every unit */
  private teamRings = new TeamRings();
  /** debug overlay: the sim's hitboxes (F3, or ?hitboxes=1; game/hitboxOverlay.ts) */
  private surfHit = new HitboxOverlay('surfaceHitboxes');
  hitboxes = false;
  private surfDecor = new SurfaceDecor();
  private surfFx = new CombatFx();
  /** fire ant mounds: drawn domes that everything on the surface walks over */
  private mounds = new SurfaceMounds();
  /** terrain height without the mounds (what the mounds are built on) */
  private terrainHeight = (x: number, y: number): number => {
    const t = this.world.terrain;
    return t.walkHeight(Math.min(Math.max(x, 0), t.width), Math.min(Math.max(y, 0), t.depth));
  };
  private surfHeight = (x: number, y: number): number => this.terrainHeight(x, y) + this.mounds.height(x, y);
  private surfMarkers = new WorldMarkers();
  private views: AntView[] = [];
  private pheroTex: THREE.DataTexture;
  private pheroData: Uint8Array;
  private pheroVer = -1;
  private surfAdapter: AntSpaceAdapter;
  private surfMap: SpaceMapper;
  private painting = false;
  private paintOn = true;
  private paintDone = new Set<number>();

  /**
   * `local` is the colony this client controls (multiplayer: the player's slot). Which colony is
   * "you" is a client fact: the simulation only knows which colonies are human-controlled.
   */
  constructor(canvas: HTMLCanvasElement, setup: GameSetup | { snapshot: Uint8Array }, quality: Quality, local?: number) {
    // a rejoining multiplayer client starts from the host's snapshot instead of generating the map
    this.world = 'snapshot' in setup ? restoreWorld(setup.snapshot, this.events) : createWorld(setup, this.events);
    this.setup = 'snapshot' in setup ? null : setup;
    this.startSnapshot = 'snapshot' in setup ? setup.snapshot.slice() : null;
    this.player = (local !== undefined ? this.world.colony(local) : undefined) ?? this.world.playerColony()!;
    this.commands = new LocalCommands(this.world, this.player.id);
    this.sim = new LocalSim(this.world, this.commands.schedule);
    this.viewedArea = nestSpace(this.player.id);
    this.input = new Input(canvas);
    const st = settings();
    this.input.bindings = bindingsOf(st);
    this.input.edgeScroll = st.edgeScroll;
    this.view = new GameView(canvas, this.input);
    this.view.setQuality(quality);
    const w = this.world;
    this.view.setTerrain(w.terrain);
    // Every underground area gets its own stage; the player's nest comes first (area 1).
    for (const a of areasFor(w, this.player.id)) {
      const g = w.nestOf(a.space);
      if (!g) continue;
      const stage = this.view.addNest(a.space, g);
      // a Nasute Termite nest is built of carton; a Sickle-Jaw nest is damp soil
      const oc = w.colony(colonyOfSpace(a.space));
      if (oc && isTermiteSpecies(oc.species)) stage.terrain.uniforms.uCarton.value = oc.species === 'rhynchotermes' ? 2 : 1;
      this.nests.set(a.space, new NestView(this.view, a.space, stage));
    }
    this.view.setActiveNest(this.viewedArea);
    this.surfAnts = new AntRenderer(this.view.renderer, 'surfaceAnts');
    this.surfAnts.lodScale = this.view.preset.lodScale;
    this.view.surfaceScene.add(this.teamRings.group, this.surfHit.group, this.surfAnts.group, this.surfCreatures.group, this.mounds.group, this.surfFood.group, this.surfDecor.group, this.surfMarkers.group, this.surfFx.group);
    // Pheromone overlay texture.
    const ph = w.phero;
    this.pheroData = new Uint8Array(ph.w * ph.h * 4);
    this.pheroTex = new THREE.DataTexture(this.pheroData, ph.w, ph.h, THREE.RGBAFormat);
    this.pheroTex.magFilter = this.pheroTex.minFilter = THREE.LinearFilter;
    const ou = this.view.terrainMesh!.overlayUniforms;
    ou.uPhero.value = this.pheroTex;
    ou.uMapSize.value.set(ph.w * ph.res, ph.h * ph.res);

    const t = w.terrain;
    const clampX = (x: number) => Math.min(Math.max(x, 0), t.width);
    const clampY = (y: number) => Math.min(Math.max(y, 0), t.depth);
    const n3 = { x: 0, y: 1, z: 0 };
    this.surfAdapter = {
      toWorld: (x, y, out) => out.set(x, t.walkHeight(clampX(x), clampY(y)) + this.mounds.height(x, y), y),
      normal: (x, y, out) => {
        t.walkNormal(clampX(x), clampY(y), n3);
        this.mounds.tilt(x, y, n3);
        out.set(n3.x, n3.y, n3.z);
      },
      forward: (h, out) => out.set(Math.cos(h), 0, Math.sin(h)),
    };
    const up = new THREE.Vector3(0, 1, 0);
    this.surfMap = {
      pos: (x, y, lift, out) => out.set(x, t.walkHeight(clampX(x), clampY(y)) + this.mounds.height(x, y) + lift, y),
      up: (out) => out.copy(up),
      quat: (h, out) => out.setFromAxisAngle(up, -h),
    };

    this.loop = new GameLoop({
      tick: () => this.tickOnce(),
      frame: (alpha, realDt, simDt) => this.frame(this.sim.alpha(alpha, performance.now(), this.loop.paused), realDt, simDt),
    });
    this.events.onAny((e) => {
      if (e.t === 'command') this.commands.acknowledge(e.player, e.seq);
      this.routeFx(e);
      this.noteAlert(e);
      // a boss's heavy footfalls shake the surface camera
      if (e.t === 'bossFootstep' && this.view.space === 'surface') this.view.surfaceRig.shake = Math.max(this.view.surfaceRig.shake, Math.min(1, e.power * 0.6));
      // a hell ant impaling prey right in front of a close camera: a jolt and a brief hit-stop
      if (e.t === 'snap' && e.impale && e.space === SURFACE && this.view.space === 'surface') {
        const rig = this.view.surfaceRig;
        const S = BALANCE.snap;
        if (rig.distance < S.shakeAt && Math.hypot(rig.target.x - e.x, rig.target.z - e.y) < rig.distance) {
          rig.shake = Math.max(rig.shake, S.shake);
          if (!this.net) this.loop.hitStop(S.hitStop);
        }
      }
      if (e.t === 'message' && e.colony !== undefined && e.colony !== this.player.id) return; // another player's message
      this.onEvent?.(e);
    });
    this.bindInput();
    // Start looking at the player's nest entrance on the surface, and at the queen
    // (or, in a cave, the middle of the cavern) in each area.
    const e0 = this.player.entrances[0];
    const arena = arenaOf(w);
    // the battle arena: the whole field in view
    if (arena) this.view.surfaceRig.jumpTo(arena.cx, arena.cy, 330);
    else this.view.surfaceRig.jumpTo(e0.sx, e0.sy, 230);
    for (const [space, nv] of this.nests) {
      const g = w.nestOf(space)!;
      const p = this.areaFocus(space);
      nv.stage.cam = { x: p.x, z: p.y, dist: g.R * 16, yaw: 0.6, pitch: 0 };
    }
    this.view.setActiveNest(this.viewedArea);
  }

  start(): void {
    this.loop.start();
  }

  /** One simulation tick (false: it cannot run yet — multiplayer is waiting for a player's packets). */
  private tickOnce(): boolean {
    if (this.net) return this.net.tryTick();
    if (this.replay) return this.replayTick();
    this.sim.tick(1);
    return true;
  }

  /** Pause or resume (single-player only: a multiplayer match cannot be paused). */
  togglePause(): void {
    if (this.net) {
      this.onEvent?.({ t: 'message', text: 'A multiplayer match cannot be paused.', kind: 'info' });
      return;
    }
    this.loop.paused = !this.loop.paused;
  }

  /**
   * Game speed. Multiplayer: a vote (sim/commands.ts `speedVote`) — faster only when every player agrees, slower at
   * once; the match runs at the agreed speed (`settings.gameSpeed`).
   */
  setSpeed(x: number): void {
    if (this.net) {
      const sp = x >= 4 ? 4 : x >= 2 ? 2 : 1;
      this.issue({ type: 'speedVote', speed: sp });
      return;
    }
    this.loop.speed = x;
  }

  /** The match's agreed speed (multiplayer) or the local speed (single-player). */
  gameSpeed(): number {
    return this.net ? (this.world.s.settings.gameSpeed ?? 1) : this.loop.speed;
  }

  /** Multiplayer: let the match drive the simulation (after useWorker). */
  attachNet(net: NetGame): void {
    this.net = net;
    this.revealAreas = false;
    this.loop.speed = 1;
    this.commands.remote = (cmd) => net.issue(cmd);
    net.onLog = (text) => this.onEvent?.({ t: 'message', text, kind: 'info' });
    net.onChat = (from, text) => this.onChat?.(from, text);
  }

  /** Multiplayer per-frame upkeep: timers, the slow-down, a rejoining client's fast-forward, the end of the match. */
  private netFrame(): void {
    const net = this.net;
    if (!net) return;
    net.update();
    // (the agreed speed — every client runs its tick clock this much faster at the same time — times the lockstep's
    // own slow-down when one client runs ahead)
    this.loop.speed = net.status().speed * (this.world.s.settings.gameSpeed ?? 1);
    // A player who rejoined plays the missed ticks at full speed (the worker queues them).
    const behind = net.behind();
    if (behind > 4 && !this.loop.paused) for (let i = 0; i < Math.min(60, behind) && net.tryTick(); i++);
    if (!this.overSent && this.frameNo % 30 === 0) {
      const win = matchWinner(this.world);
      if (win !== -1) {
        this.overSent = true;
        this.onGameOver?.(win);
      }
    }
  }

  /**
   * Move the simulation into a Web Worker (call once, before the first tick,
   * after any setup that edits the world). From then on `world` is a replica
   * updated from the worker's frames, and commands are sent to the worker.
   */
  useWorker(): void {
    if (this.sim.kind === 'worker' || typeof Worker === 'undefined') return;
    const ws = new WorkerSim(this.world);
    ws.onError = (msg) => this.onEvent?.({ t: 'message', text: `Simulation error: ${msg.split('\n')[0]}`, kind: 'warn' });
    // Clear pending commands as soon as the frame that applied them arrives (not at the next render).
    ws.onFrame = (f) => {
      for (const e of f.events) if (e.t === 'command') this.commands.acknowledge(e.player, e.seq);
    };
    this.sim = ws;
    this.commands.remote = (cmd) => ws.send([cmd]);
    if (this.pheroOn) ws.setOverlay(this.player.id);
  }

  private bindInput(): void {
    const inp = this.input;
    inp.on('toggleView', () => this.toggleView());
    inp.on('pause', () => this.togglePause());
    inp.on('speedUp', () => this.setSpeed(this.net ? this.gameSpeed() * 2 : Math.min(8, this.loop.speed * 2)));
    inp.on('speedDown', () => this.setSpeed(this.net ? this.gameSpeed() / 2 : Math.max(0.25, this.loop.speed / 2)));
    inp.on('overlay', () => this.setPhero(!this.pheroOn));
    inp.on('recall', () => this.issue({ type: 'recall' }));
    inp.on('cancel', () => {
      if (this.followId) this.unfollow();
      else this.setTool('none');
    });
    inp.on('observe', () => {
      if (this.followId) this.unfollow();
      else if (this.inspect?.kind === 'ant') this.follow(this.inspect.id);
    });
    inp.on('dig', () => this.setTool(this.tool === 'dig' ? 'none' : 'dig'));
    inp.on('upgradeTool', () => this.setTool(this.tool === 'upgrade' ? 'none' : 'upgrade'));
    inp.on('deleteTool', () => this.setTool(this.tool === 'remove' ? 'none' : 'remove'));
    inp.on('resetCam', () => (this.view.space === 'nest' ? this.view.nestRig : this.view.surfaceRig).resetView());
    inp.on('jumpMarker', () => {
      const i = this.markerSel >= 0 ? this.markerSel : this.lastMarker;
      if (i >= 0 && this.player.markers[i].placed) this.jumpToMarker(i);
      else this.onEvent?.({ t: 'message', text: 'Select a placed marker first (click its column header or press 1–5).', kind: 'info' });
    });
    inp.on('photo', () => this.togglePhoto(inp.lastShift));
    (['area1', 'area2', 'area3', 'area4', 'area5', 'area6', 'area7', 'area8'] as const).forEach((a, i) =>
      inp.on(a, () => {
        const t = this.areaTabs()[i];
        if (t) this.showArea(t.space);
      }),
    );
    inp.on('nextArea', () => this.nextArea());
    (['marker1', 'marker2', 'marker3', 'marker4', 'marker5'] as const).forEach((a, i) => inp.on(a, () => this.selectMarker(i)));
    inp.onClick = (p) => this.click(p);
    inp.onRightClick = (p) => this.rightClick(p);
    inp.onPaint = (p, phase) => this.paint(p, phase);
  }

  // ------------------------------------------------------------------ areas & spaces
  /**
   * The level's underground areas as tabs (home = 1), each with the access
   * rule applied: open only while your ants or allies are inside, home
   * always, every tab with the sandbox "reveal" setting.
   */
  areaTabs(): AreaTab[] {
    if (this.tabsFrame === this.frameNo && this.tabsCache.length) return this.tabsCache;
    const w = this.world;
    const presence = teamPresence(w, this.player.team);
    this.tabsCache = areasFor(w, this.player.id).map((a) => ({
      ...a,
      open: areaOpen(w, this.player, a.space, presence, this.revealAreas),
      ants: presence.get(a.space) ?? 0,
      alertAge: this.alertAt.has(a.space) ? w.time - this.alertAt.get(a.space)! : Infinity,
    }));
    this.tabsFrame = this.frameNo;
    return this.tabsCache;
  }

  areaTab(space: number): AreaTab | undefined {
    return this.areaTabs().find((t) => t.space === space);
  }

  /** A point to look at in an area: the queen's chamber in a nest, the cavern in a cave. */
  areaFocus(space: number): { x: number; y: number } {
    const w = this.world;
    const g = w.nestOf(space)!;
    const c = w.colony(colonyOfSpace(space));
    const qt = c?.tiles.find((x) => x.type === 'queen');
    if (qt) return g.hexCenter(qt.q);
    const food = w.s.food.filter((f) => f.space === space);
    if (food.length) return { x: food.reduce((s, f) => s + f.x, 0) / food.length, y: food.reduce((s, f) => s + f.y, 0) / food.length };
    let sx = 0;
    let sy = 0;
    let n = 0;
    const p = { x: 0, y: 0 };
    for (let q = 0; q < g.cols * g.rows; q++) {
      if (!g.isHexDug(q) || g.isEntrance(q)) continue;
      g.hexCenter(q, p);
      sx += p.x;
      sy += p.y;
      n++;
    }
    return n ? { x: sx / n, y: sy / n } : { x: g.widthMm / 2, y: g.depthMm / 2 };
  }

  /** Dive between the surface and the viewed area through one of its entrances. */
  toggleView(): void {
    const v = this.view;
    if (this.arena) return; // the battle arena is all on the surface
    if (v.space === 'surface' && !this.areaTab(this.viewedArea)?.open) this.viewedArea = nestSpace(this.player.id);
    const w = this.world;
    const space = this.viewedArea;
    const ents = w.entrancesOf(space);
    const g = w.nestOf(space)!;
    // dive through the entrance nearest the surface camera (or the first one)
    let e = ents[0];
    let bd = Infinity;
    for (const x of ents) {
      const d = (x.sx - v.surfaceRig.goal.x) ** 2 + (x.sy - v.surfaceRig.goal.z) ** 2;
      if (d < bd) {
        bd = d;
        e = x;
      }
    }
    const h = w.terrain.walkHeight(e.sx, e.sy);
    const p = g.hexCenter(e.q);
    if (v.space === 'surface') v.setActiveNest(space);
    v.switchSpace(v.space === 'surface' ? 'nest' : 'surface', new THREE.Vector3(e.sx, h, e.sy), new THREE.Vector2(p.x, p.y));
  }

  /**
   * Show an underground area (tabs, Shift + 1–6). Closed areas (no ants of yours
   * inside) refuse with "No ants in this area". From the surface this dives
   * in through the area's entrance; between areas it is a quick fade cut, and
   * the camera returns to where it was last time in that area.
   */
  showArea(space: number): boolean {
    if (this.arena) return false; // the battle arena is all on the surface (Shift+1–4 picks a team there)
    const tab = this.areaTab(space);
    if (!tab || !this.nests.has(space)) return false;
    if (!tab.open) {
      this.onEvent?.({ t: 'message', text: `${tab.name}: no ants in this area. Send a group there with a marker on its entrance.`, kind: 'info' });
      return false;
    }
    const home = nestSpace(this.player.id);
    if (space !== home && (this.tool === 'dig' || this.tool === 'tile' || this.tool === 'upgrade' || this.tool === 'remove')) this.setTool('none');
    this.selectedTile = -1;
    const v = this.view;
    if (v.space === 'surface') {
      this.viewedArea = space;
      if (!v.transitioning) this.toggleView();
    } else if (space !== this.viewedArea || v.activeNest !== space) {
      this.viewedArea = space;
      v.fadeCut(() => v.setActiveNest(space));
    }
    return true;
  }

  /** Next open underground area after the one viewed (N). */
  nextArea(): void {
    if (this.arena) return;
    const tabs = this.areaTabs().filter((t) => t.open);
    if (!tabs.length) return;
    const i = tabs.findIndex((t) => t.space === this.viewedArea);
    const next = this.view.space === 'surface' && i >= 0 ? tabs[i] : tabs[(i + 1) % tabs.length];
    this.showArea(next.space);
  }

  get viewingOwnNest(): boolean {
    return this.viewedArea === nestSpace(this.player.id);
  }

  /** Mark an alert on an area's tab (attacks on your ants, the queen hurt). */
  /** Show or hide the climb rails and riding slots (debug overlay). */
  setClimbDebug(on: boolean): void {
    this.climbDebug = on;
    this.surfCreatures.climbDebug = on;
    for (const nv of this.nests.values()) nv.creatures.climbDebug = on;
  }

  /** Show or hide the simulation's hitboxes (debug overlay). */
  setHitboxes(on: boolean): void {
    this.hitboxes = on;
  }

  private alert(space: number): void {
    this.alertAt.set(space, this.world.time);
  }

  setPhero(on: boolean): void {
    this.pheroOn = on;
    this.view.terrainMesh!.overlayUniforms.uPheroOn.value = on ? 1 : 0;
    this.sim.setOverlay(on ? this.player.id : -1);
  }

  setGrid(on: boolean): void {
    this.gridOn = on;
  }

  /** Choose a tool. Tile tools need `buildType` (+ caste for brood). Building happens in the player's nest. */
  setTool(t: Tool, buildType?: TileType, caste = ''): void {
    this.tool = t;
    if (buildType) this.buildType = buildType;
    this.buildCaste = caste;
    if (t !== 'marker') this.markerSel = -1;
    const nestTool = t === 'dig' || t === 'tile' || t === 'upgrade' || t === 'remove';
    this.input.leftDragMode = nestTool ? 'paint' : 'pan';
    if (nestTool && !this.viewingOwnNest) this.showArea(nestSpace(this.player.id));
    if (nestTool && this.view.space !== 'nest') this.toggleView();
  }

  /** Photo mode: pause and hide the UI; with Shift, also a free-flying camera. */
  photoMode = false;
  onPhoto: ((on: boolean) => void) | null = null;
  private photoWasPaused = false;
  togglePhoto(free = false): void {
    if (!this.photoMode) {
      this.photoMode = true;
      this.photoWasPaused = this.loop.paused;
      if (!this.net) this.loop.paused = true; // a multiplayer match keeps running
      this.view.setFreeCam(free);
    } else if (free && !this.view.freeCam.on) {
      this.view.setFreeCam(true);
      return;
    } else {
      this.photoMode = false;
      this.view.setFreeCam(false);
      if (!this.net) this.loop.paused = this.photoWasPaused;
    }
    this.onPhoto?.(this.photoMode);
  }

  /** The marker last selected or placed (Space jumps to it). */
  lastMarker = -1;

  /** Select marker i for placement (or deselect when already selected). */
  selectMarker(i: number): void {
    if (this.arena) return; // the arena moves the teams' markers itself
    this.lastMarker = i;
    if (this.tool === 'marker' && this.markerSel === i) {
      this.setTool('none');
      return;
    }
    this.setTool('marker');
    this.markerSel = i;
  }

  private hexUnder(p: { x: number; y: number }): number {
    if (this.view.space !== 'nest') return -1;
    const np = this.view.pickNest(p.x, p.y);
    if (!np) return -1;
    return this.world.nestOf(this.viewedArea)!.hexAt(np.x, np.y);
  }

  private paint(p: PointerInfo, phase: 'start' | 'move' | 'end'): void {
    if (phase === 'end') {
      this.painting = false;
      this.paintDone.clear();
      return;
    }
    if (!this.viewingOwnNest) return;
    const q = this.hexUnder(p);
    if (q < 0) return;
    const w = this.world;
    const c = this.player;
    const g = w.nest(c.id)!;
    if (phase === 'start') {
      this.painting = true;
      this.paintDone.clear();
      this.paintOn = this.tool === 'dig' ? !g.hexDesig[q] : true;
      this.paintSpot = g.spotIndex(q) >= 0;
    }
    if (!this.painting || this.paintDone.has(q)) return;
    this.paintDone.add(q);
    // Every change is a command; the checks here only choose what to send and what to say.
    const ti = g.tunnelIndex(q);
    if (ti === 0 && phase === 'start' && this.tool === 'remove') {
      this.onEvent?.({ t: 'message', text: 'The main entrance cannot be closed', kind: 'warn' });
      return;
    }
    if (ti > 0 && phase === 'start' && (this.tool === 'dig' || this.tool === 'remove')) {
      // an extra entrance: Remove plugs it with soil, Dig opens a plugged one again (the main one never closes)
      const e = c.entrances[ti];
      if (e && !e.fall) {
        const close = this.tool === 'remove';
        if (close === !!e.shut && !(e.work ?? 0)) this.onEvent?.({ t: 'message', text: close ? 'This entrance is already closed' : 'This entrance is open', kind: 'warn' });
        else this.issue({ type: 'entrance', i: ti, close });
      }
      return;
    }
    if (this.tool === 'dig') {
      // a drag never sweeps up an extra-entrance spot by accident: start the stroke on the spot to dig it
      if (g.spotIndex(q) >= 0 && !this.paintSpot) return;
      if (g.spotIndex(q) >= 0 && phase === 'start' && this.paintOn) {
        const why = spotBlocked(w, c, g.spotIndex(q));
        if (why) {
          this.onEvent?.({ t: 'message', text: why, kind: 'warn' });
          return;
        }
      }
      if (!g.isHexDug(q) && g.isHexDiggable(q)) this.issue({ type: 'dig', q, on: this.paintOn }, phase !== 'start');
    } else if (this.tool === 'tile') {
      const ex = tileAt(c, q) ?? (this.pendingTileAt(q) ? { built: false } : undefined);
      if (ex && !ex.built && phase === 'start') {
        // clicking a planned tile again cancels it
        this.issue({ type: 'markDelete', q });
        this.paintOn = false;
        return;
      }
      if (!this.paintOn) {
        if (ex && !ex.built) this.issue({ type: 'markDelete', q }, true);
        return;
      }
      // Later hexes of a stroke may depend on earlier ones still being applied, so only the first is pre-checked.
      const why = phase === 'start' ? canPlaceTile(w, c, this.buildType, q, this.buildCaste || undefined) : null;
      if (why) this.onEvent?.({ t: 'message', text: why, kind: 'warn' });
      else this.issue({ type: 'buildTile', q, tile: this.buildType, caste: this.buildCaste || '' }, phase !== 'start');
    } else if (this.tool === 'upgrade') {
      const t = tileAt(c, q);
      const why = !t ? 'No tile here' : t.pend === 1 ? null : canUpgrade(w, c, t);
      if (why) {
        if (phase === 'start') this.onEvent?.({ t: 'message', text: why, kind: 'warn' });
      } else this.issue({ type: 'markUpgrade', q }, phase !== 'start');
    } else if (this.tool === 'remove') {
      const t = tileAt(c, q);
      if (t?.type === 'queen') {
        if (phase === 'start') this.onEvent?.({ t: 'message', text: "The queen's chamber cannot be removed", kind: 'warn' });
      } else if (t) this.issue({ type: 'markDelete', q }, phase !== 'start');
      else if (g.hexDesig[q]) this.issue({ type: 'dig', q, on: false }, phase !== 'start');
    }
  }

  private click(p: PointerInfo): void {
    const w = this.world;
    const c = this.player;
    if (this.tool === 'arena') {
      // battle arena: the chosen unit, for the chosen team, where you click (the tool stays on for more)
      const sp = this.view.space === 'surface' ? this.view.pickSurface(p.x, p.y) : null;
      if (sp) this.issue({ type: 'arenaSpawn', team: this.arenaTeam, unit: this.arenaUnit, n: this.arenaCount, level: this.arenaLevel, at: true, x: sp.x, y: sp.z });
      return;
    }
    if (this.tool === 'spawn') {
      // sandbox: put the chosen creature where you click (it stays selected for more)
      if (this.view.space === 'nest') {
        const np = this.view.pickNest(p.x, p.y);
        if (np) this.issue({ type: 'sandboxSpawn', kind: this.spawnKind, space: this.viewedArea, x: np.x, y: np.y });
      } else {
        const sp = this.view.pickSurface(p.x, p.y);
        if (sp) this.issue({ type: 'sandboxSpawn', kind: this.spawnKind, space: SURFACE, x: sp.x, y: sp.z });
      }
      return;
    }
    if (this.tool === 'marker' && this.markerSel >= 0) {
      if (this.view.space === 'nest') {
        // Markers go anywhere in an open area: your nest, or one your ants have entered.
        const np = this.view.pickNest(p.x, p.y);
        const g = w.nestOf(this.viewedArea)!;
        if (np && g.isAirAt(np.x, np.y)) this.issue({ type: 'placeMarker', i: this.markerSel, space: this.viewedArea, x: np.x, y: np.y });
        else if (np) this.onEvent?.({ t: 'message', text: 'Markers underground go on dug floor.', kind: 'warn' });
      } else {
        const sp = this.view.pickSurface(p.x, p.y);
        if (sp) {
          this.issue({ type: 'placeMarker', i: this.markerSel, space: SURFACE, x: sp.x, y: sp.z });
          const ent = entranceAt(w, c, sp.x, sp.z); // where it snaps (the command does the same)
          if (ent) {
            const tab = this.areaTab(ent.space);
            this.onEvent?.({ t: 'message', text: `Marker ${['I', 'II', 'III', 'IV', 'V'][this.markerSel]} placed on the entrance: its groups will go down into ${tab ? `area ${tab.number} (${tab.name})` : 'that area'}.`, kind: 'info' });
          }
        }
      }
      this.setTool('none');
      return;
    }
    if (this.tool !== 'none') return;
    // Click an ant to inspect it; otherwise select the tile under the cursor (own nest).
    const hit = this.infoOn ? this.pickAnt(p.x, p.y) : null;
    this.inspect = hit;
    if (this.view.space === 'nest' && !hit && this.viewingOwnNest) {
      const q = this.hexUnder(p);
      this.selectedTile = q >= 0 && tileAt(c, q) ? q : -1;
    }
  }

  /** The space the camera shows: the surface, or the viewed underground area. */
  activeSpace(): number {
    return this.view.space === 'nest' ? this.viewedArea : SURFACE;
  }

  /** Nearest ant or creature under the cursor in the active space. */
  pickAnt(clientX: number, clientY: number): Inspect | null {
    const w = this.world;
    let px: number;
    let py: number;
    if (this.view.space === 'nest') {
      const np = this.view.pickNest(clientX, clientY);
      if (!np) return null;
      px = np.x;
      py = np.y;
    } else {
      const sp = this.view.pickSurface(clientX, clientY);
      if (!sp) return null;
      px = sp.x;
      py = sp.z;
    }
    const space = this.activeSpace();
    let best: Inspect | null = null;
    let bd = Infinity;
    for (const a of w.s.ants) {
      if (a.space !== space || a.state === AS.Dead) continue;
      const L = CASTES[a.caste].length;
      const d = Math.hypot(a.x - px, a.y - py);
      if (d < Math.max(3, L * 0.9) && d < bd) {
        bd = d;
        best = { kind: 'ant', id: a.id };
      }
    }
    for (const cr of w.s.creatures) {
      if (cr.space !== space || cr.dead) continue;
      const d = Math.hypot(cr.x - px, cr.y - py);
      if (d < cr.scale * 0.6 && d < bd) {
        bd = d;
        best = { kind: 'creature', id: cr.id };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ camera helpers
  /** Move the camera to a point on the surface or in an area (switching maps if needed). */
  jumpTo(space: 'surface' | 'nest', x: number, z: number, area = this.viewedArea): void {
    const v = this.view;
    if (space === 'nest' && area !== this.viewedArea) {
      if (!this.areaTab(area)?.open) {
        this.showArea(area); // explains why not
        return;
      }
      this.viewedArea = area;
      if (v.space === 'nest') {
        v.fadeCut(() => {
          v.setActiveNest(area, { x, z });
          v.nestRig.goal.x = x;
          v.nestRig.goal.z = z;
        });
        return;
      }
    }
    if (space !== v.space) this.toggleView();
    const r = space === 'surface' ? v.surfaceRig : v.nestRig;
    r.goal.x = x;
    r.goal.z = z;
  }

  /** Jump the camera to a placed marker (Space), switching maps if it is in another area. */
  jumpToMarker(i: number): void {
    const m = this.player.markers[i];
    if (!m.placed) return;
    if (m.space === SURFACE) this.jumpTo('surface', m.x, m.y);
    else this.jumpTo('nest', m.x, m.y, m.space);
  }

  /** Close-up observe camera following one ant (Esc to stop). */
  follow(id: number): void {
    const a = this.world.antById.get(id);
    if (!a) return;
    this.followId = id;
    const p = this.antWorldPos(a, new THREE.Vector3());
    this.view.observeRig.reset(p, CASTES[a.caste].length, false);
    this.view.observing = true;
  }

  unfollow(): void {
    this.followId = 0;
    this.view.observing = false;
  }

  private antWorldPos(a: { x: number; y: number; space: number }, out: THREE.Vector3): THREE.Vector3 {
    if (a.space === SURFACE) this.surfAdapter.toWorld(a.x, a.y, out);
    else {
      const nv = this.nests.get(a.space);
      if (nv) nv.adapter.toWorld(a.x, a.y, out);
    }
    return out;
  }

  private updateFollow(): void {
    if (!this.followId) return;
    const a = this.world.antById.get(this.followId);
    if (!a || a.state === AS.Dead) {
      this.unfollow();
      return;
    }
    // Follow across spaces: the camera cuts when the ant goes in or out of a nest.
    if (a.space === SURFACE) {
      if (this.view.space !== 'surface') this.view.space = 'surface';
    } else {
      if (!this.nests.has(a.space)) {
        this.unfollow();
        return;
      }
      if (this.viewedArea !== a.space) {
        this.viewedArea = a.space;
        this.view.setActiveNest(a.space);
      }
      if (this.view.space !== 'nest') this.view.space = 'nest';
    }
    this.view.observing = true;
    this.antWorldPos(a, this.view.observeRig.subject);
    this.view.observeRig.subject.y += CASTES[a.caste].length * 0.25;
    this.view.observeRig.heading = -a.h + Math.PI / 2;
  }

  /** Free-play goals shown in the Missions panel (scripted missions replace these). */
  /** sandbox: the creature the spawn tool places */
  spawnKind = 'wolfSpider';

  get sandbox(): boolean {
    return !!this.world.s.mode.sandbox;
  }

  /** Battle arena (sim/arena.ts): the team, unit, count and level the roster and the place tool use. Client-side only. */
  get arena(): boolean {
    return !!this.world.s.mode.arena;
  }
  arenaTeam = 0;
  arenaUnit = 'ant:lasius_soldier';
  arenaCount = 10;
  arenaLevel = 1;

  /** Battle arena, Place tool: what a click puts down (the cursor tip). */
  arenaPlaceInfo(): string {
    const u = this.arenaUnit;
    const name = u.startsWith('cr:') ? (CREATURES[u.slice(3)]?.name ?? u) : (CASTES[canonCaste(u.slice(4))]?.name ?? u);
    return `Click to place ${this.arenaCount} × ${name}${this.arenaLevel > 1 ? ` (level ${['I', 'II', 'III'][this.arenaLevel - 1]})` : ''} for ${TEAM_NAMES[this.arenaTeam]}`;
  }

  /** Battle arena: spawn the chosen unit for the chosen team round its spawn point. */
  arenaSpawnAtTeam(unit = this.arenaUnit): void {
    this.arenaUnit = unit;
    this.issue({ type: 'arenaSpawn', team: this.arenaTeam, unit, n: this.arenaCount, level: this.arenaLevel, at: false, x: 0, y: 0 });
  }

  missionInfo(): { title: string; brief: string; stage?: string; goals: Array<{ text: string; done: boolean; progress: string }> } {
    const c = this.player;
    const m = missionOf(this.world);
    if (m) {
      const def = MISSIONS[m.id];
      const st = def.stages[m.stage];
      const stage = m.result === 'won' ? 'Complete' : m.result === 'lost' ? 'Failed' : st ? `Stage ${m.stage + 1} of ${def.stages.length}: ${st.name}` : '';
      return { title: def.title, brief: def.brief, stage, goals: m.goals };
    }
    const A = arenaOf(this.world);
    if (A) {
      return {
        title: 'Battle Arena',
        brief: 'Pick a team, pick ants or creatures from the roster and drop them in — round the team\'s corner, or where you click with Place. Teams charge the nearest enemy, hold their ground, or stand passive (a dummy to climb). The last team standing wins the round; Clear all starts a new one.',
        goals: A.teams.map((T, i) => ({ text: `${TEAM_NAMES[i]}: ${T.alive} unit${T.alive === 1 ? '' : 's'} standing`, done: A.winner === i, progress: `${T.lost} lost` })),
      };
    }
    const rivals = this.world.s.colonies.filter((o) => o.team !== c.team);
    if (rivals.length && !this.sandbox) {
      const down = rivals.filter((o) => !o.alive).length;
      return {
        title: 'Skirmish',
        brief: 'Destroy every rival colony. Your team wins when the last rival queen falls, and loses with your queen.',
        goals: [
          { text: 'Destroy the rival colonies', done: down === rivals.length, progress: `${down}/${rivals.length}` },
          { text: 'Keep your queen alive', done: c.alive, progress: c.alive ? 'alive' : 'lost' },
        ],
      };
    }
    const g = this.world.nest(c.id)!;
    const groups = c.groups.filter((x) => x.type === 'brood').length;
    return {
      title: 'Free Play',
      brief: `Found a ${SPECIES[c.species].common.toLowerCase()} colony and grow it. Dig out the nest, lay out brood tiles, keep the stores full and send your groups out with the markers.`,
      goals: [
        { text: 'Raise 30 ants', done: c.living >= 30, progress: `${c.living}/30` },
        { text: 'Dig out 40 hexes of nest', done: g.dugHexCount() >= 40, progress: `${g.dugHexCount()}/40` },
        { text: 'Gather 500 food', done: c.stats.food >= 500, progress: `${Math.floor(c.stats.food)}/500` },
        { text: 'Build 4 brood groups', done: groups >= 4, progress: `${groups}/4` },
        { text: 'Open a second entrance', done: c.entrances.length >= 2, progress: `${c.entrances.length}/2` },
      ],
    };
  }

  toggleAggression(): void {
    const on = !this.shownAggression();
    this.issue({ type: 'setAggression', on });
    this.onEvent?.({ t: 'message', text: on ? 'Ants will attack any enemy they find.' : 'Ants will only defend themselves and the nest.', kind: 'info' });
  }

  // ---------------------------------------------------------------- commands and pending feedback

  /** Issue a player command (the only way the UI changes the simulation). */
  issue(body: CommandBody, silent = false): Command {
    if (this.replay) {
      if (!silent) this.onEvent?.({ t: 'message', text: 'Watching a replay: orders are off.', kind: 'info' });
      return { ...body, tick: 0, player: this.player.id, seq: 0 } as Command;
    }
    return this.commands.issue(body, { silent });
  }

  // ---------------------------------------------------------------- replays

  /** The replay of this game so far (null when it cannot be replayed). */
  async saveReplay(build: string): Promise<Uint8Array | null> {
    if ((!this.setup && !this.startSnapshot) || !this.replayable || this.replay) return null;
    const log = await this.sim.commandLog();
    const h = await this.sim.hash();
    const names = this.net ? this.net.slots.map((s) => s.name) : undefined;
    return encodeReplay({ build, setup: this.setup ?? undefined, local: this.player.id, names, ticks: h.tick, finalHash: h.hash, date: new Date().toISOString() }, log, this.startSnapshot ?? undefined);
  }

  /** What a save of this game is called and shows in the list. */
  saveHeader(build: string): SaveHeader {
    const w = this.world;
    const m = missionOf(w);
    const c = this.player;
    const mode: SaveHeader['mode'] = m ? 'mission' : this.sandbox ? 'sandbox' : this.arena ? 'arena' : w.s.colonies.some((o) => o.team !== c.team) ? 'skirmish' : 'game';
    const title = m ? MISSIONS[m.id].title : mode === 'sandbox' ? 'Sandbox' : mode === 'arena' ? 'Battle Arena' : mode === 'skirmish' ? 'Skirmish' : 'Free play';
    const map = w.terrain.map?.name;
    return { build, title, mode, mission: m?.id, ...(map ? { map } : {}), local: c.id, species: c.species, colonyName: c.name, ants: c.living, time: w.s.time, tick: w.s.tick, date: new Date().toISOString() };
  }

  /** Single-player games can be saved (a match brings players back from the host instead). */
  get canSave(): boolean {
    return !this.net && !this.replay;
  }

  /** The save file of this moment: header plus the canonical snapshot. */
  async saveBytes(build = this.build): Promise<Uint8Array | null> {
    if (!this.canSave) return null;
    const snap = await this.sim.snapshot();
    return encodeSave(this.saveHeader(build), snap);
  }

  /** Save into a slot of this browser's store. */
  async saveGame(slot: SaveSlot, build = this.build): Promise<SaveRecord | null> {
    if (this.saving) return null;
    this.saving = true;
    try {
      const bytes = await this.saveBytes(build);
      return bytes ? await putSave(slot, bytes) : null;
    } finally {
      this.saving = false;
    }
  }

  /** Autosave every 5 minutes of game time (single-player, not while the game is over). */
  private autosave(): void {
    const w = this.world;
    if (!this.canSave || !this.player.alive) return;
    if (this.nextAutosave === 0) this.nextAutosave = w.s.time + 300;
    if (w.s.time < this.nextAutosave) return;
    this.nextAutosave = w.s.time + 300;
    void this.saveGame('auto');
  }

  /** Watch a recorded game: its commands drive the simulation; the player's own orders are off. */
  playReplay(commands: Command[], ticks: number, finalHash: string): void {
    this.replay = { byTick: commandsByTick(commands), next: this.world.s.tick + 1, end: ticks, finalHash, done: false };
  }

  private replayTick(): boolean {
    const r = this.replay!;
    if (r.next > r.end) {
      if (!r.done) {
        r.done = true;
        // commands applied at the boundary after the last tick (single-player applies them at once)
        this.sim.applyNow(r.byTick.get(r.end + 1) ?? []);
        void this.sim.hash().then((h) => {
          const same = h.tick === r.end && h.hash === r.finalHash;
          this.onEvent?.({ t: 'message', text: same ? `Replay finished at tick ${r.end}: identical to the recorded game.` : `Replay finished, but the state differs from the recording (tick ${h.tick}).`, kind: same ? 'good' : 'warn' });
          this.onReplayEnd?.(same);
        });
      }
      return false;
    }
    this.sim.stepWith(r.byTick.get(r.next) ?? []);
    r.next++;
    return true;
  }

  get watchingReplay(): boolean {
    return !!this.replay;
  }

  /** Recall every group (marker panel and the R key). */
  recall(): void {
    this.issue({ type: 'recall' });
  }

  /** Concede a multiplayer match (the queen dies; the others play on, or the last one standing wins). */
  surrender(): void {
    if (this.net && this.player.alive) this.issue({ type: 'surrender' });
  }

  /** The colony ability; the reason it can't fire yet, if any (checked now, applied by the command). */
  useAbility(): string | null {
    const c = this.player;
    if ((c.abilityCd ?? 0) > 0) return `${abilityOf(c).name} is ready in ${Math.ceil(c.abilityCd)} s`;
    this.issue({ type: 'useAbility' });
    return null;
  }

  assignGroup(group: number, marker: number): void {
    this.issue({ type: 'assignGroup', group, marker });
  }

  /** Stance as the player last set it (a pending change shows at once). */
  shownAggression(): boolean {
    let on = this.player.aggressive;
    for (const c of this.commands.pending()) if (c.type === 'setAggression') on = c.on;
    return on;
  }

  /** The column a group card shows in: its pending assignment, else its current one. */
  shownGroupMarker(groupId: number, current: number): number {
    let m = current;
    for (const c of this.commands.pending()) {
      if (c.type === 'assignGroup' && c.group === groupId) m = c.marker;
      else if (c.type === 'recall') m = -1;
    }
    return m;
  }

  /** Is this group's move still waiting for its tick? */
  groupPending(groupId: number): boolean {
    return this.commands.pending().some((c) => (c.type === 'assignGroup' && c.group === groupId) || c.type === 'recall');
  }

  /** A tile placement still waiting for its tick on this hex. */
  pendingTileAt(q: number): boolean {
    return this.commands.pending().some((c) => c.type === 'buildTile' && c.q === q);
  }

  /** Markers as the player sees them: pending placements and removals already applied, flagged for the shimmer. */
  shownMarkers(): Array<{ placed: boolean; space: number; x: number; y: number; pending: boolean }> {
    const w = this.world;
    const c = this.player;
    if (this.arena) return []; // the arena moves the teams' markers itself
    const out = c.markers.map((m) => ({ placed: m.placed, space: m.space, x: m.x, y: m.y, pending: false }));
    for (const cmd of this.commands.pending()) {
      if (cmd.type === 'placeMarker' && out[cmd.i]) {
        let { space, x, y } = cmd;
        if (space === SURFACE) {
          const ent = entranceAt(w, c, x, y);
          if (ent) ({ space, x, y } = ent);
        }
        out[cmd.i] = { placed: true, space, x, y, pending: true };
      } else if (cmd.type === 'removeMarker' && out[cmd.i]) out[cmd.i] = { ...out[cmd.i], placed: false, pending: true };
    }
    return out;
  }

  /** Hexes with a command still waiting (ghost rings in the nest view). */
  pendingHexes(): Array<{ q: number; kind: 'dig' | 'undig' | 'build' | 'upgrade' | 'delete' }> {
    const out: Array<{ q: number; kind: 'dig' | 'undig' | 'build' | 'upgrade' | 'delete' }> = [];
    for (const c of this.commands.pending()) {
      if (c.type === 'dig') out.push({ q: c.q, kind: c.on ? 'dig' : 'undig' });
      else if (c.type === 'buildTile') out.push({ q: c.q, kind: 'build' });
      else if (c.type === 'markUpgrade') out.push({ q: c.q, kind: 'upgrade' });
      else if (c.type === 'markDelete') out.push({ q: c.q, kind: 'delete' });
    }
    return out;
  }

  private rightClick(p: PointerInfo): void {
    const w = this.world;
    const c = this.player;
    if (this.tool !== 'none') {
      this.setTool('none');
      return;
    }
    // Right-click a placed marker's spot removes it.
    const sp = this.view.space === 'surface' ? this.view.pickSurface(p.x, p.y) : null;
    const np = this.view.space === 'nest' ? this.view.pickNest(p.x, p.y) : null;
    if (!sp && !np) return;
    const space = this.activeSpace();
    const x = sp ? sp.x : np!.x;
    const y = sp ? sp.z : np!.y;
    const reach = space === SURFACE ? 14 : w.nestOf(this.viewedArea)!.R * 1.5;
    this.shownMarkers().forEach((m, i) => {
      if (m.placed && m.space === space && Math.hypot(m.x - x, m.y - y) < reach) this.issue({ type: 'removeMarker', i });
    });
    void c;
    this.selectedTile = -1;
  }

  /** Screen positions (CSS px) of the visible markers' label anchors, null when off-screen/hidden. */
  markerScreenPositions(): Array<{ x: number; y: number } | null> {
    const wm = this.view.space === 'nest' ? this.nests.get(this.viewedArea)?.markers : this.surfMarkers;
    if (!wm) return [null, null, null, null, null];
    const cam = this.view.activeCamera();
    const v = new THREE.Vector3();
    return wm.anchors.map((a) => {
      if (!a) return null;
      v.copy(a).project(cam);
      if (v.z > 1 || v.z < -1) return null;
      return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
    });
  }

  /**
   * Small health bars over climbable creatures (CHANGE_PLAN §15.2) that are
   * hurt or have ants on them, in the space being viewed: screen position,
   * health fraction, riders, and the room they take of the room on its back
   * (riders take room by size class). Bosses use the boss bar.
   */
  creatureBars(): Array<{ id: number; x: number; y: number; hp: number; riders: number; used: number; cap: number }> {
    const out: Array<{ id: number; x: number; y: number; hp: number; riders: number; used: number; cap: number }> = [];
    if (this.view.transitioning) return out;
    const w = this.world;
    const space = this.activeSpace();
    const cam = this.view.activeCamera();
    const nt = this.view.space === 'nest' ? this.view.nestTerrain : null;
    const v = this.barTmp;
    for (const cr of w.s.creatures) {
      if (cr.dead || cr.space !== space || CREATURES[cr.kind]?.boss) continue;
      const cap = climbRoom(cr);
      if (cap <= 0) continue;
      const riders = cr.climbers ?? 0;
      if (riders === 0 && cr.hp >= cr.maxHp - 1e-6) continue;
      const gy = space === SURFACE ? this.surfHeight(cr.x, cr.y) : nt ? nt.heightAt(cr.x, cr.y) : 0;
      v.set(cr.x, gy + cr.scale * 0.55, cr.y).project(cam);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
      out.push({ id: cr.id, x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, hp: Math.max(0, cr.hp / Math.max(1, cr.maxHp)), riders, used: cr.climbUnits ?? 0, cap });
      if (out.length >= 24) break;
    }
    return out;
  }
  private barTmp = new THREE.Vector3();

  /** Screen position of a point in the viewed nest (null when off-screen or not in the nest view). */
  nestToScreen(x: number, y: number): { x: number; y: number } | null {
    if (this.view.space !== 'nest' || this.view.transitioning) return null;
    const nt = this.view.nestTerrain;
    if (!nt) return null;
    const v = new THREE.Vector3(x, nt.heightAt(x, y), y).project(this.view.activeCamera());
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  /**
   * Labels for the tile info overlay (level pips, upgrade points have/need)
   * and, with the Upgrade tool, the points each neighbour of the hovered tile gives.
   */
  tileLabels(): Array<{ x: number; y: number; html: string; kind: 'tile' | 'pts' }> {
    const out: Array<{ x: number; y: number; html: string; kind: 'tile' | 'pts' }> = [];
    if (this.view.space !== 'nest' || !this.viewingOwnNest) return out;
    const c = this.player;
    const g = this.world.nest(c.id)!;
    const ctr = { x: 0, y: 0 };
    if (this.tileOverlay) {
      for (const t of c.tiles) {
        g.hexCenter(t.q, ctr);
        const p = this.nestToScreen(ctr.x, ctr.y - g.R * 0.45);
        if (!p) continue;
        const pips = '●'.repeat(t.level) + '○'.repeat(3 - t.level);
        const pts = t.built && t.type !== 'queen' && t.level < 3 ? ` <span class="tl-pts">${upgradePoints(this.world, c, t)}/${upgradeNeed(t)}</span>` : '';
        out.push({ x: p.x, y: p.y, html: `<span class="tl-pips">${pips}</span>${pts}${t.built ? '' : ' <span class="tl-plan">planned</span>'}`, kind: 'tile' });
        if (out.length > 300) break;
      }
    }
    if (this.tool === 'upgrade') {
      for (const n of this.hoverNeighbours) {
        if (n.q < 0) continue;
        g.hexCenter(n.q, ctr);
        const p = this.nestToScreen(ctr.x, ctr.y);
        if (p) out.push({ x: p.x, y: p.y, html: n.pts > 0 ? `+${n.pts}` : '0', kind: 'pts' });
      }
    }
    return out;
  }

  /** Mark the selected tile for upgrade; returns why it can't be (checked now; the command re-checks). */
  upgradeSelected(): string | null {
    if (this.selectedTile < 0) return 'Select a tile first';
    const t = tileAt(this.player, this.selectedTile);
    if (!t) return 'No tile here';
    const why = t.pend === 1 ? null : canUpgrade(this.world, this.player, t);
    if (why) return why;
    this.issue({ type: 'markUpgrade', q: this.selectedTile });
    return null;
  }

  removeSelected(): boolean {
    if (this.selectedTile < 0) return false;
    const t = tileAt(this.player, this.selectedTile);
    if (!t || t.type === 'queen') return false;
    this.issue({ type: 'markDelete', q: this.selectedTile });
    this.selectedTile = -1;
    return true;
  }

  /** A few times a second: what the entrance under the cursor on the surface is (owner, area, state, crowd). */
  private updateEntranceTip(): void {
    if (this.frameNo % 6 !== 0) return;
    this.entranceTip = '';
    if (this.view.space !== 'surface' || this.view.observing || (this.tool !== 'none' && this.tool !== 'marker')) return;
    const sp = this.view.pickSurface(this.input.mouseX, this.input.mouseY);
    if (!sp) return;
    const w = this.world;
    for (const tab of this.areaTabs()) {
      const ents = w.entrancesOf(tab.space);
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (Math.hypot(e.sx - sp.x, e.sy - sp.z) > 5) continue;
        const state = e.fall ? 'caving in' : e.work ? (e.shut ? 'being opened' : 'being plugged') : e.shut ? 'closed' : 'open';
        let crowd = 0;
        for (const a of w.s.ants) if (a.space === SURFACE && a.state !== AS.Dead && Math.abs(a.x - e.sx) < 6 && Math.abs(a.y - e.sy) < 6) crowd++;
        const kind = tab.owner >= 0 ? (i === 0 ? 'main entrance' : 'extra entrance') : 'entrance';
        // hell ants are extinct: nothing survives of their nests, so their entrance is a reconstruction
        const recon = tab.owner >= 0 && w.colony(tab.owner)?.species === 'hell' ? ' (reconstruction)' : '';
        this.entranceTip = `Area ${tab.number} · ${tab.name} · ${kind}${recon} · ${state}${crowd ? ` · ${crowd} ant${crowd > 1 ? 's' : ''} at the hole` : ''}`;
        return;
      }
    }
  }

  private updateHover(): void {
    this.updateEntranceTip();
    const nt = this.view.nestTerrain;
    if (!nt) return;
    const u = nt.uniforms;
    u.uGhost.value.w = 0;
    u.uGrid.value = (this.gridOn || this.tool === 'tile') && this.viewingOwnNest ? 1 : 0;
    this.hoverMsg = '';
    this.ghostInfo = '';
    this.hoverHex = -1;
    if (!this.viewingOwnNest) {
      u.uSelected.value.z = 0;
      return;
    }
    const g = this.world.nest(this.player.id)!;
    if (this.selectedTile >= 0 && tileAt(this.player, this.selectedTile)) {
      const sc = g.hexCenter(this.selectedTile);
      u.uSelected.value.set(sc.x, sc.y, 1);
    } else u.uSelected.value.z = 0;
    this.hoverNeighbours = [];
    if (this.view.space !== 'nest' || (this.tool !== 'tile' && this.tool !== 'dig' && this.tool !== 'remove' && this.tool !== 'upgrade')) return;
    const q = this.hexUnder({ x: this.input.mouseX, y: this.input.mouseY });
    if (q < 0) return;
    const c = this.player;
    const ctr = g.hexCenter(q);
    this.hoverHex = q;
    let ok = true;
    if (this.tool === 'dig') {
      ok = g.isHexDiggable(q);
      const sp = g.spotIndex(q);
      const ti = g.tunnelIndex(q);
      const e = ti > 0 ? c.entrances[ti] : undefined;
      if (e) {
        ok = !!e.shut && !e.fall;
        this.ghostInfo = e.fall ? 'This entrance has caved in' : e.work ? 'Being worked on…' : e.shut ? 'Open this entrance again (workers dig the plug out)' : 'An open entrance';
      } else if (ok && sp >= 0) {
        const why = spotBlocked(this.world, c, sp);
        ok = !why || !!g.hexDesig[q];
        this.ghostInfo = g.hexDesig[q] ? 'Entrance dig marked · click again to cancel' : why ?? 'Extra entrance spot: dig it out to open a new entrance to the surface (entrance dig, up to 7 workers)';
      } else if (ok) this.ghostInfo = g.hexDesig[q] ? 'Marked for digging · click again to cancel' : 'Mark for digging · workers excavate it (6 points)';
    } else if (this.tool === 'upgrade') {
      const t = tileAt(c, q);
      ok = !!t && t.built && !canUpgrade(this.world, c, t);
      if (t && t.built) {
        this.hoverNeighbours = neighbourPoints(this.world, c, t);
        const pts = upgradePoints(this.world, c, t);
        const need = upgradeNeed(t);
        const why = canUpgrade(this.world, c, t);
        this.ghostInfo = t.pend === 1 ? 'Upgrade marked · click again to cancel' : why ? `${why}${need < Infinity ? ` (points ${pts}/${need})` : ''}` : `Upgrade to level ${t.level + 1} · ${tileCost(c, t.type, t.caste)} food · points ${pts}/${need}`;
      } else this.hoverMsg = t ? 'Build this tile first' : `${CLICK} a tile to upgrade it`;
    } else if (this.tool === 'remove') {
      const t = tileAt(c, q);
      const ti = g.tunnelIndex(q);
      const e = ti > 0 ? c.entrances[ti] : undefined;
      ok = (!!t && t.type !== 'queen') || !!g.hexDesig[q] || (!!e && !e.shut && !e.fall);
      if (ti === 0) this.ghostInfo = 'The main entrance cannot be closed';
      else if (e) this.ghostInfo = e.fall ? 'This entrance has caved in' : e.work ? 'Being worked on…' : e.shut ? 'Closed · use Dig to open it again' : `Close this entrance: workers plug it with soil (${ENTRANCE.closeS} s)`;
      if (t && t.type !== 'queen') {
        const refund = Math.round(tileCost(c, t.type, t.caste) * BALANCE.refund);
        this.ghostInfo = !t.built ? 'Cancel this planned tile' : t.pend === 2 ? 'Marked for deletion · click again to cancel' : t.level > 1 ? `Downgrade to level ${t.level - 1} · refund ${refund} food as seeds` : `Remove tile · refund ${refund} food as seeds${t.type === 'brood' ? ' · its ant dies' : ''}`;
      } else if (g.hexDesig[q]) this.ghostInfo = 'Cancel digging here';
    } else {
      const caste = this.buildCaste || undefined;
      const why = canPlaceTile(this.world, c, this.buildType, q, caste);
      ok = !why;
      this.hoverMsg = why ?? '';
      const name = this.buildType === 'brood' && caste ? `${CASTES[caste].name} brood tile` : TILE_INFO[this.buildType].name;
      const join = ok ? groupWouldJoin(this.world, c, this.buildType, q, caste) : null;
      const ex = tileAt(c, q);
      if (ex && !ex.built) {
        ok = true;
        this.hoverMsg = '';
        this.ghostInfo = 'Planned tile · click again to cancel';
      } else this.ghostInfo = ok ? `${name} · ${tileCost(c, this.buildType, caste)} food when built${this.buildType === 'brood' && caste ? ` · hatch ${hatchCost(caste)}` : ''} · ${join ? 'joins a chamber' : 'starts a new chamber'}` : '';
    }
    u.uGhost.value.set(ctr.x, ctr.y, ok ? 1 : 2, 1);
    u.uGhostCol.value.set(ok ? 0x7cdc6a : 0xe0503a);
  }

  /** Tab alerts: the home nest invaded or the queen hurt; your ants fighting or dying in an area. */
  private noteAlert(e: SimEvent): void {
    const w = this.world;
    if (e.t === 'invasion' && e.colony === this.player.id) this.alert(nestSpace(this.player.id));
    else if (e.t === 'death' && e.kind === 'ant' && e.colony === this.player.id && e.space !== SURFACE) this.alert(e.space);
    else if (e.t === 'bite' && e.space !== SURFACE && w.s.tick % 4 === 0) {
      // a fight near one of your ants in an area
      let mine = false;
      w.antsNear(e.space, e.x, e.y, 6, (a) => {
        if (a.colony === this.player.id && (a.state === AS.Attack || a.state === AS.Grapple)) mine = true;
        return mine;
      });
      if (mine) this.alert(e.space);
    }
    const q = w.antById.get(this.player.queen);
    if (q && q.hp < q.maxHp * 0.5 && q.state !== AS.Dead && w.s.tick % 20 === 0) this.alert(q.space);
  }

  /** Combat effects go to the scene of the space they happened in. */
  private routeFx(e: SimEvent): void {
    if (!('space' in e) || typeof e.space !== 'number') return;
    if (e.space === SURFACE) this.surfFx.emit(e, this.surfHeight);
    else {
      const nv = this.nests.get(e.space);
      if (nv) nv.fx.emit(e, (x, y) => nv.stage.terrain.heightAt(x, y));
    }
  }

  private frame(alpha: number, realDt: number, simDt = realDt): void {
    const w = this.world;
    const v = this.view;
    this.frameNo++;
    this.netFrame();
    this.events.drain();
    if (this.frameNo % 30 === 0) this.autosave();
    this.updateFollow();
    // The access rule holds while you watch: when your last ant leaves an area, the view returns home.
    if (v.space === 'nest' && !v.transitioning && this.frameNo % 15 === 0 && !this.areaTab(this.viewedArea)?.open) {
      const tab = this.areaTab(this.viewedArea);
      this.onEvent?.({ t: 'message', text: `${tab ? tab.name : 'That area'}: your last ant has left. Back to your nest.`, kind: 'info' });
      this.showArea(nestSpace(this.player.id));
    }
    if (v.space === 'nest' && !v.transitioning && v.activeNest !== this.viewedArea) v.setActiveNest(this.viewedArea);
    this.updateHover();
    const cam = v.activeCamera();
    const vh = window.innerHeight * v.renderer.getPixelRatio();
    const sel = this.tool === 'marker' ? this.markerSel : -1;
    const shown = this.shownMarkers();
    if (v.space === 'nest') {
      const nv = this.nests.get(v.activeNest);
      const owner = w.colony(colonyOfSpace(v.activeNest)) ?? null;
      if (nv) nv.overlay = this.tileOverlay;
      if (nv) nv.update(w, owner, this.player, cam, alpha, realDt, vh, v.observing ? v.observeRig.distance * 3 : v.nestRig.distance, sel, v.time, shown, this.pendingHexes());
      if (nv) nv.hit.update(w, v.activeNest, this.hitboxes, (x, y) => nv.stage.terrain.heightAt(x, y), v.nestRig.goal.x, v.nestRig.goal.z, v.nestRig.distance * 2);
    } else {
      const views = this.views;
      let n = 0;
      const take = () => {
        if (n >= views.length) views.push(blankView());
        return views[n++];
      };
      for (const a of w.s.ants) {
        if (a.space !== SURFACE) continue;
        if (a.state === AS.Dead && a.deadT > 30) continue;
        antToView(w, a, take(), 0, 0);
      }
      for (const f of w.s.food) if (f.space === SURFACE && f.kind === 'corpse' && f.from.includes('_')) corpseToView(f, take(), 0, f.from);
      const list = n === views.length ? views : views.slice(0, n);
      const t = w.terrain;
      this.mounds.update(w, this.terrainHeight);
      this.view.storm = stormLevel(w.s.flood);
      this.surfMarkers.update(shown, SURFACE, this.surfHeight, v.observing ? v.observeRig.distance * 3 : v.surfaceRig.distance, (i) => markerRadius(w, this.player, i), sel, v.time);
      // creatures first: climbing ants are placed on their animated legs and backs
      this.surfCreatures.update(w.s.creatures, SURFACE, alpha, realDt, this.surfHeight, cam, vh);
      this.surfHit.update(w, SURFACE, this.hitboxes, this.surfHeight, v.surfaceRig.goal.x, v.surfaceRig.goal.z, v.surfaceRig.distance * 2);
      this.surfAnts.mount = (av, a, out) => {
        const cr = w.creatureById.get(av.rideCr ?? 0);
        return !!cr && this.surfCreatures.mountPose(cr, av, a, out);
      };
      this.surfAnts.update(list, alpha, realDt, cam, this.surfAdapter, vh);
      this.teamRings.update(w, alpha, this.surfHeight);
      this.surfFood.update(w, SURFACE, alpha, this.surfMap);
      this.surfDecor.update(w, this.foodView, (f) => edible(this.player, f));
      if (this.sim.kind === 'worker') {
        const o = this.sim.takeOverlay();
        if (o && this.pheroOn) {
          this.pheroData.set(o);
          this.pheroTex.needsUpdate = true;
        }
      } else if (this.pheroOn && w.phero.version !== this.pheroVer) {
        this.pheroVer = w.phero.version;
        w.phero.pack(this.player.id, this.pheroData);
        this.pheroTex.needsUpdate = true;
      }
    }
    // Saiy-Ants running in the gold surge leave speed lines (close to the camera only, capped)
    if (simDt > 0) {
      this.trailT += simDt;
      if (this.trailT >= BALANCE.surge.trailEvery) {
        this.trailT = 0;
        const space = v.space === 'nest' ? v.activeNest : SURFACE;
        const nv = space === SURFACE ? null : this.nests.get(space);
        const rig = v.space === 'nest' ? v.nestRig : v.surfaceRig;
        const fx = nv ? nv.fx : this.surfFx;
        const hAt = nv ? (x: number, y: number) => nv.stage.terrain.heightAt(x, y) : this.surfHeight;
        if (rig.distance < BALANCE.surge.trailMaxDist) {
          let k = 0;
          const r2 = (rig.distance * 1.5) ** 2;
          for (const a of w.s.ants) {
            if (a.space !== space || !(a.surgeT && a.surgeT > 0) || a.v < 3) continue;
            if ((a.x - rig.goal.x) ** 2 + (a.y - rig.goal.z) ** 2 > r2) continue;
            fx.goldStreak(a.x, a.y, a.h, CASTES[a.caste].length, hAt);
            if (++k >= BALANCE.surge.trailCap) break;
          }
        }
      }
    }
    // effects run on game time (frozen while paused)
    const px = (vh * 0.5) / Math.tan(THREE.MathUtils.degToRad((cam as THREE.PerspectiveCamera).fov) * 0.5);
    this.surfFx.update(simDt, this.surfHeight, px);
    for (const nv of this.nests.values()) nv.fx.update(simDt, (x, y) => nv.stage.terrain.heightAt(x, y), px);
    v.frame(realDt);
    this.autoQuality.update(v, realDt);
    this.onFrame?.();
  }
}

/** How stormy the sky looks (0..1) from the floods' phases: building through the warning, full while the water is up, clearing as it drains. */
function stormLevel(fl: readonly FloodState[] | undefined): number {
  let k = 0;
  for (const f of fl ?? []) {
    if (f.phase === 1) k = Math.max(k, 0.25 + 0.75 * (1 - f.t / FLOOD.warnS));
    else if (f.phase === 2 || f.phase === 3) k = 1;
    else if (f.phase === 4) k = Math.max(k, Math.min(1, f.t / FLOOD.drainS));
  }
  return k;
}
