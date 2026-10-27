# Jaws pass: mandibles that match the real animals (pilot)

User spec: project doc `claude/realism/03-spec-jaws-and-animation.md`, part 1. Pilot species are the tropical
fire ant (worker, plus the major and queen that share its builder) and the stag beetle. The rollout to every
species waits for the user's approval.

## The shared generator (`src/render/anatomy/mandible.ts`)

A mandible is described as an entomologist would draw it. Each species' numbers live in
`src/render/anatomy/mandibleSpecs.ts` and in the "Mandibles" section of its `docs/creatures/<id>.md`.

- **Centreline.** It runs from the hinge to the apex, bent by a heading curve (`yaw`, + toward the
  midline) and an elevation curve (`pitch`). These are smooth, overshoot-free interpolations through control
  points.
- **Outline (top view).** The distance from the centreline to the outer margin (`outer`) and to the inner
  cutting margin (`inner`) along the blade.
- **Thickness.** A dorso-ventral profile (`thick`). The cross-section is a superellipse whose inner edge can
  be a wedge (`edgeIn` ≈ 1.3) and whose outer edge is rounded (`edgeOut` ≈ 2). A minimum edge thickness
  (`edgeMin`) bevels the edge, and the underside can be flatter (`flatBelow`).
- **Teeth.** Triangular points on the inner margin, each sized, leaning toward the apex or the base, and
  sharp or worn blunt (`teeth`). The samples along the blade include every tooth's point and base, so the
  points stay sharp.
- **Tines.** Separate blades that branch off, each on its own short centreline rooted inside the blade (a
  stag beetle's fork).
- **Heel.** An optional rounded heel behind the hinge (`baseRound`), seated in the head, so the base closes
  in a rounded condyle instead of a flat cut (the user's note of 2026-10-26).
- **Colour.** Per-vertex colour darkening from the base to the apex and onto the teeth and the cutting edge.
- **Build.** Every cross-section is a ring from the outer margin over the top to the inner margin and back
  underneath, placed in the centreline's frame. The 2D outline is therefore extruded and bent in one step,
  closed at both ends, wound outward and given surface coordinates for the baked detail (regions `MANDIBLE`
  and `CR_MAND`).
- **Fitting.** `fitLen` scales a spec so the apex reaches a given distance toward the midline. An ant's pair
  is fitted to close with a little overlap in front of the clypeus. The hinge is placed at the head's
  anterolateral corners (`antGeometry.ts`). The opening angle is per species (`mandible.open`).

Tools: `tools/mandible-dump.ts` and `tools/mandible-plot.py` give quick top and side plots without the
browser. `tests/browser/jaws.py` renders close-ups, and `tools/jaws-sheets.py` puts them next to the photos and
makes the blind pairs.

## Pilot results

- **Fire ant worker.** Two triangular plates close across the front of the head. Each has four teeth (the
  apex plus three, smaller toward the base) and runs reddish brown to near black at the teeth. Open, the pair
  spreads about 80°. The head was reshaped with them: oval-rectangular, widest behind the middle and
  narrowing to the jaws, domed in profile and sloping to the clypeus. The sting now rests retracted.
- **Fire ant major.** Short, thick, black jaws with worn, blunt crowns. The front of the head darkens toward
  them.
- **Stag beetle.** Broad flattened blades with a sharp inner edge. Each leaves the head's front corner at
  about 45°, runs forward and hooks inward. A large inner tooth sits at half way, leaning back. There are
  small teeth on the base and a row of denticles toward the forked tip, whose inner prong rises above the
  point. Colour is dark maroon to near black at the points. The bases close in rounded lobes beside the mouth,
  where the labrum and golden maxillary brushes now fill the gap.
- **Stag head.** Broad and flat, its front corners carrying the antler bases, notched at the eyes, with a
  front ridge.
- **Allometry.** A male-size parameter goes from a small male (short, simple jaws, a head narrower than the
  pronotum) to a major (photo stag_06). The game's boss is a major.

Comparison sheets: `docs/realism/jaws/compare-jaws.png` and `compare-allometry.png` (kept out of the
repository: they contain the study photos), and `renders-jaws.png` (the renders alone). The review is in
`PROGRESS.md`.
