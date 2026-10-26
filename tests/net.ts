/**
 * Headless multiplayer tests (multiplayer brief, Part D): several clients in
 * one process, each with its own World, connected through an in-memory hub
 * with latency and jitter, running real lockstep with random commands.
 *
 *   npx vite-node tests/net.ts
 */
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { createWorld } from '../src/sim/mapGen';
import { World } from '../src/sim/world';
import { Command, CommandSchedule, stepWithCommands } from '../src/sim/commands';
import { encodeState, hashState, restoreWorld } from '../src/sim/snapshot';
import { SURFACE } from '../src/sim/types';
import { LocalHub, LocalEndpoint } from '../src/net/transport';
import { NetGame, NetSim } from '../src/net/netGame';
import { Slot, packControl, unpack } from '../src/net/messages';
import { DEFAULT_LOBBY, GENE_THIEF_DEFAULT, TEAM_BASE, matchPlayers, matchSetup, matchWinner, teamsBlocker } from '../src/net/match';
import { Lobby } from '../src/net/lobby';
import { BORROWABLE } from '../src/sim/species';
import { dhypot } from '../src/sim/dmath';
import { LocalCommands } from '../src/game/localCommands';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}

class TestSim implements NetSim {
  sched = new CommandSchedule();
  constructor(public w: World) {}
  stepWith(cmds: Command[]): void {
    for (const c of cmds) this.sched.add(c);
    stepWithCommands(this.w, 0.05, this.sched);
    this.w.events.drain();
  }
  hash(): Promise<{ tick: number; hash: string }> {
    return Promise.resolve({ tick: this.w.s.tick, hash: hashState(this.w) });
  }
  snapshot(): Promise<Uint8Array> {
    return Promise.resolve(encodeState(this.w));
  }
}

interface Client {
  peer: string;
  player: number;
  ep: LocalEndpoint;
  sim: TestSim;
  game: NetGame;
  cmds: LocalCommands;
  acc: number;
  rng: Rng;
  hashes: Map<number, string>;
  applied: number;
  /** tick of every applied command */
  appliedAt: number[];
  alive: boolean;
}

const slot = (kind: Slot['kind'], name: string, species: Slot['species'], peer = '', token = ''): Slot => ({ kind, name, species, color: 0, ready: true, peer, ping: 0, token, team: 0 });

function makeMatch(hub: LocalHub, n: number, opts: { delay?: number; ai?: boolean; slots?: Slot[]; map?: import('../src/maps/types').MapId } = {}) {
  let slots: Slot[] = [slot('human', 'Host', 'lasius', 'p0', 't0')];
  for (let i = 1; i < n; i++) slots.push(slot('human', `Guest ${i}`, i % 2 ? 'formica' : 'solenopsis', `p${i}`, `t${i}`));
  if (opts.ai !== false) slots.push(slot('ai', 'AI', 'atta'));
  if (opts.slots) slots = opts.slots;
  const players = matchPlayers(slots);
  const setup = matchSetup(players, { ...DEFAULT_LOBBY, seed: 4242, ...(opts.map ? { map: opts.map } : {}) });
  // everyone is connected (the lobby) before the match starts
  const eps = [hub.connect('p0', 'p0')];
  for (let i = 1; i < n; i++) eps.push(hub.connect(`p${i}`, 'p0'));
  const clients: Client[] = [];
  for (let i = 0; i < n; i++) {
    const ep = eps[i];
    const w = createWorld(setup, new EventBus());
    const sim = new TestSim(w);
    const game = new NetGame(ep, i, players.map((p) => ({ ...p })), sim, { delay: opts.delay ?? 3, now: () => hub.now });
    const cmds = new LocalCommands(w, i);
    cmds.remote = (c) => game.issue(c);
    const cl: Client = { peer: `p${i}`, player: i, ep, sim, game, cmds, acc: 0, rng: new Rng(100 + i), hashes: new Map(), applied: 0, appliedAt: [], alive: true };
    w.events.onAny((e) => {
      if (e.t === 'command') {
        cl.applied++;
        cl.appliedAt.push(w.s.tick);
      }
    });
    clients.push(cl);
  }
  return { clients, setup, players };
}

/** Random orders a player might give: markers, stance, groups, digging. */
function randomOrder(c: Client): void {
  const w = c.sim.w;
  const col = w.colony(c.player)!;
  if (!col.alive) return;
  const r = c.rng.next();
  const e = col.entrances[0];
  if (r < 0.4) c.cmds.issue({ type: 'placeMarker', i: c.rng.int(0, 4), space: SURFACE, x: e.sx + c.rng.range(-80, 80), y: e.sy + c.rng.range(-80, 80) }, { silent: true });
  else if (r < 0.55) c.cmds.issue({ type: 'setAggression', on: c.rng.chance(0.5) }, { silent: true });
  else if (r < 0.8) {
    const g = col.groups[c.rng.int(0, col.groups.length - 1)];
    if (g) c.cmds.issue({ type: 'assignGroup', group: g.id, marker: c.rng.int(-1, 4) }, { silent: true });
  } else {
    const g = w.nest(col.id)!;
    c.cmds.issue({ type: 'dig', q: c.rng.int(0, g.cols * g.rows - 1), on: true }, { silent: true });
  }
}

/** Run the clients for `ms` of simulated time in 16 ms frames. */
async function run(hub: LocalHub, clients: Client[], ms: number, orders = true, onFrame?: (t: number) => void): Promise<void> {
  const end = hub.now + ms;
  while (hub.now < end) {
    const now = hub.now + 16;
    hub.deliver(now);
    for (const c of clients) {
      if (!c.alive) continue;
      c.game.update();
      // the clock keeps running while waiting (up to 250 ms of debt), so a short stall is caught up after
      c.acc += 16 * c.game.status().speed;
      if (c.acc > 250) c.acc = 250;
      while (c.acc >= 50) {
        if (!c.game.tryTick()) break;
        c.acc -= 50;
        const t = c.sim.w.s.tick;
        if (t % 100 === 0) c.hashes.set(t, hashState(c.sim.w));
        if (orders && c.rng.chance(0.08)) randomOrder(c);
      }
    }
    onFrame?.(now);
    await Promise.resolve();
  }
}

function compareHashes(a: Client, b: Client): { common: number; diff: number } {
  let common = 0;
  let diff = -1;
  for (const [t, h] of a.hashes) {
    const o = b.hashes.get(t);
    if (o === undefined) continue;
    common++;
    if (o !== h && (diff < 0 || t < diff)) diff = t;
  }
  return { common, diff };
}

const t0 = Date.now();

// ---------------------------------------------------------------- three players, laggy links
{
  const hub = new LocalHub();
  const lag = new Rng(7);
  hub.latency = () => 40 + lag.next() * 80; // 40–120 ms one way, with jitter
  const { clients } = makeMatch(hub, 3);
  await run(hub, clients, 60_000);
  const ticks = clients.map((c) => c.sim.w.s.tick);
  check('lockstep: three clients advance together over 40–120 ms links', Math.min(...ticks) >= 1000 && Math.max(...ticks) - Math.min(...ticks) <= 12, `ticks ${ticks.join(', ')} after 60 s`);
  const ab = compareHashes(clients[0], clients[1]);
  const ac = compareHashes(clients[0], clients[2]);
  check('lockstep: every client has the same state hash at every checkpoint', ab.diff < 0 && ac.diff < 0 && ab.common >= 10, `${ab.common} checkpoints compared`);
  check('lockstep: no desync is reported', clients.every((c) => !c.game.status().desync));
  const upTo = Math.min(...ticks);
  const counts = clients.map((c) => c.appliedAt.filter((t) => t <= upTo).length);
  check("lockstep: every player's commands are applied on every client, at the same ticks", counts.every((n) => n === counts[0]) && counts[0] > 100 && clients.every((c) => c.appliedAt.filter((t) => t <= upTo).join() === clients[0].appliedAt.filter((t) => t <= upTo).join()), `${counts[0]} commands from 3 players`);
  const d = clients.map((c) => c.game.status().delay);
  check('adaptive delay: settles between 2 and 8 ticks from the measured ping', d.every((x) => x >= 2 && x <= 8) && d.every((x) => x === d[0]), `delay ${d.join(', ')} ticks, pings ${JSON.stringify(clients[0].game.status().pings)}`);
  // a forced desync: one client's state changes outside the simulation
  clients[2].sim.w.colony(1)!.food += 3;
  await run(hub, clients, 12_000, false);
  check('desync: a client that diverges is detected at the next hash and the match stops', clients.every((c) => !!c.game.status().desync), JSON.stringify(clients[0].game.status().desync?.tick));
  const rep = await clients[0].game.desyncReport('test');
  check('desync: the report has the snapshot and the recent packets', rep.snapshot.length > 100000 && JSON.parse(rep.json).recentPackets.length > 100);
}

// ---------------------------------------------------------------- drop and rejoin
{
  const hub = new LocalHub();
  hub.latency = () => 30;
  const { clients, players } = makeMatch(hub, 3);
  await run(hub, clients, 20_000);
  const before = clients[0].sim.w.s.tick;
  // player 2 loses the connection
  clients[2].alive = false;
  hub.disconnect('p2');
  await run(hub, clients.slice(0, 2), 10_000);
  const stalled = clients[0].sim.w.s.tick;
  const st = clients[0].game.status();
  check('drop: the others wait for a missing player (and show who)', stalled - before < 40 && st.waitingFor.includes(2) && st.waitingMs > 3000, `waited ${(st.waitingMs / 1000).toFixed(1)} s for ${st.waitingFor}`);
  await run(hub, clients.slice(0, 2), 35_000);
  const after = clients[0].sim.w.s.tick;
  check('drop: after 30 s the host drops the player and the match goes on', after - stalled > 200 && clients[0].game.status().dropped.includes(2) && clients[1].game.status().dropped.includes(2), `tick ${stalled} → ${after}`);
  await run(hub, clients.slice(0, 2), 3_000);
  check("drop: the AI takes over the dropped player's colony on every client", clients[0].sim.w.colony(2)!.ai && clients[1].sim.w.colony(2)!.ai);
  const ab = compareHashes(clients[0], clients[1]);
  check('drop: the remaining clients stay in sync', ab.diff < 0, `${ab.common} checkpoints`);

  // player 2 comes back with its token: the host sends a snapshot and the packets since; it fast-forwards
  const ep = hub.connect('p2b', 'p0');
  let resync: { msg: Extract<import('../src/net/messages').Control, { t: 'resync' }>; blob: Uint8Array } | null = null;
  ep.onMessage = (_from, data) => {
    const m = unpack(data);
    if (m?.kind === 'control' && m.msg.t === 'resync') resync = { msg: m.msg, blob: m.blob! };
  };
  ep.send('p0', packControl({ t: 'join', name: 'Guest 2', token: 't2', build: 'test' }));
  for (let i = 0; i < 40 && !resync; i++) await run(hub, clients.slice(0, 2), 50);
  check('rejoin: the host answers a returning player with a snapshot', !!resync);
  if (resync) {
    const r = resync as { msg: Extract<import('../src/net/messages').Control, { t: 'resync' }>; blob: Uint8Array };
    const w = restoreWorld(r.blob, new EventBus());
    const sim = new TestSim(w);
    const game = NetGame.fromResync(ep, r.msg, sim, () => hub.now);
    const cmds = new LocalCommands(w, r.msg.you);
    cmds.remote = (c) => game.issue(c);
    const back: Client = { peer: 'p2b', player: 2, ep, sim, game, cmds, acc: 0, rng: new Rng(555), hashes: new Map(), applied: 0, appliedAt: [], alive: true };
    // catch up quickly, then play on with the others
    const all = [clients[0], clients[1], back];
    for (let k = 0; k < 400 && back.sim.w.s.tick < clients[0].sim.w.s.tick - 5; k++) {
      if (back.game.tryTick()) continue;
      await run(hub, all, 16, false);
    }
    await run(hub, all, 20_000);
    check('rejoin: the returning player catches up and plays again (their colony is theirs again)', Math.abs(back.sim.w.s.tick - clients[0].sim.w.s.tick) < 12 && !clients[0].sim.w.colony(2)!.ai && !back.sim.w.colony(2)!.ai, `ticks ${clients[0].sim.w.s.tick} / ${back.sim.w.s.tick}`);
    const ac = compareHashes(clients[0], back);
    const detail = [...back.hashes.keys()].map((t) => `${t}:${clients[0].hashes.get(t) === back.hashes.get(t) ? 'ok' : 'DIFF'}`).join(' ');
    check('rejoin: the returning player is in sync with the others', ac.diff < 0 && ac.common >= 4, `${ac.common} checkpoints ${detail}; host vs client 1: ${compareHashes(clients[0], clients[1]).diff}`);
  }
  void players;
}

// ---------------------------------------------------------------- 150 ms + jitter + loss: still smooth
{
  const hub = new LocalHub();
  const lag = new Rng(9);
  hub.latency = () => 65 + lag.next() * 20 + (lag.next() < 0.01 ? 150 : 0); // 150 ms round trip, ±10 ms jitter, 1 % resent
  const { clients } = makeMatch(hub, 4);
  let stalledFrames = 0;
  let frames = 0;
  await run(hub, clients, 40_000, true, () => {
    frames++;
    if (clients[0].game.status().waitingFor.length) stalledFrames++;
  });
  const ticks = clients.map((c) => c.sim.w.s.tick);
  check('4 players at 150 ms round trip with jitter and loss: the match keeps a steady 20 ticks/s', Math.min(...ticks) >= 700, `ticks ${ticks.join(', ')} in 40 s; host waited in ${((stalledFrames / frames) * 100).toFixed(1)} % of frames; delay ${clients[0].game.status().delay}`);
  // after the delay has adapted: the next 20 s
  const t1 = clients[0].sim.w.s.tick;
  stalledFrames = 0;
  frames = 0;
  await run(hub, clients, 20_000, true, () => {
    frames++;
    if (clients[0].game.status().waitingFor.length) stalledFrames++;
  });
  const steady = clients[0].sim.w.s.tick - t1;
  check('4 players, steady state: about 20 ticks/s and almost no waiting', steady >= 380 && stalledFrames / frames < 0.05, `${steady} ticks in 20 s, waited in ${((stalledFrames / frames) * 100).toFixed(1)} % of frames, delay ${clients[0].game.status().delay}`);
  const ok = clients.slice(1).every((c) => compareHashes(clients[0], c).diff < 0);
  check('4 players: all in sync', ok);
}

// ---------------------------------------------------------------- surrender ends a two-player match
{
  const hub = new LocalHub();
  hub.latency = () => 40;
  const { clients } = makeMatch(hub, 2, { ai: false });
  await run(hub, clients, 5_000, false);
  clients[1].cmds.issue({ type: 'surrender' });
  await run(hub, clients, 3_000, false);
  const wins = clients.map((c) => matchWinner(c.sim.w));
  const team0 = clients[0].sim.w.colony(0)!.team;
  check('surrender: the conceding colony is out on every client and the other is the last queen standing', clients.every((c) => !c.sim.w.colony(1)!.alive && c.sim.w.colony(0)!.alive) && wins.every((x) => x === team0), `winner ${wins.join(', ')}`);
  check('surrender: the clients stay in sync after it', compareHashes(clients[0], clients[1]).diff < 0 && compareHashes(clients[0], clients[1]).common >= 1);
  // a command from a colony that is out is refused (it cannot surrender twice or keep playing)
  const before = clients[1].applied;
  clients[1].cmds.issue({ type: 'recall' });
  await run(hub, clients, 1_000, false);
  check('surrender: a colony that is out can no longer give orders', clients[1].applied === before + 1 && !clients[1].sim.w.colony(1)!.alive);
}

// ---------------------------------------------------------------- teams and the Gene Thief
{
  // 2 v 2 on Meadow Pond: the host and a Gene Thief player (Red) against two AIs (Blue), one a Gene Thief
  const team = (s: Slot, t: number, borrowed?: string[]) => ({ ...s, team: t, ...(borrowed ? { borrowed } : {}) });
  const slots = [
    team(slot('human', 'Host', 'lasius', 'p0', 't0'), 1),
    team(slot('human', 'Thief', 'plagiaria', 'p1', 't1'), 1, ['atta_major', 'hell_soldier', 'bogus_caste']),
    team(slot('ai', 'AI', 'formica'), 2),
    team(slot('ai', 'AI', 'plagiaria'), 2),
  ];
  const hub = new LocalHub();
  hub.latency = () => 40;
  const { clients, setup } = makeMatch(hub, 2, { slots, map: 'meadowPond' });
  check('teams: lobby teams become simulation teams (Red, Red, Blue, Blue) and teammates are grouped', JSON.stringify(setup.colonies.map((c) => c.team)) === JSON.stringify([TEAM_BASE + 1, TEAM_BASE + 1, TEAM_BASE + 2, TEAM_BASE + 2]) && setup.groupTeams === true);
  check("Gene Thief: the player's picks are kept (unknown castes dropped), an AI with no picks gets the default pair", JSON.stringify(setup.colonies[1].borrowed) === JSON.stringify(['atta_major', 'hell_soldier']) && JSON.stringify(setup.colonies[3].borrowed) === JSON.stringify(GENE_THIEF_DEFAULT), JSON.stringify(setup.colonies.map((c) => c.borrowed)));
  const w = clients[0].sim.w;
  check('Gene Thief: the borrowed castes are raised by that colony on every client', clients.every((c) => ['atta_major', 'hell_soldier'].every((id) => c.sim.w.colony(1)!.castes.includes(id))) && !w.colony(0)!.castes.includes('atta_major'), w.colony(1)!.castes.join(','));
  // teammates on neighbouring sites: each colony's nearest other colony is its teammate
  const nests = w.s.colonies.map((c) => ({ id: c.id, team: c.team, x: c.entrances[0].sx, y: c.entrances[0].sy }));
  const nearestIsMate = nests.every((a) => {
    const others = nests.filter((b) => b.id !== a.id).sort((p, q) => dhypot(p.x - a.x, p.y - a.y) - dhypot(q.x - a.x, q.y - a.y));
    return others[0].team === a.team;
  });
  check('teams: teammates start on neighbouring colony sites', nearestIsMate, nests.map((n) => `${n.id}@${Math.round(n.x)},${Math.round(n.y)}`).join(' '));
  check('teams: allies are not enemies (teamOf)', w.teamOf(0) === w.teamOf(1) && w.teamOf(2) === w.teamOf(3) && w.teamOf(0) !== w.teamOf(2));
  await run(hub, clients, 20_000);
  const cmp = compareHashes(clients[0], clients[1]);
  check('teams: a 2 v 2 match with Gene Thieves stays in sync', cmp.diff < 0 && cmp.common >= 3 && clients.every((c) => !c.game.status().desync), `${cmp.common} checkpoints`);
  check('teams: no winner while both teams have a queen', matchWinner(w) === -1);
  for (const c of clients) for (const id of [2, 3]) c.sim.w.colony(id)!.alive = false;
  check('teams: when one team is out, the other team wins together', clients.every((c) => matchWinner(c.sim.w) === TEAM_BASE + 1));
  for (const c of clients) c.sim.w.colony(0)!.alive = false;
  check('teams: a team still wins with one of its queens left', matchWinner(w) === TEAM_BASE + 1);
}

// ---------------------------------------------------------------- the lobby: teams and Gene Thief picks are checked by the host
{
  const hub = new LocalHub();
  const hostEp = hub.connect('h', 'h');
  const host = new Lobby(hostEp, 'ROOMXX', 'Host', 'th');
  const guestEp = hub.connect('g', 'h');
  const guest = new Lobby(guestEp, 'ROOMXX', 'Guest', 'tg');
  const settle = () => {
    for (let k = 0; k < 10; k++) hub.deliver(hub.now + 10);
  };
  settle();
  check('lobby: eight slots, the guest is seated', host.slots.length === 8 && guest.you === 1, `you ${guest.you}`);
  guest.setMine({ species: 'plagiaria', team: 9, borrowed: ['bogus', 'fire_major'] } as never);
  settle();
  const g = host.slots[1];
  check('lobby: a guest cannot set a team past 4 or a caste that does not exist', g.species === 'plagiaria' && g.team === 0 && JSON.stringify(g.borrowed) === JSON.stringify(['fire_major']), JSON.stringify(g));
  guest.setMine({ team: 2 });
  settle();
  check("lobby: a guest picks their own team and everyone sees it", host.slots[1].team === 2 && guest.slots[1].team === 2);
  host.setSlot(1, { species: 'atta' });
  host.setSlot(1, { team: 3 });
  settle();
  check("lobby: the host can move a player to another team but not change their species", host.slots[1].team === 3 && host.slots[1].species === 'plagiaria');
  host.setSlot(2, { kind: 'ai', species: 'plagiaria' });
  const ai = host.slots[2];
  check('lobby: a Gene Thief AI steals two or three castes, all borrowable', ai.kind === 'ai' && (ai.borrowed?.length ?? 0) >= 2 && (ai.borrowed?.length ?? 0) <= 3 && ai.borrowed!.every((id) => BORROWABLE.includes(id)), JSON.stringify(ai.borrowed));
  host.setMine({ team: 3 });
  host.setSlot(2, { team: 3 });
  check('lobby: everyone on one team cannot start', host.startBlocker().startsWith('Everyone is on Team'), host.startBlocker());
  host.setSlot(2, { team: 0 });
  check('lobby: a colony with no team makes it a match', !teamsBlocker(matchPlayers(host.slots)), teamsBlocker(matchPlayers(host.slots)));
  check('lobby: a guest who is not ready still blocks the start', host.startBlocker().startsWith('Waiting for'), host.startBlocker());
}

console.log(`\n${failed ? failed + ' FAILED' : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
