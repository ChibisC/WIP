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
`src/render/anatomy/mandibleSpecs.ts`. Measured on the reference photos stag_02, stag_05 and stag_06 (study
only). `size` is the male's allometric size (0 = a small male, 1 = a large major; the game's boss is a
major). Fractions are of the mandible's own length, hinge to apex.

| | Major male (size 1) | Small male (size 0) |
|---|---|---|
| Length | 0.34 of the body length (mandibles included), about the head and pronotum together | 0.17 |
| Outline (top) | Leaves the head's front corner at about 45° outward, continuing the head's side. Turns to run straight forward through the middle (0.45–0.65), then hooks inward toward the point. Broad flat blade: 0.34 wide at the base (a third of the head's width), 0.12 at the middle, 0.04 near the point. | A gentle inward curve, broad at the base. |
| Thickness (side) | Flattened top to bottom: 0.11 at the base to 0.03 at the point. Sharp inner edge (wedge), rounded outer edge, flatter underneath. Rises gently (0.28 rad at the base to 0.06 at the point). | Thicker, less flattened. |
| Teeth | One large inner tooth at half way: a broad flat point 0.13 long, standing in from the inner edge and leaning back toward the head. Three small teeth on the broad base (0.10, 0.17, 0.24). A row of four denticles from 0.65 to 0.76. | One small tooth at 0.72. |
| Tip | Forked. The point curves inward, and an inner prong branches at 0.77, angled further inward and rising above the point (the upper prong, a little longer). | Simple. |
| Colour | Dark maroon to chestnut (#4a1c1b, a little darker and duller than the elytra), near black at the points and teeth (#120809). | Same. |
| Surface | Finely granulate-punctate, satin (detail recipe `STAG_MAND`). | Same. |
| Hinge | At the head's front corners: the outer margin of each base continues the head's side. | Same. |
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
