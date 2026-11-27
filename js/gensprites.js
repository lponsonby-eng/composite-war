// =============================================================================
//  GENERATED SPRITES: connects the Pixelgen generators (tools/pixelgen) to the game.
//  Human units get medieval soldier or cavalry sheets in their faction's heraldry,
//  every general (except monsters) gets a hero sheet of their own with a matching
//  portrait, and fallen soldiers leave their bodies on the battlefield.
//  Everything is made on first use (seeded, so always the same picture) and then
//  kept; the rest is warmed up in the background a few pieces at a time.
//  Units with no generated look yet (monsters, artillery, beast riders) keep their
//  old sprites: Gen returns null for them.
//
//  A generated sheet is a canvas with .fw/.fh (frame size) and .pad (empty rows
//  under the feet). Its columns are down/up/left/right and its rows walk frames,
//  with the attack in row 4, like the old 16 px sheets.
// =============================================================================
const Gen = {
  on: typeof PixelGen !== 'undefined' && !!(PixelGen.GENERATORS && PixelGen.GENERATORS.soldier),
  cache: {},
  queue: [],

  // ---------------------------------------------------------------- unit looks
  // How each human unit is drawn: a soldier troop (with weapon / helm), a robed caster,
  // or a cavalry sheet. Units missing here keep their old sprite.
  UNITS: {
    knight:     { troop: 'knight' },
    lancer:     { cav: 'knight', weapon: 'lance' },
    archer:     { troop: 'archer' },
    mage:       { caster: 'hood', weapon: 'staff' },
    cleric:     { caster: 'coif', weapon: 'staff' },
    warden:     { troop: 'manatarms', weapon: 'halberd', helm: 'greathelm' },
    hunter:     { troop: 'archer', helm: 'hood' },
    shaman:     { caster: 'hood', weapon: 'staff' },
    ranger:     { troop: 'archer', helm: 'hood' },
    witch:      { caster: 'hood', weapon: 'staff' },
    druid:      { caster: 'hood', weapon: 'staff' },
    ashigaru:   { troop: 'spearman', helm: 'kettle' },
    brawler:    { troop: 'manatarms', weapon: 'mace', helm: 'bascinet' },
    emberider:  { cav: 'manatarms', weapon: 'sword' },
    nightmare:  { cav: 'knight', weapon: 'lance', coat: 'black' },
    tidemage:   { caster: 'hood', weapon: 'staff' },
    seapriest:  { caster: 'coif', weapon: 'staff' },
    nomad:      { troop: 'spearman', helm: 'hood' },
    sunguard:   { troop: 'knight', weapon: 'mace', helm: 'sallet' },
    sunpriest:  { caster: 'hood', weapon: 'staff' },
    militia:    { troop: 'levy' },
    bandit:     { troop: 'archer', helm: 'hood' },
    // beast riders
    bearrider:  { cav: 'manatarms', mount: 'bear', weapon: 'axe' },
    stagrider:  { cav: 'spearman', mount: 'stag', weapon: 'spear' },
    boarrider:  { cav: 'levy', mount: 'boar', weapon: 'axe' },
    camelrider: { cav: 'spearman', mount: 'camel', weapon: 'spear' },
    waverider:  { cav: 'spearman', mount: 'kelpie', weapon: 'spear' },
    // monsters (tools/pixelgen/creatures.js)
    yeti: { creature: 'yeti' }, frosteye: { creature: 'frosteye' }, beetle: { creature: 'beetle' }, flame: { creature: 'flame' },
    skeleton: { creature: 'skeleton' }, ninja: { creature: 'ninja' }, ghost: { creature: 'ghost' }, bonepriest: { creature: 'bonepriest' },
    slime: { creature: 'slime' }, beast: { creature: 'mudbrute' }, thorn: { creature: 'thornling' }, bogshaman: { creature: 'bogshaman' },
    fishfolk: { creature: 'fishfolk' }, bulwark: { creature: 'crab' }, crystal: { creature: 'crystaleye' }, hawk: { creature: 'firehawk' },
    frogman: { creature: 'frogman' },
    // artillery
    cannon: { creature: 'cannon' }, firecannon: { creature: 'firecannon' }, suncannon: { creature: 'suncannon' },
    mortar: { creature: 'mortar' }, catapult: { creature: 'catapult' },
  },
  // Monster generals: the creature each one is (drawn larger, crowned, with an aura).
  MONSTER_GENERALS: { brrn: 'yeti', grimbark: 'beetle', morrow: 'thornling', ignis: 'flame', morta: 'bonepriest', ooze: 'slime',
    krug: 'mudbrute', gill: 'fishfolk', shellos: 'crab', lumi: 'crystaleye', amun: 'mummy', zephyr: 'firehawk' },
  hasCreatures: typeof PixelGen !== 'undefined' && !!(PixelGen.GENERATORS && PixelGen.GENERATORS.creature),

  // the faction a unit is recruited by (for its colours)
  unitFaction(id) {
    if (!this._uf) {
      this._uf = {};
      for (const [f, list] of Object.entries(DATA.rosters || {})) for (const u of Object.keys(list)) if (!this._uf[u]) this._uf[u] = f;
    }
    return this._uf[id] || 'neutral';
  },

  // Key of a unit type's generated sheet in Assets.img, or null to keep the old sprite.
  unit(id) {
    if (!this.on || !this.UNITS[id]) return null;
    const key = 'gen:u:' + id;
    if (!Assets.img[key]) {
      const spec = this.UNITS[id], f = this.unitFaction(id), seed = 1 + (PixelGen.hashSeed(id) % 9973);
      let res;
      if (spec.creature) {
        if (!this.hasCreatures) return null;
        res = PixelGen.generate('creature', { seed, faction: f, creature: spec.creature });
        Assets.img[key] = this.canvas(res.img, 48, 48, 2, 5, res.scale);
        Assets.img[key].corpse = { x: 0, y: 240, w: 48, h: 48 };
        return key;
      }
      if (spec.cav) res = PixelGen.generate('cavalry', { seed, faction: f, troop: spec.cav, weapon: spec.weapon, coat: spec.coat, mount: spec.mount });
      else if (spec.caster) res = PixelGen.generate('soldier', { seed, faction: f, troop: 'archer', helm: spec.caster, weapon: spec.weapon, robe: 'yes' });
      else res = PixelGen.generate('soldier', { seed, faction: f, troop: spec.troop, weapon: spec.weapon, helm: spec.helm });
      Assets.img[key] = this.canvas(res.img, spec.cav ? 48 : 32, spec.cav ? 52 : 40, spec.cav ? 0 : 2, spec.cav ? 5 : 5);
      Assets.img[key].corpse = spec.cav ? { x: 0, y: 260, w: 64, h: 32, rider: { x: 70, y: 260, w: 40, h: 32 } } : { x: 0, y: 200, w: 40, h: 32, alt: { x: 44, y: 200 } };
    }
    return key;
  },

  // ---------------------------------------------------------------- heroes
  // Each general's archetype follows what they lead; lords are warlords.
  ARCHETYPES: {
    warrior: ['paladin', 'berserker', 'cavalier', 'shieldmaiden'],
    beast: ['berserker', 'shieldmaiden'],
    shooter: ['huntress', 'huntress', 'jester', 'alchemist'],
    artillery: ['alchemist'],
    mage: ['witch', 'necromancer', 'reaper', 'witch'],
    healer: ['monk', 'monk', 'witch', 'paladin'],
  },
  heroArchetype(gid) {
    const d = DATA.generals[gid];
    if (d.hero) return d.hero;                                    // set `hero` on a general to choose
    if (d.lord) return 'warlord';
    const t = (DATA.units[d.leads] || {}).type || 'infantry';
    const list = this.ARCHETYPES[t] || this.ARCHETYPES.warrior;
    return list[PixelGen.hashSeed('arch:' + gid) % list.length];
  },
  commanderOpts(gid) {
    const d = DATA.generals[gid], cls = DATA.classOf(gid), t = (DATA.units[d.leads] || {}).type;
    return { seed: 1 + (PixelGen.hashSeed('hero:' + gid) % 99991), faction: d.faction && DATA.factions[d.faction] ? d.faction : 'neutral',
      role: cls === 'marksman' ? 'marksman' : cls === 'mage' ? (t === 'healer' ? 'healer' : 'mage') : 'warrior', lord: d.lord ? 'yes' : 'no' };
  },
  heroOpts(gid) { return { seed: 1 + (PixelGen.hashSeed('hero:' + gid) % 99991), hero: this.heroArchetype(gid) }; },

  // Key of a general's hero sheet (monster generals: their creature as a general), or null.
  hero(gid) {
    const d = DATA.generals[gid];
    if (!this.on || !d) return null;
    const key = 'gen:h:' + gid;
    if (d.mface) {                                                  // a monster general: their creature, as a general
      const kind = this.MONSTER_GENERALS[gid] || (this.UNITS[d.leads] || {}).creature;
      if (!kind || !this.hasCreatures) return null;
      if (!Assets.img[key]) {
        const res = PixelGen.generate('creature', { seed: 1 + (PixelGen.hashSeed('hero:' + gid) % 99991), faction: d.faction, creature: kind, hero: 'yes' });
        Assets.img[key] = this.canvas(res.img, 48, 48, 2, 5, res.scale);
      }
      return key;
    }
    if (!Assets.img[key]) {
      // generals: commanders in their army's style, made grand (plumed helm or hat, cape, gilt; lords crowned)
      const res = PixelGen.GENERATORS.commander ? PixelGen.generate('commander', this.commanderOpts(gid)) : PixelGen.generate('champion', this.heroOpts(gid));
      Assets.img[key] = this.canvas(res.img, 40, 48, 2, 5);
    }
    return key;
  },
  // A portrait canvas (64 x 64) in one of three moods, or null.
  portrait(gid, mood = 'neutral') {
    const d = DATA.generals[gid];
    if (!this.on || !d) return null;
    const key = 'gen:p:' + gid;
    if (d.mface) {                                                  // monster generals have one face for every mood
      const kind = this.MONSTER_GENERALS[gid] || (this.UNITS[d.leads] || {}).creature;
      if (!kind || !this.hasCreatures) return null;
      if (!this.cache[key]) this.cache[key] = this.canvas(PixelGen.generate('creatureface', { seed: 1 + (PixelGen.hashSeed('hero:' + gid) % 99991), faction: d.faction, creature: kind }).img, 64, 64, 0, 1);
      return this.cache[key];
    }
    if (!this.cache[key]) {                                         // the same person as their battle sheet (see hero)
      const res = PixelGen.GENERATORS.commanderface ? PixelGen.generate('commanderface', this.commanderOpts(gid)) : PixelGen.generate('heroface', this.heroOpts(gid));
      this.cache[key] = this.canvas(res.img, 64, 64, 0, 0);
    }
    const i = Math.max(0, ['neutral', 'fierce', 'smile'].indexOf(mood));
    const ck = key + ':' + i;
    if (!this.cache[ck]) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      c.getContext('2d').drawImage(this.cache[key], i * 64, 0, 64, 64, 0, 0, 64, 64);
      this.cache[ck] = c;
    }
    return this.cache[ck];
  },
  // Guess a line's mood from its words (a scene can also set `mood` itself).
  moodOf(text) {
    const t = String(text || '');
    if (/\b(thank|glad|welcome|well done|rejoice|celebrat|feast|friend|haha|ha!|splendid|wonderful|good news|at last)/i.test(t)) return 'smile';
    if (/\b(die|death|kill|blood|traitor|never|crush|destroy|enough|how dare|war\b|burn|fight|attack|revenge|vengeance|curse)/i.test(t) || /!.*!/.test(t)) return 'fierce';
    return 'neutral';
  },

  // ---------------------------------------------------------------- helpers
  canvas(grid, fw, fh, pad, rows, scale = 1) {
    const c = document.createElement('canvas'); c.width = grid.w; c.height = grid.h;
    const x = c.getContext('2d');
    x.putImageData(new ImageData(grid.toRGBA(), grid.w, grid.h), 0, 0);
    c.fw = fw; c.fh = fh; c.pad = pad; c.rows = rows; c.scale = scale;   // scale: big creatures are drawn larger
    return c;
  },

  // Make everything ahead of time, a few pieces per idle moment, so first sight never stutters.
  warm() {
    if (!this.on) return;
    for (const id of Object.keys(this.UNITS)) if (DATA.units[id]) this.queue.push(() => this.unit(id));
    for (const gid of Object.keys(DATA.generals)) this.queue.push(() => this.hero(gid));
    const step = () => {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 12) { try { this.queue.shift()(); } catch (e) { console.warn(e); } }
      if (this.queue.length) setTimeout(step, 30);
    };
    setTimeout(step, 400);
  },
};
