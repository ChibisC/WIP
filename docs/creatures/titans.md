# Titans digging into nests — how long a hole takes

The rules: `DESIGN.md` ("Titans dig into nests", "Story titans always get in"); the numbers: `TITAN_DIG` and
`STORY.titanRaid` in `src/sim/balance.ts`; the code: `src/sim/creatures/titanDig.ts`. Specs:
`claude/creatures/01-spec-digging-titans.md` (digging titans), `claude/creatures/02-spec-easier-titan-holes.md` (holes
made easier, 2026-11-03), `claude/story/05-spec-story-titans-get-inside.md` (story titans always get in, 2026-11-03).

## Time to open the hole (skirmish rules)

`npx vite-node tools/titan-holes.ts -- 5` (`SPECIES=lasius` for Lasius soldiers): a skirmish nest stripped to its
queen; the titan sent on a raid from 45 mm off a hole; undefended, 20 or 80 soldiers waiting at the hole (marker V, on
the ground: no climbing), or 20 soldiers on a marker following it (riders: climbing allowed). Seconds of digging until
the breach, or when it gave up (below `giveUpHealth`) and the health it had left. Seed 5.

**Before** (`main` `762d7c3`: `holeWork` 40 s at speed 1; any hit → 45 % pace for 1.2 s; a heavy tick 15 % back,
down to zero; giving up below 35 %):

| titan (dig speed) | undefended | 20 defenders | 80 defenders | riders |
|---|---|---|---|---|
| Termant soldiers | | | | |
| Mexican red-knee tarantula (1.6) | 25.0 s | 54.9 s | gave up at 30 s (35 %) | 54.5 s |
| Carolina wolf spider mother (1.5) | 26.7 s | gave up at 32 s (35 %) | gave up at 33 s (35 %) | gave up at 31 s (35 %) |
| Megarian banded centipede (1.0) | 40.0 s | gave up at 42 s (35 %) | gave up at 20 s (35 %) | gave up at 40 s (35 %) |
| European stag beetle (0.6) | 66.7 s | gave up at 60 s (35 %) | gave up at 27 s (35 %) | gave up at 59 s (35 %) |
| Lasius soldiers | | | | |
| Mexican red-knee tarantula (1.6) | 25.0 s | gave up at 53 s (35 %) | gave up at 25 s (35 %) | gave up at 53 s (35 %) |
| Carolina wolf spider mother (1.5) | 26.7 s | gave up at 28 s (35 %) | gave up at 15 s (35 %) | gave up at 27 s (35 %) |
| Megarian banded centipede (1.0) | 40.0 s | gave up at 38 s (35 %) | gave up at 22 s (35 %) | gave up at 35 s (35 %) |
| European stag beetle (0.6) | 66.7 s | gave up at 70 s (35 %) | gave up at 30 s (35 %) | gave up at 64 s (35 %) |

Almost any defence stalled the titan until it gave up: 20 soldiers kept every titan but the tarantula out.

**After** (`holeWork` 16 s; the centipede 1.15, the stag beetle 0.8; the slow from the damage rate, floor 55 %;
checkpoints 25 / 50 / 75 %; giving up below 55 %):

| titan (dig speed) | undefended | 20 defenders | 80 defenders | riders |
|---|---|---|---|---|
| Termant soldiers | | | | |
| Mexican red-knee tarantula (1.6) | 10.0 s | 12.6 s | 14.7 s | 13.0 s |
| Carolina wolf spider mother (1.5) | 10.0 s | 15.5 s | 15.4 s | 15.6 s |
| Megarian banded centipede (1.15) | 15.0 s | 20.6 s | gave up at 16 s (55 %) | 20.9 s |
| European stag beetle (0.8) | 20.3 s | 26.8 s | gave up at 20 s (55 %) | 27.2 s |
| Lasius soldiers | | | | |
| Mexican red-knee tarantula (1.6) | 10.0 s | 12.2 s | 15.7 s | 13.2 s |
| Carolina wolf spider mother (1.5) | 10.0 s | 15.2 s | gave up at 12 s (55 %) | 15.6 s |
| Megarian banded centipede (1.15) | 15.0 s | 21.6 s | gave up at 17 s (55 %) | 22.3 s |
| European stag beetle (0.8) | 20.3 s | 25.3 s | gave up at 23 s (55 %) | 26.4 s |

* Undefended: the burrowers in 10 s, the centipede in 15 s, the stag beetle in 20 s (targets 8–12 / ~15 / ~20).
* Defenders still slow it: 20 soldiers 1.2–1.5 × the time, a big army 1.5–1.6 × (the floor caps it at 1.8 ×; the wolf
  spider mother is small, so few ants reach her at once and 20 or 80 make little difference).
* A big army makes a slow digger give up by damage (the centipede, the stag beetle; the Lasius swarm the spider mother
  too), not a fast one with much health (the tarantula): hurting it, not stalling it, is the defence.
* Progress never drops below the last checkpoint (`tests/titans.ts`; the tool also records the lowest progress after
  each checkpoint).

## Story titans (always get in)

Story raids use the same digging with their own floors (`STORY.titanRaid`): pace ≥ 60 %, no knock-backs, a cap of 12 /
15 / 18 / 20 s (Easy → Brutal), a health floor of 10 % until inside. `tests/storyCh1.ts` runs both chapter 1 titans on
all four difficulties with no defence, 40 ants at the hole, 40 riders and the titan down in its lair when its cue
fires: inside every time (CHANGE_PLAN §26 has the times; why they never got in before: §26.1).
