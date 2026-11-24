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
//              line telling the player what happened
//  Text can use {lord}, {faction}, {advisor}, {town}, {region}, {other}, {hero}.
//  Effect helpers: G.ev.gold(n), G.ev.troops(n), G.ev.loseTroops(frac),
//  G.ev.xp(n), G.ev.wanderer(), G.ev.veterans(n).
// =============================================================================
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
