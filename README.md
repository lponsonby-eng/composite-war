# Composite War

A pixel-art strategy game in plain HTML, CSS and JavaScript: conquer towns on a large
map of eight regions, then fight real-time battles with generals and their squads.

Open `index.html` through any local web server (for example `python3 -m http.server`).

## Files
- `js/data.js` – the scenario: factions, regions, unit stats, generals, levelling, hiring, ground. Start here.
- `js/events.js` – story events: the prologue, faction openings, region discoveries, random events, milestones and endings.
- `js/map.js` – the map: 92 towns, roads and landmark positions (made by `tools/genmap.py`, safe to hand-edit).
- `js/art.js` – pixel art drawn in code: each region's buildings, landmarks and scenery.
- `js/heraldry.js` – faction banners: random symbols in faction colours, each side with its own glow effect.
- `js/game.js` – campaign state, turns, AI opponents, panels and dialogs.
- `js/battle.js` – the real-time battle simulation and drawing, and the skill handlers (`SKILL_FX`).
- `js/terrain.js` – battlefield generation: hills, forests, rivers, streams, lakes, swamps, and walled towns with their cliffs, lakes, gates and the way round to them.
- `js/battleui.js` – battle controls: selecting squads, orders, formations, skills, battle minimap.
- `js/mapview.js` – draws the strategy map, scrolling, zoom and the minimap.
- `js/assets.js` – loads images and sounds.
- `js/palette.js` – the game's fixed palette (Resurrect 64) and snapping colours to it.
- `js/main.js` – startup, frame loop, mouse input.

## The map
Eight regions, each with its own faction, ground, building style, scenery and landmark:
Aster Plains (castles), Frozen North (igloos, ice peak), Darkwood (tree huts, giant dead tree),
Ember Peaks (forges, volcano, lava), Mistlands (towers, ruins, drifting mist), Bogmire Fens
(stilt huts, giant mushroom), Crystal Lakes (crystal spires on islands) and Sunscar Desert
(adobe houses, pyramid), with the neutral Heartlands in the middle. Each faction starts
with its capital and three towns; the other 60 towns are free towns held by militia.
Win by defeating every rival faction.

Each faction's landmark stands beside its capital and empowers one of its own units in nearby battles
(full strength near the landmark, fading with distance, and only while the faction holds its capital):
Aster's Royal Bastion (Knights), Frostmark's Heart of Winter (Frost Eyes), the Thornwood's Old Hollow
(Witches), the Ember Clan's Mountain of Fire (Fire Spirits), the Shadow Order's Whispering Ruins (Ghosts),
the Horde's Mother Mushroom (Bog Beasts), the Azure Tide's Prism Spires (Crystal Eyes) and the Sun Pyramid
(Sun Guards). The Heartlands' Old Stones help the Free Towns' Militia while they hold the Crossroads.
The bonuses are set in `DATA.landmarkPower` in `js/data.js`.

The map is drawn as a painted atlas with a touch of crisp pixel terracing (`buildTerrain` in `js/mapview.js`):
each region keeps its own colours and biome (`LOOK`), an elevation field raises mountain ranges away from towns
and roads (lit from the north-west, stepped into terraces with cliff faces, snow on the frozen peaks), forests are
clusters of round canopies, rivers run downhill to the sea, the coast is a bright rim over a sea that deepens
from the shore, and towns are joined by thin pale routes. Region names are italic serif lettering, town names
plain outlined lettering, and towns are the generated buildings below, each on its own block of ground.

To make a different map: `python3 tools/genmap.py 42` (any number gives a new layout).

## Pixel art generators
`tools/pixelgen/` holds offline pixel-art generators (no APIs, no network, no dependencies).
Every picture comes from a seed, so a design you like can be made again from its seed and options.
They draw at the game's own sizes, in faction colours with hue-shifted ramps and dark outlines:
- **hero**: 64 x 112 unit sheets like `assets/chars` (down/up/left/right; walk, attack, hurt, cast), by class, weapon and headgear
- **portrait**: 38 x 38 faces like `assets/faces` (skin, hair, beards, helmets, hoods, wizard hats, circlets)
- **monster**: 64 x 64 creature sheets like `assets/monsters` (blobs, beasts, flyers, eyes, bugs, spirits)
- **fx**: 32 x 32 effect strips like `assets/fx` (burst, slash, sparkle, smoke, ring, orb) in each element's colours
- **tile**: 32 x 32 seamless ground (grass, dirt, cobble, sand, snow, water, lava, brick, planks, swamp, crystal)
- **item**: 16 x 16 icons (sword, axe, spear, bow, staff, shield, potion, gem, scroll, ring)
- **palette**: colour ramps for a faction or base colour, with harmony colours, skin and metal

**Medieval 32px set** (`tools/pixelgen/medieval.js`), in the spirit of late-medieval battle art such as
Danville's *The White Company*: realistic proportions, readable faces and beards, plate and mail with hard
highlights, and heraldry on everything. Each faction gets its own coat of arms (rolled from its name), so a
whole army's surcoats, shields, banners and tents match:
- **arms**: 32 x 36 coat of arms on a heater shield (divisions, ordinaries and charges, keeping the rule of tincture)
- **soldier**: 128 x 232 sheet of 32 x 40 frames (front/back/left/right; walk, attack) plus two fallen bodies in blood;
  troops: knight, man-at-arms, captain, spearman, archer, crossbowman, levy. Foot soldiers (`footFrame`) are about four
  heads tall with full bodies: thick legs touching at the thigh with knee cops or boots, a chest tapering to the waist,
  a fauld or skirt over the hips, broad shoulders with pauldrons on plate, and a smaller head with rounded helms (the
  great helm has a visor slit, breaths and a ridge). Each troop keeps its own silhouette: knights in plate with surcoat
  and heater shield, men-at-arms in plate and mail with polearms, spearmen in padded coats with tall spears, archers in
  jacks with a quiver and a bow as tall as themselves, levies in plain tunics. Blades are held point-down at the side.
  Every colour runs through `tone()`: deep, cool shadows and soft warm-white highlights, with a dark navy outline
- **commander** (generals in battle): 160 x 288 sheet of 40 x 48 frames, the foot soldier's body made grand: a tall
  feathered plume in the army's colours (or a plumed wide-brimmed hat for marksmen, a jewelled circlet for mages and
  healers), a cape with a gilded hem that streams out behind, gilded pauldron edges, belt, hem and baldric; faction lords
  wear a gold crown and an ermine collar. Options: `--role warrior|marksman|mage|healer`, `--lord yes|no`. Generals are
  drawn 28 px against their men's 22, so they stand a head taller in a block
- **commanderface** (generals' portraits): 192 x 64, the matching 64 x 64 bust of a commander (same seed and options,
  so the same person) in three moods (neutral, fierce, smile): warriors in an open-faced helm with the visor raised so
  the face shows, plume, gilded pauldrons and the army's arms on the chest; marksmen in their plumed hat; mages and
  healers with circlet, mantle and stole; lords crowned with an ermine collar; on a backdrop in the army's colour
  inside a gilt frame. Used for every portrait in the game
- **champion** (the older hero style, no longer used by the game): 160 x 288 sheet of 40 x 48 frames (front/back/left/right; walk, attack, special).
  Heroes are built to stand apart from the rank and file, in the spirit of Vampire Survivors' cast: twelve
  archetypes (witch, reaper, cavalier, berserker, paladin, monk, necromancer, huntress, alchemist, jester,
  warlord, shieldmaiden), each with its own silhouette (witch hats, plumed cavalier hats, plague masks, jester
  caps, horned and winged helms, halos, crowns, wolf-pelt hoods), capes that billow as they walk, an oversized
  signature weapon, a bold personal palette instead of army livery, and a glowing aura outline. Personal traits
  (a raven or wisp familiar, drifting motes, glowing runes, eyepatches, scars) make heroes of one archetype differ.
  `--palette faction` tints a hero in their faction's colour; `--aura off` removes the outline
- **heroface** (hero portraits): 192 x 64, the matching 64 x 64 dialogue bust of a champion in three moods
  (neutral, fierce, smile). Use the same seed and options as the hero sheet and you get the same person: hat,
  hair, beard, colours, cape, weapon over the shoulder, familiar, scars and eyepatch all match, on a vignette
  lit by the hero's glow colour, with the aura outline.
- **cavalry**: 192 x 292 sheet of 48 x 52 frames (horse and rider; front/back/left/right; walk, charge) plus a fallen
  horse and rider; seven horse coats, heraldic caparisons, chanfrons, couched lances
- **creature** (`tools/pixelgen/creatures.js`): 192 x 288 sheets of 48 x 48 frames for monsters and war machines,
  inspired by Vampire Survivors' bestiary (strong one-colour silhouettes, glowing eyes, reaching, shambling and
  flapping animation): skeleton, bone priest, ninja, fishfolk, frogman, yeti, bog shaman, thornling, mud brute,
  mummy, slime, fire spirit, ghost, frost eye, crystal eye, fire hawk, bat, beetle, crab, and cannon, fire cannon,
  sun cannon, seed mortar and coral catapult. Each sheet ends with the creature's remains (blood, ichor, bones,
  ash, a wreck...). `--hero yes` makes a monster general: larger, crowned and aura-lit; **creatureface** is its portrait
- cavalry `--mount` also takes bear, stag, boar, camel and kelpie (a finned water horse)
- **building** (`tools/pixelgen/buildings.js`): 96 x 80 town buildings in three-quarter view on a floating block
  of ground, with lit windows, tiled roofs and props, one architecture per region with its fantasy element built
  in: blue-roofed castles (Aster), timber-framed towns with a windmill and clock tower (Heartlands), igloos and ice
  fortresses with crystal-ice spires (Frozen North), tree houses (Darkwood), lava forges and a black fortress
  (Ember Peaks), gothic spires with violet light (Mistlands), stilt huts and a mushroom-cap longhouse (Bogmire),
  white palaces with crystals growing through them (Crystal Lakes), adobe houses and a golden-domed palace
  (Sunscar). Sizes: village, town, capital and shrine. Each seed is a variant (roof and wall colours from the region's options,
  chimneys, towers, domes, props on the ground, sometimes mirrored); the game seeds each town by its id, so every
  town on the map and every house in a siege has its own look
- **field**: 64 x 64 seamless ground (leafy meadow, stony camp, mud, rutted road)
- **decal**: blood pools, scorch marks and trampled grass
- **prop**: camp pieces (striped pavilion, palisade, gatehouse, banner, hay bale, campfire, barrel, crates,
  weapon rack, hay cart) and scenery (oak, pine, bush, rock, stump)

Open `tools/pixelgen/index.html` in a browser to browse seeds, preview animations and download PNGs,
or write files from the command line:

    node tools/pixelgen/cli.js list
    node tools/pixelgen/cli.js hero --faction ember --cls mage --count 8
    node tools/pixelgen/cli.js hero --seed 40 --out assets/chars --name 26

Files go to `tools/pixelgen/out/` unless `--out` is given. The generators live in `tools/pixelgen/pixelgen.js`.

## Story
The realm was held together by the Concord Crown until it shattered into eight shards,
one for each faction. Story events (`js/events.js`) play as dialogue with portraits:
a prologue and an opening for each faction; a discovery with a choice the first time you
take a town in each region; random events at the start of some turns (caravans, bandits,
refugees, plague, festivals, deserters, wanderers, an old drill-master); milestones (first
victory, first signature ability, 25 and 50 towns, rival factions falling); and endings.
Choices can give or cost gold, soldiers, XP, promotions or bring a wandering general.
Add your own events by copying an entry; the format is described at the top of the file.

## Characters from free sprite packs
Generals, heroes, most foot units and many monsters are hand-made, animated characters from free packs by
[LuizMelo](https://luizmelo.itch.io) (CC0) and [Sven Thole](https://sventhole.itch.io) (free for any game), listed
in `assets/sprites/CREDITS.md`. `tools/sprites/import.py` cuts each pack into one sheet per character (rows idle,
run, attack, hurt, death, facing right; feet on one row; characters much taller than the game's figures halved) and
writes `assets/sprites/catalog.json`. In the game (`js/chars.js`) each character is recoloured for the faction that
fields it (cloth takes the faction's hue, muted; skin, steel and a monster's own colours are kept) and snapped to the
palette; units play their real animations (run, attack, hurt, idle; mirrored to face left) and leave the last frame
of their death on the field. Who looks like whom: `Chars.UNITS`, `Chars.HEROES` (generals by class; lords are
kings) and `Chars.MONSTER_GENERALS`. Portraits are a close-up of the same character. Cavalry, artillery and a few
beasts keep their generated look.

## Town walls
Battle-town walls are pixel art drawn on the art grid by `js/walls.js` (`WallArt`), after a hand-painted castle
tileset: blue-grey coursed bricks lit along their tops with dark mortar, flagstone wall-walks between parapets,
crenellations on the outer edge, arrow slits, moss creeping up from the foot and ivy hanging from the top, round
towers (corners, both sides of each gate, along long runs) with a crenellated rim and a flagged floor, oak gate
doors with iron bands, studs and ring handles that split as they are battered (and lie as splintered planks once
broken), and flagstone gateways. Streets and the market square are set stones. Everything is seeded by the town,
so it always looks the same.

## Buildings from free packs
Towns on the map, houses inside battle towns and four landmarks are drawn from free building packs (Devs in
Exile, Pixel-Deck, MutterPixel Studio; see `assets/buildings/CREDITS.md`). `tools/sprites/buildings.py` picks each
region's set (castles and timber houses for Aster, village houses for the Heartlands, stone towers for Frostmark,
cabins for the Thornwood, smithies and red forts for the Ember Clan, ruins for the Shadow Order, fishing huts for
the Horde, domed halls for the Azure Tide, tents and domes for the Sun) and packs them into one atlas. In the game
(`Art.building`, `Art.ROOF`) each region's buildings take its roof colour and tone and are snapped to the palette;
the smaller Devs in Exile buildings are shown at 2x. On the map the lead general stands at the town's left front
corner (the rest counted as +N) so the buildings show.

## Pixel art: one grid, one palette
- **One pixel grid in battle.** The battlefield is drawn into a buffer at one pixel per *art pixel* (`ART` in
  `js/terrain.js`: soldiers' 32 px art is 22 world px tall, so 32/22 art pixels per world pixel), then enlarged to the
  screen by a whole number. Zooming in steps a whole art-pixel size at a time, so sprites stay crisp; zoomed out
  below 1:1 it shrinks smoothly for an overview. Battles open at 1:1. Units, generals, houses, trees and rocks are
  drawn at one art pixel each (the older 16 px scenery at a clean 2x); the walls, roads, fields and ground are drawn
  straight onto the same grid. Squad markers, numbers and messages are drawn sharp on top.
- **The strategy map too** keeps one art pixel per map pixel: the land is painted in 2-px cells and enlarged once
  with Scale2x (rounded coasts as hard pixels on the 1-px grid), and towns, landmarks, scenery and generals are
  drawn at one art pixel each; the map is drawn into a buffer and enlarged by a whole number, zoom steps whole
  sizes, and town and region names are drawn sharp on top. Up to two generals stand in front of a town at full
  size, with a "+N" badge for the rest.
- **One sombre palette.** Everything (sprites, characters, buildings, portraits, effects, the battlefield and the
  map) is snapped to the game's palette in `js/palette.js`: built around iron grey `#36413E`, charcoal `#5D5E60`,
  rosy granite `#8D8D92`, thistle `#BEB2C8` and dust grey `#D7D6D6`, with muted earth, skin, steel, water and
  faction tones and a little fire (matched in OKLab through a lookup table). Faction colours and the interface
  are muted to match. Set `Palette.on = false` to see the raw colours.

## Battles
Live battles are fought by **blocks of hundreds of men** on a large field (2000 x 1280) seen
from high above, like a simplified Total War, with scrolling, zoom and a minimap; the whole
field is in view (set `DATA.battle.fog` to bring back fog of war). Each campaign soldier takes
the field as 5 men (`DATA.battle.men`), so a 16-soldier squad is an 80-man block in ranks behind
its general and banner; afterwards the survivors are turned back into soldiers. Auto-resolved
battles run the same rules with 1 man per soldier, so they stay fast and give the same results.
Men in a block stand far enough apart that each one can be seen (`spacing`, and `spacingY` more up and
down the screen, as the figures are tall and narrow); auto-resolved battles, where nothing is drawn, keep
the tighter spacing (`spacingAuto`) they were balanced with. Every block also has a fixed-size **marker** (troop-type symbol, troops left, strength and
morale bars) that stays readable at any zoom; click it to select the block.

**Morale** decides most fights. Every block has morale (shown under its portrait as Steady, Wavering or
Routing). It drops with losses, with blows into its **flank** or **rear** (which also hit 30% / 60% harder),
with charges, and when its general falls; it recovers out of contact, and the Rally skill restores
it. A wavering block fights worse; a routing block flees for its own edge of the field and can rally once
it is safe. A side whose blocks have all routed or fallen loses. Advancing blocks wheel to face the enemy
they fight (holding blocks keep the facing you gave them until the enemy is close), so hitting them from
the side pays. Tune it in `DATA.battle.morale` and `DATA.battle.flank`.

Battles start paused. Select blocks by clicking them or their marker (Shift adds), dragging a box, or
clicking their portraits; right-click the ground to move (tap on touch screens), right-click an enemy to
attack. **Right-drag draws a front line**: the selection spreads along it, each block as wide as its share
of the line (files of men to match), facing across it (to the left of the drag direction), with a ghost
preview while you drag. Blocks march facing the way they go and turn to their ordered facing on arrival.
Groups move in a **formation** (Auto: frontline in front and backline behind; Line; Column; Wedge) at the
slowest block's pace. Orders: Advance, Hold, Retreat. The ranks close up as men fall. Advancing or
attacking frontline blocks **charge** the last stretch (`charge`: faster, a harder first blow, and a blow
to the enemy's morale; cavalry keep their bigger charge bonus; a man's charge impact only counts again
once he has been out of the fight for a few seconds). Shooters, casters and artillery fire
from far off (`rangeMul`, 3.4x their listed range: archers about 320 px, cannons about 500), so armies
trade volleys long before they meet; skills reach `skillRangeMul` and cover `areaMul` more ground.

**Missiles** (`DATA.battle.missile`) fly slowly (arrows 150 px/s, artillery 110) in an arc with a shadow
under them, and are not guided: each is loosed at where its target will be (leading it), scattered by
`scatter` x the distance (artillery a little more), and hits whoever is within `hitR` of where it comes
down. Troops on the move and loose files dodge some of them, long shots miss more, and arrows that miss
stick in the ground. Artillery blasts hit full force where they land and half at the edge.

**Weight of battle** (`hpMul`, `heroHpMul`, `atkMul`, `rangedAtkMul`, `cdMul`, `defMul`, `shockExp`): soldiers
are 4.5x as tough (generals, already five times a soldier, 3.3x, so two lone generals do not duel for
minutes), melee hits 1.3x and ranged 1.5x as hard but 1.3x less often, and armour counts 1.5x. A
clash of two blocks holds for a while instead of being decided in seconds, and ranged fire wears
blocks down on the way in (less than the longer range suggests, since slow missiles miss moving troops).
Healing and skill damage grow with the extra toughness. Morale shocks per hit (flank, rear, charge) shrink
partly with the extra hits a kill takes (in live battles including `menHp`), so blocks still break before
they are wiped out, but not on first contact. A general whose men are all gone loses heart (`morale.alone`)
and leaves the field. Open-field battles last one to two minutes; battles have 10 minutes.

Each hero has **skills** paid with MP
(Charge, Rally, Shield Wall for warriors; Volley, Eagle Eye for marksmen; Meteor, Frost Field or Mass
Heal, Blessing for mages): use the buttons or Z / X / C, and area skills land where you click. **Auto**
lets a hero cast by themself; computer heroes always do. Space pauses. Tune it in `DATA.battle` and
`DATA.skills`.

**Adding skills.** What a skill does is a handler in `SKILL_FX` (end of `js/battle.js`),
given the casting squad, the target point and helpers. Squad-level helpers are there for
skills that move or shape whole blocks of troops: `squadUnits`, `squadCentre`, `putSquad`
(stand a squad somewhere in formation), `teleportSquad`, `push` (knockback that stops at
solid ground) and `buffSquad`. A ready-made **Blink** skill (short teleport of the whole
squad, in formation) is in `DATA.skills`; give it to a hero by adding `'blink'` to their
`skills` (or in `DATA.skillsOf`); computer heroes use it to jump onto enemy shooters, or
to escape melee if they are backline.

## Formation screen
Before every battle you fight yourself, the formation screen shows your squads in a
**front row** (deploys nearest the enemy) and a **back row**. Click a squad to switch
rows, use the arrows to order them along the line, or press Auto to sort by class. Each
hero remembers their row for next time, and Auto group formation in battle keeps the rows.

## Hero classes, unit types and recruiting
Modelled on the class/recruit system of Vahren-engine games such as Kinoko Takenoko War
(the system, not its units: every unit here is our own). Each unit has a type: infantry,
cavalry or beast (frontline), or shooter, artillery, mage or healer (backline). Each hero
has a class from the troops they lead: **Warrior** recruits infantry, cavalry and beasts;
**Marksman** recruits shooters and artillery; **Mage** recruits battle mages and healers.
A hero recruits only their own faction's units of those types (`DATA.rosters`), and a
squad can mix types. A faction's **lord** can recruit any unit on the faction's roster.
Rosters carry Vahren-style **hiring weights** (e.g. Aster: knight 4, archer 4, lancer 2,
cannon 2, cleric 2, mage 1): computer armies are recruited by these weights, the recruit
window labels units Common / Uncommon / Rare, and "Fill with faction mix" fills a squad in
the faction's proportions. Uncommon units cost 15% more and rare units 40% more, and only
a limited number of each can be hired per turn by each faction (uncommon 4 + 1 per 4 towns,
rare 1 + 1 per 6 towns; common units are unlimited). Tune it in `DATA.rarityRules`.
Squad sizes (`DATA.squadSize`): lords 24, heroes 16, wanderers 12; militia captains keep
their garrison size. In battle a mixed squad's frontline soldiers stand in front of the
hero and its backline soldiers behind. Cavalry charge for double damage after a run; spearmen (`antiCav`)
hit cavalry hard; artillery has long range and big blasts; healers mend the most hurt ally
in reach. Set `cls` on a general to give them a different class.

## Signature abilities
Every hero gets two abilities of their own, rolled at random when they first appear:
a weaker one learned at **level 15** and their best at **level 30** (heroes now level to
40, with faster XP and a smaller bonus per level). The kind follows the hero's class and
troops (warriors: strike / nova / aura; marksmen: shot / barrage; battle mages: blast /
nova / drain / strike; healers: mend / aura / drain), the element follows their faction
(fire, ice, nature, shadow, holy, steel: e.g. Lava Ball, Eviscerate, Blizzard), and the
numbers are rolled, shown as 1-5 stars. Learned abilities raise a hero's value: their
strength rating, hire price and persuasion price. They appear in the Recruit window and on
the battle skill bar (keys V and B); computer heroes use them too. Tune it in
`DATA.signature`.

## Soldier levels and promotion
Every soldier has a level. After a battle each survivor gains a level, another if their
side won, and one per kill. At **level 15** a soldier is promoted to tier 2 (e.g. Knight →
Knight Captain: +30% hp, +25% attack, +1 defence) and at **level 30** to tier 3 (Paladin:
+60% hp, +50% attack, +2 defence); every level also adds 1%. Promoted soldiers wear a
silver pip (tier 2) or two gold pips (tier 3) in battle. Heroes of level 10+ can recruit
veterans that start at level 15 for 3x the price. Dismissing removes the lowest-level
soldier first. Tune it in `DATA.promotion` (tier names are in `DATA.promotion.names`).

## Frontline and backline
Every unit type is **frontline** (melee) or **backline** (archers and casters); a general
takes the role of the squad they lead. In battle the frontline deploys in front, holds up
enemies that pass close (slowing them), and goes first for enemies threatening its own
backline. The backline deploys behind, stays behind its own front line, steps back from
melee when it can, and its arrows and spells hit hard and pierce armour - but caught in
melee it fights at under half strength. In testing, a frontline army beats a lone backline
almost every time, a mixed army beats a lone backline about 3 times in 4, and mixed vs
all-frontline is about even. Tune it in `DATA.roles`; set a unit's `role` to override.

## Persuasion
Any **cornered** general who is not yours (except faction lords) can be persuaded to join
for gold. Cornered means the same as losing a battle with nowhere to retreat: their town
has no neighbouring town of their own side. Click their town: you need one of your generals who has not acted, in your town next
to theirs, to go as envoy (it uses their turn). The price grows with the general's
strength (level, squad size and quality): militia captains ~100 gold, Free Towns heroes
~130-200, rival faction generals 60% more. The persuaded general joins with their level
and troops and moves into the envoy's town. Computer factions persuade too: as many
as they can afford and find worth it, your cornered generals included. Tune it in `DATA.persuade`.

## Levels & experience
Generals earn XP in battle: per kill by their squad, for taking part, and for winning.
Each level makes the general 10% stronger and their squad 4% stronger. Tune it in
`DATA.leveling` in `js/data.js`. Lords start at level 3.

## Wandering generals
Generals with no faction (marked with a gold coin on the map) drift between towns.
Hire one while they are in a town you own; the price rises with their level and
includes half a squad. Captured generals (not lords) become wanderers too, and the
computer factions hire them as well. Tune it in `DATA.hiring` / `DATA.wanderers`.

## Battlefield terrain
Each town has a battlefield type (`terrain`: plains, forest, river, swamp, snow, dunes,
lava, crystal) and optionally `walls` and a `site` in `js/map.js`. The field is generated from the
town's id (the same town always gives the same field) from that type's recipe in
`FIELD_RECIPES` (`js/terrain.js`), with regional flavour (`REGION_FIELD`: Darkwood has more
woods, the desert fewer...): hills (long dune ridges in the desert), forests, a winding
river with fords and a bridge (a frozen river in the snow, a lava river with stone
causeways in the Ember Peaks), thin streams, lakes, boulders and crystal pillars, and
patches of mud, snow or sand. Battlefields take their region's colours and trees, and
hills are drawn with light, shade and contour lines.

- **High ground** (`DATA.battle.hills`): shooters gain range shooting down at lower
  targets (and lose some shooting uphill), melee hits harder downhill, climbing slows units,
  and (with fog of war on) everyone sees further from a hilltop. Computer armies deploy on the best high
  ground near their start.
- **Forests** hide the troops in them: the enemy only spots them up close
  (`forestSpot`), or for a moment after they attack. They also slow units and give cover
  from arrows and spells.
- Rivers are slow to wade (and units fight badly in the water) except at fords and
  bridges; streams are shallow. Snowdrifts, dunes and mud slow units, frozen ground is
  fast but slippery, lava and rocks block the way.
- **Walled towns** (every capital, city and town; villages are open) stand about two-thirds of the
  way across the field: a square of thick stone walls with round towers at the corners, beside
  every gate and along the walls, and inside a raised wall-walk (the defenders' archers shoot
  from high ground, behind battlements: 50% cover), cobbled streets from every side to a market
  square with the keep or church, a windmill, a crop field and houses in the region's style, with
  roads running out from the gates and fields outside. Inside the walls defenders get +1.5
  defence and 60% cover from missiles shot from outside (35% from artillery, which lobs its shot).
- Each walled town has a **site** (`site` in `js/map.js`, `DATA.sites` in `js/data.js`) that sets
  its ways in: **open ground** (a gate on every side), **ridge end** (cliffs close the far side and
  one flank: two gates), **clifftop** (cliffs all round, one gate up a narrow ramp) or **island**
  (raised out of a deep lake, one gate at the end of a causeway; as hard to take as a clifftop). Attackers march round the town (and
  its cliffs or lake) to the gates. One-gate strongholds have tougher gatehouses (`gateHp`) and count
  as much stronger for the computer when it weighs up an attack (`power`). `tools/genmap.py` picks
  the site from the land: lake and crystal country puts towns on islands, mountains and snow on
  crags, a town at the end of a single road is always a one-gate stronghold, one on two roads tends
  to sit on a ridge end, crossroads towns stand on open ground. The strategy map shows each
  town's wall ring, and a crag with its ramp or a lake with its causeway under it.
- The **gates** are shut and attackers must batter them down (`DATA.battle.gate`): melee hits
  them, artillery hits them hard (2x), mages crack them, arrows barely scratch them.
  A damaged gate cracks and shows a bar of what is left; a broken one is open for good and
  shakes the defenders. While every gate stands, computer artillery bombards a gate and frontline
  troops with no one to fight outside the walls batter one, spreading over the gates when there
  are several; right-click a gate to send your selected squads at it. Computer defenders man the
  walls beside the gates with their backline, keep their frontline just inside the gates, go for
  anyone who gets in and return to their posts once the town is clear. Defenders can pass through
  their own gates to sally out; routed defenders have nowhere to run and huddle in the square.

Point at the ground in battle to see what it is (bottom left). Tune it in `DATA.ground`.

## Art
**Generated art in the game** (`js/gensprites.js`): the game runs the Pixelgen generators itself (no image
files needed), seeded so every picture is always the same:
- human units (knights, archers, spearmen, robed mages and priests, militia...) use medieval soldier sheets
  in their faction's heraldry, and horse cavalry (lancers, ember riders, nightmare riders) cavalry sheets.
  Monsters, beast riders and artillery use the creature and mount generators. The look of each unit is set
  in `Gen.UNITS`, and each monster general's creature in `Gen.MONSTER_GENERALS`
- every general is a unique hero (monster generals are a crowned, larger version of their creature) (archetype from what they lead, lords are warlords; set
  `hero: 'witch'` on a general in `js/data.js` to choose) with a matching portrait. Dialogue shows the
  portrait at 128 px in a mood guessed from the line (set `mood: 'fierce'` / `'smile'` on a scene to choose)
- fallen soldiers stay on the battlefield in their blood, and green battlefields are a generated meadow with
  generated bushes, rocks and stumps
Sprites are made the first time they are needed and the rest are made in the background after loading.

Placeholder art and audio come from the Ninja Adventure pack (CC0) and Kenney (CC0).
