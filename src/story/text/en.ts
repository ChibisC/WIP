/**
 * Story narration, English (claude/story/02-spec §2: short captions, one voice, data for editing and translation).
 * The narrator is Dr. Elena Varga, a field myrmecologist on Wayfarer Island (docs/story/DESIGN-STORY.md); she has no
 * model and appears only in these captions. Keys: `<level>.<key>` for captions (voice lines hook on the same key:
 * audio `narration/<key>`), `tip.<key>` for gameplay tips, `journal.<level>.*` for the field journal pages.
 * Real-species facts are sourced in DESIGN-STORY.md §9.
 */
export const EN: Record<string, string> = {
  // ------------------------------------------------------------------ Level 1 — The Garden Below
  'garden.intro1': 'Field journal, Wayfarer Island. Eleven years I have spent here, watching what the sea and the storms bring ashore.',
  'garden.intro2': "Last night's storm left something new by the garden puddle: a winged queen, soaked, dragging herself out of the water.",
  'garden.beetle': 'A ground beetle stops to look her over. Most of its kind are night hunters; this one is late going home.',
  'garden.intro3': 'She sheds her wings and digs in. A founding queen seals herself away and raises her first brood alone, on the reserves in her own body.',
  'garden.termant': "She is no species I know. An ant's body, but her workers chew dead wood like termites, and ants are wasps' cousins, termites a kind of cockroach.",
  'garden.nanitics': 'Her first daughters are small. A queen feeding brood from her own body can only afford little workers at first.',
  'garden.wood': 'They gather wood as readily as food. Nothing on this island eats both.',
  'garden.contact1': 'Visitors. Two black garden ant workers, Lasius niger, one of the commonest ants in Europe and plainly common here too.',
  'garden.contact2': 'In an ant colony the young workers stay below, nursing brood; only the older ones go out to forage. These two are old hands.',
  'garden.contact3': 'Back up the bank to report. A forager that finds something worth having lays a scent trail home, and its nestmates follow it.',
  'garden.contactDead': 'They will not be reporting back. Their nest will notice who is missing, all the same.',
  'garden.genes1': "Now I see what she does with the dead. Her workers carry Lasius corpses into the stores, and the colony keeps more than the meat.",
  'garden.aphids': 'Up on the flowerbed the garden ants keep aphids, stroking them for sugary honeydew and driving off the ladybirds that hunt them.',
  'garden.genes2': 'Her newest brood are not hers at all: black garden ant soldiers, big-headed and strong, raised in a stranger’s nest.',
  'garden.raid1': 'The garden colony has noticed her. Lasius defend their aphids and their nest hard.',
  'garden.flank': 'The stone steps are watched. At the far end of the flowerbed the bank has slumped into a narrower way up.',
  'garden.queenFact': 'A Lasius niger queen can live for decades; one kept by a German entomologist lived nearly twenty-nine years.',
  'garden.flight': 'On warm, still summer days their winged queens and males fly all at once, across whole towns. This garden will not send any this year.',
  'garden.win': 'The garden is hers. One season ago she was flotsam; now she rules this side of the puddle.',
  'garden.lose': 'The queen is dead. The garden ants will clear what is left of her colony by nightfall.',
  // ------------------------------------------------------------------ Level 2 — Fire on the Banks
  'fireBanks.intro1': 'Spring. The garden colony has sent out a young queen, and she has come south to the river, where the ground is warm and bare.',
  'fireBanks.intro2': 'That ground belongs to tropical fire ants, Solenopsis geminata. The species is American; Spanish galleons carried it across the Pacific in the 1500s, and on around the tropics.',
  'fireBanks.foragers': 'A foraging column. Fire ant workers come in many sizes, from small minors to big, square-headed majors.',
  'fireBanks.sting': 'A fire ant grips with its jaws, then arches and stings, again and again. Their venom is mostly alkaloids, not the proteins of a bee.',
  'fireBanks.numbers': 'Alone, a fire ant worker is small. They win by numbers: disturb the mound and hundreds pour out at once.',
  'fireBanks.warn': 'The majors are gathering at the top of the slope. Something is about to come down it.',
  'fireBanks.swarm': 'Here they come. Hold them at the foot of the slope, where only so many can fight at once.',
  'fireBanks.swarmDone': 'The swarm is spent. The bank is littered with the dead, and her workers are already carrying them home.',
  'fireBanks.majors': 'The square-headed majors rarely hunt. Their blunt jaws crack seeds, and the colony keeps the grain in its chambers.',
  'fireBanks.genes': 'She wants the majors. Their bodies are worth more to her than any number of small workers.',
  'fireBanks.stolen': 'Fire ant majors, raised by a queen that is not a fire ant. She took this in a single season.',
  'fireBanks.river1': 'The river is rising. Everything living on the low margin is heading for higher ground.',
  'fireBanks.river2': 'Fire ants ride out floods on rafts of their own linked bodies. The trick is best known from a cousin, the red imported fire ant.',
  'fireBanks.river3': 'The water is going down. The margin will be mud for days.',
  'fireBanks.assault': 'The mound is the last of it. The main slope is a killing ground; the root at the east end climbs the bank unwatched.',
  'fireBanks.unease': 'I keep checking my notes: two species, two seasons, and she has learned the weapons of both. Nothing learns that fast.',
  'fireBanks.win': 'The fire ants are gone from the bank. The river belongs to her now.',
  'fireBanks.lose': 'The queen is dead. By morning the fire ants have carried her colony into their mound.',
  'fireBanks.ending': 'One more thing troubles me. In the island’s heart there are ants that have been doing what she does for far longer than she has.',
  // ------------------------------------------------------------------ Tips (gameplay, shown as notes, not narration)
  'tip.dig': 'Tip: the Build panel (bottom right) has Dig. Paint soil for workers to dig out, then lay brood and store tiles in the space.',
  'tip.tiles': 'Tip: brood tiles raise ants; food store tiles hold food. Tiles next to each other form one chamber and one group.',
  'tip.forage': 'Tip: foragers find food on their own and lay trails home. Place marker I on a food source to send a group there.',
  'tip.markers': 'Tip: markers I–V send your groups across the surface. Drag a group’s button onto a marker in the marker panel.',
  'tip.wood': 'Tip: Gene-Thief Termant workers eat everything: dead wood, leaf litter and leaves go into the same food store as the rest, and carton walls are built from it.',
  'tip.genes': 'Tip: carry enemy corpses into the stores. The Genome tab in the Build panel shows the gene samples of each species.',
  'tip.caste': 'Tip: the Black Garden Ant Soldier is in the Build panel now. Its brood tile raises soldiers from the stolen genes.',
  'tip.ramps': 'Tip: the banks are too steep to climb. Ants go up and down by the ramps; a defended ramp is a chokepoint.',
  'tip.rival': 'Tip: put a marker on the rival entrance to send your groups down into its nest, then onto its queen.',
  'tip.fireCaste': 'Tip: the Tropical Fire Ant Major is in the Build panel now.',
  'tip.flood': 'Tip: the low margin floods. Pull your ants up the ramps before the water comes.',
  // ------------------------------------------------------------------ Field journal pages
  'journal.garden.title': 'Lasius niger — the black garden ant',
  'journal.garden.body':
    'One of the commonest ants in Europe, and on Wayfarer Island the master of the gardens. Workers are 3–5 mm, dark brown to black. A colony begins with a single queen who seals herself in and raises her first, small workers alone. As in most ants, young workers nurse and older ones forage, recruiting nestmates along scent trails. They farm aphids for honeydew and guard them from predators. Queens are long-lived: one kept in captivity lived almost twenty-nine years.',
  'journal.garden.note': "The newcomer took their soldier caste from their dead. I have no explanation for it.",
  'journal.fireBanks.title': 'Solenopsis geminata — the tropical fire ant',
  'journal.fireBanks.body':
    'Native to the Americas; genetic studies trace its spread to Spanish trade in the 16th century, from Acapulco to Manila and on around the tropics. Workers vary greatly in size, from small minors to large majors with square heads and blunt jaws that crack seeds; the colony stores grain. A worker grips with its mandibles and stings repeatedly; the venom is mostly alkaloids. Colonies nest in open, sunny, disturbed ground under loose soil mounds, and fire ants (best studied in the red imported fire ant) survive floods by linking into living rafts.',
  'journal.fireBanks.note': 'Two species, two seasons. She learns faster than anything I have studied, and I think something on this island learned it first.',
};
