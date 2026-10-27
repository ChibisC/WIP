# European stag beetle — *Lucanus cervus* (Lucanidae) — BOSS

## Size
- Males 35–75 mm including mandibles (game boss: 100 mm, ~1.4×).

## Anatomy (male)
- **Mandibles enormous**, antler-like, ≈ .35 L, reddish-chestnut, curving
  inward with an inner tooth near the middle and a forked tip.
- Head black, broad, flat, wider than long, with elbowed antennae ending in a
  **lamellate club of 4 comb-like plates**.
- Pronotum black, broad, rounded sides.
- **Elytra chestnut / reddish-brown**, smooth and glossy, covering the abdomen.
- Legs black, robust, fore tibiae toothed for digging; tarsal claws strong.

## Mandibles (jaws pass, 2026-10-27)

Built by the shared generator (`src/render/anatomy/mandible.ts`) from `stagMandible(size)` in
`src/render/anatomy/mandibleSpecs.ts`. The outline was traced on photo stag_03 (a major from above) with
`tools/mandible-overlay.py`, and the allometry follows photo stag_06 (study only). `size` is the male's
allometric size: 0 = a small male, 1 = a large major (the game's boss is a major). Fractions are of the
mandible's own length, hinge to apex.

| | Major male (size 1) | Small male (size 0) |
|---|---|---|
| Length | 0.34 of the body length (mandibles included), about the head and pronotum together | 0.12, about the head's length |
| Outline (top) | Leaves the head's front corner at about 55° outward from a smooth swollen base. Turns through the basal third to run straight forward (0.45–0.65). Leans in over the distal third, the point hooking in a little more (0.58 rad). Width: 0.29 at the base, 0.15 through the middle, narrowing between the big tooth and the fork, tapering to a sharp point. | Calipers: out a little at the base, curving in all along (to 0.86 rad at the point). |
| Thickness (side) | Flattened: 0.12 at the base to 0.02 at the point. Sharp inner edge (wedge), rounded outer edge, flatter underneath. Held raised: 0.2 rad at the base, 0.36 through the basal quarter, 0.08 at the point. | Thicker, less raised. |
| Teeth | The big inner tooth is a thorn 0.12 long at 0.57, standing straight in and a little forward, its root filleted into the blade. A row of seven fine denticles runs from 0.41 to 0.53. | No big tooth. The denticles fade out below mid size. |
| Tip | Forked. The inner prong at 0.78 is 0.17 long, nearly transverse and slightly upturned. The point above it is a little longer and hooks in. | A small inner prong near the point (0.07). |
| Colour | Dark maroon (#46181c) at the base, darker through the middle (#34121a), near black at the points and teeth (#0a0506). | Same. |
| Surface | Satin, finely granulate and pitted (detail recipe `STAG_MAND`, clearcoat roughness 0.3). | Same. |
| Hinge | At the head's front corners, the base a rounded heel seated in the head. | Same. |
| Closed / open | At rest the tips point at each other with a gap of about a third of the span. In the grab each swings 0.7 rad outward; clamped, they close past rest. | Same. |

The head (`stagBeetle.ts` `headGeo`) was reshaped to carry them. It is broad and flat, nearly as wide behind
as the pronotum's front, its sides diverging to sharp front corners that jut forward over the mandible bases.
It is notched at the eyes, the front margin hollowed between the mandibles, with a raised transverse ridge
across the front.

## Colour and surface
- High gloss (clearcoat) on elytra and mandibles; head/pronotum black satin.

## Movement
- Slow, heavy **tripod gait**; raises the head and mandibles when threatened.
  Males fly clumsily on summer evenings (not used).
- Animation pass (docs/realism/animation.md): feet planted in world space, stepping in alternating tripods
  when the body has moved or turned far enough (turning in place steps round), the body rocking toward the
  planted tripod. Three idles (antenna flicks, a jaw opening, a slight rear-up). The grab (antlers wide and
  quivering, head low), the clamp's snap and lift with an overshoot, and the toss's flick (tossed ants tumble
  and bounce). The rear-and-slam: a crouch, the rear with an overshoot, the slam on the sim's slam tick
  (dust ring, camera shake, hit-stop) and a dip. Two hit flinches. Death: the legs curl in half a second,
  twitching, and it rolls onto its back. The antlers and antennae sway on springs.

## Behaviour (boss phases)
1. **Advance**: plods forward, mandibles open; ants latched slow it only
   slightly (high strength).
2. **Grab and toss** (telegraph: head raised, mandibles spread wide): clamps
   an ant or cluster and **flings it** (as males do to rival males in combat).
3. **Rear-up crush** (enraged below 40%): rears on hind legs and slams down
   (area knockback), shaking off latched ants.

## Facts for info cards
- Male stag beetles use their antler mandibles to wrestle and throw rivals off branches.
- Stag beetle larvae spend 3–7 years underground feeding on decaying wood.
- Adult stag beetles live only a few weeks and feed mostly on sap.
