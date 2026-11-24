# Composite War

A pixel-art strategy game in plain HTML, CSS and JavaScript: conquer towns on a large
map of eight regions, then fight real-time battles with generals and their squads.

Open `index.html` through any local web server (for example `python3 -m http.server`).

## Files
- `js/data.js` – the scenario: factions, regions, unit stats, generals, levelling, hiring, ground. Start here.
- `js/map.js` – the map: 92 towns, roads and landmark positions (made by `tools/genmap.py`, safe to hand-edit).
- `js/art.js` – pixel art drawn in code: each region's buildings, landmarks and scenery.
- `js/game.js` – campaign state, turns, AI opponents, panels and dialogs.
- `js/battle.js` – the real-time battle simulation and drawing.
- `js/terrain.js` – battlefield ground: forests, rivers, swamps and town walls.
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

To make a different map: `python3 tools/genmap.py 42` (any number gives a new layout).

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
lava, crystal) and optionally `walls` in `js/map.js`. Battlefields take their region's
colours and trees. Snowdrifts and dunes slow units, frozen ponds are fast but slippery,
lava pools and crystal pillars block the way. Forests slow units and give cover from arrows
and spells. Rivers are slow to wade (and units fight badly in the water) except at
the fords. Mud slows everyone. Walls are solid with one gate; defenders stay behind
them, get cover from arrows and +1.5 defence inside. Tune it in `DATA.ground`.

## Art
Placeholder art and audio come from the Ninja Adventure pack (CC0) and Kenney (CC0).
