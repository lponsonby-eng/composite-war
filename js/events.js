// =============================================================================
//  STORY EVENTS
//  Each event has:
//    id        unique name
//    trigger   when it is checked: 'start' (new game), 'turn' (start of your
//              turn), 'capture' (you take a town), 'won' (you win a battle),
//              'learn' (your hero learns a signature ability), 'fallen' (a
//              faction is destroyed), 'victory' / 'defeat' (end of the game)
//    when      optional test (G = the game, c = details such as c.spot, c.faction)
//    chance    optional: only happens this often (0..1) when the test passes
//    repeat    true if it can happen again (otherwise once per game)
//    scenes    lines of dialogue: { who, text }. who is a general's id, 'lord'
//              (your lord), 'advisor' (one of your other heroes) or 'narrator'
//    choices   optional buttons: { label, effect(G, c) } - effect may return a
//              line (or a list of lines) telling the player what happened.
//              when(G, c): only show this button if true (e.g. one faction only).
//              outcomes: instead of effect, a list of possible results; one is
//              picked at random. Each is { w, mood, text, effect }:
//                w      weight - higher is more likely; a number or (G, c) => number
//                mood   'good', 'bad' or 'mixed' (good and bad at once)
//                text   what happened (story text), effect: as above
//              Risky choices show a ? on their button.
//  Text can use {lord}, {faction}, {advisor}, {town}, {region}, {other}, {hero},
//  {prev} (on capture: who held the town before).
//  Effect helpers: G.ev.gold(n), G.ev.troops(n), G.ev.loseTroops(frac),
//  G.ev.xp(n), G.ev.heroXp(n) (one random hero), G.ev.wanderer(), G.ev.veterans(n),
//  G.ev.income(n, turns, name) (+/- gold each turn for a while),
//  G.ev.rivalGold(n), G.ev.rivalTroops(frac), G.ev.rivalIncome(n, turns, name).
// =============================================================================

// What kind of place a captured town is (c.spot = the town, c.from = old owner)
const village = c => DATA.spots[c.spot].kind === 'village';
const fortress = c => !!DATA.spots[c.spot].walls && DATA.spots[c.spot].kind === 'town';
const smallTown = c => ['village', 'town'].includes(DATA.spots[c.spot].kind) && !DATA.spots[c.spot].walls;
const rivalCapital = c => DATA.spots[c.spot].kind === 'capital' && c.from && !DATA.factions[c.from].neutral;

window.EVENTS = [

  // ------------------------------------------------------------------ prologue
  { id: 'prologue', trigger: 'start', scenes: [
    { who: 'narrator', text: 'For three hundred years the Concord Crown held the realm together: eight peoples, one peace.' },
    { who: 'narrator', text: 'Last winter the Crown shattered. Eight shards fell into eight hands, and every ruler who holds one hears it whisper the same thing: reunite me.' },
    { who: 'narrator', text: 'The Free Towns of the Heartlands only want to be left alone. They will not be.' },
  ] },
  { id: 'open_aster', trigger: 'start', when: G => G.player === 'aster', scenes: [
    { who: 'lord', text: 'The shard of the plains is ours. The Kingdom of Aster kept the peace once; it will keep it again, by the sword if need be.' },
    { who: 'advisor', text: 'Our knights are ready, my lord. The Heartlands lie east - whoever holds them holds the roads to every border.' },
  ] },
  { id: 'open_frost', trigger: 'start', when: G => G.player === 'frost', scenes: [
    { who: 'lord', text: 'The south has always looked down on the north. Now the ice-shard sings in my hall, and the south will look up.' },
    { who: 'advisor', text: 'The clans answer your horn, Jarl. The yetis have come down from the peaks. Winter marches with us.' },
  ] },
  { id: 'open_thorn', trigger: 'start', when: G => G.player === 'thorn', scenes: [
    { who: 'lord', text: 'The forest remembers every axe and every fire. The shard took root in the old dead tree, and the Darkwood woke with it.' },
    { who: 'advisor', text: 'The rangers are in the branches, the witches at their kettles. Say the word, and the trees will walk.' },
  ] },
  { id: 'open_ember', trigger: 'start', when: G => G.player === 'ember', scenes: [
    { who: 'lord', text: 'The shard fell into the volcano and the mountain did not melt it. It glows hotter than the lava. That is a sign.' },
    { who: 'advisor', text: 'The forges have not slept in a week. The spears are sharp and the fire spirits restless. Point us at someone.' },
  ] },
  { id: 'open_shadow', trigger: 'start', when: G => G.player === 'shadow', scenes: [
    { who: 'lord', text: 'Everyone fears the mist. Good. Fear walks ahead of an army and opens gates before it arrives.' },
    { who: 'advisor', text: 'Our ninjas are already in three capitals. The dead in the ruins stir. The Order is ready, master.' },
  ] },
  { id: 'open_horde', trigger: 'start', when: G => G.player === 'horde', scenes: [
    { who: 'lord', text: 'Bog folk always get the leftovers. Not this time. The shard is in our mud, and the mud is coming for everyone.' },
    { who: 'advisor', text: 'The beasts are fed, boss. Well, mostly. The slimes ate the fence again.' },
  ] },
  { id: 'open_azure', trigger: 'start', when: G => G.player === 'azure', scenes: [
    { who: 'lord', text: 'The shard sank into the Crystal Lakes and every crystal began to glow. The tide has chosen us.' },
    { who: 'advisor', text: 'The fishfolk guard every causeway, my queen. Our enemies will have to cross the water. Few cross it twice.' },
  ] },
  { id: 'open_sun', trigger: 'start', when: G => G.player === 'sun', scenes: [
    { who: 'lord', text: 'The shard fell on the steps of the old pyramid. The desert gives nothing for free - but it gave us this.' },
    { who: 'advisor', text: 'The riders are saddled and the sun cannons polished. Gold buys loyalty, Sultana, and we have both.' },
  ] },

  // ------------------------------------------------------------------ regions: first town taken
  { id: 'reg_frost', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'frost' && G.player !== 'frost', scenes: [
    { who: 'narrator', text: '{town} is ours. Beyond it, the ice peak glitters - its glaciers hold caches the northern clans buried long ago.' },
    { who: 'advisor', text: 'We could dig them out. Or we could leave them, and the clans might think better of us.' },
  ], choices: [
    { label: 'Dig up the caches (+150 gold)', effect: G => G.ev.gold(150) },
    { label: 'Leave them (some clansmen join: +6 soldiers)', effect: G => G.ev.troops(6) },
  ] },
  { id: 'reg_darkwood', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'darkwood' && G.player !== 'thorn', scenes: [
    { who: 'narrator', text: 'In {town} the trees lean in to listen. Something in the giant dead tree is watching.' },
    { who: 'advisor', text: 'The locals say if you leave an offering at its roots, it lends you its wisdom.' },
  ], choices: [
    { label: 'Leave an offering (-80 gold, heroes gain XP)', effect: G => { G.ev.gold(-80); return G.ev.xp(60); } },
    { label: 'Burn the undergrowth (+60 gold)', effect: G => G.ev.gold(60) },
  ] },
  { id: 'reg_ember', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'ember' && G.player !== 'ember', scenes: [
    { who: 'narrator', text: 'The smiths of {town} still work, though their masters have fled. The volcano rumbles above them.' },
    { who: 'advisor', text: 'We could sell their fire-ore, or let them arm our soldiers.' },
  ], choices: [
    { label: 'Sell the fire-ore (+200 gold)', effect: G => G.ev.gold(200) },
    { label: 'Arm our troops (4 soldiers promoted)', effect: G => G.ev.veterans(4) },
  ] },
  { id: 'reg_aster', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'aster' && G.player !== 'aster', scenes: [
    { who: 'narrator', text: 'The granaries of {town} are full. The plains feed half the realm.' },
  ], choices: [
    { label: 'Requisition the grain (+150 gold)', effect: G => G.ev.gold(150) },
    { label: 'Feed the people (volunteers: +6 soldiers)', effect: G => G.ev.troops(6) },
  ] },
  { id: 'reg_shadow', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'shadow' && G.player !== 'shadow', scenes: [
    { who: 'narrator', text: 'Mist curls through {town}. In the ruins nearby, someone has left a lantern burning - and a note.' },
    { who: 'narrator', text: '"A sword for hire, to whoever pays first." No signature.' },
  ], choices: [
    { label: 'Follow the lantern (a wandering general appears)', effect: G => G.ev.wanderer() },
    { label: 'Burn the note and loot the ruins (+100 gold)', effect: G => G.ev.gold(100) },
  ] },
  { id: 'reg_bog', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'bog' && G.player !== 'horde', scenes: [
    { who: 'narrator', text: 'The mushroom under {town} is the size of a castle. Its spores make soldiers feel invincible. Mostly.' },
  ], choices: [
    { label: 'Brew spore tonic (heroes gain XP, some troops fall ill)', effect: G => { G.ev.loseTroops(0.1); return G.ev.xp(80); } },
    { label: 'Trade the spores to merchants (+120 gold)', effect: G => G.ev.gold(120) },
  ] },
  { id: 'reg_azure', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'azure' && G.player !== 'azure', scenes: [
    { who: 'narrator', text: 'From {town} you can see the great crystal glowing in the lake. Its light makes wounds close faster.' },
  ], choices: [
    { label: 'Chip off crystals to sell (+220 gold)', effect: G => G.ev.gold(220) },
    { label: 'Let the army rest in its light (heroes gain XP)', effect: G => G.ev.xp(70) },
  ] },
  { id: 'reg_sun', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'sun' && G.player !== 'sun', scenes: [
    { who: 'narrator', text: 'The well of {town} is the only water for a day in every direction. Caravans pay to drink.' },
  ], choices: [
    { label: 'Charge the caravans (+180 gold)', effect: G => G.ev.gold(180) },
    { label: 'Let them drink free (desert riders join: +5 soldiers)', effect: G => G.ev.troops(5) },
  ] },
  { id: 'reg_free', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].region === 'free', scenes: [
    { who: 'narrator', text: 'The people of {town} watch your banners go up in silence. The Free Towns were free for a very long time.' },
    { who: 'advisor', text: 'A light hand here and the other towns may come over more easily.' },
  ], choices: [
    { label: 'A light hand (+4 soldiers volunteer)', effect: G => G.ev.troops(4) },
    { label: 'Collect back taxes (+100 gold)', effect: G => G.ev.gold(100) },
  ] },

  // ------------------------------------------------------------------ milestones
  { id: 'first_win', trigger: 'won', scenes: [
    { who: 'advisor', text: 'Our first victory! The bards are already making it sound bigger than it was.' },
    { who: 'lord', text: 'Let them. Every town that hears the song is a town that opens its gates.' },
  ] },
  { id: 'first_learn', trigger: 'learn', scenes: [
    { who: 'hero', text: 'Something has changed. I can feel the shard\'s power in my hands now - {other}.' },
    { who: 'lord', text: 'Then use it well, {hero}. The others will be learning the same tricks.' },
  ] },
  { id: 'towns25', trigger: 'turn', when: G => G.spotsOf(G.player).length >= 25, scenes: [
    { who: 'advisor', text: 'Twenty-five towns fly our banner. The other rulers have started sending envoys instead of armies.' },
    { who: 'lord', text: 'Envoys can be ignored. Keep marching.' },
  ], choices: [{ label: 'Tribute from the new towns (+250 gold)', effect: G => G.ev.gold(250) }] },
  { id: 'towns50', trigger: 'turn', when: G => G.spotsOf(G.player).length >= 50, scenes: [
    { who: 'narrator', text: 'Half the realm answers to {faction}. The shards in the other rulers\' halls have begun to dim.' },
    { who: 'lord', text: 'The Crown wants to be whole. It knows who will make it so.' },
  ], choices: [{ label: 'Hold a triumph (heroes gain XP)', effect: G => G.ev.xp(120) }] },
  { id: 'rival_fallen', trigger: 'fallen', repeat: true, when: (G, c) => c.faction !== G.player && !DATA.factions[c.faction].neutral, scenes: [
    { who: 'narrator', text: 'News reaches the court: the {other} is no more. Its shard has passed to new hands.' },
    { who: 'advisor', text: 'One fewer rival. But whoever took it is stronger now.' },
  ] },

  // ------------------------------------------------------------------ turn events
  { id: 'wanderers_rumour', trigger: 'turn', when: G => G.turn >= 4, scenes: [
    { who: 'advisor', text: 'Rumour says swords-for-hire roam the roads since the Crown broke. Heroes with no master, marked with gold.' },
    { who: 'lord', text: 'Keep the treasury ready. A good hero is worth a whole squad.' },
  ] },
  { id: 'taxes', trigger: 'turn', when: G => G.turn >= 8, scenes: [
    { who: 'advisor', text: 'The war chest is thin, {lord}. We could raise the war tax - the people will grumble.' },
  ], choices: [
    { label: 'Raise the tax (+200 gold)', effect: G => G.ev.gold(200) },
    { label: 'Leave it (grateful villagers: +6 soldiers)', effect: G => G.ev.troops(6) },
  ] },
  { id: 'shards_resonate', trigger: 'turn', when: G => G.turn >= 20, scenes: [
    { who: 'narrator', text: 'On the twentieth turn of the war, every shard in the realm flares at once. For one night, every hero dreams the same dream of a whole crown.' },
  ], choices: [{ label: 'Wake inspired (heroes gain XP)', effect: G => G.ev.xp(100) }] },

  // ------------------------------------------------------------------ random events (start of a turn)
  { id: 'caravan', trigger: 'turn', repeat: true, chance: 0.06, scenes: [
    { who: 'narrator', text: 'A merchant caravan, lost on the war roads, asks for an escort through {town}.' },
  ], choices: [
    { label: 'Escort them (+90 gold)', effect: G => G.ev.gold(90) },
    { label: 'Take their cargo (+160 gold, some soldiers desert in disgust)', effect: G => { G.ev.loseTroops(0.08); return G.ev.gold(160); } },
  ] },
  { id: 'bandits', trigger: 'turn', repeat: true, chance: 0.05, when: G => G.gold[G.player] >= 60, scenes: [
    { who: 'advisor', text: 'Bandits are raiding the roads near {town}. They will leave for a price.' },
  ], choices: [
    { label: 'Pay them off (-60 gold)', effect: G => G.ev.gold(-60) },
    { label: 'Hunt them down (lose a few soldiers, heroes gain XP)', effect: G => { G.ev.loseTroops(0.06); return G.ev.xp(30); } },
  ] },
  { id: 'refugees', trigger: 'turn', repeat: true, chance: 0.05, scenes: [
    { who: 'narrator', text: 'Refugees from the fighting arrive at {town}, carrying what they could.' },
  ], choices: [
    { label: 'Take them in (the able-bodied join: +5 soldiers)', effect: G => G.ev.troops(5) },
    { label: 'Turn them away (+40 gold saved)', effect: G => G.ev.gold(40) },
  ] },
  { id: 'plague', trigger: 'turn', repeat: true, chance: 0.03, when: G => G.turn >= 6, scenes: [
    { who: 'advisor', text: 'Camp fever in the barracks at {town}. The healers are doing what they can.' },
  ], choices: [
    { label: 'Pay for medicine (-100 gold)', effect: G => G.ev.gold(-100) },
    { label: 'Ride it out (lose some soldiers)', effect: G => G.ev.loseTroops(0.15) },
  ] },
  { id: 'festival', trigger: 'turn', repeat: true, chance: 0.04, scenes: [
    { who: 'narrator', text: '{town} holds its harvest festival despite the war. The soldiers are invited.' },
  ], choices: [
    { label: 'Join the feast (heroes gain XP)', effect: G => G.ev.xp(25) },
    { label: 'Collect festival taxes (+70 gold)', effect: G => G.ev.gold(70) },
  ] },
  { id: 'mystery_wanderer', trigger: 'turn', repeat: true, chance: 0.04, when: G => G.turn >= 3, scenes: [
    { who: 'narrator', text: 'A cloaked stranger was seen in the tavern at {town}, asking who pays best for a sword.' },
  ], choices: [{ label: 'Send word to the tavern (a wandering general appears)', effect: G => G.ev.wanderer() }] },
  { id: 'deserters', trigger: 'turn', repeat: true, chance: 0.03, when: G => G.turn >= 5, scenes: [
    { who: 'advisor', text: 'Some of our soldiers slipped away in the night. The war is long.' },
  ], choices: [
    { label: 'Pay a bonus to keep the rest (-80 gold)', effect: G => G.ev.gold(-80) },
    { label: 'Let them go (lose some soldiers)', effect: G => G.ev.loseTroops(0.08) },
  ] },
  { id: 'old_veteran', trigger: 'turn', repeat: true, chance: 0.03, scenes: [
    { who: 'narrator', text: 'An old soldier from the Concord wars offers to drill your recruits at {town}.' },
  ], choices: [{ label: 'Accept (2 soldiers promoted)', effect: G => G.ev.veterans(2) }] },

  // ------------------------------------------------------------------ conquests: your people, the place you took
  // c.spot is the town, c.from who held it. The helpers at the top of the file say what
  // kind of place it is: village(c), fortress(c) (walled town), rivalCapital(c).
  // Each faction has a first village, first fortress and first rival capital, plus a
  // "raid" event that can come back whenever they take a village or town.

  // Kingdom of Aster - knights, law, chivalry
  { id: 'aster_village', trigger: 'capture', when: (G, c) => G.player === 'aster' && village(c), scenes: [
    { who: 'advisor', text: 'The headman of {town} kneels and offers the keys. He asks only that our knights keep to the code.' },
  ], choices: [
    { label: 'Swear to protect them (+4 soldiers, -40 gold)', effect: G => [G.ev.gold(-40), G.ev.troops(4)] },
    { label: 'Billet the knights in their homes', outcomes: [
      { w: 2, mood: 'good', text: 'The villagers grumble, but they feed the horses well.', effect: G => G.ev.gold(60) },
      { w: 1, mood: 'bad', text: 'A knight forgets his vows. By morning half the village has fled - and word spreads.', effect: G => [G.ev.loseTroops(0.05), G.ev.income(-10, 3, 'Bad name in the villages')] },
    ] },
  ] },
  { id: 'aster_fort', trigger: 'capture', when: (G, c) => G.player === 'aster' && fortress(c), scenes: [
    { who: 'narrator', text: 'The walls of {town} are breached. In the keep, the defeated commander offers his sword hilt-first.' },
    { who: 'lord', text: 'The code says a brave enemy may be spared.' },
  ], choices: [
    { label: 'Spare him and his men', outcomes: [
      { w: 3, mood: 'good', text: 'He keeps his word. His veterans take service under your banner.', effect: G => [G.ev.troops(5), G.ev.veterans(3)] },
      { w: 1, mood: 'bad', text: 'At night the gate is opened from inside. He was never going to keep his word.', effect: G => [G.ev.loseTroops(0.12), G.ev.gold(-60)] },
    ] },
    { label: 'Ransom him (+120 gold)', effect: G => G.ev.gold(120) },
  ] },
  { id: 'aster_capital', trigger: 'capture', when: (G, c) => G.player === 'aster' && rivalCapital(c), scenes: [
    { who: 'narrator', text: 'The throne room of {town} is empty. The {prev} shard is gone, but their treasury is not.' },
    { who: 'advisor', text: 'The heralds ask how this victory should be told, {lord}.' },
  ], choices: [
    { label: 'A royal triumph (heroes gain XP)', effect: G => G.ev.xp(90) },
    { label: 'Open the treasury to the people', outcomes: [
      { w: 2, mood: 'good', text: 'The people of {town} cheer the King of Aster. Some even enlist.', effect: G => [G.ev.troops(6), G.ev.income(15, 4, 'Grateful subjects')] },
      { w: 1, mood: 'mixed', text: 'The crowd cheers - and then riots over who gets what. Order is restored, at a cost.', effect: G => [G.ev.troops(3), G.ev.loseTroops(0.06)] },
    ] },
  ] },
  { id: 'aster_raid', trigger: 'capture', repeat: true, chance: 0.15, when: (G, c) => G.player === 'aster' && smallTown(c), scenes: [
    { who: 'advisor', text: 'A young squire found the {town} tithe barn untouched. Do we take the tithe for the war, {lord}?' },
  ], choices: [
    { label: 'Take the tithe', outcomes: [
      { w: 3, mood: 'good', effect: G => G.ev.gold(80) },
      { w: 1, mood: 'mixed', text: 'The priests curse the knights. The gold spends just as well, but the men are uneasy.', effect: G => [G.ev.gold(80), G.ev.loseTroops(0.05)] },
    ] },
    { label: 'Leave it to the church (the squire is knighted: heroes gain XP)', effect: G => G.ev.xp(20) },
  ] },

  // Frostmark - clans, endurance, the old ways
  { id: 'frost_village', trigger: 'capture', when: (G, c) => G.player === 'frost' && village(c), scenes: [
    { who: 'lord', text: 'Soft southern folk. {town} has never seen real winter. Shall we show them?' },
  ], choices: [
    { label: 'Take their winter stores', outcomes: [
      { w: 2, mood: 'good', effect: G => G.ev.gold(110) },
      { w: 1, mood: 'mixed', text: 'The stores are rich, but the hungry villagers join the next rival army that passes.', effect: G => [G.ev.gold(110), G.ev.rivalGold(40)] },
    ] },
    { label: 'Teach them clan law (+5 soldiers)', effect: G => G.ev.troops(5) },
  ] },
  { id: 'frost_fort', trigger: 'capture', when: (G, c) => G.player === 'frost' && fortress(c), scenes: [
    { who: 'advisor', text: 'Stone walls, Jarl. Our people have never held walls like these. The skalds say a hall must be blessed in blood or in mead.' },
  ], choices: [
    { label: 'Mead! A feast in the great hall', outcomes: [
      { w: 2, mood: 'good', text: 'The feast lasts three days. The songs will last three hundred years.', effect: G => G.ev.xp(60) },
      { w: 1, mood: 'mixed', text: 'A glorious feast - and a terrible brawl. Two clans are no longer speaking.', effect: G => [G.ev.xp(60), G.ev.loseTroops(0.08)] },
    ] },
    { label: 'Blood: hold a trial by combat (soldiers promoted)', effect: G => G.ev.veterans(4) },
  ] },
  { id: 'frost_capital', trigger: 'capture', when: (G, c) => G.player === 'frost' && rivalCapital(c), scenes: [
    { who: 'narrator', text: 'Snow falls on {town} for the first time in living memory. The {prev} has lost its heart to the north.' },
  ], choices: [
    { label: 'Carve its gates into a longhall (+income for 5 turns)', effect: G => G.ev.income(20, 5, 'Southern longhall') },
    { label: 'Call the yetis down to feast', outcomes: [
      { w: 1, mood: 'good', text: 'The yetis come in their dozens and stay to fight.', effect: G => [G.ev.troops(8), G.ev.veterans(2)] },
      { w: 1, mood: 'bad', text: 'The yetis come, eat everything, and leave.', effect: G => G.ev.gold(-120) },
    ] },
  ] },
  { id: 'frost_raid', trigger: 'capture', repeat: true, chance: 0.15, when: (G, c) => G.player === 'frost' && smallTown(c), scenes: [
    { who: 'advisor', text: 'A wolf pack is following the army since {town}. The hunters want to tame them, the elders want them gone.' },
  ], choices: [
    { label: 'Tame the wolves', outcomes: [
      { w: 2, mood: 'good', text: 'The wolves learn quickly. Soldiers with wolves at their heels fight like veterans.', effect: G => G.ev.veterans(3) },
      { w: 1, mood: 'bad', text: 'The wolves learn quickly - to steal from the supply wagons.', effect: G => G.ev.gold(-70) },
    ] },
    { label: 'Hunt them for pelts (+60 gold)', effect: G => G.ev.gold(60) },
  ] },

  // Thornwood Pact - the forest, the old pacts, witchcraft
  { id: 'thorn_village', trigger: 'capture', when: (G, c) => G.player === 'thorn' && village(c), scenes: [
    { who: 'advisor', text: 'The people of {town} cut down the grove at the edge of their fields. The trees want them to pay.' },
  ], choices: [
    { label: 'Make them plant a new grove (+5 soldiers join the Pact)', effect: G => G.ev.troops(5) },
    { label: 'Let the forest take its due', outcomes: [
      { w: 2, mood: 'good', text: 'The roots swallow the fields and the trees grow fat on it. The witches are delighted.', effect: G => G.ev.xp(50) },
      { w: 1, mood: 'mixed', text: 'The forest takes its due - and a few of our own who stood too close.', effect: G => [G.ev.xp(50), G.ev.loseTroops(0.08)] },
    ] },
  ] },
  { id: 'thorn_fort', trigger: 'capture', when: (G, c) => G.player === 'thorn' && fortress(c), scenes: [
    { who: 'lord', text: 'Stone. Dead stone, cut from the living hill. I can hear the ivy in the cracks begging to be let loose.' },
  ], choices: [
    { label: 'Let the ivy pull down the walls', outcomes: [
      { w: 1, mood: 'good', text: 'The walls fall and a forest rises in a single night. The beetles nest in it.', effect: G => [G.ev.troops(6), G.ev.xp(30)] },
      { w: 1, mood: 'bad', text: 'The ivy pulls down the walls - and the storehouse, and the barracks.', effect: G => [G.ev.gold(-90), G.ev.loseTroops(0.06)] },
    ] },
    { label: 'Keep the walls and sell the stone (+140 gold)', effect: G => G.ev.gold(140) },
  ] },
  { id: 'thorn_capital', trigger: 'capture', when: (G, c) => G.player === 'thorn' && rivalCapital(c), scenes: [
    { who: 'narrator', text: 'Seeds from the Darkwood are scattered over the palace gardens of {town}. In a year, the {prev} will be a memory under the leaves.' },
  ], choices: [
    { label: 'Grow a heart-tree here (+income for 5 turns)', effect: G => G.ev.income(20, 5, 'Heart-tree') },
    { label: 'Brew a hex from the royal crypt', outcomes: [
      { w: 2, mood: 'good', text: 'The hex spreads along every road. Rival soldiers wake up covered in toadstools.', effect: G => G.ev.rivalTroops(0.08) },
      { w: 1, mood: 'bad', text: 'The hex backfires on the witches who brewed it.', effect: G => [G.ev.loseTroops(0.08), G.ev.gold(-50)] },
    ] },
  ] },
  { id: 'thorn_raid', trigger: 'capture', repeat: true, chance: 0.15, when: (G, c) => G.player === 'thorn' && smallTown(c), scenes: [
    { who: 'advisor', text: 'A woodcutter from {town} is caught with an axe. Pact law is clear. The rangers wait for your word.' },
  ], choices: [
    { label: 'Pact law: the forest judges him', outcomes: [
      { w: 1, mood: 'good', text: 'The forest spares him. He becomes its most devoted ranger.', effect: G => G.ev.troops(2) },
      { w: 1, mood: 'bad', text: 'The forest does not spare him. The town hides its sons from our recruiters.', effect: G => G.ev.income(-10, 2, 'Fearful villages') },
    ] },
    { label: 'Fine him instead (+50 gold)', effect: G => G.ev.gold(50) },
  ] },

  // Ember Clan - forge, fire, honour in battle
  { id: 'ember_village', trigger: 'capture', when: (G, c) => G.player === 'ember' && village(c), scenes: [
    { who: 'advisor', text: 'The smith of {town} has never worked fire-ore. He wants to learn. He also wants to be paid.' },
  ], choices: [
    { label: 'Teach him the clan forge-craft', outcomes: [
      { w: 2, mood: 'good', text: 'He learns fast. Within a week, the village spears glow red.', effect: G => G.ev.veterans(3) },
      { w: 1, mood: 'bad', text: 'Fire-ore does not forgive beginners. The forge and half the street burn.', effect: G => G.ev.gold(-80) },
    ] },
    { label: 'Burn the old forge and take his tools (+70 gold)', effect: G => G.ev.gold(70) },
  ] },
  { id: 'ember_fort', trigger: 'capture', when: (G, c) => G.player === 'ember' && fortress(c), scenes: [
    { who: 'lord', text: 'These walls held us for a whole day. Whoever built them deserves a duel, not a grave.' },
  ], choices: [
    { label: 'Duel their champion yourself', outcomes: [
      { w: 2, mood: 'good', text: '{lord} wins in three strokes. The defenders lay down their arms and take the clan oath.', effect: G => [G.ev.heroXp(80), G.ev.troops(5)] },
      { w: 1, mood: 'mixed', text: 'A long, bloody duel. {lord} wins - barely - and the defenders refuse to kneel.', effect: G => [G.ev.heroXp(80), G.ev.loseTroops(0.06)] },
    ] },
    { label: 'Melt the gates into spearheads (soldiers promoted)', effect: G => G.ev.veterans(3) },
  ] },
  { id: 'ember_capital', trigger: 'capture', when: (G, c) => G.player === 'ember' && rivalCapital(c), scenes: [
    { who: 'narrator', text: 'The banners of the {prev} burn on the walls of {town}. The fire spirits dance in the smoke.' },
  ], choices: [
    { label: 'Feed the fire spirits the palace', outcomes: [
      { w: 2, mood: 'good', text: 'The spirits grow strong on it and follow your heroes into battle.', effect: G => G.ev.xp(100) },
      { w: 1, mood: 'bad', text: 'The spirits grow strong - and bored. The city burns for a week.', effect: G => [G.ev.xp(40), G.ev.income(-15, 3, 'Burning city')] },
    ] },
    { label: 'Hold a great forge-moot (+200 gold)', effect: G => G.ev.gold(200) },
  ] },
  { id: 'ember_raid', trigger: 'capture', repeat: true, chance: 0.15, when: (G, c) => G.player === 'ember' && smallTown(c), scenes: [
    { who: 'advisor', text: 'The warriors want to burn {town} as an offering to the mountain. The quartermaster wants its grain.' },
  ], choices: [
    { label: 'Burn it for the mountain', outcomes: [
      { w: 1, mood: 'good', text: 'The volcano rumbles its approval. The warriors are fired up.', effect: G => G.ev.xp(35) },
      { w: 1, mood: 'mixed', text: 'The mountain approves. The quartermaster does not: the army goes hungry.', effect: G => [G.ev.xp(35), G.ev.loseTroops(0.06)] },
    ] },
    { label: 'Take the grain (+60 gold)', effect: G => G.ev.gold(60) },
  ] },

  // Shadow Order - secrets, ninjas, the restless dead
  { id: 'shadow_village', trigger: 'capture', when: (G, c) => G.player === 'shadow' && village(c), scenes: [
    { who: 'advisor', text: 'The graveyard of {town} is old, master. Very old. The bone priests could wake it.' },
  ], choices: [
    { label: 'Wake the graveyard', outcomes: [
      { w: 2, mood: 'good', text: 'The dead rise in neat rows and wait for orders.', effect: G => G.ev.troops(7) },
      { w: 1, mood: 'mixed', text: 'The dead rise - and so do the living, with torches. The village is ours, but empty.', effect: G => [G.ev.troops(7), G.ev.income(-10, 3, 'Empty village')] },
    ] },
    { label: 'Leave the dead in peace and spy on the living (+80 gold)', effect: G => G.ev.gold(80) },
  ] },
  { id: 'shadow_fort', trigger: 'capture', when: (G, c) => G.player === 'shadow' && fortress(c), scenes: [
    { who: 'narrator', text: 'In the cellars of {town} the ninjas find a map of every secret passage in the realm. Half of it is written in a code nobody can read.' },
  ], choices: [
    { label: 'Sell it to the highest bidder (+150 gold, rivals get richer)', effect: G => [G.ev.gold(150), G.ev.rivalGold(50)] },
    { label: 'Try to break the code', outcomes: [
      { w: 1, mood: 'good', text: 'The code breaks. The ninjas slip into every rival armoury at once.', effect: G => [G.ev.rivalTroops(0.08), G.ev.xp(40)] },
      { w: 1, mood: 'bad', text: 'The map is a trap. Three ninjas walk into a sealed vault and never come out.', effect: G => G.ev.loseTroops(0.06) },
    ] },
  ] },
  { id: 'shadow_capital', trigger: 'capture', when: (G, c) => G.player === 'shadow' && rivalCapital(c), scenes: [
    { who: 'lord', text: 'The kings of the {prev} lie in the crypt under {town}. Kings make excellent servants.' },
  ], choices: [
    { label: 'Raise the dead kings', outcomes: [
      { w: 2, mood: 'good', text: 'The old kings kneel. Their crowns still shine.', effect: G => [G.ev.veterans(4), G.ev.gold(100)] },
      { w: 1, mood: 'bad', text: 'The old kings do not kneel. It takes all night to put them back down.', effect: G => G.ev.loseTroops(0.12) },
    ] },
    { label: 'Let the mist settle over the city (+income for 5 turns)', effect: G => G.ev.income(18, 5, 'City in the mist') },
  ] },
  { id: 'shadow_raid', trigger: 'capture', repeat: true, chance: 0.15, when: (G, c) => G.player === 'shadow' && smallTown(c), scenes: [
    { who: 'advisor', text: 'A merchant of {town} offers to spy for us. He has offered the same to everyone else, of course.' },
  ], choices: [
    { label: 'Hire him anyway', outcomes: [
      { w: 1, mood: 'good', text: 'His reports are excellent. Our heroes always know where the enemy sleeps.', effect: G => G.ev.xp(30) },
      { w: 1, mood: 'bad', text: 'His reports are excellent - for the other side.', effect: G => G.ev.gold(-60) },
    ] },
    { label: 'Silence him and take his ledger (+50 gold)', effect: G => G.ev.gold(50) },
  ] },

  // Wild Horde - beasts, mud, appetite
  { id: 'horde_village', trigger: 'capture', when: (G, c) => G.player === 'horde' && village(c), scenes: [
    { who: 'advisor', text: 'Boss! {town} has a pigsty. A BIG pigsty. The boar riders are crying with joy.' },
  ], choices: [
    { label: 'Eat the pigs (heroes gain XP)', effect: G => G.ev.xp(30) },
    { label: 'Breed the pigs', outcomes: [
      { w: 2, mood: 'good', text: 'Piglets everywhere. In a month, every rider has a war boar.', effect: G => [G.ev.troops(4), G.ev.income(10, 4, 'Boar farms')] },
      { w: 1, mood: 'bad', text: 'The slimes got into the sty. There are no pigs. There are only slimes.', effect: G => G.ev.gold(-50) },
    ] },
  ] },
  { id: 'horde_fort', trigger: 'capture', when: (G, c) => G.player === 'horde' && fortress(c), scenes: [
    { who: 'lord', text: 'Walls! Nice and solid. The bog beasts love to scratch their backs on walls.' },
  ], choices: [
    { label: 'Let the beasts scratch', outcomes: [
      { w: 1, mood: 'good', text: 'Happy beasts, fierce beasts. They fight twice as hard after a good scratch.', effect: G => G.ev.veterans(4) },
      { w: 1, mood: 'mixed', text: 'Happy beasts. No walls. Good thing we are winning.', effect: G => [G.ev.veterans(4), G.ev.gold(-60)] },
    ] },
    { label: 'Sell the armoury to bog traders (+130 gold)', effect: G => G.ev.gold(130) },
  ] },
  { id: 'horde_capital', trigger: 'capture', when: (G, c) => G.player === 'horde' && rivalCapital(c), scenes: [
    { who: 'narrator', text: 'The menagerie of the {prev} in {town} is full of beasts nobody in the bog has ever seen.' },
  ], choices: [
    { label: 'Open the cages', outcomes: [
      { w: 2, mood: 'good', text: 'The beasts sniff your tamers and decide they like them.', effect: G => [G.ev.troops(8), G.ev.xp(40)] },
      { w: 1, mood: 'bad', text: 'The beasts sniff your tamers and decide they are hungry.', effect: G => G.ev.loseTroops(0.12) },
    ] },
    { label: 'Charge admission (+income for 5 turns)', effect: G => G.ev.income(18, 5, 'Royal menagerie') },
  ] },
  { id: 'horde_raid', trigger: 'capture', repeat: true, chance: 0.15, when: (G, c) => G.player === 'horde' && smallTown(c), scenes: [
    { who: 'advisor', text: 'A slime got loose in the {town} brewery. It is drunk, boss. It is very big and very drunk.' },
  ], choices: [
    { label: 'Try to get it back in line', outcomes: [
      { w: 1, mood: 'good', text: 'A drunk slime is a brave slime. It eats a rival scout patrol on the way back.', effect: G => [G.ev.troops(2), G.ev.xp(20)] },
      { w: 1, mood: 'bad', text: 'It eats the brewery, then the brewer\'s savings.', effect: G => G.ev.gold(-50) },
    ] },
    { label: 'Sell the rest of the beer (+50 gold)', effect: G => G.ev.gold(50) },
  ] },

  // Azure Tide - water, trade, the crystal
  { id: 'azure_village', trigger: 'capture', when: (G, c) => G.player === 'azure' && village(c), scenes: [
    { who: 'advisor', text: 'The well of {town} is dry, my queen. The tide mages could call water up from deep below.' },
  ], choices: [
    { label: 'Call the water', outcomes: [
      { w: 2, mood: 'good', text: 'Water bursts up clear and cold. The village swears itself to the Tide.', effect: G => [G.ev.troops(5), G.ev.income(10, 3, 'Grateful wells')] },
      { w: 1, mood: 'bad', text: 'Water bursts up - all of it. The village floods to the rooftops.', effect: G => G.ev.gold(-70) },
    ] },
    { label: 'Sell them water by the barrel (+80 gold)', effect: G => G.ev.gold(80) },
  ] },
  { id: 'azure_fort', trigger: 'capture', when: (G, c) => G.player === 'azure' && fortress(c), scenes: [
    { who: 'narrator', text: 'Under the keep of {town} runs an underground river. The fishfolk think it might lead all the way to the lakes.' },
  ], choices: [
    { label: 'Send the fishfolk to explore it', outcomes: [
      { w: 1, mood: 'good', text: 'It does. Reinforcements swim up from the lakes the same week.', effect: G => G.ev.troops(7) },
      { w: 1, mood: 'mixed', text: 'It leads to a sunken vault full of coins - and full of eels.', effect: G => [G.ev.gold(120), G.ev.loseTroops(0.06)] },
    ] },
    { label: 'Dam it and make a moat (heroes gain XP)', effect: G => G.ev.xp(35) },
  ] },
  { id: 'azure_capital', trigger: 'capture', when: (G, c) => G.player === 'azure' && rivalCapital(c), scenes: [
    { who: 'narrator', text: 'In the palace of {town} hangs a crystal the {prev} stole from the lakes long ago. It still hums the song of the Tide.' },
  ], choices: [
    { label: 'Carry it home (heroes gain XP)', effect: G => G.ev.xp(90) },
    { label: 'Set it in the city fountain', outcomes: [
      { w: 2, mood: 'good', text: 'The fountain glows. Merchants come from every corner of the realm to see it.', effect: G => G.ev.income(25, 5, 'Crystal fountain') },
      { w: 1, mood: 'bad', text: 'Thieves steal it the very first night.', effect: G => G.ev.gold(-60) },
    ] },
  ] },
  { id: 'azure_raid', trigger: 'capture', repeat: true, chance: 0.15, when: (G, c) => G.player === 'azure' && smallTown(c), scenes: [
    { who: 'advisor', text: 'The river fishers of {town} ask for the Tide\'s blessing on their nets. They can pay - a little.' },
  ], choices: [
    { label: 'Bless the nets', outcomes: [
      { w: 2, mood: 'good', text: 'A great catch. The fishers send their sons to the army.', effect: G => G.ev.troops(3) },
      { w: 1, mood: 'mixed', text: 'A great catch - including a river serpent, which is not pleased.', effect: G => [G.ev.troops(3), G.ev.loseTroops(0.04)] },
    ] },
    { label: 'Take their coin and skip the blessing (+40 gold)', effect: G => G.ev.gold(40) },
  ] },

  // Sunscar Dominion - gold, caravans, the old pyramid
  { id: 'sun_village', trigger: 'capture', when: (G, c) => G.player === 'sun' && village(c), scenes: [
    { who: 'advisor', text: 'The people of {town} have never seen gold coins, Sultana. They trade in salt.' },
  ], choices: [
    { label: 'Introduce the Sunscar dinar', outcomes: [
      { w: 2, mood: 'good', text: 'Coins replace salt in a month. The tax collectors are delighted.', effect: G => G.ev.income(15, 4, 'New dinar markets') },
      { w: 1, mood: 'bad', text: 'Forgers flood the market with fake dinars.', effect: G => G.ev.gold(-70) },
    ] },
    { label: 'Buy all their salt (+5 soldiers hired with salt pay)', effect: G => G.ev.troops(5) },
  ] },
  { id: 'sun_fort', trigger: 'capture', when: (G, c) => G.player === 'sun' && fortress(c), scenes: [
    { who: 'lord', text: 'A fine fortress. Pity about the garrison. Still - mercenaries are only loyal to whoever pays last.' },
  ], choices: [
    { label: 'Pay the defeated garrison to switch sides (-80 gold)', outcomes: [
      { w: 3, mood: 'good', text: 'They take the gold and the oath.', effect: G => [G.ev.gold(-80), G.ev.troops(6), G.ev.veterans(2)] },
      { w: 1, mood: 'bad', text: 'They take the gold. Then they leave.', effect: G => G.ev.gold(-80) },
    ] },
    { label: 'Auction the fortress armoury (+150 gold)', effect: G => G.ev.gold(150) },
  ] },
  { id: 'sun_capital', trigger: 'capture', when: (G, c) => G.player === 'sun' && rivalCapital(c), scenes: [
    { who: 'narrator', text: 'Golden sun-banners hang from the towers of {town}. The {prev} treasury is counted twice, just to be sure.' },
  ], choices: [
    { label: 'Hire every sword in the city (+8 soldiers, -100 gold)', effect: G => [G.ev.gold(-100), G.ev.troops(8)] },
    { label: 'Invest the treasury with the caravan guilds', outcomes: [
      { w: 2, mood: 'good', text: 'The caravans return heavy with profit.', effect: G => G.ev.income(30, 5, 'Caravan investments') },
      { w: 1, mood: 'bad', text: 'The caravans never return. Neither do the guildmasters.', effect: G => G.ev.gold(-100) },
    ] },
  ] },
  { id: 'sun_raid', trigger: 'capture', repeat: true, chance: 0.15, when: (G, c) => G.player === 'sun' && smallTown(c), scenes: [
    { who: 'advisor', text: 'A treasure hunter in {town} swears he knows where the {prev} buried its payroll. For a share, of course.' },
  ], choices: [
    { label: 'Fund his dig (-30 gold)', outcomes: [
      { w: 1, mood: 'good', text: 'He was telling the truth!', effect: G => G.ev.gold(120) },
      { w: 1, mood: 'bad', text: 'He was not telling the truth.', effect: G => G.ev.gold(-30) },
    ] },
    { label: 'Throw him out', effect: () => '' },
  ] },

  // Special places in the Heartlands - everyone sees these, but each people reacts differently
  { id: 'crossroads', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].kind === 'city', scenes: [
    { who: 'narrator', text: '{town}, the great city where every road meets. Its guild halls, markets and temples now fly the banner of {faction}.' },
    { who: 'advisor', text: 'The guilds will pay for their charters. Or we could rule the markets ourselves.' },
  ], choices: [
    { label: 'Sell charters to the guilds (+income for 6 turns)', effect: G => G.ev.income(25, 6, 'Crossroads guilds') },
    { label: 'Seize the markets', outcomes: [
      { w: G => G.player === 'sun' || G.player === 'azure' ? 3 : 1, mood: 'good', text: 'Our merchants know the trade. Profits pour in.', effect: G => G.ev.gold(300) },
      { w: 1, mood: 'bad', text: 'The guilds shut every stall. The city starves, and so does the treasury.', effect: G => [G.ev.gold(60), G.ev.income(-15, 3, 'Guild strike')] },
    ] },
    { label: 'Turn the temples into barracks (+8 soldiers)', when: G => ['ember', 'horde', 'shadow'].includes(G.player), effect: G => G.ev.troops(8) },
  ] },
  { id: 'pinewood_shrine', trigger: 'capture', when: (G, c) => DATA.spots[c.spot].kind === 'shrine', scenes: [
    { who: 'narrator', text: 'The old shrine of {town} is where the Concord Crown was first forged. A faint echo of its power lingers in the stones.' },
  ], choices: [
    { label: 'Pray at the shrine', outcomes: [
      { w: G => G.player === 'aster' || G.player === 'azure' ? 3 : 2, mood: 'good', text: 'The stones answer. Every hero feels the Crown\'s old strength.', effect: G => G.ev.xp(110) },
      { w: G => G.player === 'shadow' || G.player === 'horde' ? 2 : 1, mood: 'bad', text: 'The stones do not recognise your people. A cold wind blows the army\'s fires out.', effect: G => G.ev.loseTroops(0.08) },
    ] },
    { label: 'Draw the last power from the stones', outcomes: [
      { w: G => G.player === 'shadow' || G.player === 'thorn' ? 3 : 1, mood: 'good', text: 'The power floods into your shard. Rival shards dim.', effect: G => [G.ev.xp(60), G.ev.rivalIncome(-10, 3, 'Dimming shards')] },
      { w: 1, mood: 'mixed', text: 'The power floods into your heroes - and the shrine crumbles. Pilgrims curse your name.', effect: G => [G.ev.xp(80), G.ev.income(-10, 4, 'Pilgrims\' curse')] },
    ] },
    { label: 'Leave it untouched (pilgrims bring gifts: +income for 6 turns)', effect: G => G.ev.income(12, 6, 'Shrine pilgrims') },
  ] },

  // ------------------------------------------------------------------ realm events: the whole world is affected
  // You react with a choice; most choices roll a good, bad or mixed outcome.
  // Some peoples get an extra option of their own.
  { id: 'realm_comet', trigger: 'turn', chance: 0.035, when: G => G.turn >= 4, scenes: [
    { who: 'narrator', text: 'A comet tears across the sky and falls somewhere beyond the hills. Every army in the realm sees it.' },
    { who: 'advisor', text: 'The soldiers say it is an omen. Whose omen, they are not sure.' },
  ], choices: [
    { label: 'Declare it an omen of victory', outcomes: [
      { w: 2, mood: 'good', text: 'The soldiers believe it. They march like men who cannot lose.', effect: G => [G.ev.xp(40), G.ev.troops(4)] },
      { w: 1, mood: 'bad', text: 'A second comet follows the first. The soldiers decide it was not our omen after all.', effect: G => G.ev.loseTroops(0.08) },
    ] },
    { label: 'Race to the crater', outcomes: [
      { w: 1, mood: 'good', text: 'Our scouts get there first. Star-iron, enough for a fortune.', effect: G => G.ev.gold(250) },
      { w: 1, mood: 'mixed', text: 'We get there first - and so do two rival armies. We come away with half.', effect: G => [G.ev.gold(120), G.ev.loseTroops(0.05)] },
      { w: 1, mood: 'bad', text: 'Nothing but ash and a scorched patrol.', effect: G => [G.ev.gold(-40), G.ev.loseTroops(0.05)] },
    ] },
    { label: 'Forge the star-iron in the volcano', when: G => G.player === 'ember', outcomes: [
      { w: 3, mood: 'good', text: 'Star-iron and volcano fire: blades that cut through shields like smoke.', effect: G => [G.ev.veterans(6), G.ev.gold(80)] },
      { w: 1, mood: 'mixed', text: 'The iron is too wild for the forge. Half the blades shatter, half are perfect.', effect: G => G.ev.veterans(3) },
    ] },
  ] },
  { id: 'realm_winter', trigger: 'turn', chance: 0.035, when: G => G.turn >= 6, scenes: [
    { who: 'narrator', text: 'The Long Winter comes early. Snow buries the roads from the Frozen North to the edge of the desert.' },
    { who: 'advisor', text: 'Every army will suffer. The question is how much.' },
  ], choices: [
    { label: 'Buy firewood and furs (-120 gold, rivals suffer)', effect: G => [G.ev.gold(-120), G.ev.rivalTroops(0.06)] },
    { label: 'March through the snow', outcomes: [
      { w: G => G.player === 'frost' ? 4 : 1, mood: 'good', text: 'The enemy huddles in their towns. We hit them where they sleep.', effect: G => [G.ev.xp(60), G.ev.rivalTroops(0.08)] },
      { w: 2, mood: 'bad', text: 'The snow takes the stragglers.', effect: G => [G.ev.loseTroops(0.12), G.ev.rivalTroops(0.06)] },
    ] },
    { label: 'Winter is ours: call the clans (Frostmark)', when: G => G.player === 'frost', effect: G => [G.ev.troops(8), G.ev.rivalTroops(0.08), G.ev.rivalIncome(-10, 3, 'Long Winter')] },
  ] },
  { id: 'realm_plague', trigger: 'turn', chance: 0.035, when: G => G.turn >= 8, scenes: [
    { who: 'narrator', text: 'The Grey Cough spreads along the trade roads. Towns close their gates; armies count their sick.' },
  ], choices: [
    { label: 'Close the roads (-income for 3 turns, rivals hit harder)', effect: G => [G.ev.income(-15, 3, 'Closed roads'), G.ev.rivalTroops(0.08)] },
    { label: 'Trust the healers', outcomes: [
      { w: 1, mood: 'good', text: 'The healers find a cure. Other rulers pay handsomely for the recipe.', effect: G => G.ev.gold(200) },
      { w: 2, mood: 'bad', text: 'The cough runs through the camps.', effect: G => G.ev.loseTroops(0.15) },
    ] },
    { label: 'Raise the plague dead as soldiers (Shadow Order)', when: G => G.player === 'shadow', outcomes: [
      { w: 3, mood: 'good', text: 'The dead do not cough.', effect: G => G.ev.troops(10) },
      { w: 1, mood: 'mixed', text: 'The dead do not cough - but the living soldiers will not sleep next to them.', effect: G => [G.ev.troops(10), G.ev.loseTroops(0.05)] },
    ] },
    { label: 'Brew a bog remedy (Wild Horde)', when: G => G.player === 'horde', outcomes: [
      { w: 2, mood: 'good', text: 'It smells terrible and works perfectly.', effect: G => [G.ev.gold(150), G.ev.rivalGold(-50)] },
      { w: 1, mood: 'bad', text: 'It smells terrible and works terribly.', effect: G => G.ev.loseTroops(0.1) },
    ] },
  ] },
  { id: 'realm_dragon', trigger: 'turn', chance: 0.035, when: G => G.turn >= 10, scenes: [
    { who: 'narrator', text: 'A dragon has woken in the far mountains, drawn by the whispers of the broken Crown. It burns a town a night - anyone\'s town.' },
  ], choices: [
    { label: 'Send heroes to hunt it', outcomes: [
      { w: 1, mood: 'good', text: 'The dragon falls! Its hoard is beyond counting, and the bards will sing your heroes\' names.', effect: G => [G.ev.gold(300), G.ev.xp(80)] },
      { w: 1, mood: 'mixed', text: 'The dragon flees, wounded. Your heroes return scarred and wiser.', effect: G => [G.ev.xp(80), G.ev.loseTroops(0.12)] },
      { w: 1, mood: 'bad', text: 'The dragon does not flee.', effect: G => [G.ev.loseTroops(0.2), G.ev.gold(-50)] },
    ] },
    { label: 'Pay it tribute to burn someone else (-150 gold)', outcomes: [
      { w: 3, mood: 'good', text: 'The dragon takes the gold and flies off toward your rivals.', effect: G => [G.ev.gold(-150), G.ev.rivalIncome(-20, 3, 'Dragon fire')] },
      { w: 1, mood: 'bad', text: 'The dragon takes the gold - and comes back for more.', effect: G => [G.ev.gold(-150), G.ev.income(-15, 3, 'Dragon fire')] },
    ] },
    { label: 'Speak to it as kin of fire (Ember Clan)', when: G => G.player === 'ember', outcomes: [
      { w: 2, mood: 'good', text: 'The dragon listens. It agrees to burn only those who stand against the Ember Clan.', effect: G => [G.ev.rivalIncome(-20, 4, 'Dragon fire'), G.ev.rivalTroops(0.06)] },
      { w: 1, mood: 'bad', text: 'The dragon is not interested in kinship.', effect: G => G.ev.loseTroops(0.1) },
    ] },
  ] },
  { id: 'realm_flood', trigger: 'turn', chance: 0.035, when: G => G.turn >= 5, scenes: [
    { who: 'narrator', text: 'Spring rains swell every river at once. Bridges wash away and fields turn to lakes.' },
  ], choices: [
    { label: 'Rebuild the bridges (-100 gold)', outcomes: [
      { w: 2, mood: 'good', text: 'Ours are the only bridges left standing. Merchants pay tolls to cross.', effect: G => [G.ev.gold(-100), G.ev.income(20, 4, 'Bridge tolls')] },
      { w: 1, mood: 'mixed', text: 'The bridges are rebuilt - and the next rain washes half of them away again.', effect: G => [G.ev.gold(-100), G.ev.income(10, 3, 'Bridge tolls')] },
    ] },
    { label: 'Wait for the water to go down (-income for 3 turns)', effect: G => [G.ev.income(-10, 3, 'Flooded fields'), G.ev.rivalIncome(-10, 3, 'Flooded fields')] },
    { label: 'Ride the floodwaters (Azure Tide)', when: G => G.player === 'azure', effect: G => [G.ev.xp(70), G.ev.rivalTroops(0.08), G.ev.income(15, 3, 'Water trade')] },
  ] },
  { id: 'realm_drought', trigger: 'turn', chance: 0.035, when: G => G.turn >= 7, scenes: [
    { who: 'narrator', text: 'No rain for forty days. Wells crack, crops wither, and the price of water climbs higher than the price of wine.' },
  ], choices: [
    { label: 'Ration water to the army', outcomes: [
      { w: 2, mood: 'mixed', text: 'The army survives on half rations. Grumbling, but alive.', effect: G => [G.ev.loseTroops(0.05), G.ev.rivalTroops(0.05)] },
      { w: 1, mood: 'bad', text: 'Rationing breeds desertion.', effect: G => G.ev.loseTroops(0.12) },
    ] },
    { label: 'Buy water from the desert (-120 gold)', effect: G => [G.ev.gold(-120), G.ev.rivalTroops(0.06)] },
    { label: 'Open the hidden oasis wells (Sunscar Dominion)', when: G => G.player === 'sun', effect: G => [G.ev.income(25, 4, 'Water sales'), G.ev.rivalGold(-60)] },
  ] },
  { id: 'realm_uprising', trigger: 'turn', chance: 0.035, when: G => G.turn >= 9, scenes: [
    { who: 'narrator', text: 'Tired of endless war, peasants rise across the realm. Every ruler faces burning granaries and barricaded villages.' },
  ], choices: [
    { label: 'Crush the uprising', outcomes: [
      { w: 2, mood: 'mixed', text: 'Order returns at sword-point. The villages pay - but they remember.', effect: G => [G.ev.gold(100), G.ev.income(-10, 3, 'Sullen villages')] },
      { w: 1, mood: 'bad', text: 'The peasants know the land better than we do.', effect: G => G.ev.loseTroops(0.1) },
    ] },
    { label: 'Hear their grievances', outcomes: [
      { w: 2, mood: 'good', text: 'Lower taxes, fewer levies. The peasants go home - some of them to enlist.', effect: G => [G.ev.income(-5, 3, 'Tax relief'), G.ev.troops(7)] },
      { w: 1, mood: 'bad', text: 'They take your kindness as weakness and ask for more.', effect: G => G.ev.gold(-120) },
    ] },
    { label: 'Arm the rebels against your rivals (-60 gold)', outcomes: [
      { w: 1, mood: 'good', text: 'The rebels burn rival granaries instead of ours.', effect: G => [G.ev.gold(-60), G.ev.rivalIncome(-20, 3, 'Peasant revolt')] },
      { w: 1, mood: 'bad', text: 'The rebels take the weapons and burn our granaries anyway.', effect: G => [G.ev.gold(-60), G.ev.income(-15, 3, 'Peasant revolt')] },
    ] },
  ] },
  { id: 'realm_goldrush', trigger: 'turn', chance: 0.035, when: G => G.turn >= 3, scenes: [
    { who: 'narrator', text: 'Gold is found in the Heartland hills! Prospectors, bandits and soldiers flood the roads.' },
  ], choices: [
    { label: 'Send soldiers to stake a claim', outcomes: [
      { w: 2, mood: 'good', text: 'We strike a rich seam.', effect: G => G.ev.income(25, 4, 'Gold mine') },
      { w: 1, mood: 'mixed', text: 'We strike gold. Half the soldiers decide they would rather be miners.', effect: G => [G.ev.gold(150), G.ev.loseTroops(0.1)] },
      { w: 1, mood: 'bad', text: 'Fool\'s gold. And the bandits took the real thing.', effect: G => G.ev.loseTroops(0.06) },
    ] },
    { label: 'Tax the prospectors who cross our roads (+income for 3 turns)', effect: G => G.ev.income(12, 3, 'Prospector tax') },
  ] },
  { id: 'realm_mercenaries', trigger: 'turn', chance: 0.035, when: G => G.turn >= 5, scenes: [
    { who: 'narrator', text: 'The Iron Company, the most famous mercenaries in the realm, have lost their employer. They are taking offers from all sides.' },
  ], choices: [
    { label: 'Hire them on credit (-15 gold a turn for 5 turns)', outcomes: [
      { w: 3, mood: 'good', text: 'The Company marches under your banner.', effect: G => [G.ev.income(-15, 5, 'Iron Company wages'), G.ev.troops(8), G.ev.veterans(4)] },
      { w: 1, mood: 'bad', text: 'They take the first payment and sign with a rival the next day.', effect: G => [G.ev.income(-15, 5, 'Iron Company wages'), G.ev.rivalGold(60)] },
    ] },
    { label: 'Outbid nobody - but bribe them to stay out of the war (-100 gold)', effect: G => [G.ev.gold(-100), 'The Iron Company goes home.'] },
    { label: 'Ignore them', outcomes: [
      { w: 1, mood: 'good', text: 'The Company squabbles over offers and disbands. Some of them drift to you.', effect: G => G.ev.troops(3) },
      { w: 1, mood: 'bad', text: 'A rival hires them. Their gold flows, their armies swell.', effect: G => G.ev.rivalGold(100) },
    ] },
  ] },
  { id: 'realm_eclipse', trigger: 'turn', chance: 0.035, when: G => G.turn >= 12, scenes: [
    { who: 'narrator', text: 'The sun goes dark at noon. In every hall of the realm, the shards of the Crown blaze in the darkness.' },
    { who: 'lord', text: 'The shard is calling. It wants something.' },
  ], choices: [
    { label: 'Answer the shard', outcomes: [
      { w: 1, mood: 'good', text: 'Power floods through every hero who stands near it.', effect: G => G.ev.xp(150) },
      { w: 1, mood: 'mixed', text: 'Power floods through your heroes - and burns through the soldiers around them.', effect: G => [G.ev.xp(150), G.ev.loseTroops(0.12)] },
    ] },
    { label: 'Cover the shard and wait', effect: G => [G.ev.gold(50), 'The darkness passes. Rival halls are not so lucky: ' + G.ev.rivalTroops(0.05)] },
    { label: 'Hold a night ritual in the darkness (Shadow Order / Thornwood Pact)', when: G => G.player === 'shadow' || G.player === 'thorn', effect: G => [G.ev.xp(120), G.ev.rivalIncome(-15, 3, 'Shards dimmed')] },
  ] },
  { id: 'realm_locusts', trigger: 'turn', chance: 0.035, when: G => G.turn >= 6, scenes: [
    { who: 'narrator', text: 'A swarm of locusts the size of a storm cloud sweeps over the farmlands. Fields are stripped in hours.' },
  ], choices: [
    { label: 'Burn the fields ahead of them', outcomes: [
      { w: 1, mood: 'good', text: 'The swarm turns away from the smoke - toward your rivals.', effect: G => [G.ev.income(-5, 2, 'Burned fields'), G.ev.rivalIncome(-15, 3, 'Locusts')] },
      { w: 1, mood: 'bad', text: 'The wind turns. We burned our own fields for nothing.', effect: G => G.ev.income(-20, 3, 'Burned fields') },
    ] },
    { label: 'Buy grain before the prices rise (-100 gold)', effect: G => [G.ev.gold(-100), G.ev.rivalIncome(-10, 3, 'Locusts')] },
    { label: 'Let the beasts eat the locusts (Wild Horde)', when: G => G.player === 'horde', effect: G => [G.ev.xp(50), G.ev.troops(4), G.ev.rivalIncome(-15, 3, 'Locusts')] },
    { label: 'Let the forest swallow the swarm (Thornwood Pact)', when: G => G.player === 'thorn', effect: G => [G.ev.income(10, 3, 'Untouched forest farms'), G.ev.rivalIncome(-15, 3, 'Locusts')] },
  ] },
  { id: 'realm_tournament', trigger: 'turn', chance: 0.035, when: G => G.turn >= 4, scenes: [
    { who: 'narrator', text: 'The Free Towns call a Grand Tournament - a truce for one week, and a purse of gold for the champion. Heroes from every faction come.' },
  ], choices: [
    { label: 'Send your best hero to compete', outcomes: [
      { w: G => G.player === 'aster' ? 3 : 2, mood: 'good', text: 'Your champion wins! The purse is yours, and everyone saw it.', effect: G => [G.ev.heroXp(120), G.ev.gold(200)] },
      { w: 1, mood: 'mixed', text: 'Your champion loses in the final - but learns more than a victory could teach.', effect: G => G.ev.heroXp(100) },
      { w: 1, mood: 'bad', text: 'Your champion is beaten in the first round, in front of the whole realm.', effect: G => [G.ev.gold(-50), G.ev.rivalGold(50)] },
    ] },
    { label: 'Use the truce to spy on rival heroes (heroes gain XP)', effect: G => G.ev.xp(40) },
    { label: 'Bet on the outcome (-80 gold)', outcomes: [
      { w: 1, mood: 'good', effect: G => G.ev.gold(160) },
      { w: 1, mood: 'bad', effect: G => G.ev.gold(-80) },
    ] },
  ] },
  { id: 'realm_quake', trigger: 'turn', chance: 0.035, when: G => G.turn >= 8, scenes: [
    { who: 'narrator', text: 'The earth shakes from coast to coast. When the dust settles, an ancient vault of the Concord kings lies open in the hills.' },
  ], choices: [
    { label: 'Send an expedition into the vault', outcomes: [
      { w: 1, mood: 'good', text: 'Gold, old armour, and the battle-diaries of the Concord kings.', effect: G => [G.ev.gold(200), G.ev.veterans(4)] },
      { w: 1, mood: 'mixed', text: 'Treasure - and a second quake that seals half the expedition inside.', effect: G => [G.ev.gold(150), G.ev.loseTroops(0.08)] },
      { w: 1, mood: 'bad', text: 'Something was sealed in that vault for a reason.', effect: G => [G.ev.loseTroops(0.12)] },
    ] },
    { label: 'Help the towns rebuild instead (+6 soldiers, -60 gold)', effect: G => [G.ev.gold(-60), G.ev.troops(6)] },
  ] },
  { id: 'realm_shardfever', trigger: 'turn', chance: 0.035, when: G => G.turn >= 15, scenes: [
    { who: 'narrator', text: 'Shard-fever: every lord in the realm dreams of the whole Crown and wakes angry. Rival courts tear themselves apart with plots.' },
    { who: 'advisor', text: 'Our court is not immune, {lord}. Some of the captains have been whispering.' },
  ], choices: [
    { label: 'Purge the whisperers', outcomes: [
      { w: 2, mood: 'good', text: 'The plot is crushed before it starts. The court is loyal.', effect: G => G.ev.veterans(3) },
      { w: 1, mood: 'bad', text: 'The purge goes too far. Good soldiers flee.', effect: G => G.ev.loseTroops(0.1) },
    ] },
    { label: 'Fan the plots in rival courts (-80 gold)', outcomes: [
      { w: 2, mood: 'good', text: 'Rival lords spend a season hunting traitors instead of fighting.', effect: G => [G.ev.gold(-80), G.ev.rivalTroops(0.1)] },
      { w: 1, mood: 'mixed', text: 'It works - but our agents are caught, and the rivals know who paid.', effect: G => [G.ev.gold(-80), G.ev.rivalTroops(0.05), G.ev.loseTroops(0.04)] },
    ] },
  ] },

  // ------------------------------------------------------------------ endings
  { id: 'victory', trigger: 'victory', scenes: [
    { who: 'narrator', text: 'The last rival banner falls. One by one the shards are carried to {lord}\'s hall.' },
    { who: 'narrator', text: 'When the eighth shard is set in place, the Concord Crown shines whole again - and the realm, at last, is quiet.' },
    { who: 'lord', text: 'Peace, then. Let it last longer than the last one.' },
  ] },
  { id: 'defeat', trigger: 'defeat', scenes: [
    { who: 'narrator', text: 'The banners of {faction} are torn down from the last tower. Its shard passes to another hand.' },
    { who: 'narrator', text: 'Perhaps another ruler will reunite the Crown. Perhaps, one day, you will try again.' },
  ] },
];
