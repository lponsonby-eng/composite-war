// =============================================================================
//  SCENARIO DATA
//  This file is the "script" of the game, like a Vahren scenario.
//  Change names, stats and starting armies here — no other code needs to change.
//  The map itself (towns, roads, landmarks) is in js/map.js.
//
//  Sprites refer to files in assets/:  'c18' = assets/chars/18.png,
//  'm3' = assets/monsters/3.png.  hue: recolours a sprite or face (0-360 degrees),
//  so one picture can serve several different characters.
// =============================================================================
window.DATA = {

  title: 'Composite War',

  startGold: 150,
  battleTimeLimit: 180,          // seconds; when time runs out the defender holds

  // --- Battles ---------------------------------------------------------------
  // The battlefield (world pixels), how far units see through the fog of war,
  // and heroes' magic points (MP) for skills.
  battle: {
    width: 1120, height: 720,
    vision: { soldier: 90, hero: 140, cavalry: 30, shooter: 25 },   // cavalry and shooters see further
    mp: { base: 60, perLevel: 5, regen: 3, start: 0.6 },
  },

  // --- Hero skills -----------------------------------------------------------
  // target: 'self' (around the hero) or 'ground' (click a spot within range).
  // Damage, healing and buffs grow 6% per hero level. dur: seconds.
  skills: {
    charge:     { name: 'Charge',      mp: 30, cd: 15, target: 'self', dur: 4, desc: 'The squad sprints and its next blows hit twice as hard.' },
    rally:      { name: 'Rally',       mp: 40, cd: 20, target: 'self', dur: 8, heal: 0.3, def: 2, desc: 'Heals the squad 30% and steadies it (+2 defence).' },
    shieldwall: { name: 'Shield Wall', mp: 30, cd: 18, target: 'self', dur: 8, def: 4, spd: 0.5, desc: '+4 defence but half speed.' },
    volley:     { name: 'Volley',      mp: 40, cd: 18, target: 'ground', range: 230, radius: 50, arrows: 14, dmg: 9, desc: 'A rain of arrows on an area.' },
    eagleeye:   { name: 'Eagle Eye',   mp: 30, cd: 20, target: 'self', dur: 12, range: 40, view: 120, desc: 'The squad shoots further and sees much further.' },
    meteor:     { name: 'Meteor',      mp: 60, cd: 25, target: 'ground', range: 210, radius: 45, dmg: 50, delay: 1, desc: 'A meteor strikes an area after a moment.' },
    frostfield: { name: 'Frost Field', mp: 40, cd: 20, target: 'ground', range: 210, radius: 55, dur: 6, slow: 0.4, dps: 4, desc: 'Enemies in the area are slowed and chilled.' },
    massheal:   { name: 'Mass Heal',   mp: 50, cd: 20, target: 'self', radius: 100, heal: 40, desc: 'Heals every ally nearby.' },
    bless:      { name: 'Blessing',    mp: 40, cd: 22, target: 'self', radius: 100, dur: 10, atk: 1.3, desc: 'Allies nearby hit 30% harder.' },
  },


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
  // home: the map region the faction starts in (see regions below).
  factions: {
    aster:   { name: 'Kingdom of Aster',  color: '#3d7be0', playable: true, home: 'aster',
               blurb: 'Knights, archers and mages of the green western plains.' },
    frost:   { name: 'Frostmark',         color: '#9fe2ff', playable: true, home: 'frost',
               blurb: 'Hardy clans of the frozen north-west, with yetis and ice spirits.' },
    thorn:   { name: 'Thornwood Pact',    color: '#1fa38a', playable: true, home: 'darkwood',
               blurb: 'Rangers, witches and giant beetles of the dark forest.' },
    ember:   { name: 'Ember Clan',        color: '#e0483d', playable: true, home: 'ember',
               blurb: 'Fierce warriors of the volcano, allied with fire spirits.' },
    shadow:  { name: 'Shadow Order',      color: '#9b4fd6', playable: true, home: 'shadow',
               blurb: 'Ninjas, restless dead and ghosts of the eastern mistlands.' },
    horde:   { name: 'Wild Horde',        color: '#7bc043', playable: true, home: 'bog',
               blurb: 'Beast tamers of the south-western bog, leading slimes and monsters.' },
    azure:   { name: 'Azure Tide',        color: '#e05aa8', playable: true, home: 'azure',
               blurb: 'Fishfolk and tide mages of the crystal lakes.' },
    sun:     { name: 'Sunscar Dominion',  color: '#f0b429', playable: true, home: 'sun',
               blurb: 'Nomads, golden guards and fire hawks of the southern desert.' },
    neutral: { name: 'Free Towns',        color: '#a9a9a9', playable: false, neutral: true,
               blurb: 'Independent towns that just want to be left alone.' },
  },

  // --- Regions: how each part of the map looks ------------------------------
  // ground: map colours [light, mid, dark, speckle]. building: town style.
  // landmark: big feature drawn at MAP.landmarks[region]. deco: scenery.
  // battle: battlefield grass tint. garrison: unit types of free-town militia.
  regions: {
    aster:    { name: 'Aster Plains',    ground: ['#7cc456', '#67b04a', '#4f9a3a', '#8fd062'], building: 'castle',
                landmark: 'castle', deco: ['tree_round', 'tree_pine', 'tree_round', 'bush'], battle: null, garrison: ['militia', 'bandit'] },
    frost:    { name: 'Frozen North',    ground: ['#f2f7fb', '#dfe9f2', '#c3d4e4', '#ffffff'], building: 'igloo',
                landmark: 'icepeak', deco: ['snowpine', 'snowpine', 'icerock'], battle: '#dfeaf5', garrison: ['hunter', 'militia'] },
    darkwood: { name: 'Darkwood',        ground: ['#3c6a3a', '#30573a', '#22402c', '#4c7a3c'], building: 'treehut',
                landmark: 'deadtree', deco: ['darktree', 'darktree', 'darktree', 'mushroom'], battle: '#2f5a3a', garrison: ['ranger', 'militia'] },
    ember:    { name: 'Ember Peaks',     ground: ['#8a7466', '#6f5d54', '#54443f', '#c0583a'], building: 'forge',
                landmark: 'volcano', deco: ['ashrock', 'deadpine', 'lavacrack'], battle: '#8a6a58', garrison: ['ashigaru', 'militia'] },
    free:     { name: 'Heartlands',      ground: ['#9ccc5c', '#88bb4e', '#6fa042', '#b0d870'], building: 'village',
                landmark: 'shrine', deco: ['tree_round', 'bush', 'tree_round', 'grass_tuft'], battle: null, garrison: ['militia', 'bandit'] },
    shadow:   { name: 'Mistlands',       ground: ['#8a8aa0', '#76768e', '#5e5e78', '#a4a4bc'], building: 'tower',
                landmark: 'ruins', deco: ['deadpine', 'gravestone', 'gravestone', 'deadpine'], battle: '#6c6c88', garrison: ['skeleton', 'militia'] },
    bog:      { name: 'Bogmire Fens',    ground: ['#6f7f3a', '#5f6e32', '#4b5828', '#88964a'], building: 'stilthut',
                landmark: 'giantshroom', deco: ['mushroom', 'reeds', 'bush'], battle: '#5e6a34', garrison: ['frogman', 'militia'] },
    azure:    { name: 'Crystal Lakes',   ground: ['#a6e0d0', '#8fd0c4', '#72b8b0', '#d8fff6'], building: 'spire',
                landmark: 'crystal', deco: ['crystal', 'palm', 'reeds'], battle: '#8ad0c8', garrison: ['fishfolk', 'militia'] },
    sun:      { name: 'Sunscar Desert',  ground: ['#f2d68a', '#e6c474', '#d2aa5c', '#fae6a8'], building: 'adobe',
                landmark: 'pyramid', deco: ['cactus', 'cactus', 'dune', 'bones'], battle: '#e8cc84', garrison: ['nomad', 'bandit'] },
  },

  // --- Frontline and backline ----------------------------------------------
  // Every unit type is frontline (melee) or backline (archers and casters).
  // Frontline: deploys in front; enemies within pinRadius of a frontline unit are
  //   held up (their speed x pinSlow), and frontline units go first for enemies
  //   threatening their own backline (within guardRadius of it).
  // Backline: deploys behind and stays behindFront pixels behind its own front line;
  //   steps back (at kiteSpeed) from frontline enemies within kiteRange when it can; and hits
  //   at meleePenalty strength while an enemy is within exposedRange.
  //   Arrows and spells ignore `pierce` of the target's defence, and hit `power` times harder.
  //   An army with backline but no frontline counts as weaker (noFrontPower).
  roles: {
    front: { name: 'Frontline', pinRadius: 16, pinSlow: 0.4, guardRadius: 60 },
    back:  { name: 'Backline', behindFront: 18, kiteRange: 30, exposedRange: 20, meleePenalty: 0.45, noFrontPower: 0.75, pierce: 0.5, power: 1.4, kiteSpeed: 0.7 },
  },

  // --- Unit types ----------------------------------------------------------
  // type: infantry | cavalry | beast (frontline) or shooter | artillery | mage | healer (backline).
  // hp, atk (damage), def (damage reduction), spd (pixels/sec), range (pixels),
  // cd (seconds between attacks), cost (gold per soldier).
  // proj = projectile image for ranged units, splash = area damage radius.
  // antiCav: spearmen, extra damage against cavalry. Healers heal instead of attacking (atk = heal).
  units: {
    // Kingdom of Aster
    knight:   { name: 'Knight',      type: 'infantry',  sprite: 'c18', hp: 34, atk: 6, def: 2, spd: 24, range: 12, cd: 1.0, cost: 22 },
    lancer:   { name: 'Lancer',      type: 'cavalry',   sprite: 'c15', hp: 30, atk: 7, def: 2, spd: 42, range: 14, cd: 1.2, cost: 32 },
    archer:   { name: 'Archer',      type: 'shooter',   sprite: 'c8',  hp: 18, atk: 5, def: 0, spd: 24, range: 95, cd: 1.6, cost: 24, proj: 'arrow' },
    cannon:   { name: 'Cannon',      type: 'artillery', sprite: 'm20', hp: 16, atk: 20, def: 1, spd: 14, range: 150, cd: 3.1, cost: 40, proj: 'fireball', splash: 22 },
    mage:     { name: 'Mage',        type: 'mage',      sprite: 'c19', hp: 16, atk: 8, def: 0, spd: 22, range: 75, cd: 2.2, cost: 36, proj: 'fireball', splash: 14 },
    cleric:   { name: 'Cleric',      type: 'healer',    sprite: 'c9',  hp: 18, atk: 8, def: 0, spd: 22, range: 70, cd: 1.8, cost: 30 },

    // Frostmark
    warden:   { name: 'Ice Warden',  type: 'infantry',  sprite: 'c15', hue: 180, hp: 34, atk: 6, def: 3, spd: 21, range: 12, cd: 1.1, cost: 24 },
    yeti:     { name: 'Yeti',        type: 'beast',     sprite: 'c11', hp: 46, atk: 7, def: 2, spd: 21, range: 12, cd: 1.3, cost: 30 },
    bearrider:{ name: 'Bear Rider',  type: 'cavalry',   sprite: 'm11', hue: 190, hp: 36, atk: 7, def: 2, spd: 36, range: 14, cd: 1.3, cost: 34 },
    hunter:   { name: 'Snow Hunter', type: 'shooter',   sprite: 'c19', hue: 170, hp: 20, atk: 5, def: 0, spd: 24, range: 90, cd: 1.6, cost: 24, proj: 'arrow' },
    frosteye: { name: 'Frost Eye',   type: 'mage',      sprite: 'm1',  hue: 190, hp: 18, atk: 7, def: 0, spd: 22, range: 75, cd: 2.0, cost: 34, proj: 'icebolt', splash: 12 },
    shaman:   { name: 'Snow Shaman', type: 'healer',    sprite: 'c9',  hue: 180, hp: 18, atk: 8, def: 0, spd: 22, range: 70, cd: 1.8, cost: 30 },

    // Thornwood Pact
    beetle:   { name: 'Thorn Beetle', type: 'beast',    sprite: 'm16', hp: 50, atk: 7, def: 3, spd: 18, range: 12, cd: 1.4, cost: 32 },
    stagrider:{ name: 'Stag Rider',  type: 'cavalry',   sprite: 'm10', hue: 80, hp: 28, atk: 7, def: 1, spd: 42, range: 14, cd: 1.2, cost: 30 },
    ranger:   { name: 'Ranger',      type: 'shooter',   sprite: 'c1',  hp: 20, atk: 5, def: 0, spd: 28, range: 100, cd: 1.6, cost: 26, proj: 'arrow' },
    mortar:   { name: 'Seed Mortar', type: 'artillery', sprite: 'm21', hue: 80, hp: 16, atk: 18, def: 1, spd: 14, range: 145, cd: 3.0, cost: 38, proj: 'hexbolt', splash: 20 },
    witch:    { name: 'Witch',       type: 'mage',      sprite: 'c4',  hue: 110, hp: 16, atk: 8, def: 0, spd: 22, range: 75, cd: 2.2, cost: 34, proj: 'hexbolt', splash: 14 },
    druid:    { name: 'Druid',       type: 'healer',    sprite: 'c3',  hue: 110, hp: 18, atk: 8, def: 0, spd: 22, range: 70, cd: 1.8, cost: 30 },

    // Ember Clan
    ashigaru: { name: 'Ashigaru',    type: 'infantry',  sprite: 'c4',  hp: 30, atk: 6, def: 1, spd: 26, range: 18, cd: 1.1, cost: 20, antiCav: true },
    brawler:  { name: 'Brawler',     type: 'infantry',  sprite: 'c2',  hp: 44, atk: 8, def: 2, spd: 22, range: 12, cd: 1.3, cost: 30 },
    emberider:{ name: 'Ember Rider', type: 'cavalry',   sprite: 'c6',  hue: 350, hp: 30, atk: 8, def: 1, spd: 42, range: 14, cd: 1.2, cost: 32 },
    firecannon:{ name: 'Fire Cannon', type: 'artillery', sprite: 'm20', hue: 340, hp: 16, atk: 22, def: 1, spd: 14, range: 140, cd: 3.2, cost: 42, proj: 'fireball', splash: 24 },
    flame:    { name: 'Fire Spirit', type: 'mage',      sprite: 'm2',  hp: 18, atk: 7, def: 0, spd: 28, range: 65, cd: 1.8, cost: 30, proj: 'fireball', splash: 10 },

    // Shadow Order
    skeleton: { name: 'Skeleton',    type: 'infantry',  sprite: 'c23', hp: 26, atk: 6, def: 1, spd: 24, range: 12, cd: 1.0, cost: 16 },
    nightmare:{ name: 'Nightmare Rider', type: 'cavalry', sprite: 'c24', hue: 250, hp: 28, atk: 8, def: 1, spd: 44, range: 14, cd: 1.2, cost: 32 },
    ninja:    { name: 'Ninja',       type: 'shooter',   sprite: 'c7',  hp: 20, atk: 5, def: 0, spd: 38, range: 55, cd: 0.9, cost: 26, proj: 'shuriken' },
    ghost:    { name: 'Ghost',       type: 'mage',      sprite: 'm7',  hp: 16, atk: 7, def: 0, spd: 26, range: 70, cd: 2.0, cost: 32, proj: 'fireball', splash: 12 },
    bonepriest:{ name: 'Bone Priest', type: 'healer',   sprite: 'c23', hue: 260, hp: 18, atk: 8, def: 0, spd: 22, range: 70, cd: 1.8, cost: 28 },

    // Wild Horde
    slime:    { name: 'Slime',       type: 'beast',     sprite: 'm3',  hp: 30, atk: 5, def: 1, spd: 20, range: 10, cd: 1.0, cost: 14 },
    beast:    { name: 'Bog Beast',   type: 'beast',     sprite: 'm8',  hp: 55, atk: 8, def: 3, spd: 20, range: 12, cd: 1.4, cost: 34 },
    boarrider:{ name: 'Boar Rider',  type: 'cavalry',   sprite: 'm5',  hp: 34, atk: 7, def: 2, spd: 38, range: 14, cd: 1.3, cost: 30 },
    thorn:    { name: 'Thornling',   type: 'shooter',   sprite: 'm4',  hp: 24, atk: 5, def: 0, spd: 18, range: 80, cd: 1.7, cost: 22, proj: 'arrow' },
    bogshaman:{ name: 'Bog Shaman',  type: 'healer',    sprite: 'm6',  hp: 20, atk: 8, def: 0, spd: 20, range: 70, cd: 1.8, cost: 28 },

    // Azure Tide
    fishfolk: { name: 'Fishfolk',    type: 'infantry',  sprite: 'm22', hp: 30, atk: 6, def: 1, spd: 26, range: 18, cd: 1.0, cost: 20, antiCav: true },
    bulwark:  { name: 'Shellguard',  type: 'beast',     sprite: 'm14', hp: 48, atk: 6, def: 3, spd: 18, range: 12, cd: 1.2, cost: 30 },
    waverider:{ name: 'Wave Rider',  type: 'cavalry',   sprite: 'm18', hue: 300, hp: 28, atk: 7, def: 1, spd: 42, range: 14, cd: 1.2, cost: 30 },
    crystal:  { name: 'Crystal Eye', type: 'shooter',   sprite: 'm17', hp: 20, atk: 6, def: 1, spd: 20, range: 90, cd: 1.7, cost: 28, proj: 'sparkbolt' },
    catapult: { name: 'Coral Catapult', type: 'artillery', sprite: 'm21', hue: 300, hp: 16, atk: 18, def: 1, spd: 14, range: 145, cd: 3.0, cost: 38, proj: 'icebolt', splash: 20 },
    tidemage: { name: 'Tide Mage',   type: 'mage',      sprite: 'c17', hue: 170, hp: 16, atk: 8, def: 0, spd: 22, range: 75, cd: 2.2, cost: 34, proj: 'icebolt', splash: 14 },
    seapriest:{ name: 'Sea Priest',  type: 'healer',    sprite: 'c17', hue: 200, hp: 18, atk: 8, def: 0, spd: 22, range: 70, cd: 1.8, cost: 30 },

    // Sunscar Dominion
    nomad:    { name: 'Nomad Spear', type: 'infantry',  sprite: 'c14', hp: 28, atk: 6, def: 1, spd: 30, range: 18, cd: 1.0, cost: 20, antiCav: true },
    sunguard: { name: 'Sun Guard',   type: 'infantry',  sprite: 'c20', hp: 42, atk: 7, def: 3, spd: 20, range: 12, cd: 1.2, cost: 32 },
    camelrider:{ name: 'Camel Rider', type: 'cavalry',  sprite: 'c14', hue: 30, hp: 32, atk: 7, def: 1, spd: 40, range: 14, cd: 1.2, cost: 30 },
    hawk:     { name: 'Fire Hawk',   type: 'shooter',   sprite: 'm9',  hp: 18, atk: 6, def: 0, spd: 36, range: 80, cd: 1.5, cost: 28, proj: 'fireball' },
    suncannon:{ name: 'Sun Cannon',  type: 'artillery', sprite: 'm20', hue: 40, hp: 16, atk: 20, def: 1, spd: 14, range: 150, cd: 3.1, cost: 40, proj: 'fireball', splash: 22 },
    sunpriest:{ name: 'Sun Priest',  type: 'healer',    sprite: 'c16', hue: 40, hp: 18, atk: 8, def: 0, spd: 22, range: 70, cd: 1.8, cost: 30 },

    // Free Towns
    militia:  { name: 'Militia',     type: 'infantry',  sprite: 'c10', hp: 26, atk: 5, def: 1, spd: 24, range: 16, cd: 1.1, cost: 15, antiCav: true },
    bandit:   { name: 'Bandit Archer', type: 'shooter', sprite: 'c13', hp: 18, atk: 4, def: 0, spd: 26, range: 85, cd: 1.7, cost: 18, proj: 'arrow' },
    frogman:  { name: 'Frogman',     type: 'beast',     sprite: 'm14', hue: 300, hp: 32, atk: 6, def: 2, spd: 22, range: 12, cd: 1.1, cost: 20 },
  },

  // --- Unit type rules -----------------------------------------------------
  // role: frontline or backline. Cavalry charge: the first blow after running at
  // least chargeRun pixels does chargeMul damage. Spearmen (antiCav) do antiCavMul
  // to cavalry. Healers restore their atk in hp to the most hurt ally in range.
  unitTypes: {
    infantry:  { name: 'Infantry',  role: 'front' },
    cavalry:   { name: 'Cavalry',   role: 'front', chargeRun: 40, chargeMul: 2 },
    beast:     { name: 'Beast',     role: 'front' },
    shooter:   { name: 'Shooter',   role: 'back' },
    artillery: { name: 'Artillery', role: 'back' },
    mage:      { name: 'Mage',      role: 'back' },
    healer:    { name: 'Healer',    role: 'back' },
  },
  antiCavMul: 1.6,

  // --- Soldier levels and promotion -------------------------------------------
  // Every soldier has a level. After a battle each survivor gains `survive` levels,
  // `win` more if their side won, and `kill` per enemy they killed. At level 15 a
  // soldier is promoted to tier 2, at level 30 to tier 3. Each tier multiplies hp
  // and attack and adds defence; every level also adds `perLevel` to hp and attack.
  // Heroes of level `veteranHeroLevel` or more can recruit soldiers that start at
  // level 15 (tier 2) for `veteranCost` times the price.
  promotion: {
    tierLevels: [15, 30], maxLevel: 40,
    tiers: [{ hp: 1, atk: 1, def: 0 }, { hp: 1.3, atk: 1.25, def: 1 }, { hp: 1.6, atk: 1.5, def: 2 }],
    perLevel: 0.01,
    survive: 1, win: 1, kill: 1,
    veteranHeroLevel: 10, veteranCost: 3,
    // Tier 2 and 3 names; any unit not listed becomes "Veteran ..." and "Elite ...".
    names: {
      knight: ['Knight Captain', 'Paladin'], lancer: ['Cuirassier', 'Royal Lancer'], archer: ['Longbowman', 'Master Archer'],
      cannon: ['Field Gun', 'Great Cannon'], mage: ['Battlemage', 'Archmage'], cleric: ['Priest', 'High Priest'],
      yeti: ['Great Yeti', 'Yeti King'], hunter: ['Frost Stalker', 'Winter Sniper'], shaman: ['Frost Seer', 'Snow Oracle'],
      ranger: ['Pathfinder', 'Forest Warden'], witch: ['Hex Witch', 'Coven Mother'], druid: ['Grove Keeper', 'Archdruid'],
      ashigaru: ['Spear Sergeant', 'Samurai'], brawler: ['Bruiser', 'Champion'], flame: ['Blaze Spirit', 'Inferno'],
      ninja: ['Shinobi', 'Shadow Master'], skeleton: ['Bone Warrior', 'Death Knight'], ghost: ['Wraith', 'Banshee'],
      slime: ['Big Slime', 'King Slime'], beast: ['Bog Brute', 'Bog Titan'], thorn: ['Briar Shooter', 'Thorn Lord'],
      fishfolk: ['Reef Guard', 'Tide Champion'], tidemage: ['Wave Caller', 'Storm Tide'], crystal: ['Prism Eye', 'Diamond Eye'],
      nomad: ['Dune Lancer', 'Desert Lion'], sunguard: ['Sun Sentinel', 'Solar Paladin'], hawk: ['Blaze Hawk', 'Phoenix'],
      militia: ['Town Guard', 'Captain of the Watch'],
    },
  },

  // --- Hero classes: what a hero can recruit ----------------------------------
  // A hero's class comes from the unit type they lead (or set `cls` on the general).
  // They can recruit their faction's units of the listed types (see rosters).
  // A faction's lord can recruit ANY unit on the faction's roster.
  heroClasses: {
    warrior:  { name: 'Warrior',  role: 'front', types: ['infantry', 'cavalry', 'beast'],
                blurb: 'Frontline commander: recruits infantry, cavalry and beasts.' },
    marksman: { name: 'Marksman', role: 'back',  types: ['shooter', 'artillery'],
                blurb: 'Backline commander: recruits shooters and artillery.' },
    mage:     { name: 'Mage',     role: 'back',  types: ['mage', 'healer'],
                blurb: 'Backline caster: recruits battle mages and healers.' },
  },

  // Which units each faction can field.
  rosters: {
    aster:   ['knight', 'lancer', 'archer', 'cannon', 'mage', 'cleric'],
    frost:   ['warden', 'yeti', 'bearrider', 'hunter', 'frosteye', 'shaman'],
    thorn:   ['beetle', 'stagrider', 'ranger', 'mortar', 'witch', 'druid'],
    ember:   ['ashigaru', 'brawler', 'emberider', 'firecannon', 'flame'],
    shadow:  ['skeleton', 'nightmare', 'ninja', 'ghost', 'bonepriest'],
    horde:   ['slime', 'beast', 'boarrider', 'thorn', 'bogshaman'],
    azure:   ['fishfolk', 'bulwark', 'waverider', 'crystal', 'catapult', 'tidemage', 'seapriest'],
    sun:     ['nomad', 'sunguard', 'camelrider', 'hawk', 'suncannon', 'sunpriest'],
    neutral: ['militia', 'bandit', 'frogman'],
  },

  // --- Generals ------------------------------------------------------------
  // face: portrait from assets/faces (or mface: a monster sprite as portrait).
  // hue: recolour of face and battle sprite. leads: unit type of their squad
  // (the general fights as a much stronger version of it). max: squad size.
  // troops: starting soldiers. lord: faction leader. level: starting level.
  // Each faction's lord and the next two generals start in its capital; the
  // rest spread over its other starting towns.
  generals: {
    aldric:  { name: 'Aldric',   faction: 'aster', face: 21, leads: 'knight', max: 10, troops: 10, lord: true, level: 3 },
    tobin:   { name: 'Tobin',    faction: 'aster', face: 6,  leads: 'knight', max: 8, troops: 6 },
    mira:    { name: 'Mira',     faction: 'aster', face: 17, leads: 'archer', max: 8, troops: 6 },
    oren:    { name: 'Oren',     faction: 'aster', face: 9,  leads: 'mage',   max: 6, troops: 4 },
    elsa:    { name: 'Elsa',     faction: 'aster', face: 4,  hue: 200, leads: 'cleric', max: 8, troops: 5 },
    bertram: { name: 'Bertram',  faction: 'aster', face: 15, leads: 'lancer', max: 8, troops: 5 },

    hroth:   { name: 'Jarl Hroth', faction: 'frost', face: 9, hue: 180, leads: 'yeti', max: 8, troops: 8, lord: true, level: 3 },
    ysolde:  { name: 'Ysolde',   faction: 'frost', face: 19, leads: 'hunter', max: 8, troops: 6 },
    brrn:    { name: 'Brrn',     faction: 'frost', mface: 11, hue: 190, leads: 'yeti', max: 7, troops: 5 },
    skadi:   { name: 'Skadi',    faction: 'frost', face: 4, hue: 170, leads: 'hunter', max: 8, troops: 5 },
    eira:    { name: 'Eira',     faction: 'frost', face: 17, hue: 190, leads: 'frosteye', max: 6, troops: 4 },
    olaf:    { name: 'Olaf',     faction: 'frost', face: 3, hue: 180, leads: 'bearrider', max: 6, troops: 4 },

    sylvara: { name: 'Sylvara',  faction: 'thorn', face: 1, hue: 150, leads: 'ranger', max: 10, troops: 10, lord: true, level: 3 },
    grimbark:{ name: 'Grimbark', faction: 'thorn', mface: 16, leads: 'beetle', max: 7, troops: 5 },
    hexa:    { name: 'Hexa',     faction: 'thorn', face: 4, hue: 110, leads: 'witch', max: 6, troops: 4 },
    bramble: { name: 'Bramble',  faction: 'thorn', face: 25, hue: 120, leads: 'ranger', max: 8, troops: 6 },
    nettle:  { name: 'Nettle',   faction: 'thorn', face: 6, hue: 110, leads: 'stagrider', max: 6, troops: 4 },
    morrow:  { name: 'Morrow',   faction: 'thorn', mface: 15, hue: 140, leads: 'druid', max: 6, troops: 4 },

    kaen:    { name: 'Kaen',     faction: 'ember', face: 12, leads: 'ashigaru', max: 10, troops: 10, lord: true, level: 3 },
    garr:    { name: 'Garr',     faction: 'ember', face: 20, leads: 'brawler', max: 7, troops: 5 },
    suzu:    { name: 'Suzu',     faction: 'ember', face: 5,  leads: 'ashigaru', max: 8, troops: 6 },
    hoshi:   { name: 'Hoshi',    faction: 'ember', face: 16, leads: 'flame', max: 6, troops: 4 },
    ignis:   { name: 'Ignis',    faction: 'ember', mface: 2, leads: 'flame', max: 6, troops: 4 },
    tetsu:   { name: 'Tetsu',    faction: 'ember', face: 22, hue: 330, leads: 'emberider', max: 6, troops: 4 },

    noct:    { name: 'Noct',     faction: 'shadow', face: 13, leads: 'ninja', max: 10, troops: 10, lord: true, level: 3 },
    ossian:  { name: 'Ossian',   faction: 'shadow', face: 23, leads: 'skeleton', max: 10, troops: 7 },
    rin:     { name: 'Rin',      faction: 'shadow', face: 24, leads: 'ninja', max: 8, troops: 6 },
    vael:    { name: 'Vael',     faction: 'shadow', face: 11, leads: 'ghost', max: 6, troops: 4 },
    morta:   { name: 'Morta',    faction: 'shadow', mface: 19, hue: 260, leads: 'bonepriest', max: 8, troops: 5 },
    kage:    { name: 'Kage',     faction: 'shadow', face: 7, hue: 260, leads: 'nightmare', max: 6, troops: 4 },

    grubb:   { name: 'Grubb',    faction: 'horde', face: 1,  leads: 'beast', max: 8, troops: 8, lord: true, level: 3 },
    bruno:   { name: 'Bruno',    faction: 'horde', face: 22, leads: 'beast', max: 6, troops: 4 },
    pip:     { name: 'Pip',      faction: 'horde', face: 25, leads: 'slime', max: 10, troops: 8 },
    ada:     { name: 'Ada',      faction: 'horde', face: 14, leads: 'thorn', max: 8, troops: 6 },
    ooze:    { name: 'Ooze',     faction: 'horde', mface: 3, leads: 'slime', max: 8, troops: 6 },
    krug:    { name: 'Krug',     faction: 'horde', mface: 8, leads: 'boarrider', max: 6, troops: 4 },

    marina:  { name: 'Marina',   faction: 'azure', face: 17, hue: 160, leads: 'tidemage', max: 8, troops: 8, lord: true, level: 3 },
    gill:    { name: 'Gill',     faction: 'azure', mface: 22, leads: 'fishfolk', max: 10, troops: 7 },
    coral:   { name: 'Coral',    faction: 'azure', face: 6, hue: 160, leads: 'fishfolk', max: 8, troops: 6 },
    pearl:   { name: 'Pearl',    faction: 'azure', face: 4, hue: 150, leads: 'crystal', max: 8, troops: 5 },
    shellos: { name: 'Shellos',  faction: 'azure', mface: 14, leads: 'bulwark', max: 6, troops: 4 },
    lumi:    { name: 'Lumi',     faction: 'azure', mface: 17, leads: 'seapriest', max: 6, troops: 4 },

    zahra:   { name: 'Zahra',    faction: 'sun', face: 20, hue: 20, leads: 'sunguard', max: 8, troops: 8, lord: true, level: 3 },
    rashid:  { name: 'Rashid',   faction: 'sun', face: 14, leads: 'nomad', max: 10, troops: 7 },
    amun:    { name: 'Amun',     faction: 'sun', mface: 13, leads: 'sunguard', max: 7, troops: 5 },
    sefa:    { name: 'Sefa',     faction: 'sun', face: 16, hue: 40, leads: 'suncannon', max: 8, troops: 5 },
    tariq:   { name: 'Tariq',    faction: 'sun', face: 12, hue: 30, leads: 'camelrider', max: 8, troops: 6 },
    nefer:   { name: 'Nefer',    faction: 'sun', face: 5, hue: 30, leads: 'sunpriest', max: 6, troops: 4 },

    // Named heroes of the Free Towns, posted to the biggest heartland towns.
    wen:     { name: 'Elder Wen',   faction: 'neutral', face: 3,  leads: 'militia', max: 6, troops: 5 },
    rook:    { name: 'Rook',        faction: 'neutral', face: 10, leads: 'militia', max: 8, troops: 6, level: 2 },
    golem:   { name: 'Iron Golem',  faction: 'neutral', face: 15, leads: 'frogman', max: 6, troops: 5, level: 2 },
    ilo:     { name: 'Brother Ilo', faction: 'neutral', face: 19, leads: 'frogman', max: 5, troops: 4 },
    sela:    { name: 'Sela',        faction: 'neutral', face: 4,  leads: 'militia', max: 6, troops: 5 },
  },

  // Free towns without a named hero are held by a militia captain. Captains
  // are made automatically (below) from these names and faces.
  captainNames: ['Bram', 'Hilde', 'Corwin', 'Maddox', 'Petra', 'Ulric', 'Greta', 'Joss', 'Ivo', 'Runa', 'Dag',
    'Fenna', 'Lorcan', 'Tilda', 'Osric', 'Wynn', 'Agna', 'Bors', 'Cael', 'Della', 'Edda', 'Garth', 'Hale', 'Isa'],
  captainFaces: [3, 6, 9, 10, 13, 14, 22, 25, 1, 5, 12, 16],

  // --- Squad sizes ------------------------------------------------------------
  // How many soldiers a general can command (as in Vahren-style games, the faction
  // lord commands the biggest army). Set `max` and `maxFixed: true` on a general
  // to give them their own size. Starting troops are scaled by startTroops.
  squadSize: { lord: 24, hero: 16, wanderer: 12, startTroops: 1.5 },

  // --- Persuasion -----------------------------------------------------------
  // Pay a general of another side to join you. Like a general who loses a battle
  // with nowhere to retreat, only a CORNERED general can be bought: one whose town
  // has no neighbouring town of their own side. Price = base + perPower x their
  // strength (level, squad size and quality), times factionMul for generals of a
  // rival faction (loyal) or captainMul for militia captains. Lords refuse.
  // You need an envoy: one of your generals who has not acted, in your town next
  // to theirs; the envoy spends their turn. Computer factions persuade too, yours
  // included, as many as they can afford while keeping `aiReserve` gold, when the
  // general is worth at least `aiMinValue` strength per gold.
  persuade: { base: 40, perPower: 0.6, factionMul: 1.6, captainMul: 0.7, aiReserve: 150, aiMinValue: 0.5 },

  // --- Wandering generals -------------------------------------------------
  // Generals with no faction drift between towns. Whoever owns the town they
  // are in can hire them: cost = base + perLevel * level, and they arrive with
  // half a squad. Captured generals (not lords) also become wanderers.
  hiring: { base: 60, perLevel: 25, appearChance: 0.5, maxOnMap: 5, stayMin: 3, stayMax: 6 },
  wanderers: {
    kestrel: { name: 'Kestrel',  face: 2,  leads: 'archer', max: 8, troops: 0, level: 3, wanderer: true },
    juro:    { name: 'Juro',     face: 7,  leads: 'ninja',  max: 8, troops: 0, level: 2, wanderer: true },
    marta:   { name: 'Marta',    face: 8,  leads: 'knight', max: 8, troops: 0, level: 2, wanderer: true },
    fenn:    { name: 'Old Fenn', face: 18, leads: 'mage',   max: 6, troops: 0, level: 4, wanderer: true },
    sable:   { name: 'Sable',    face: 24, hue: 200, leads: 'ninja', max: 8, troops: 0, level: 3, wanderer: true },
    torvald: { name: 'Torvald',  face: 21, hue: 30, leads: 'yeti', max: 6, troops: 0, level: 3, wanderer: true },
    zephyr:  { name: 'Zephyr',   mface: 10, leads: 'hawk', max: 8, troops: 0, level: 2, wanderer: true },
    mags:    { name: 'Mags',     face: 2, hue: 120, leads: 'witch', max: 6, troops: 0, level: 4, wanderer: true },
  },

  // --- Battlefield ground --------------------------------------------------
  // speed: movement multiplier. cover: share of arrow/spell damage blocked.
  // footing: attack multiplier for units standing in it (default 1).
  // behindCover: protection from arrows for units standing just behind a town wall.
  // fortify: extra defence for defenders while they are inside their walls.
  ground: {
    grass:  { speed: 1,    cover: 0 },
    forest: { speed: 0.6,  cover: 0.4 },
    water:  { speed: 0.3,  cover: 0, footing: 0.6 },
    ford:   { speed: 0.8,  cover: 0, footing: 0.85 },
    mud:    { speed: 0.5,  cover: 0 },
    wall:   { speed: 0,    cover: 0,   behindCover: 0.35, fortify: 1.5 },   // solid: go through the gate
    snow:   { speed: 0.55, cover: 0 },                    // deep snowdrifts
    ice:    { speed: 1.2,  cover: 0, footing: 0.8 },      // fast but slippery
    sand:   { speed: 0.6,  cover: 0 },                    // dunes
    lava:   { speed: 0,    cover: 0 },                    // solid: walk around it
    rock:   { speed: 0,    cover: 0 },                    // crystal pillars and boulders: solid
  },
};

// Fill in each unit's id and role (from its type).
for (const [id, t] of Object.entries(DATA.units)) {
  t.id = id;
  if (!t.type) t.type = t.range > 30 ? 'shooter' : 'infantry';
  if (!t.role) t.role = DATA.unitTypes[t.type].role;
}
// Soldier tiers: 1, 2 or 3 from a soldier's level; and the name of a unit at a tier.
DATA.tierOf = lv => 1 + DATA.promotion.tierLevels.filter(l => (lv || 1) >= l).length;
DATA.unitName = (type, lv) => {
  const t = DATA.tierOf(lv), u = DATA.units[type];
  if (t === 1) return u.name;
  const n = DATA.promotion.names[type];
  return n ? n[t - 2] : (t === 2 ? 'Veteran ' : 'Elite ') + u.name;
};
// Stat multipliers for a soldier of level lv.
DATA.soldierBoost = lv => {
  const P = DATA.promotion, T = P.tiers[DATA.tierOf(lv) - 1], k = 1 + ((lv || 1) - 1) * P.perLevel;
  return { hp: T.hp * k, atk: T.atk * k, def: T.def };
};

// A hero's class: set with `cls`, or from the type of unit they lead.
DATA.classOf = gid => {
  const d = DATA.generals[gid];
  if (d.cls) return d.cls;
  const ty = DATA.units[d.leads].type;
  return ['shooter', 'artillery'].includes(ty) ? 'marksman' : ['mage', 'healer'].includes(ty) ? 'mage' : 'warrior';
};
DATA.roleOf = gid => DATA.heroClasses[DATA.classOf(gid)].role;
// A hero's skills: set `skills` on the general, or from their class and troops.
DATA.skillsOf = gid => {
  const d = DATA.generals[gid];
  if (d.skills) return d.skills;
  const cls = DATA.classOf(gid), ty = DATA.units[d.leads].type;
  if (cls === 'marksman') return ['volley', 'eagleeye'];
  if (cls === 'mage') return ty === 'healer' ? ['massheal', 'bless'] : ['meteor', 'frostfield'];
  return ty === 'cavalry' ? ['charge', 'rally'] : ['rally', 'shieldwall', 'charge'];
};

// Units a hero can recruit while serving faction f.
DATA.recruitable = (gid, f) => {
  const d = DATA.generals[gid];
  if (d.lord && d.faction === f) return (DATA.rosters[f] || [d.leads]).slice();   // the lord can field anything the faction has
  const types = DATA.heroClasses[DATA.classOf(gid)].types;
  const list = (DATA.rosters[f] || []).filter(u => types.includes(DATA.units[u].type));
  return list.length ? list : [DATA.generals[gid].leads];
};

// The map comes from js/map.js.
DATA.spots = MAP.spots;
DATA.links = MAP.links;

// Wanderers are generals too: put them in the same table so every lookup works.
Object.assign(DATA.generals, DATA.wanderers);

// Squad sizes: lords 24, heroes 16, wanderers 12 (captains keep their garrison size).
for (const d of Object.values(DATA.generals)) {
  if (d.maxFixed) continue;
  const Z = DATA.squadSize;
  d.max = d.lord ? Z.lord : d.wanderer ? Z.wanderer : Z.hero;
  d.troops = Math.min(d.max, Math.round((d.troops || 0) * Z.startTroops));
}

// A militia captain for every free town (only used where no named hero is posted).
Object.entries(DATA.spots).forEach(([id, s], i) => {
  if (!s.garrison) return;
  const reg = DATA.regions[s.region] || DATA.regions.free;
  DATA.generals['cap_' + id] = {
    name: 'Capt. ' + DATA.captainNames[i % DATA.captainNames.length],
    faction: 'neutral', captain: true,
    face: DATA.captainFaces[(i * 7) % DATA.captainFaces.length], hue: (i * 47) % 360,
    leads: reg.garrison[i % reg.garrison.length], max: s.garrison, troops: s.garrison,
  };
});
