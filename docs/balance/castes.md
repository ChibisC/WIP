# Caste and creature balance (2026-11-02)

User note (2026-11-02, 00:34): "balance all current ant and termite species soldiers and workers and other castes
(workers should be similar in strength and stats but not the same like eotu) and buff creatures cos they are weak
against ants right now".

## Method
- `tools/caste-table.ts` lists every caste's numbers (health, bite, interval, armour, speed, extra damage from acid,
  venom, glue and snaps, cost, power = effective health × damage per second, power per food); `-- creatures` the
  creatures'.
- `tools/balance-matrix.ts` fights them on open ground with the same food's worth on each side (build + hatch):
  `refw` / `refs` / `refm` put every worker / soldier / major against a reference caste (black garden ant worker,
  black garden ant soldier, tropical fire ant major), three seeds, both ways round (the two sides of the harness are not
  quite alike); the margin is the share of the caste's side left minus the reference's (−1..1). `ONLY=a,b` limits the
  list; `PURSUE=1` makes each side's marker follow the other side (for sickle-jaw soldiers, below). `workers` /
  `soldiers` / `heavies` run a full round robin; `creatures` puts each creature against 5 / 10 / 20 / 40 black garden ant
  workers (bosses 20 / 40 / 80 / 120; `KINDS=a,b` limits it).
- `tools/balance-tune.ts -- <ref> <food> <castes>` searches the stat scale at which a caste ties the reference (health
  and every damage source × s; a nasute's glue stream × s²; a sickle-jaw's health × s²). Equal-food fights snowball:
  the margin swings from −0.7 to +0.7 over a few per cent of strength, so the numbers were set from the tie point
  rather than by trial and error, then measured again.
- Sizes: workers at 150 food (12–15 a side), soldiers at 300 food (8–16 a side, the size of a real fight), majors at
  420 food (5–10 a side).
- Targets: every caste within about ±0.25 of its reference — a coin flip either way, since a few per cent of strength
  is ±0.5 at these sizes — each with its own profile (below). Wild predators beat a handful of workers and need about
  twenty; bosses need about a hundred.

## Workers: similar, not the same
All workers build for 10 food (11–13 with hatching) and have 16–21 health and 1.9–2.6 bite (the fire ant minor 13.5
and 1.25, with venom); each species keeps its own shape. The army ant's sting stays a little stronger than the fire
ant's, worker for worker (a design rule in `tests/casteAbilities.ts`).

| worker | hp | bite | interval | armour | speed | extra | v black garden ant worker |
|---|---|---|---|---|---|---|---|
| Black Garden Ant | 17 | 2.6 | 0.9 | 0 | 16 | acid opener | reference |
| Red Wood Ant | 19 | 2.4 | 1.0 | 0.3 | 26 | acid opener | +0.08 |
| Leafcutter media | 17 | 2.3 | 1.05 | 1 | 17 | — (armoured) | −0.08 |
| Tropical Fire Ant minor | 13.5 | 1.25 | 0.8 | 0 | 15 | venom stacks (1.3/s a stack, every bite) | −0.07 |
| Army Ant minor | 19 | 2.6 | 0.8 | 0 | 30 | sting every third bite (1.4/s a stack); fastest | −0.09 |
| Plagiaria | 18 | 2.6 | 0.9 | 0.3 | 22 | acid (1.5 every 5 s) | +0.17 |
| Nasute termite worker | 20 | 2.4 | 1.0 | 0 | 12.8 | — (slow, soft) | −0.18 |
| Sickle-jaw termite worker | 21 | 2.4 | 1.0 | 0 | 12.8 | — (slow, tough) | −0.04 |
| Hell ant worker | 18 | 2.1 | 1.0 | 0 | 19 | pinning snap (3 dps) | −0.14 |
| Saiy-Ant worker | 16 | 1.9 | 1.0 | 0.2 | 22 | gold surge | +0.13 |
| Termant worker | 19 | 2.2 | 1.0 | 0.5 | 24 | acid opener | +0.14 |

Before (the first round robin at 150 food) the scores ran from −0.89 (both termite workers, which lost to everything)
to +0.80 (Plagiaria); leafcutter medias and Saiy-Ant workers won almost everything.

## Soldiers
Measured with each side's attack marker allowing gathering, as in a game (army ants then raid as they do on a marker);
the sickle-jaws alone get the "no gathering" order, or they guard a trail to their far-away nest.

| soldier | hp | bite | armour | extra | cost | v black garden ant soldier, 300 food |
|---|---|---|---|---|---|---|
| Black Garden Ant | 42 | 4.8 | 1 | acid opener | 24 | reference (13 a side) |
| Red Wood Ant (tank) | 107 | 3.8 | 2.5 | — | 36 | −0.02 |
| Leafcutter media | 50.5 | 5.8 | 1.5 | — | 29 | +0.13 |
| Tropical Fire Ant | 28 | 2.6 | 0.5 | venom 2.4 | 19 | +0.09 |
| Army Ant media | 51.5 | 6.2 | 1 | sting 2.0 every third bite, rage | 29 | +0.17 |
| Nasute | 12 | 0.3 | 0 | glue stream 2 → 20 dps, pure (the user's) | 26.4 | −0.18 |
| Sickle-jaw | 22 | 3 | 0 | grab and squirt | 22.8 | −0.40 (stalls; see below) |
| Hell ant | 49 | 3.9 | 2 | sting 1.25, impale (burst 12.5) | 34 | +0.01 |
| Saiy-Ant | 68 | 5.2 | 2 | gold surge | 36 | +0.17 |
| Termant | 55.5 | 4.35 | 1.5 | glue burst | 26.5 | −0.15 |

Before, at 150 food: the Red Wood Ant soldier −0.67, leafcutter media +0.53, army ant media +0.52, nasute +0.57, hell
ant −0.39. In small fights (150 food, 4–8 a side) the bigger soldiers still beat the black garden ant soldier.

- The black garden ant soldier is the cheap numbers soldier: tuned to tie in fights of a dozen a side, it loses the
  small ones (4–8 a side) to the bigger soldiers — "they win by numbers" (its species' blurb). It was trimmed from 44 /
  5 to 42 / 4.8 so the others needed less.
- Sickle-jaw soldiers win one on one (+1.00) and lose in groups (2 v 2 −0.33, 3 v 3 −0.78 with `PURSUE=1`): each holds
  one enemy until it dies, and the others go free. On a marker they guard the trail rather than charge (the harness's
  fights stall at 120 s), as designed.
- The nasute's glue stream is the strongest soldier weapon (pure damage from five body lengths, +0.52 at 21.6 food).
  Its ramp (2 → 20 dps) is the user's and stays exactly; the nasute costs more wood instead (× 2.2 the baseline worker,
  was × 1.8: 22 + 4.4), and its health is 12 (was 12.8). (With the ramp at 1.6 → 13.5 it tied at the old price.)

## Majors
| major | hp | bite | armour | cost | v tropical fire ant major, 420 food |
|---|---|---|---|---|---|
| Tropical Fire Ant | 95 | 7 | 2 | 70 | reference (6 a side) |
| Leafcutter | 120 | 9.5 | 3 | 80 | −0.10 |
| Army Ant soldier | 92 | 11.2 | 2 | 86 | ≈ 0 (tie at these numbers) |
| Nasute major | 76 | 5.6 | 1 | 42 | −0.17 |

Before, two of each at 150 food: leafcutter and army ant majors +1.00, nasute major −0.29.

## Creatures (buffed)
Against black garden ant workers (5 / 10 / 20 / 40): does it die, and how many ants does it take?

| creature | hp (was) | bite (was) | before | after |
|---|---|---|---|---|
| ground beetle | 300 (150) | 12 (9) | lives / lives / dies (−4) | lives / lives / dies (−8) |
| wolf spider | 280 (140) | 18 (16) | lives / **dies** (−6) / dies | lives / lives / dies (−8) |
| stone centipede | 220 (110) | 10 (7) | **dies to 5** (−3) | lives / lives / dies (−3) |
| rove beetle | 320 (180) | 22 (20) | lives / lives / dies (−4) | lives / lives / dies (−8) |
| mantis | 480 (260), armour 2 (1), strikes every 1.6 s (2.4), flees at 10 % (20 %) | 36 (30) | **dies to 5** (−2) | lives / lives / dies (−9) |
| antlion | 180 (90) | 16 (12) | lives / lives / dies (−4) | lives / lives / dies (−11) |
| spiderling | 30 (22) | 4 (3) | dies | dies (still a small one) |
| pill woodlouse, cutworm | 90 (60), 180 (120) | — | food | food (longer to bring down) |

Bosses (20 / 40 / 80 / 120 workers): the tarantula, the giant mantis and the Hogna mother need 80–120 workers; the
stag beetle and the banded centipede beat 120. Unchanged.

## Costs
`balance.ts` tile costs (build + hatch): fire ant minor 10 + 1 (hatch was 1.5), fire ant soldier 16 + 3 (was 20 + 3.5),
army ant media 24 + 5 (was 28 + 5), army ant soldier 75 + 11 (was 90 + 12), nasute soldier 22 + 4.4 wood (was 18 + 3.6).
Every worker still builds for 10.
