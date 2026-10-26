import './ui/style.css';

import { runAntLab } from './dev/antLab';
import { runSwarmTest } from './dev/swarmTest';
import { runCreatureLab } from './dev/creatureLab';
import { runSoundBoard } from './dev/soundBoard';
import { renderScenario } from './dev/audioRender';
import { GameSession } from './game/session';
import { showMenu, MenuChoice, teamOf, randomBorrowed } from './ui/menu';
import { SPECIES } from './sim/species';
import { MISSIONS } from './sim/missions';
import { GameUI } from './ui/gameUI';
import { GameSetup } from './sim/mapGen';
import { layoutDemo } from './dev/nestDemo';
import { battleDemo } from './dev/battleDemo';
import { TEAM_NAMES, arenaLayout } from './sim/arena';
import { ARENA } from './sim/balance';
import { chamberDemo } from './dev/chamberDemo';
import { creatureDemo } from './dev/creatureDemo';
import { runDeterminism } from './dev/determinism';
import { runStressPage } from './dev/stressPage';
import { decodeReplay } from './game/replay';
import { SaveSlot, decodeSave, deleteSave, getSave } from './game/saves';
import { settings, updateSettings } from './game/profile';
import { BUILD_ID } from './net/messages';
import { DebugOverlay } from './ui/debugOverlay';
import { fitMenus } from './ui/dom';
import { TOUCH, installTouchGuards } from './core/device';
import { LobbyView, savedName, showMultiplayerMenu, showTitle } from './ui/multiplayer';
import { NetHud } from './ui/netHud';
import { Lobby, StartInfo, newToken, roomCode } from './net/lobby';
import { NetGame } from './net/netGame';
import { BroadcastChannelTransport, NetSimTransport, Transport } from './net/transport';
import { PeerTransport } from './net/peerTransport';

installTouchGuards();
fitMenus();
const q = new URLSearchParams(location.search);
/** where Auto graphics quality starts: phones and tablets start a step lower (autoQuality.ts keeps them there) */
const AUTO_START = TOUCH ? 'medium' : 'high';
const canvas = document.getElementById('view') as HTMLCanvasElement;
const scene = q.get('scene');
if (scene === 'antlab') runAntLab(canvas, q);
else if (scene === 'swarm') runSwarmTest(canvas, q);
else if (scene === 'crlab') runCreatureLab(canvas, q);
else if (scene === 'sounds' && q.get('render')) void renderScenario(q.get('render')!, Number(q.get('secs') || 8));
else if (scene === 'sounds') runSoundBoard(document.getElementById('ui')!);
else if (scene === 'determinism') runDeterminismPage(q);
else if (q.get('stress')) runStressPage(canvas, document.getElementById('ui')!, q);
else startGame();

/**
 * ?scene=determinism[&min=2]: runs the determinism check in this browser and shows the hashes.
 * Open it in two different browsers (Chrome, Firefox, Safari): the final hash must be the same,
 * and the same as `npm run test:determinism -- <min>` prints in Node.
 */
function runDeterminismPage(params: URLSearchParams): void {
  const ui = document.getElementById('ui')!;
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:24px;color:#e8dcc0;font:14px/1.5 monospace;white-space:pre-wrap;z-index:10';
  const min = Number(params.get('min') || 2);
  box.textContent = `Determinism check: ${min} min of game time, run twice and once from a snapshot…`;
  ui.appendChild(box);
  setTimeout(() => {
    const r = runDeterminism(Math.round(min * 1200));
    const ok = r.bDiff < 0 && r.cDiff < 0;
    box.textContent = [
      `Determinism check — ${navigator.userAgent}`,
      `${min} min of game time (${r.ticks} ticks), ${r.a.length} checkpoints, ${r.ants} ants at the end`,
      `two runs from tick 0: ${r.bDiff < 0 ? 'identical' : 'DIFFER at tick ' + (r.bDiff + 1) * r.every}`,
      `restored from a snapshot: ${r.cDiff < 0 ? 'identical' : 'DIFFERS at tick ' + (r.cDiff + 1) * r.every}`,
      `final hash: ${r.a[r.a.length - 1]}`,
      `time: ${((r.ms.a + r.ms.b + r.ms.c) / 1000).toFixed(1)} s`,
      ok ? 'PASS' : 'FAIL',
    ].join('\n');
    (window as unknown as { __det: unknown }).__det = { ...r, ok, engine: navigator.userAgent };
  }, 50);
}

/** Prototype game bootstrap: start menu → GameSession + HUD. ?play=1 skips the menu. */
function startGame(): void {
  const ui = document.getElementById('ui')!;
  const launch = (c: MenuChoice) => {
    const load = document.createElement('div');
    load.className = 'loading';
    load.textContent = 'Excavating the founding chamber…';
    ui.appendChild(load);
    setTimeout(() => {
      if (c.mode === 'arena') return launchArena(c, load);
      const colonies: GameSetup['colonies'] = [{ species: c.species, player: true, ai: false, borrowed: c.species === 'plagiaria' ? c.borrowed : undefined, team: 0 }];
      // a mission brings its own map and rival; skirmish and sandbox use the menu's line-up
      const mission = c.mode === 'mission' ? MISSIONS[c.mission] : null;
      const ais: MenuChoice['ais'] = mission ? (mission.rival ? [{ species: mission.rival, borrowed: [], team: 'own' }] : []) : c.ais;
      for (const ai of ais) {
        const sp = SPECIES[ai.species];
        const team = teamOf(ai.team);
        colonies.push({
          species: ai.species,
          player: false,
          ai: true,
          developed: 6,
          startWorkers: 14,
          team,
          borrowed: ai.species === 'plagiaria' ? (ai.borrowed.length ? ai.borrowed : randomBorrowed()) : undefined,
          name: `${team === 0 ? 'Allied' : 'Rival'} ${sp.common.toLowerCase()} colony${ais.filter((x) => x.species === ai.species).length > 1 ? ' ' + ais.filter((x, k) => x.species === ai.species && k <= ais.indexOf(ai)).length : ''}`,
        });
      }
      // Underground areas besides the nests: a root hollow with a food cache; ?areas=1 builds the
      // five-area test level (adds an allied colony and a beetle's den).
      const caves: NonNullable<GameSetup['caves']> = [{ name: 'Root hollow', kind: 'cave', food: 70 }];
      if (q.get('areas')) {
        if (!ais.length) colonies.push({ species: 'solenopsis', player: false, ai: true, developed: 6, startWorkers: 14 });
        colonies.push({ species: 'lasius', player: false, ai: true, team: 0, name: 'Allied black ants', developed: 3, startWorkers: 8 });
        caves.push({ name: 'Beetle den', kind: 'lair', food: 40 });
      }
      // the map grows with the number of colonies so nests are not crowded
      const size = colonies.length <= 2 ? 640 : colonies.length <= 4 ? 800 : 980;
      const setup: GameSetup = {
        seed: Number(q.get('seed') || Math.floor(Math.random() * 1e6)),
        style: mission ? mission.style : c.style,
        width: size,
        depth: size,
        colonies,
        caves,
        food: 1.2,
        settings: { creatures: q.get('creatures') ? Number(q.get('creatures')) : 1 },
        mission: mission?.id,
        sandbox: c.mode === 'sandbox',
      };
      if (!q.get('play')) updateSettings({ quality: c.quality });
      const s = new GameSession(canvas, setup, c.quality === 'auto' ? AUTO_START : c.quality);
      s.build = BUILD_ID;
      s.autoQuality.enabled = c.quality === 'auto';
      if (q.get('reveal')) s.revealAreas = true;
      // ?delay=N: give single-player an input delay of N ticks, to try the multiplayer pending feedback
      if (q.get('delay')) s.commands.delay = Math.max(0, Math.min(8, Number(q.get('delay'))));
      (window as unknown as { __session: GameSession }).__session = s;
      if (!q.get('noui')) {
        (window as unknown as { __ui: GameUI }).__ui = new GameUI(s, ui);
        new DebugOverlay(s, ui);
      }
      load.remove();
      if (q.get('layout')) layoutDemo(s);
      if (q.get('battle')) battleDemo(s, q.get('battle')!, !!q.get('raid'));
      if (q.get('chamber')) chamberDemo(s);
      if (q.get('spawn')) creatureDemo(s, q.get('spawn')!);
      if (q.get('climbdebug')) s.setClimbDebug(true);
      if (q.get('hitboxes')) s.setHitboxes(true);
      if (q.get('layout') || q.get('battle') || q.get('chamber') || q.get('spawn')) s.replayable = false; // test scenes edit the world directly
      // The simulation runs in a Web Worker (the screenshot harness steps it synchronously in this thread; ?worker=0 too).
      if (!q.get('shot') && q.get('worker') !== '0') s.useWorker();
      if (q.get('shot')) {
        const n = Number(q.get('ticks') || 0);
        s.loop.advance(n);
        if (q.get('view') === 'nest') s.view.space = 'nest';
        if (q.get('nest')) {
          const t = s.areaTabs()[Number(q.get('nest')) - 1];
          if (t) {
            s.viewedArea = t.space;
            s.view.setActiveNest(t.space);
          }
        }
        const r = s.view.space === 'nest' ? s.view.nestRig : s.view.surfaceRig;
        if (q.get('dist')) r.jumpTo(Number(q.get('cx') || r.goal.x), Number(q.get('cz') || r.goal.z), Number(q.get('dist')));
        if (q.get('yaw')) r.yaw = r.goalYaw = Number(q.get('yaw'));
        if (q.get('pitch')) r.pitchBias = Number(q.get('pitch'));
        // A virtual clock: each step is exactly `dt` seconds of frame time, however slow rendering is.
        let vt = performance.now();
        (window as unknown as { __step: (k: number, dt: number) => void }).__step = (k, dt) => {
          for (let i = 0; i < k; i++) s.loop.step((vt += dt * 1000));
        };
        s.loop.step(vt);
        s.loop.step((vt += 16));
        (window as unknown as { __ready: boolean }).__ready = true;
        return;
      }
      s.start();
      setTimeout(() => ((window as unknown as { __ready: boolean }).__ready = true), 800);
    }, 30);
  };
  /** Battle arena (sim/arena.ts): one colony per team (nests out of the way), an empty field, no economy. */
  const launchArena = (c: MenuChoice, load: HTMLElement) => {
    const n = Math.max(2, Math.min(4, c.teams ?? 2));
    const L = arenaLayout(ARENA.size, n);
    const setup: GameSetup = {
      seed: Number(q.get('seed') || Math.floor(Math.random() * 1e6)),
      style: c.style,
      width: ARENA.size,
      depth: ARENA.size,
      colonies: L.map((p, i) => ({ species: 'lasius' as const, player: i === 0, ai: false, startWorkers: 0, startFood: 0, at: { x: p.nx, y: p.ny }, name: `Team ${TEAM_NAMES[i]}` })),
      caves: [],
      food: 0,
      aphids: 0,
      plants: 0,
      puddles: 0,
      settings: { creatures: 0 },
      arena: true,
    };
    if (!q.get('play')) updateSettings({ quality: c.quality });
    const s = new GameSession(canvas, setup, c.quality === 'auto' ? AUTO_START : c.quality);
    s.build = BUILD_ID;
    s.autoQuality.enabled = c.quality === 'auto';
    (window as unknown as { __session: GameSession }).__session = s;
    if (!q.get('noui')) {
      (window as unknown as { __ui: GameUI }).__ui = new GameUI(s, ui);
      new DebugOverlay(s, ui);
    }
    load.remove();
    if (!q.get('shot') && q.get('worker') !== '0') s.useWorker();
    if (q.get('shot')) {
      let vt = performance.now();
      (window as unknown as { __step: (k: number, dt: number) => void }).__step = (k, dt) => {
        for (let i = 0; i < k; i++) s.loop.step((vt += dt * 1000));
      };
      s.loop.step(vt);
      s.loop.step((vt += 16));
      (window as unknown as { __ready: boolean }).__ready = true;
      return;
    }
    s.start();
    setTimeout(() => ((window as unknown as { __ready: boolean }).__ready = true), 800);
  };
  if (q.get('play')) {
    launch({ teams: Number(q.get('teams') || 2), mode: (q.get('mode') as MenuChoice['mode']) || (q.get('mission') ? 'mission' : 'skirmish'), mission: (q.get('mission') as MenuChoice['mission']) || 'meadow', species: (q.get('species') as MenuChoice['species']) || 'lasius', borrowed: (q.get('borrow') || 'formica_mortar,fire_major').split(','), ais: (q.get('rival') || '').split(',').filter(Boolean).map((sp) => ({ species: sp as MenuChoice['species'], borrowed: [], team: 'own' as const })), style: (q.get('style') as MenuChoice['style']) || (q.get('mode') === 'arena' ? 'formicarium' : 'meadow'), quality: (q.get('q') as MenuChoice['quality']) || 'high' });
    return;
  }
  const title = () => showTitle(ui, () => showMenu(ui, launch), () => mpMenu(), (bytes) => watchReplay(bytes), { slot: (sl) => void loadSlot(sl), file: (b) => void loadGame(b) });

  // ------------------------------------------------------------------ saved games (Phase 14)
  const loadSlot = async (slot: SaveSlot) => {
    const rec = await getSave(slot);
    if (slot === 'import') void deleteSave('import');
    if (!rec) {
      title();
      return failToast('That save is no longer here (saves live in this browser only).');
    }
    await loadGame(rec.bytes);
  };
  const failToast = (text: string) => {
    const t = document.createElement('div');
    t.className = 'load-error';
    t.textContent = text;
    ui.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  };
  const loadGame = async (bytes: Uint8Array) => {
    const wait = loading('Opening the saved colony…');
    let snap: Awaited<ReturnType<typeof decodeSave>>;
    try {
      snap = await decodeSave(bytes);
    } catch (e) {
      wait.remove();
      title();
      return failToast(e instanceof Error ? e.message : String(e));
    }
    setTimeout(() => {
      const qc = settings().quality;
      let s: GameSession;
      try {
        s = new GameSession(canvas, { snapshot: snap.snapshot }, qc === 'auto' ? AUTO_START : qc, snap.header.local);
      } catch (e) {
        wait.remove();
        title();
        return failToast(`This save could not be opened${snap.header.build !== BUILD_ID ? ' (it is from another version of the game)' : ''}: ${e instanceof Error ? e.message : String(e)}`);
      }
      s.build = BUILD_ID;
      s.autoQuality.enabled = qc === 'auto';
      (window as unknown as { __session: GameSession }).__session = s;
      (window as unknown as { __ui: GameUI }).__ui = new GameUI(s, ui);
      new DebugOverlay(s, ui);
      wait.remove();
      s.onEvent?.({ t: 'message', text: `Loaded: ${snap.header.title}, ${Math.floor(snap.header.time / 60)} min in.`, kind: 'good' });
      if (q.get('worker') !== '0') s.useWorker();
      s.start();
      setTimeout(() => ((window as unknown as { __ready: boolean }).__ready = true), 800);
    }, 30);
  };

  // ------------------------------------------------------------------ replays (brief Part F)
  const watchReplay = (bytes: Uint8Array) => {
    let r: ReturnType<typeof decodeReplay>;
    try {
      r = decodeReplay(bytes);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      return title();
    }
    const wait = loading('Loading the replay…');
    setTimeout(() => {
      const s = new GameSession(canvas, r.snapshot ? { snapshot: r.snapshot } : r.header.setup!, mpQuality, r.header.local);
      s.autoQuality.enabled = !q.get('q');
      if (q.get('worker') !== '0') s.useWorker();
      s.playReplay(r.commands, r.header.ticks, r.header.finalHash);
      (window as unknown as { __session: GameSession }).__session = s;
      (window as unknown as { __ui: GameUI }).__ui = new GameUI(s, ui);
      new DebugOverlay(s, ui);
      wait.remove();
      s.onEvent?.({ t: 'message', text: `Watching a replay (${Math.floor(r.header.ticks / 1200)} min ${Math.floor((r.header.ticks % 1200) / 20)} s). Orders are off; speed keys work.`, kind: 'info' });
      s.start();
      (window as unknown as { __ready: boolean }).__ready = true;
    }, 30);
  };
  const mpMenu = (error = '') =>
    showMultiplayerMenu(ui, { create: (name, local) => void createGame(name, local), join: (name, code, local) => void joinGame(name, code, local), back: title }, error);

  // ------------------------------------------------------------------ multiplayer (brief Part E)
  const loading = (text: string) => {
    const el = document.createElement('div');
    el.className = 'loading';
    el.textContent = text;
    ui.appendChild(el);
    return el;
  };
  const peerId = () => 'tab-' + Math.random().toString(36).slice(2, 10);

  // ?netsim=150,20,0.01: add latency (ms round trip), jitter (ms) and loss to this client's connection
  const netsim = (t: Transport): Transport => {
    const v = q.get('netsim');
    if (!v) return t;
    const [lat, jit, loss] = v.split(',').map(Number);
    return new NetSimTransport(t, { latency: lat || 0, jitter: jit || 0, loss: loss || 0 });
  };

  const openLobby = (raw: Transport, room: string, name: string, token: string, local: boolean) => {
    const transport = netsim(raw);
    const lobby = new Lobby(transport, room, name, token);
    const view = new LobbyView(ui, lobby, local, () => {
      transport.close();
      view.close();
      history.replaceState(null, '', location.pathname);
      mpMenu();
    });
    lobby.onStart = (info) => {
      view.close();
      // Build the match after this message handler returns: the lobby keeps whatever arrives meanwhile.
      const wait = loading(info.kind === 'start' ? 'Founding the colonies…' : 'Rejoining the match…');
      setTimeout(() => {
        startMatch(info, lobby);
        wait.remove();
      }, 30);
    };
  };

  const createGame = async (name: string, local: boolean) => {
    const room = roomCode();
    const wait = loading('Creating the game…');
    try {
      const transport = local ? new BroadcastChannelTransport(room, peerId(), true) : new PeerTransport(room, true);
      if (transport instanceof PeerTransport) await transport.ready;
      wait.remove();
      openLobby(transport, room, name, newToken(), local);
    } catch (e) {
      wait.remove();
      mpMenu(e instanceof Error ? e.message : String(e));
    }
  };

  const joinGame = async (name: string, room: string, local: boolean) => {
    // the same token comes back after a reload, so a dropped player gets their colony back
    const key = `ud-token-${room}`;
    let token = '';
    try {
      token = sessionStorage.getItem(key) || '';
      if (!token) sessionStorage.setItem(key, (token = newToken()));
    } catch {
      token = newToken();
    }
    history.replaceState(null, '', `${location.pathname}?room=${room}${local ? '&local=1' : ''}`);
    const wait = loading(`Joining game ${room}…`);
    try {
      const transport = local ? new BroadcastChannelTransport(room, peerId(), false) : new PeerTransport(room, false);
      if (transport instanceof PeerTransport) await transport.ready;
      wait.remove();
      openLobby(transport, room, name, token, local);
    } catch (e) {
      wait.remove();
      history.replaceState(null, '', location.pathname);
      mpMenu(e instanceof Error ? e.message : String(e));
    }
  };

  const mpQuality = (q.get('q') as 'low' | 'medium' | 'high' | null) || AUTO_START;
  const startMatch = (info: StartInfo, lobby: Lobby) => {
    const transport = lobby.transport;
    let s: GameSession;
    let net: NetGame;
    if (info.kind === 'start') {
      s = new GameSession(canvas, info.msg.setup, mpQuality, info.msg.you);
      s.useWorker();
      net = new NetGame(transport, info.msg.you, info.msg.slots, s.sim, { delay: info.msg.delay });
    } else {
      // back in a match in progress: the host's snapshot, then fast-forward
      s = new GameSession(canvas, { snapshot: info.snapshot }, mpQuality, info.msg.you);
      s.useWorker();
      net = NetGame.fromResync(transport, info.msg, s.sim);
    }
    for (const [from, data] of lobby.takeBuffered()) net.receive(from, data);
    // dropped while still connected (too slow): come back the way a reconnecting player does
    net.onSelfDropped = () => setTimeout(() => location.reload(), 1500);
    s.autoQuality.enabled = !q.get('q');
    s.attachNet(net);
    const w = window as unknown as { __session: GameSession; __net: NetGame; __ready: boolean };
    w.__session = s;
    w.__net = net;
    (window as unknown as { __ui: GameUI }).__ui = new GameUI(s, ui);
    new DebugOverlay(s, ui);
    new NetHud(s, ui, () => {
      net.close();
      location.href = location.pathname;
    });
    s.start();
    setTimeout(() => (w.__ready = true), 800);
  };

  // ?load=slot: the pause menu's Load restarts the page into a save
  const loadParam = q.get('load') as SaveSlot | null;
  if (loadParam) {
    history.replaceState(null, '', location.pathname);
    void loadSlot(loadParam);
    return;
  }
  const room = q.get('room');
  if (room && /^[A-Za-z]{6}$/.test(room)) void joinGame(q.get('name') || savedName() || 'Player', room.toUpperCase(), !!q.get('local'));
  else title();
}
