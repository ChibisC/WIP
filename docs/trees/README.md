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
