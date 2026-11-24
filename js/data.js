// =============================================================================
//  SCENARIO DATA
//  This file is the "script" of the game, like a Vahren scenario.
//  Change names, stats, map positions and starting armies here — no other code
//  needs to change. Sprites refer to files in assets/:  'c18' = assets/chars/18.png,
//  'm3' = assets/monsters/3.png.  Faces use assets/faces/<n>.png.
// =============================================================================
window.DATA = {

  title: 'Composite War',

  startGold: 150,
  battleTimeLimit: 120,          // seconds; when time runs out the defender holds

  // --- Levels & experience ---------------------------------------------------
  // Generals earn XP in battle and level up. XP needed for the next level is
  // xpBase + xpPerLevel * current level. Each level above 1 makes the general
  // leaderBonus stronger (hp and attack) and their squad squadBonus stronger.
  leveling: {
    maxLevel: 20, xpBase: 40, xpPerLevel: 25,
    leaderBonus: 0.10, squadBonus: 0.04,
    killSoldier: 4, killGeneral: 25,   // XP to the general whose squad landed the blow
    fought: 10, won: 15, capture: 5,   // XP for taking part, for winning, for taking an empty town
  },

  // --- Factions ------------------------------------------------------------
  // playable: shown on the faction select screen. neutral: never acts on its own.
  factions: {
    aster:   { name: 'Kingdom of Aster', color: '#3d7be0', playable: true,
               blurb: 'Disciplined knights, archers and mages of the western plains.' },
    ember:   { name: 'Ember Clan',       color: '#e0483d', playable: true,
               blurb: 'Fierce warriors of the volcanic north-east, allied with fire spirits.' },
    shadow:  { name: 'Shadow Order',     color: '#9b4fd6', playable: true,
               blurb: 'Ninjas, restless dead and ghosts from the misty south-east.' },
    horde:   { name: 'Wild Horde',       color: '#4fb04a', playable: true,
               blurb: 'Beast tamers of the bog, leading slimes and monsters.' },
    neutral: { name: 'Free Towns',       color: '#a9a9a9', playable: false, neutral: true,
               blurb: 'Independent towns that just want to be left alone.' },
  },

  // --- Unit types ----------------------------------------------------------
  // hp, atk (damage), def (damage reduction), spd (pixels/sec), range (pixels),
  // cd (seconds between attacks), cost (gold per soldier).
  // proj = projectile image for ranged units, splash = area damage radius.
  units: {
    knight:   { name: 'Knight',      sprite: 'c18', hp: 34, atk: 6, def: 2, spd: 24, range: 12, cd: 1.0, cost: 22 },
    archer:   { name: 'Archer',      sprite: 'c8',  hp: 18, atk: 5, def: 0, spd: 24, range: 95, cd: 1.6, cost: 24, proj: 'arrow' },
    mage:     { name: 'Mage',        sprite: 'c19', hp: 16, atk: 8, def: 0, spd: 22, range: 75, cd: 2.2, cost: 36, proj: 'fireball', splash: 14 },

    ashigaru: { name: 'Ashigaru',    sprite: 'c4',  hp: 30, atk: 6, def: 1, spd: 26, range: 18, cd: 1.1, cost: 20 },
    brawler:  { name: 'Brawler',     sprite: 'c2',  hp: 44, atk: 8, def: 2, spd: 22, range: 12, cd: 1.3, cost: 30 },
    flame:    { name: 'Fire Spirit', sprite: 'm2',  hp: 18, atk: 7, def: 0, spd: 28, range: 65, cd: 1.8, cost: 30, proj: 'fireball', splash: 10 },

    ninja:    { name: 'Ninja',       sprite: 'c7',  hp: 20, atk: 5, def: 0, spd: 38, range: 55, cd: 0.9, cost: 26, proj: 'shuriken' },
    skeleton: { name: 'Skeleton',    sprite: 'c23', hp: 26, atk: 6, def: 1, spd: 24, range: 12, cd: 1.0, cost: 16 },
    ghost:    { name: 'Ghost',       sprite: 'm7',  hp: 16, atk: 7, def: 0, spd: 26, range: 70, cd: 2.0, cost: 32, proj: 'fireball', splash: 12 },

    slime:    { name: 'Slime',       sprite: 'm3',  hp: 30, atk: 5, def: 1, spd: 20, range: 10, cd: 1.0, cost: 14 },
    beast:    { name: 'Bog Beast',   sprite: 'm8',  hp: 55, atk: 8, def: 3, spd: 20, range: 12, cd: 1.4, cost: 34 },
    thorn:    { name: 'Thornling',   sprite: 'm4',  hp: 24, atk: 5, def: 0, spd: 18, range: 80, cd: 1.7, cost: 22, proj: 'arrow' },

    militia:  { name: 'Militia',     sprite: 'c10', hp: 26, atk: 5, def: 1, spd: 24, range: 12, cd: 1.1, cost: 15 },
    frogman:  { name: 'Frogman',     sprite: 'm14', hp: 32, atk: 6, def: 2, spd: 22, range: 12, cd: 1.1, cost: 20 },
  },

  // --- Generals ------------------------------------------------------------
  // face/sprite: index of assets/faces and assets/chars. leads: unit type of
  // their squad (the general fights as a much stronger version of it).
  // max: squad size. troops: starting soldiers. lord: faction leader.
  // level: starting level (default 1).
  generals: {
    aldric: { name: 'Aldric',  faction: 'aster',  face: 21, leads: 'knight',   max: 10, troops: 10, lord: true, level: 3 },
    tobin:  { name: 'Tobin',   faction: 'aster',  face: 6,  leads: 'knight',   max: 8,  troops: 6 },
    mira:   { name: 'Mira',    faction: 'aster',  face: 17, leads: 'archer',   max: 8,  troops: 6 },
    oren:   { name: 'Oren',    faction: 'aster',  face: 9,  leads: 'mage',     max: 6,  troops: 4 },

    kaen:   { name: 'Kaen',    faction: 'ember',  face: 12, leads: 'ashigaru', max: 10, troops: 10, lord: true, level: 3 },
    garr:   { name: 'Garr',    faction: 'ember',  face: 20, leads: 'brawler',  max: 7,  troops: 5 },
    suzu:   { name: 'Suzu',    faction: 'ember',  face: 5,  leads: 'ashigaru', max: 8,  troops: 6 },
    hoshi:  { name: 'Hoshi',   faction: 'ember',  face: 16, leads: 'flame',    max: 6,  troops: 4 },

    noct:   { name: 'Noct',    faction: 'shadow', face: 13, leads: 'ninja',    max: 10, troops: 10, lord: true, level: 3 },
    ossian: { name: 'Ossian',  faction: 'shadow', face: 23, leads: 'skeleton', max: 10, troops: 7 },
    rin:    { name: 'Rin',     faction: 'shadow', face: 24, leads: 'ninja',    max: 8,  troops: 6 },
    vael:   { name: 'Vael',    faction: 'shadow', face: 11, leads: 'ghost',    max: 6,  troops: 4 },

    grubb:  { name: 'Grubb',   faction: 'horde',  face: 1,  leads: 'beast',    max: 8,  troops: 8, lord: true, level: 3 },
    bruno:  { name: 'Bruno',   faction: 'horde',  face: 22, leads: 'beast',    max: 6,  troops: 4 },
    pip:    { name: 'Pip',     faction: 'horde',  face: 25, leads: 'slime',    max: 10, troops: 8 },
    ada:    { name: 'Ada',     faction: 'horde',  face: 14, leads: 'thorn',    max: 8,  troops: 6 },

    wen:    { name: 'Elder Wen',   faction: 'neutral', face: 3,  leads: 'militia', max: 6, troops: 5 },
    rook:   { name: 'Rook',        faction: 'neutral', face: 10, leads: 'militia', max: 8, troops: 6, level: 2 },
    golem:  { name: 'Iron Golem',  faction: 'neutral', face: 15, leads: 'frogman', max: 6, troops: 5, level: 2 },
    ilo:    { name: 'Brother Ilo', faction: 'neutral', face: 19, leads: 'frogman', max: 5, troops: 4 },
    sela:   { name: 'Sela',        faction: 'neutral', face: 4,  leads: 'militia', max: 6, troops: 5 },
  },

  // --- Map -----------------------------------------------------------------
  // The map is 640 x 360 pixels. kind: capital | town | village | shrine.
  // income: gold per turn. gens: generals stationed there at the start.
  spots: {
    asterhold:  { name: 'Asterhold',  x: 95,  y: 165, kind: 'capital', income: 30, owner: 'aster',   gens: ['aldric', 'tobin'] },
    brookfield: { name: 'Brookfield', x: 80,  y: 262, kind: 'town',    income: 15, owner: 'aster',   gens: ['mira'] },
    westwatch:  { name: 'Westwatch',  x: 150, y: 72,  kind: 'village', income: 10, owner: 'aster',   gens: ['oren'] },

    bogmire:    { name: 'Bogmire',    x: 165, y: 318, kind: 'capital', income: 25, owner: 'horde',   gens: ['grubb', 'bruno'] },
    mosshollow: { name: 'Mosshollow', x: 268, y: 285, kind: 'village', income: 12, owner: 'horde',   gens: ['pip', 'ada'] },

    emberkeep:  { name: 'Emberkeep',  x: 565, y: 78,  kind: 'capital', income: 30, owner: 'ember',   gens: ['kaen', 'garr'] },
    ashford:    { name: 'Ashford',    x: 455, y: 52,  kind: 'village', income: 10, owner: 'ember',   gens: ['suzu'] },
    redpine:    { name: 'Redpine',    x: 462, y: 155, kind: 'town',    income: 15, owner: 'ember',   gens: ['hoshi'] },

    nightspire: { name: 'Nightspire', x: 565, y: 305, kind: 'capital', income: 30, owner: 'shadow',  gens: ['noct', 'ossian'] },
    gloomvale:  { name: 'Gloomvale',  x: 462, y: 280, kind: 'village', income: 10, owner: 'shadow',  gens: ['rin'] },
    mistfen:    { name: 'Mistfen',    x: 565, y: 195, kind: 'town',    income: 15, owner: 'shadow',  gens: ['vael'] },

    millcross:  { name: 'Millcross',  x: 200, y: 182, kind: 'town',    income: 15, owner: 'neutral', gens: ['wen'] },
    pinewood:   { name: 'Pinewood',   x: 258, y: 95,  kind: 'village', income: 10, owner: 'neutral', gens: ['rook'] },
    crossroads: { name: 'Crossroads', x: 335, y: 190, kind: 'town',    income: 25, owner: 'neutral', gens: ['golem'] },
    oldshrine:  { name: 'Old Shrine', x: 360, y: 72,  kind: 'shrine',  income: 10, owner: 'neutral', gens: ['ilo'] },
    stonegate:  { name: 'Stonegate',  x: 370, y: 300, kind: 'village', income: 12, owner: 'neutral', gens: ['sela'] },
  },

  // Roads between spots. Armies can only move or attack along roads.
  links: [
    ['asterhold', 'brookfield'], ['asterhold', 'westwatch'], ['asterhold', 'millcross'],
    ['brookfield', 'bogmire'], ['brookfield', 'millcross'],
    ['westwatch', 'pinewood'], ['millcross', 'pinewood'], ['millcross', 'crossroads'],
    ['bogmire', 'mosshollow'], ['mosshollow', 'crossroads'], ['mosshollow', 'stonegate'],
    ['pinewood', 'oldshrine'], ['oldshrine', 'crossroads'], ['oldshrine', 'ashford'],
    ['crossroads', 'redpine'], ['crossroads', 'stonegate'], ['stonegate', 'gloomvale'],
    ['ashford', 'emberkeep'], ['ashford', 'redpine'], ['redpine', 'emberkeep'], ['redpine', 'mistfen'],
    ['emberkeep', 'mistfen'], ['mistfen', 'nightspire'], ['mistfen', 'gloomvale'], ['gloomvale', 'nightspire'],
  ],
};
