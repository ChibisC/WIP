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
- Legs black, robust, fore tibiae toothed for digging; tarsal claws strong. The fore tibia (model: `stag_tibia1`,
  fixed 2026-11-06) is long and slender (about an eighth as wide as long), nearly parallel-sided, bowing slightly
  outward, with a row of small teeth growing toward the apex along its outer edge, the apex forked into two prongs
  and two short spurs on the inner face; it lies flat with the toothed edge away from the body, held beside and a
  little ahead of the head, never past the mandibles.

## Mandibles (jaws pass, 2026-10-27)

Built by the shared generator (`src/render/anatomy/mandible.ts`) from `stagMandible(size)` in
`src/render/anatomy/mandibleSpecs.ts`. The outline was traced on photo stag_03 (a major from above) with
`tools/mandible-overlay.py`, and the allometry follows photo stag_06 (study only). `size` is the male's
allometric size: 0 = a small male, 1 = a large major (the game's boss is a major). Fractions are of the
mandible's own length, hinge to apex.

| | Major male (size 1) | Small male (size 0) |
|---|---|---|
| Length | 0.34 of the body length (mandibles included), about the head and pronotum together | 0.075, about the head's length |
| Outline (top) | Leaves the head's front corner at about 55° outward from a smooth swollen base. Turns through the basal third to run straight forward (0.45–0.65). Leans in over the distal third, the point hooking in a little more (0.58 rad). Width: 0.29 at the base, 0.15 through the middle, narrowing between the big tooth and the fork, tapering to a sharp point. | Short and stout (widths 1.45× the major's as fractions of length), nearly straight, the point turning in a little (0.56 rad). |
| Thickness (side) | Flattened: 0.12 at the base to 0.02 at the point. Sharp inner edge (wedge), rounded outer edge, flatter underneath. Held raised: 0.2 rad at the base, 0.36 through the basal quarter, 0.08 at the point. | Thicker, less raised. |
| Teeth | The big inner tooth is a flat, broad-based lobe 0.1 long at 0.57, standing straight in and a little forward, its root filleted into the blade. A row of seven fine denticles runs from 0.41 to 0.53. | A nub of the big tooth (0.04). The denticles fade out below mid size. |
| Tip | Forked. The inner prong at 0.78 is 0.15 long, flat, nearly transverse and slightly upturned. The point above it is a little longer and hooks in. | A small inner prong near the point (0.08). |
| Colour | Purple-chestnut (#3e1c22) at the base, darker through the middle (#2e161c), near black at the points and teeth (#0a0506). | Same. |
| Surface | Satin to glossy, finely granulate and pitted (detail recipe `STAG_MAND`, clearcoat roughness 0.22). | Same. |
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

## Males of four sizes (2026-11-03; claude/story/06-spec-levels-5-7-and-lengths.md §2)

Besides the titan (a major male, boss), four normal males: `stagMinor`, `stagSmall`, `stagMedium`, `stagLarge`
(kinds.ts, ai `stagMale`; behaviour numbers in `BALANCE` `STAG_MALE`). They are the same model at male sizes 0, 1, 2, 3
(of the five the model has, 4 being the titan's major): the head narrows and the antlers shorten with the allometry above
(antlers 7.5 %, 14 %, 21 % and 27 % of the length; the major's 34 %). Lengths 45, 55, 70 and 85 mm (0.45–0.85 of the
titan's 100 mm), so drawn, antler tips to elytra apex, about 32, 43, 59 and 77 mm — within the real 35–75 mm of males,
the minor a little under. Because the short antlers leave the major's layout tail-heavy, a male's model is drawn shifted
forward so its body is centred on the sim position, and its outline capsule runs from the elytra apex to the antler tips
(`stagMaleGeom`). Shots: `docs/creatures/shots/stag_sizes_*.jpg` (tests/browser/stag_sizes.py).

| | minor | small | medium | large |
|---|---|---|---|---|
| Moves | plods on shoving ants aside; pinches what fights it (threat first) | as the minor | + grabs an ant in its antlers, lifts and tosses it (every 9 s) | + grabs two (every 7 s); rears and slams when hard pressed (under 60 % health, 3+ ants round it); shakes riders off |
| Wild | forests and rainforests only, rarer than the common creatures | | | the rarest |

**Rival males wrestle** (`stagWrestle.ts`). Two males (any sizes, never the titan) that meet with no ants about square
up (reared a little, antlers spread), lock antlers and shove back and forth, their heads twisting; then the winner — the
bigger one mostly, a hurt one less often — rears, lifts the other in its antlers and flicks it off to one side. The loser
lands on its back, legs waving, rights itself and walks off; neither is hurt, and both leave rivals alone for 40–80 s.
Ants coming close or a hit on either break the bout off. In the wild, males fight like this over females and sap
flows; the winner lifts its rival and drops or throws it off the branch. Story levels can stage a bout with
`startStagWrestle(w, a, b)`.

Facts for the males' cards: how big a male grows and how long its antlers get depends on how well it fed as a larva
(small males' jaws are about as long as the head); males run from about 35 to 75 mm, antlers included; a big male's
antlers grow faster than its body (positive allometry); rival males lock antlers and the stronger throws the other off
the branch; larvae live 3–7 years in dead, rotting wood; adults live a few weeks, mostly on fat stored as larvae,
drinking a little sap.
