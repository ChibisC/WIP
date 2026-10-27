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
- **Teeth stay on the edge.** A tooth bulges only the outermost part of the inner half of each
  cross-section, so a row of small teeth reads as teeth on the margin rather than ribs across the blade.
- **Tines.** Separate blades that branch off, each on its own short centreline rooted inside the blade (a
  stag beetle's big tooth and the inner prong of its fork). A tine can taper slowly and widen into a fillet
  where it grows out of the blade (`taper`, `flare`).
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
browser. `tools/mandible-overlay.py` lays a mandible's top-view silhouette over a specimen photo, which is how
the stag beetle's outline was traced (the output contains the photo and stays out of the repository). `tests/browser/jaws.py` renders close-ups, and `tools/jaws-sheets.py` puts them next to the photos and
makes the blind pairs.

## Pilot results

Two review rounds by fresh reviewers drove the changes (scores and notes in `PROGRESS.md`).

- **Fire ant worker.** The outer margin is a quarter ellipse: it leaves the head's front corner straight
  ahead and curves in to an apex just past the midline, about half the hinge's distance in front of it. The
  cutting edge is straight, about 30° off transverse, with four teeth: the apex plus three, smaller toward
  the basal angle. Closed, the pair is a low dark arc in front of the head. The clypeus projects as a lobe
  over the jaws' bases and covers the space between the two cutting edges, as in *Solenopsis*. There is no
  open gap and no "toothy mouth". Open (about 80°), the toothed triangles show. Reddish brown darkens to near
  black at the teeth.
- **Fire ant worker head.** A rounded square, about 1.1–1.2 times as long as wide, with nearly parallel sides
  and a broad front. The antennae insert near the front, close to the clypeus. The surface is smooth and
  shining: the reticulate cells, whose cavity shading read as a pebbled skin, are gone. The clypeal carinae
  are dropped, because at this scale their ends read as upright prongs.
- **Fire ant major.** Massive black jaws, deep and broad with worn, nearly toothless edges. They are hinged
  higher in the face, so their upper side continues the head's front and the closed pair makes a blunt dark
  muzzle. The face darkens gradually into them, the lower front most. The head's profile slopes down to them.
- **Stag beetle (major male).** The outline was traced from a specimen photographed from above (photo
  stag_03) with the overlay tool:
  - The jaw leaves the head's front corner at about 55° in a smooth swollen bulge (no flange or corner).
  - It turns through the basal third to run straight forward, then leans in over the distal third.
  - It tapers to a sharp point that hooks in a little.
  - The big inner tooth at 0.57 of the length is a thorn standing straight in. The fork's inner prong at 0.78
    is longer and slightly upturned, and the point above it is a little longer still. Both have filleted
    roots.
  - A row of seven fine denticles runs below the big tooth.
  - It is held raised, rising from the head and levelling toward the points.
  - Dark maroon darkens to near black at the points; satin and finely pitted, no longer lacquered.
- **Stag head.** Broad and flat, its front corners carrying the antler bases, notched at the eyes, with a
  front ridge.
- **Allometry.** A male-size parameter runs from a small male to a major (photo stag_06):
  - Jaws get shorter, out less at the base and curved in more, like calipers.
  - The fork shrinks to a small prong but stays.
  - The big tooth shrinks to a nub and goes.
  - The denticles fade out below mid size.
  - The head becomes narrower than the pronotum.
  - The game's boss is a major.

Comparison sheets: `docs/realism/jaws/compare-jaws.png` and `compare-allometry.png` (kept out of the
repository: they contain the study photos), and `renders-jaws.png` (the renders alone). The review is in
`PROGRESS.md`.
