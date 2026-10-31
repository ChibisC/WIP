/**
 * Multiplayer game speed vote (sim/commands.ts `speedVote`): faster only when every player agrees, slower at once,
 * "no" clears the request, dropped (AI-run) players don't vote, the votes travel through the wire format, and two
 * worlds fed the same commands stay identical.
 *
 *   npx vite-node tests/speedVote.ts
 */
import { EventBus } from '../src/core/events';
import { createWorld } from '../src/sim/mapGen';
import { Command, applyCommand, decodeTickPacket, encodeTickPacket } from '../src/sim/commands';
import { hashState } from '../src/sim/snapshot';
import { Slot } from '../src/net/messages';
import { DEFAULT_LOBBY, matchPlayers, matchSetup } from '../src/net/match';

let failed = 0;
function check(name: string, ok: boolean, info = ''): void {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  — ${info}` : ''}`);
}

const slot = (kind: Slot['kind'], name: string, species: Slot['species']): Slot => ({ kind, name, species, color: 0, ready: true, peer: '', ping: 0, token: '', team: 0 });
function world() {
  const slots = [slot('human', 'Host', 'lasius'), slot('human', 'Guest 1', 'formica'), slot('human', 'Guest 2', 'solenopsis'), slot('ai', 'AI', 'atta')];
  return createWorld(matchSetup(matchPlayers(slots), { ...DEFAULT_LOBBY, seed: 77 }), new EventBus());
}
let seq = 0;
const vote = (w: ReturnType<typeof world>, player: number, speed: number) => applyCommand(w, { type: 'speedVote', speed, player, tick: w.s.tick + 1, seq: seq++ } as Command);
const speed = (w: ReturnType<typeof world>) => w.s.settings.gameSpeed ?? 1;

const w = world();
const humans = w.s.colonies.filter((c) => c.player).map((c) => c.id);
check('setup: three human colonies and an AI one', humans.length === 3 && w.s.colonies.some((c) => !c.player), `humans ${humans.join(', ')}`);

vote(w, humans[0], 2);
check('a request alone does not change the speed', speed(w) === 1 && (w.s.settings.speedVotes ?? [])[humans[0]] === 2);
vote(w, humans[1], 2);
check('two of three agreeing is not enough', speed(w) === 1);
vote(w, humans[2], 2);
check('when every player agrees the match runs at 2×', speed(w) === 2 && (w.s.settings.speedVotes ?? []).every((v) => v === 0));

vote(w, humans[1], 4);
vote(w, humans[0], 2);
check('voting the current speed says no: the 4× request is cleared', speed(w) === 2 && (w.s.settings.speedVotes ?? []).every((v) => v === 0));

vote(w, humans[2], 1);
check('anyone can bring the speed back down at once', speed(w) === 1);

// a dropped player (driven by the AI) does not hold the vote up
const host = w.s.colonies[0].id;
applyCommand(w, { type: 'setControl', colony: humans[2], human: false, player: host, tick: w.s.tick + 1, seq: seq++ } as Command);
vote(w, humans[0], 4);
vote(w, humans[1], 4);
check("a dropped player's colony (run by the AI) does not have to agree", speed(w) === 4);

check('an AI colony cannot vote', vote(w, w.s.colonies.find((c) => !c.player)!.id, 1) !== null && speed(w) === 4);
check('only 1×, 2× and 4×', vote(w, humans[0], 3) === 'bad speed' && speed(w) === 4);

// the wire format and determinism
const pk = decodeTickPacket(encodeTickPacket(10, humans[1], [{ type: 'speedVote', speed: 4, player: humans[1], tick: 10, seq: 5 } as Command]));
check('the vote travels through the lockstep packet', pk.cmds.length === 1 && pk.cmds[0].type === 'speedVote' && (pk.cmds[0] as { speed: number }).speed === 4);
const a = world();
const b = world();
for (const x of [a, b]) {
  vote(x, humans[0], 2);
  vote(x, humans[1], 2);
}
check('two worlds fed the same votes have the same state hash', hashState(a) === hashState(b) && hashState(a) !== hashState(world()));

if (failed) {
  console.log(`\n${failed} speed-vote test(s) FAILED`);
  // (as the other tests: no Node types in the build's typecheck)
  (globalThis as unknown as { process: { exit: (code: number) => never } }).process.exit(1);
}
console.log('\nall speed-vote tests passed');
