# The Trees — a third layer over the ground

Spec: `claude/trees/01-spec-trees-layer.md` (user, 2026-11-07). Plan: `CHANGE_PLAN.md` §30. Design: `DESIGN.md` §3.13.

Stills in `shots/` (`tests/browser/trees.py`, meadow pond, `?trees=1`):
- `canopy.jpg` — the canopy over a trunk from above: the trunk-top disc, the branches and leaves, the ground far below.
- `ground.jpg` — a trunk's foot with its three climb points (pale rings).
- `bar.jpg` — the TREES bar right of the ground map.
- `climb.jpg` — a group sent to a marker on a branch: ants on the bark at a climb point (seen from the ground).
- `leaf.jpg` — ants out on a branch by their marker, in the trees view.
- `fight.jpg` — a fight on a branch (a wolf spider placed on the twig).
- `fall.jpg` — ants flung off a branch by a stag beetle, dropping to the ground.
- `off.jpg` — a match without the layer: no bar, no trunks.

Tools: `npx vite-node tools/trees-check.ts -- <seed>` (every map's canopy, the joined-canopy and reachability checks),
`npx vite-node tests/trees.ts`.

### 2026-11-08 — the climb as a bark walk (`tests/browser/trunk_climb.py`)
- `climb_walk.jpg` — ants on a willow's trunk from the ground: feet on the bark, bodies parallel to the trunk, going up.
- `climb_rim.jpg` — the trees view: two ants over the trunk top's rim, stepping onto the wood.
- `clips/climb.gif` — a group sent to a branch: from the ground at the climb point, tipping up onto the bark and climbing.

## Trees v2 (2026-11-24) — real trees in tiers (claude/trees/02-spec-trees-look-and-tiers.md; CHANGE_PLAN §38)
Stills in `shots/v2/` (render only; `scratchpad` probe `look.py` per map with ants placed on every tier, the tree lab
`?scene=treelab` for the sheets):
- `<species>_crown.jpg` — a crown from the tilted camera: the trunk rising out of the haze to its crotch, limbs to the
  high tier near the middle and out and down to the low boughs, leaves in clusters off the walkways.
- `<species>_tiers.jpg` — closer: a sloping branch between two tiers, ants on both, a drop where one passes over another.
- `oak_close.jpg`, `acacia_close.jpg` — the bark and leaves near (acacia's paired thorns).
- `lab/bark.jpg`, `lab/bark_close.jpg` — the five barks on walked limbs (oak, beech, willow, rainforest, acacia).
- `lab/leaves.jpg` — each species' four blades, upper side and underside.
- `lab/crotch_*.jpg` — round 2 (the user's notes, 2026-11-24): the trunk swelling into thicker limbs, each with its
  collar — oak from the side near and far and from above, beech, rainforest, acacia from above.
References (descriptions and numbers, no photos): `references.md`.
