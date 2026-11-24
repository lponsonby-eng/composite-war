# Composite War

A pixel-art strategy game in plain HTML, CSS and JavaScript: conquer towns on a map,
then fight real-time battles with generals and their squads.

Open `index.html` through any local web server (for example `python3 -m http.server`).

## Files
- `js/data.js` – the scenario: factions, unit stats, generals, towns, roads, levelling rules. Start here.
- `js/game.js` – campaign state, turns, AI opponents, panels and dialogs.
- `js/battle.js` – the real-time battle simulation and drawing.
- `js/mapview.js` – draws the strategy map.
- `js/assets.js` – loads images and sounds.
- `js/main.js` – startup, frame loop, mouse input.

## Levels & experience
Generals earn XP in battle: per kill by their squad, for taking part, and for winning.
Each level makes the general 10% stronger and their squad 4% stronger. Tune it in
`DATA.leveling` in `js/data.js`. Lords start at level 3.

## Art
Placeholder art and audio come from the Ninja Adventure pack (CC0) and Kenney (CC0).
