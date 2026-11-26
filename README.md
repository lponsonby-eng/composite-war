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
- `js/terrain.js` – battlefield generation: hills, forests, rivers, streams, lakes, swamps and town walls.
- `js/battleui.js` – battle controls: selecting squads, orders, formations, skills, battle minimap.
- `js/mapview.js` – draws the strategy map, scrolling, zoom and the minimap.
- `js/assets.js` – loads images and sounds.
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

To make a different map: `python3 tools/genmap.py 42` (any number gives a new layout).

## Story
The realm was held together by the Concord Crown until it shattered into eight shards,
one for each faction. Story events (`js/events.js`) play as dialogue with portraits:
a prologue and an opening for each faction; a discovery with a choice the first time you
take a town in each region; random events at the start of some turns (caravans, bandits,
refugees, plague, festivals, deserters, wanderers, an old drill-master); milestones (first
victory, first signature ability, 25 and 50 towns, rival factions falling); and endings.
Choices can give or cost gold, soldiers, XP, promotions or bring a wandering general.
Add your own events by copying an entry; the format is described at the top of the file.

## Battles
Battles are fought on a large field (2000 x 1280) seen from high above, like a simplified
Total War, with scrolling, zoom, a minimap and **fog of war**: the land always shows, but you
only see (and your units only target) the enemy troops your squads can see. Every squad has
a **banner** (side colour, troop-type symbol, troops left, strength bar) that stays readable
at any zoom. Battles start paused. Select squads by clicking them or their banner (Shift
adds), dragging a box, or clicking their portraits; right-click the ground to move (tap on
touch screens), right-click an enemy to attack. **Right-drag draws a front line**: the
selection spreads along it, each squad as wide as its share of the line (soldiers per rank
to match), facing across it (to the left of the drag direction), with a ghost preview while
you drag. Squads march facing the way they go and turn to their ordered facing on arrival.
Groups move in a **formation** (Auto: frontline in front and backline behind; Line; Column;
Wedge) at the slowest squad's pace. Orders: Advance, Hold, Retreat. Soldiers stand in ranks
(`spacing` / `rankDepth`), and the ranks close up as they fall. Advancing or attacking
frontline troops **charge** the last stretch (`charge`: faster, and a harder first blow;
cavalry keep their bigger charge bonus). Ranged units reach further on the big field
(`rangeMul`), and skills cover more ground (`areaMul`).
Each hero has **skills** paid with MP (Charge, Rally, Shield Wall for warriors; Volley,
Eagle Eye for marksmen; Meteor, Frost Field or Mass Heal, Blessing for mages): use the
buttons or Z / X / C, and area skills land where you click. **Auto** lets a hero cast by
themself; computer heroes always do. Space pauses. Tune it in `DATA.battle` and
`DATA.skills`. Auto-resolved battles run the same simulation without drawing.

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
lava, crystal) and optionally `walls` in `js/map.js`. The field is generated from the
town's id (the same town always gives the same field) from that type's recipe in
`FIELD_RECIPES` (`js/terrain.js`), with regional flavour (`REGION_FIELD`: Darkwood has more
woods, the desert fewer...): hills (long dune ridges in the desert), forests, a winding
river with fords and a bridge (a frozen river in the snow, a lava river with stone
causeways in the Ember Peaks), thin streams, lakes, boulders and crystal pillars, and
patches of mud, snow or sand. Battlefields take their region's colours and trees, and
hills are drawn with light, shade and contour lines.

- **High ground** (`DATA.battle.hills`): shooters gain range shooting down at lower
  targets (and lose some shooting uphill), everyone sees further from a hilltop, melee hits
  harder downhill, and climbing slows units. Computer armies deploy on the best high
  ground near their start.
- **Forests** hide the troops in them: the enemy only spots them up close
  (`forestSpot`), or for a moment after they attack. They also slow units and give cover
  from arrows and spells.
- Rivers are slow to wade (and units fight badly in the water) except at fords and
  bridges; streams are shallow. Snowdrifts, dunes and mud slow units, frozen ground is
  fast but slippery, lava and rocks block the way.
- Walls are solid with three gates; defenders stay behind them, get cover from arrows
  and +1.5 defence inside.

Point at the ground in battle to see what it is (bottom left). Tune it in `DATA.ground`.

## Art
Placeholder art and audio come from the Ninja Adventure pack (CC0) and Kenney (CC0).
